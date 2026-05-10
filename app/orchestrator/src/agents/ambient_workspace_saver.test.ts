import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAmbientWorkspaceSaver,
  snapshotFingerprint,
  type CurrentTaskState,
} from "./ambient_workspace_saver.js";
import type { WorkspaceSnapshot } from "../workspace/aerospace.js";

type FakeWorkspace = {
  capture: () => WorkspaceSnapshot;
  setSnapshot: (snapshot: WorkspaceSnapshot) => void;
  captureCount: () => number;
};

function makeFakeWorkspace(initial: WorkspaceSnapshot): FakeWorkspace {
  let snapshot = clone(initial);
  let calls = 0;
  return {
    capture() {
      calls += 1;
      return clone(snapshot);
    },
    setSnapshot(next) {
      snapshot = clone(next);
    },
    captureCount() {
      return calls;
    },
  };
}

function clone(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot;
}

function makeSnapshot(windowIds: number[], extras?: Partial<WorkspaceSnapshot>): WorkspaceSnapshot {
  return {
    backend: "aerospace",
    windows: windowIds.map((id) => ({ id, app: `App${id}`, title: `Title ${id}`, workspace: "main" })),
    ...extras,
  };
}

type RecordedActivity = { type: string; task_id?: string; status?: string };

function makeFakeObservability() {
  const counters = new Map<string, number>();
  const activities: RecordedActivity[] = [];
  return {
    activities,
    counters,
    recorder: {
      async incrementCounter(name: string, by = 1) {
        counters.set(name, (counters.get(name) ?? 0) + by);
      },
      async recordActivity(input: { type: string; task_id?: string; status?: string }) {
        activities.push({ type: input.type, task_id: input.task_id, status: input.status });
        return { id: `actv_${activities.length}`, ...input } as never;
      },
      async listActivity() {
        return [];
      },
      async snapshot() {
        return { counters: {}, activity_count: activities.length };
      },
    },
  };
}

