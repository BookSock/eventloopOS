import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AutoPaperCodexIdleWatcher,
  type AutoPaperCodexIdleDeps,
  type AutoPaperTaskRecord,
} from "./auto_paper_codex_idle.js";
import type { CodexSessionInspection } from "./codex/session_inspector.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { StoredEventResult } from "../store.js";

type RecordedIngest = { event: McpEvent; now: Date };

function createDeps(input: {
  tasks: AutoPaperTaskRecord[];
  inspections: Map<string, CodexSessionInspection | CodexSessionInspection[]>;
  manualModeActive?: boolean;
  now?: Date;
  defaultIdleSeconds?: number;
}): AutoPaperCodexIdleDeps & {
  ingested: RecordedIngest[];
  emitted: Array<{ taskId: string; emittedAt: Date }>;
  setNow: (next: Date) => void;
  setInspection: (threadId: string, inspection: CodexSessionInspection) => void;
} {
  const ingested: RecordedIngest[] = [];
  const emitted: Array<{ taskId: string; emittedAt: Date }> = [];
  let now = input.now ?? new Date("2026-05-09T12:00:00.000Z");
  const inspectionMap = new Map<string, CodexSessionInspection | CodexSessionInspection[]>(input.inspections);
  return {
    registry: {
      async listTasks() {
        return input.tasks;
      },
      async recordTaskPaperEmitted(taskId: string, emittedAt: Date) {
        emitted.push({ taskId, emittedAt });
      },
    },
    ingestor: {
      async ingestEventAsReviewPacket(event, n) {
        ingested.push({ event, now: n });
        const result: StoredEventResult = {
          event,
          route_decision: {
            id: `rte_${event.id}`,
            event_id: event.id,
            action: "ask_human_now",
            confidence: "medium",
            evidence: [],
            created_at: n.toISOString(),
          },
        };
        return result;
      },
    },
    manualMode: {
      async getManualModeState() {
        return { active: Boolean(input.manualModeActive) };
      },
    },
    inspect: async (threadId) => {
      const value = inspectionMap.get(threadId);
      if (Array.isArray(value)) {
        const next = value.shift();
        if (!next) throw new Error(`no more inspections queued for ${threadId}`);
        return next;
      }
      if (!value) return { thread_id: threadId, exists: false };
      return value;
    },
    defaultIdleSeconds: input.defaultIdleSeconds,
    now: () => now,
    ingested,
    emitted,
    setNow: (next) => {
      now = next;
    },
    setInspection: (threadId, inspection) => {
      inspectionMap.set(threadId, inspection);
    },
  };
}

