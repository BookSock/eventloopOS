import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AutoPaperCodexIdleWatcher,
  type AutoPaperCodexIdleDeps,
  type AutoPaperTaskRecord,
} from "./auto_paper_codex_idle.js";
import type { CodexSessionInspection } from "./codex/session_inspector.js";
import type { ClaudeSessionInspection } from "./claude/session_inspector.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { StoredEventResult } from "../store.js";
import type { TaskRuntimeSession } from "../task_sessions/types.js";

type RecordedIngest = { event: McpEvent; now: Date };

function createDeps(input: {
  tasks: AutoPaperTaskRecord[];
  inspections: Map<string, CodexSessionInspection | CodexSessionInspection[]>;
  claudeInspections?: Map<string, ClaudeSessionInspection | ClaudeSessionInspection[]>;
  taskSessions?: TaskRuntimeSession[];
  manualModeActive?: boolean;
  activeTaskId?: string | null;
  focusedCodex?: {
    codex_thread_id?: string | null;
    ghostty_window_id?: string | null;
    task_id?: string | null;
    terminal_ref?: string | null;
  };
  now?: Date;
  defaultIdleSeconds?: number;
  autoDormantSeconds?: number;
}): AutoPaperCodexIdleDeps & {
  ingested: RecordedIngest[];
  emitted: Array<{ taskId: string; emittedAt: Date }>;
  markedDormant: Array<{ taskId: string; dormantAt: Date }>;
  setNow: (next: Date) => void;
  setInspection: (threadId: string, inspection: CodexSessionInspection) => void;
} {
  const ingested: RecordedIngest[] = [];
  const emitted: Array<{ taskId: string; emittedAt: Date }> = [];
  const markedDormant: Array<{ taskId: string; dormantAt: Date }> = [];
  let now = input.now ?? new Date("2026-05-09T12:00:00.000Z");
  const inspectionMap = new Map<string, CodexSessionInspection | CodexSessionInspection[]>(input.inspections);
  const claudeInspectionMap = new Map<string, ClaudeSessionInspection | ClaudeSessionInspection[]>(input.claudeInspections ?? []);
  return {
    registry: {
      async listTasks() {
        return input.tasks;
      },
      async recordTaskPaperEmitted(taskId: string, emittedAt: Date) {
        emitted.push({ taskId, emittedAt });
      },
      async markTaskDormant(taskId: string, dormantAt: Date) {
        markedDormant.push({ taskId, dormantAt });
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
    activeTask: {
      async getCurrentTaskState() {
        return { current_task_id: input.activeTaskId ?? null, updated_at: now.toISOString() };
      },
    },
    focusedCodex: input.focusedCodex
      ? {
          async getFocusedCodex() {
            return input.focusedCodex ?? {};
          },
        }
      : undefined,
    taskSessions: input.taskSessions
      ? {
          listSessions() {
            return input.taskSessions ?? [];
          },
        }
      : undefined,
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
    inspectClaude: async (sessionId) => {
      const value = claudeInspectionMap.get(sessionId);
      if (Array.isArray(value)) {
        const next = value.shift();
        if (!next) throw new Error(`no more claude inspections queued for ${sessionId}`);
        return next;
      }
      if (!value) return { session_id: sessionId, exists: false };
      return value;
    },
    defaultIdleSeconds: input.defaultIdleSeconds,
    autoDormantSeconds: input.autoDormantSeconds,
    now: () => now,
    ingested,
    emitted,
    markedDormant,
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

  it("emits a paper for an idle Claude task session even when the task anchor is not Codex", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_claude_review", primary_anchor_kind: "ghostty_window", primary_anchor_id: "win-claude" },
      ],
      taskSessions: [
        {
          id: "task_session_claude_review",
          task_id: "task_claude_review",
          provider: "claude",
          native_session_id: "claude_session_review",
          status: "idle",
          updated_at: "2026-05-09T11:00:00.000Z",
        },
      ],
      inspections: new Map(),
      claudeInspections: new Map([
        ["claude_session_review", {
          session_id: "claude_session_review",
          exists: true,
          rollout_path: "/tmp/claude.jsonl",
          last_event_at: "2026-05-09T11:00:00.000Z",
          idle_seconds: 3600,
          event_count: 2,
          recent_event_types: ["assistant"],
          recent_summary: "assistant: Ready for review",
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.considered, 1);
    assert.equal(result.emitted.length, 1);
    assert.equal(result.emitted[0]!.task_id, "task_claude_review");
    assert.equal(deps.ingested[0]!.event.type, "claude.task_idle");
    assert.match(deps.ingested[0]!.event.title, /Claude session idle/);
    assert.match(deps.ingested[0]!.event.summary, /Ready for review/);
  });

  it("still considers a Claude task session when the same task has a Codex primary anchor", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_mixed_agents", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_mixed" },
      ],
      taskSessions: [
        {
          id: "task_session_claude_mixed",
          task_id: "task_mixed_agents",
          provider: "claude",
          native_session_id: "claude_session_mixed",
          status: "idle",
          updated_at: "2026-05-09T11:00:00.000Z",
        },
      ],
      inspections: new Map([
        ["thread_mixed", {
          thread_id: "thread_mixed",
          exists: true,
          last_event_at: "2026-05-09T11:45:00.000Z",
          idle_seconds: 10,
          event_count: 1,
        }],
      ]),
      claudeInspections: new Map([
        ["claude_session_mixed", {
          session_id: "claude_session_mixed",
          exists: true,
          rollout_path: "/tmp/claude-mixed.jsonl",
          last_event_at: "2026-05-09T11:00:00.000Z",
          idle_seconds: 3600,
          event_count: 2,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.considered, 2);
    assert.deepEqual(deps.ingested.map((entry) => entry.event.type), ["claude.task_idle"]);
  });

  it("emits a blocked session paper once, then waits for session update before re-emitting", async () => {
    const sessions: TaskRuntimeSession[] = [
      {
        id: "task_session_blocked",
        task_id: "task_agent_blocked",
        provider: "fake",
        status: "blocked",
        updated_at: "2026-05-09T11:00:00.000Z",
      },
    ];
    const deps = createDeps({
      tasks: [],
      taskSessions: sessions,
      inspections: new Map(),
    });
    const watcher = new AutoPaperCodexIdleWatcher(deps);
    const first = await watcher.tick();
    const second = await watcher.tick();
    assert.equal(first.emitted.length, 1);
    assert.equal(deps.ingested[0]!.event.type, "fake.task_blocked");
    assert.equal(second.emitted.length, 0);
    assert.equal(second.skipped[0]?.reason, "already_emitted_for_window");

    sessions[0] = { ...sessions[0]!, updated_at: "2026-05-09T11:10:00.000Z" };
    const third = await watcher.tick();
    assert.equal(third.emitted.length, 1);
    assert.equal(deps.ingested.length, 2);
  });

  it("emits a waiting session paper for approval/input statuses without needing a native thread anchor", async () => {
    const deps = createDeps({
      tasks: [],
      taskSessions: [
        {
          id: "task_session_waiting",
          task_id: "task_agent_waiting",
          provider: "codex",
          status: "waiting_approval",
          updated_at: "2026-05-09T11:20:00.000Z",
        },
        {
          id: "task_session_needs_input",
          task_id: "task_agent_input",
          provider: "claude",
          status: "Needs User Input",
          updated_at: "2026-05-09T11:25:00.000Z",
        },
      ],
      inspections: new Map(),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.considered, 2);
    assert.deepEqual(result.emitted.map((entry) => entry.task_id), [
      "task_agent_waiting",
      "task_agent_input",
    ]);
    assert.deepEqual(deps.ingested.map((entry) => entry.event.type), [
      "codex.task_waiting",
      "claude.task_waiting",
    ]);
    assert.match(deps.ingested[0]!.event.title, /Codex session waiting/);
    assert.match(deps.ingested[0]!.event.summary, /waiting for human input/);
    assert.equal(deps.ingested[0]!.event.raw_ref.uri, "eventloopos://task-sessions/task_session_waiting");
  });

  it("includes session context in waiting papers so the queue reminder is actionable", async () => {
    const deps = createDeps({
      tasks: [],
      taskSessions: [
        {
          id: "task_session_checkout",
          task_id: "task_checkout_polish",
          provider: "codex",
          status: "waiting_approval",
          name: "Checkout toast polish",
          status_detail: "Approve final copy before the agent resumes.",
          preview: "Fallback text that should not hide the status detail.",
          updated_at: "2026-05-09T11:20:00.000Z",
        },
      ],
      inspections: new Map(),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 1);
    assert.match(deps.ingested[0]!.event.summary, /Checkout toast polish/);
    assert.match(deps.ingested[0]!.event.summary, /Approve final copy/);
    assert.doesNotMatch(deps.ingested[0]!.event.summary, /Fallback text/);
  });

  it("does not spam waiting papers when a session has no timestamp fields", async () => {
    const deps = createDeps({
      tasks: [],
      taskSessions: [
        {
          id: "task_session_no_timestamp",
          task_id: "task_agent_no_timestamp",
          provider: "fake",
          status: "waiting_approval",
        },
      ],
      inspections: new Map(),
    });
    const watcher = new AutoPaperCodexIdleWatcher(deps);
    const first = await watcher.tick();
    deps.setNow(new Date("2026-05-09T12:00:30.000Z"));
    const second = await watcher.tick();
    assert.equal(first.emitted.length, 1);
    assert.equal(second.emitted.length, 0);
    assert.equal(second.skipped[0]?.reason, "already_emitted_for_window");
    assert.equal(deps.ingested.length, 1);
    assert.match(deps.ingested[0]!.event.idempotency_key ?? "", /status:waiting_approval:session:task_session_no_timestamp/);
  });

  it("recognizes common stuck/review/question task-session statuses without treating generic pending as waiting", async () => {
    const deps = createDeps({
      tasks: [],
      taskSessions: [
        {
          id: "task_session_stuck",
          task_id: "task_agent_stuck",
          provider: "codex",
          status: "stuck",
          updated_at: "2026-05-09T11:20:00.000Z",
        },
        {
          id: "task_session_review",
          task_id: "task_agent_review",
          provider: "claude",
          status: "Ready For Review",
          updated_at: "2026-05-09T11:21:00.000Z",
        },
        {
          id: "task_session_pending_approval",
          task_id: "task_agent_pending_approval",
          provider: "fake",
          status: "pending approval",
          updated_at: "2026-05-09T11:22:00.000Z",
        },
        {
          id: "task_session_question",
          task_id: "task_agent_question",
          provider: "codex",
          status: "question_for_user",
          updated_at: "2026-05-09T11:23:00.000Z",
        },
        {
          id: "task_session_approval_pending",
          task_id: "task_agent_approval_pending",
          provider: "codex",
          status: "approval pending",
          updated_at: "2026-05-09T11:24:00.000Z",
        },
        {
          id: "task_session_awaiting_review",
          task_id: "task_agent_awaiting_review",
          provider: "claude",
          status: "awaiting review",
          updated_at: "2026-05-09T11:25:00.000Z",
        },
        {
          id: "task_session_user_input_required",
          task_id: "task_agent_user_input_required",
          provider: "fake",
          status: "user_input_required",
          updated_at: "2026-05-09T11:26:00.000Z",
        },
        {
          id: "task_session_pending_generic",
          task_id: "task_agent_pending_generic",
          provider: "fake",
          status: "pending",
          updated_at: "2026-05-09T11:27:00.000Z",
        },
      ],
      inspections: new Map(),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.considered, 7);
    assert.deepEqual(result.emitted.map((entry) => entry.task_id), [
      "task_agent_stuck",
      "task_agent_review",
      "task_agent_pending_approval",
      "task_agent_question",
      "task_agent_approval_pending",
      "task_agent_awaiting_review",
      "task_agent_user_input_required",
    ]);
    assert.deepEqual(deps.ingested.map((entry) => entry.event.type), [
      "codex.task_blocked",
      "claude.task_waiting",
      "fake.task_waiting",
      "codex.task_waiting",
      "codex.task_waiting",
      "claude.task_waiting",
      "fake.task_waiting",
    ]);
  });

  it("does not paper generic unknown task-session statuses without a native anchor", async () => {
    const deps = createDeps({
      tasks: [],
      taskSessions: [
        {
          id: "task_session_pending",
          task_id: "task_agent_pending",
          provider: "fake",
          status: "pending",
          updated_at: "2026-05-09T11:20:00.000Z",
        },
      ],
      inspections: new Map(),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.considered, 0);
    assert.equal(result.emitted.length, 0);
    assert.equal(deps.ingested.length, 0);
  });

  it("does not double-consider a Codex task when both task primary anchor and task session point at it", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_codex_dupe", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_dupe" },
      ],
      taskSessions: [
        {
          id: "task_session_codex_dupe",
          task_id: "task_codex_dupe",
          provider: "codex",
          native_thread_id: "thread_dupe",
          status: "idle",
        },
      ],
      inspections: new Map([
        ["thread_dupe", {
          thread_id: "thread_dupe",
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
    assert.equal(deps.ingested.length, 1);
  });

  it("skips the currently active task so reading output does not paper the task under the user's eyes", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_active", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_active" },
      ],
      activeTaskId: "task_active",
      inspections: new Map([
        ["thread_active", {
          thread_id: "thread_active",
          exists: true,
          last_event_at: "2026-05-09T10:00:00.000Z",
          idle_seconds: 7200,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped[0]?.reason, "task_currently_active");
    assert.equal(deps.ingested.length, 0);
  });

  it("skips when the task's Codex thread is focused even if current task state is stale", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_focused_thread", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_focused" },
      ],
      activeTaskId: "task_other",
      focusedCodex: { codex_thread_id: "thread_focused", ghostty_window_id: "win-focused" },
      inspections: new Map([
        ["thread_focused", {
          thread_id: "thread_focused",
          exists: true,
          last_event_at: "2026-05-09T10:00:00.000Z",
          idle_seconds: 7200,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped[0]?.reason, "codex_thread_focused");
    assert.equal(deps.ingested.length, 0);
  });

  it("skips when the focused terminal is bound to the task", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_focused_terminal", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_terminal" },
      ],
      focusedCodex: { task_id: "task_focused_terminal", terminal_ref: "ghostty:win-focused" },
      inspections: new Map([
        ["thread_terminal", {
          thread_id: "thread_terminal",
          exists: true,
          last_event_at: "2026-05-09T10:00:00.000Z",
          idle_seconds: 7200,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped[0]?.reason, "task_focused_by_terminal");
    assert.equal(deps.ingested.length, 0);
  });

  it("skips already dormant tasks", async () => {
    const deps = createDeps({
      tasks: [
        {
          id: "task_dormant",
          primary_anchor_kind: "codex_thread",
          primary_anchor_id: "thread_dormant",
          dormant_at: "2026-05-08T12:00:00.000Z",
        },
      ],
      inspections: new Map([
        ["thread_dormant", {
          thread_id: "thread_dormant",
          exists: true,
          last_event_at: "2026-05-07T12:00:00.000Z",
          idle_seconds: 86400,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped[0]?.reason, "task_dormant");
    assert.equal(deps.ingested.length, 0);
  });

  it("marks very old idle tasks dormant instead of papering forever", async () => {
    const deps = createDeps({
      tasks: [
        { id: "task_stale", primary_anchor_kind: "codex_thread", primary_anchor_id: "thread_stale" },
      ],
      autoDormantSeconds: 3600,
      inspections: new Map([
        ["thread_stale", {
          thread_id: "thread_stale",
          exists: true,
          last_event_at: "2026-05-09T10:00:00.000Z",
          idle_seconds: 7200,
          event_count: 1,
        }],
      ]),
    });
    const result = await new AutoPaperCodexIdleWatcher(deps).tick();
    assert.equal(result.emitted.length, 0);
    assert.equal(result.skipped[0]?.reason, "marked_dormant");
    assert.equal(deps.markedDormant.length, 1);
    assert.equal(deps.markedDormant[0]?.taskId, "task_stale");
    assert.equal(deps.ingested.length, 0);
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