describe("ambient_workspace_saver", () => {
  it("skips with skipped_unbounded event when current_task_id is null", async () => {
    const workspace = makeFakeWorkspace(makeSnapshot([1, 2]));
    const obs = makeFakeObservability();
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async (): Promise<CurrentTaskState> => ({ currentTaskId: null }),
      updateTaskLayout: async (taskId, snapshot) => {
        writes.push({ taskId, snapshot });
      },
      isManualModeActive: () => false,
      observability: obs.recorder,
      now: () => new Date("2026-05-10T15:00:00.000Z"),
    });

    const result = await saver.tick();

    assert.equal(result.decision, "skipped_unbounded");
    assert.equal(writes.length, 0);
    assert.equal(workspace.captureCount(), 0, "must not even capture when unbounded");
    assert.deepEqual(
      obs.activities.map((a) => a.type),
      ["ambient_workspace_save_skipped_unbounded"],
    );
  });

  it("skips with skipped_unchanged event when current snapshot matches last saved", async () => {
    const snapshot = makeSnapshot([1, 2]);
    const workspace = makeFakeWorkspace(snapshot);
    const obs = makeFakeObservability();

    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_blog" }),
      updateTaskLayout: async (taskId, snap) => {
        writes.push({ taskId, snapshot: snap });
      },
      isManualModeActive: () => false,
      observability: obs.recorder,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    // First tick: change vs "no last saved" → debounced.
    let result = await saver.tick();
    assert.equal(result.decision, "debounced");

    // Advance past debounce, snapshot still the same → commit.
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "committed");
    assert.equal(writes.length, 1);

    // Now the saved fingerprint matches current → skipped_unchanged.
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "skipped_unchanged");
    assert.equal(writes.length, 1, "no second commit when unchanged");
    assert.ok(
      obs.activities.some((a) => a.type === "ambient_workspace_save_skipped_unchanged" && a.task_id === "task_blog"),
      "should emit skipped_unchanged event",
    );
  });

  it("debounces 3s before committing a changed snapshot", async () => {
    const initial = makeSnapshot([1]);
    const workspace = makeFakeWorkspace(initial);
    const obs = makeFakeObservability();
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");

    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_alpha" }),
      updateTaskLayout: async (taskId, snap) => {
        writes.push({ taskId, snapshot: snap });
      },
      isManualModeActive: () => false,
      observability: obs.recorder,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    // First tick — change observed (no prior saved snapshot for task) →
    // debounced, no write yet.
    let result = await saver.tick();
    assert.equal(result.decision, "debounced");
    assert.equal(writes.length, 0);

    // Advance 1s — still inside debounce window, no change to snapshot.
    nowMs += 1_000;
    result = await saver.tick();
    assert.equal(result.decision, "debounced");
    assert.equal(writes.length, 0, "must not commit before debounce elapses");

    // Advance to 3.0s+ since first observation — debounce elapsed → commit.
    nowMs += 2_500;
    result = await saver.tick();
    assert.equal(result.decision, "committed");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].taskId, "task_alpha");
    assert.ok(
      obs.activities.some((a) => a.type === "ambient_workspace_save_committed" && a.task_id === "task_alpha"),
      "should emit committed event",
    );
  });

  it("resets debounce window when snapshot keeps changing", async () => {
    const workspace = makeFakeWorkspace(makeSnapshot([1]));
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_alpha" }),
      updateTaskLayout: async (taskId, snap) => {
        writes.push({ taskId, snapshot: snap });
      },
      isManualModeActive: () => false,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    // First change observed.
    let result = await saver.tick();
    assert.equal(result.decision, "debounced");

    // Snapshot changes again 1s later → debounce window resets.
    nowMs += 1_000;
    workspace.setSnapshot(makeSnapshot([1, 2]));
    result = await saver.tick();
    assert.equal(result.decision, "debounced");

    // 2.5s after the most recent change — still inside the new debounce.
    nowMs += 2_500;
    result = await saver.tick();
    assert.equal(result.decision, "debounced");
    assert.equal(writes.length, 0, "no commit because debounce kept resetting");

    // 1s more (3.5s after the last change) — now elapsed, commit fires.
    nowMs += 1_000;
    result = await saver.tick();
    assert.equal(result.decision, "committed");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].snapshot.windows.length, 2);
  });

  it("skips when manual mode is active, even with current task and changed snapshot", async () => {
    const workspace = makeFakeWorkspace(makeSnapshot([1, 2]));
    const obs = makeFakeObservability();
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    let manual = true;
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_alpha" }),
      updateTaskLayout: async (taskId, snap) => {
        writes.push({ taskId, snapshot: snap });
      },
      isManualModeActive: () => manual,
      observability: obs.recorder,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date("2026-05-10T15:00:00.000Z"),
    });

    const result = await saver.tick();
    assert.equal(result.decision, "skipped_manual_mode");
    assert.equal(writes.length, 0);
    assert.equal(workspace.captureCount(), 0, "must not capture under manual mode");
    assert.ok(
      obs.activities.some((a) => a.type === "ambient_workspace_save_skipped_manual_mode"),
      "should emit skipped_manual_mode event",
    );

    // Once manual mode exits, normal flow resumes.
    manual = false;
    const next = await saver.tick();
    assert.equal(next.decision, "debounced", "first non-manual tick observes change → debounced");
  });

  it("clears pending state when current_task_id changes mid-debounce", async () => {
    const workspace = makeFakeWorkspace(makeSnapshot([1]));
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    let currentTaskId: string | null = "task_alpha";
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId }),
      updateTaskLayout: async (taskId, snap) => {
        writes.push({ taskId, snapshot: snap });
      },
      isManualModeActive: () => false,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    // First tick on task_alpha → debounced.
    let result = await saver.tick();
    assert.equal(result.decision, "debounced");

    // Switch to task_beta before debounce elapses.
    currentTaskId = "task_beta";
    nowMs += 1_000;
    result = await saver.tick();
    assert.equal(result.decision, "debounced", "new task → fresh debounce, not commit");
    assert.equal(writes.length, 0);

    // Advance past debounce on task_beta — commit lands for task_beta.
    nowMs += 4_000;
    result = await saver.tick();
    assert.equal(result.decision, "committed");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].taskId, "task_beta");
  });

  it("snapshotFingerprint is order-insensitive over windows but sensitive to title/workspace", () => {
    const a = snapshotFingerprint(makeSnapshot([1, 2]));
    const reversed = snapshotFingerprint({
      backend: "aerospace",
      windows: [
        { id: 2, app: "App2", title: "Title 2", workspace: "main" },
        { id: 1, app: "App1", title: "Title 1", workspace: "main" },
      ],
    });
    assert.equal(a, reversed, "fingerprint must be window-order-insensitive");

    const titleChanged = snapshotFingerprint({
      backend: "aerospace",
      windows: [
        { id: 1, app: "App1", title: "Different", workspace: "main" },
        { id: 2, app: "App2", title: "Title 2", workspace: "main" },
      ],
    });
    assert.notEqual(a, titleChanged, "title change must change fingerprint");
  });

  it("recovers from updateTaskLayout error and emits an error event", async () => {
    const workspace = makeFakeWorkspace(makeSnapshot([1]));
    const obs = makeFakeObservability();
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_alpha" }),
      updateTaskLayout: async () => {
        throw new Error("db_unreachable");
      },
      isManualModeActive: () => false,
      observability: obs.recorder,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    let result = await saver.tick();
    assert.equal(result.decision, "debounced");
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "error");
    assert.ok(
      obs.activities.some((a) => a.type === "ambient_workspace_save_error" && a.status === "failed"),
      "should emit error activity",
    );
  });

  it("records window-workspace observations on every snapshot capture", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-2",
      windows: [
        {
          id: 100,
          app: "Slack",
          title: "  Team-Eng | Slack",
          workspace: "ws-2",
          appBundleId: "com.tinyspeck.slackmacgap",
        },
        { id: 200, app: "Ghostty", title: "codex", workspace: "ws-1" },
      ],
    };
    const workspace = makeFakeWorkspace(snapshot);
    const obs = makeFakeObservability();
    const observations: Array<{
      windowId: string;
      workspaceId: string;
      isTaskWorkspace: boolean;
      appBundle?: string;
      titlePrefix?: string;
    }> = [];
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_a" }),
      updateTaskLayout: async () => {},
      isManualModeActive: () => false,
      recordWindowObservation: async (input) => {
        observations.push({
          windowId: input.windowId,
          workspaceId: input.workspaceId,
          isTaskWorkspace: input.isTaskWorkspace,
          appBundle: input.appBundle,
          titlePrefix: input.titlePrefix,
        });
      },
      observability: obs.recorder,
      now: () => new Date("2026-05-10T15:00:00.000Z"),
    });

    await saver.tick();
    assert.equal(observations.length, 2);
    const slack = observations.find((entry) => entry.windowId === "100");
    const ghostty = observations.find((entry) => entry.windowId === "200");
    assert.equal(slack?.workspaceId, "ws-2");
    assert.equal(slack?.isTaskWorkspace, true, "window on the active task workspace must be marked is_task_workspace=true");
    assert.equal(slack?.appBundle, "com.tinyspeck.slackmacgap", "app bundle id flows through when AeroSpace exposes it");
    assert.equal(slack?.titlePrefix, "team-eng | slack", "title is normalized to lowercase + trimmed");
    assert.equal(ghostty?.workspaceId, "ws-1");
    assert.equal(ghostty?.isTaskWorkspace, false, "window on a non-active workspace must not be marked is_task_workspace");
    assert.equal(ghostty?.appBundle, "Ghostty", "falls back to display name when bundle id absent");
    assert.equal(ghostty?.titlePrefix, "codex");
  });
});