describe("AutoPaperCodexIdleWatcher", () => {
  it("emits a paper when idle threshold is met", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_alpha", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_alpha" },
      ],
      inspections: new Map([
        ["thread_alpha", {
          thread_id: "thread_alpha",
          exists: true,
          rollout_path: "/tmp/r.jsonl",
          last_event_at: "2026-05-09T11:00:00.000Z",
          idle_seconds: 3600,
          event_count: 3,
          recent_event_types: ["event_msg"],
          recent_summary: "event_msg/agent_message",
        }],
      ]),
    });
    const watcher = new AutoPaperCodexIdleWatcher(deps);
    const result = await watcher.tick();
    assert.equal(result.paused, false);
    assert.equal(result.emitted.length, 1);
    assert.equal(result.emitted[0]!.task_id, "task_alpha");
    assert.equal(deps.ingested.length, 1);
    assert.equal(deps.ingested[0]!.event.type, "codex.task_idle");
    // The watcher strips the leading "task_" so taskIdForHint can re-prefix it
    // and the resulting packet.task_id round-trips back to the original task.id.
    assert.equal(deps.ingested[0]!.event.task_hint, "alpha");
    assert.equal(deps.emitted.length, 1);
    assert.equal(deps.emitted[0]!.taskId, "task_alpha");
  });

  it("skips when idle threshold not met", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_recent", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_recent" },
      ],
      inspections: new Map([
        ["thread_recent", {
          thread_id: "thread_recent",
          exists: true,
          last_event_at: "2026-05-09T11:59:30.000Z",
          idle_seconds: 30,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]!.reason, "below_threshold");
    assert.equal(deps.ingested.length, 0);
    assert.equal(deps.emitted.length, 0);
  });

  it("throttles duplicate emits within the same idle period", async () => {
    const inspection: CodexSessionInspection = {
      thread_id: "thread_throttle",
      exists: true,
      last_event_at: "2026-05-09T11:00:00.000Z",
      idle_seconds: 3600,
      event_count: 1,
    };
    const deps = createDeps({
      tasks: [
        { id: "task_throttle", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_throttle" },
      ],
      inspections: new Map([["thread_throttle", inspection]]),
    });
    const watcher = new AutoPaperCodexIdleWatcher(deps);
    const first = await watcher.tick();
    const second = await watcher.tick();
    assert.equal(first.emitted.length, 1);
    assert.equal(second.emitted.length, 0);
    assert.equal(second.skipped[0]!.reason, "already_emitted_for_window");
    assert.equal(deps.ingested.length, 1);
    assert.equal(deps.emitted.length, 1);
  });

  it("emits a second paper after activity-then-new-idle", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_resume", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_resume" },
      ],
      inspections: new Map([
        ["thread_resume", [
          // Tick 1: idle 3600s past threshold -> emits, anchor pinned at 11:00.
          { thread_id: "thread_resume", exists: true, last_event_at: "2026-05-09T11:00:00.000Z", idle_seconds: 3600, event_count: 1 },
          // Tick 2: thread became active again 30s ago; idle below threshold -> skip, anchor cleared.
          { thread_id: "thread_resume", exists: true, last_event_at: "2026-05-09T12:00:00.000Z", idle_seconds: 30, event_count: 2 },
          // Tick 3: thread idle past threshold again under the new last_event_at -> emits a fresh paper.
          { thread_id: "thread_resume", exists: true, last_event_at: "2026-05-09T12:00:00.000Z", idle_seconds: 3600, event_count: 2 },
        ]],
      ]),
      now: new Date("2026-05-09T12:00:00.000Z"),
    });
    const watcher = new AutoPaperCodexIdleWatcher(deps);
    const first = await watcher.tick();
    assert.equal(first.emitted.length, 1, "first idle period emits");
    deps.setNow(new Date("2026-05-09T12:00:30.000Z"));
    const second = await watcher.tick();
    assert.equal(second.emitted.length, 0, "activity reset window: idle below threshold");
    assert.equal(second.skipped[0]!.reason, "below_threshold");
    deps.setNow(new Date("2026-05-09T13:00:00.000Z"));
    const third = await watcher.tick();
    assert.equal(third.emitted.length, 1, "new idle period emits a fresh paper");
    assert.equal(deps.ingested.length, 2);
    assert.equal(deps.emitted.length, 2);
  });

  it("skips entire tick when manual mode is active", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_paused", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_paused" },
      ],
      inspections: new Map([
        ["thread_paused", {
          thread_id: "thread_paused",
          exists: true,
          last_event_at: "2026-05-09T10:00:00.000Z",
          idle_seconds: 7200,
          event_count: 1,
        }],
      ]),
      manualModeActive: true,
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.paused, true);
    assert.equal(result.reason, "manual_mode_active");
    assert.equal(result.considered, 0);
    assert.equal(deps.ingested.length, 0);
    assert.equal(deps.emitted.length, 0);
  });

  it("skips non-codex anchors", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_ghostty", primary_anchor_kind: "ghostty_window", primary_anchor_id: "wnd_42" },
        { id: "task_codex", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_codex" },
      ],
      inspections: new Map([
        ["thread_codex", {
          thread_id: "thread_codex",
          exists: true,
          last_event_at: "2026-05-09T11:00:00.000Z",
          idle_seconds: 3600,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.considered, 1);
    assert.equal(result.emitted.length, 1);
    assert.equal(result.emitted[0]!.task_id, "task_codex");
  });

  it("respects per-task idle override", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_strict", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_strict", auto_paper_idle_seconds: 7200 },
      ],
      inspections: new Map([
        ["thread_strict", {
          thread_id: "thread_strict",
          exists: true,
          last_event_at: "2026-05-09T11:00:00.000Z",
          idle_seconds: 3600,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped[0]!.reason, "below_threshold");
  });
});
