import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAmbientWorkspaceSaver,
  createAmbientWorkspaceSaverFromRuntime,
  filterSnapshotForTaskSave,
  snapshotFingerprint,
  type CurrentTaskState,
} from "./ambient_workspace_saver.js";
import type { WorkspaceSnapshot } from "../workspace/aerospace.js";
import type { Runtime } from "../runtime.js";

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

    const moved = snapshotFingerprint({
      backend: "aerospace",
      windows: [
        {
          id: 1,
          app: "App1",
          title: "Title 1",
          workspace: "main",
          layout: "floating",
          frame: { x: 40, y: 50, width: 600, height: 400 },
        },
        { id: 2, app: "App2", title: "Title 2", workspace: "main" },
      ],
    });
    assert.notEqual(a, moved, "layout/frame changes must change fingerprint");
  });

  it("filters saved task snapshots to active workspace plus follows windows", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 1,
      windows: [
        { id: 1, app: "TextEdit", title: "Reply", workspace: "paper-a" },
        { id: 2, app: "Music", title: "Personal", workspace: "personal" },
        { id: 3, app: "Slack", title: "Team", workspace: "paper-b" },
        { id: 4, app: "eventloopOS Queue", title: "eventloopOS Queue", workspace: "paper-a" },
        { id: 5, app: "Tailscale", title: "Tailscale", workspace: "paper-b" },
      ],
    };

    assert.deepEqual(filterSnapshotForTaskSave(snapshot, new Set(["3"])).windows.map((window) => window.id), [1, 3]);
    assert.deepEqual(filterSnapshotForTaskSave(snapshot, new Set(["3", "5"])).windows.map((window) => window.id), [1, 3]);

    const workspace = makeFakeWorkspace(snapshot);
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_paper_a" }),
      updateTaskLayout: async (taskId, nextSnapshot) => {
        writes.push({ taskId, snapshot: nextSnapshot });
      },
      isManualModeActive: () => false,
      getFollowsWindowIds: () => ["3"],
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    assert.equal((await saver.tick()).decision, "debounced");
    nowMs += 5_000;
    assert.equal((await saver.tick()).decision, "committed");
    assert.deepEqual(writes[0]?.snapshot.windows.map((window) => window.id), [1, 3]);
  });

  it("does not save windows explicitly tagged for a different task into the current paper", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 2,
      windows: [
        { id: 1, app: "TextEdit", title: "[task:paper a] reply", workspace: "paper-a" },
        { id: 2, app: "Google Chrome", title: "[task:paper b] Playwright report", workspace: "paper-a" },
        { id: 3, app: "Ghostty", title: "[task:paper b] codex", workspace: "paper-b" },
      ],
    };

    const filtered = filterSnapshotForTaskSave(snapshot, new Set(["3"]), "task_paper_a");

    assert.deepEqual(filtered.windows.map((window) => window.id), [1]);
    assert.equal(filtered.focusedWindowId, undefined, "focused foreign-task window must not be persisted as current paper focus");
  });

  it("does not save windows claimed by another task into the current paper", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 2,
      windows: [
        { id: 1, app: "TextEdit", title: "Reply", workspace: "paper-a" },
        { id: 2, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Playwright report", workspace: "paper-a" },
      ],
    };

    const filtered = filterSnapshotForTaskSave(snapshot, new Set(), "task_paper_a", [
      { task_id: "task_paper_b", app_bundle: "com.google.chrome", title_prefix: "playwright" },
    ]);

    assert.deepEqual(filtered.windows.map((window) => window.id), [1]);
    assert.equal(filtered.focusedWindowId, undefined, "focused foreign-claimed window must not be persisted");
  });

  it("keeps windows claimed by the current task", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 2,
      windows: [
        { id: 2, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Playwright report", workspace: "paper-a" },
      ],
    };

    const filtered = filterSnapshotForTaskSave(snapshot, new Set(), "task_paper_a", [
      { task_id: "task_paper_a", window_id: "2" },
    ]);

    assert.deepEqual(filtered.windows.map((window) => window.id), [2]);
    assert.equal(filtered.focusedWindowId, 2);
  });

  it("keeps user-created untagged windows on the active paper", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 2,
      windows: [
        { id: 1, app: "TextEdit", title: "[task:paper a] reply", workspace: "paper-a" },
        { id: 2, app: "Numbers", title: "Scratch budget", workspace: "paper-a" },
      ],
    };

    const filtered = filterSnapshotForTaskSave(snapshot, new Set(), "task_paper_a");

    assert.deepEqual(filtered.windows.map((window) => window.id), [1, 2]);
    assert.equal(filtered.focusedWindowId, 2);
  });

  it("infers task-window claims from tagged windows during ambient capture", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 2,
      windows: [
        { id: 1, app: "TextEdit", title: "[task:paper a] reply", workspace: "paper-a" },
        { id: 2, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "[task:paper b] Playwright report", workspace: "paper-a" },
      ],
    };
    const workspace = makeFakeWorkspace(snapshot);
    const obs = makeFakeObservability();
    const claims: Array<{
      taskId: string;
      windowId?: string;
      appBundle?: string;
      titlePrefix?: string;
      source?: string;
      ttlMs?: number;
    }> = [];
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_paper_a" }),
      updateTaskLayout: async () => {},
      isManualModeActive: () => false,
      claimTaskWindow: async (input) => {
        claims.push({
          taskId: input.taskId,
          windowId: input.windowId,
          appBundle: input.appBundle,
          titlePrefix: input.titlePrefix,
          source: input.source,
          ttlMs: input.ttlMs,
        });
      },
      getTaskWindowClaims: () => claims.map((claim) => ({
        task_id: claim.taskId,
        window_id: claim.windowId,
        app_bundle: claim.appBundle,
        title_prefix: claim.titlePrefix,
      })),
      observability: obs.recorder,
      now: () => new Date("2026-05-10T15:00:00.000Z"),
    });

    const result = await saver.tick();

    assert.equal(result.decision, "debounced");
    assert.deepEqual(claims, [
      {
        taskId: "task_paper_a",
        windowId: "1",
        appBundle: "TextEdit",
        titlePrefix: "[task:paper a] reply",
        source: "ambient_tagged_window",
        ttlMs: 1_800_000,
      },
      {
        taskId: "task_paper_b",
        windowId: "2",
        appBundle: "com.google.Chrome",
        titlePrefix: "[task:paper b] playwright report",
        source: "ambient_tagged_window",
        ttlMs: 1_800_000,
      },
    ]);
    assert.equal(obs.counters.get("task_window_claims_inferred_total"), 2);
    assert.ok(obs.activities.some((activity) => activity.type === "task_window_claims_inferred"));
  });

  it("infers task-window claims from task session process ancestry", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 2,
      windows: [
        { id: 1, app: "TextEdit", title: "Reply", workspace: "paper-a", pid: 100 },
        { id: 2, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Playwright report", workspace: "paper-a", pid: 500 },
      ],
    };
    const workspace = makeFakeWorkspace(snapshot);
    const obs = makeFakeObservability();
    const writes: Array<{ taskId: string; snapshot: WorkspaceSnapshot }> = [];
    const claims: Array<{
      taskId: string;
      windowId?: string;
      appBundle?: string;
      titlePrefix?: string;
      source?: string;
      ttlMs?: number;
    }> = [];
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const saver = createAmbientWorkspaceSaver({
      workspace,
      getCurrentTaskState: async () => ({ currentTaskId: "task_paper_a" }),
      updateTaskLayout: async (taskId, nextSnapshot) => {
        writes.push({ taskId, snapshot: nextSnapshot });
      },
      isManualModeActive: () => false,
      claimTaskWindow: async (input) => {
        claims.push({
          taskId: input.taskId,
          windowId: input.windowId,
          appBundle: input.appBundle,
          titlePrefix: input.titlePrefix,
          source: input.source,
          ttlMs: input.ttlMs,
        });
      },
      getTaskWindowClaims: () => claims.map((claim) => ({
        task_id: claim.taskId,
        window_id: claim.windowId,
        app_bundle: claim.appBundle,
        title_prefix: claim.titlePrefix,
      })),
      listTaskSessions: () => [
        { id: "task_session_b", task_id: "task_paper_b", provider: "codex", pid: 400 },
      ],
      getProcessAncestorPids: (pid) => pid === 500 ? [450, 400, 1] : [1],
      observability: obs.recorder,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    assert.equal((await saver.tick()).decision, "debounced");
    assert.deepEqual(claims, [
      {
        taskId: "task_paper_b",
        windowId: "2",
        appBundle: "com.google.Chrome",
        titlePrefix: "playwright report",
        source: "ambient_process_tree",
        ttlMs: 1_800_000,
      },
    ]);

    nowMs += 5_000;
    assert.equal((await saver.tick()).decision, "committed");
    assert.deepEqual(writes[0]?.snapshot.windows.map((window) => window.id), [1]);
    assert.equal(writes[0]?.snapshot.focusedWindowId, undefined);
    assert.equal(obs.counters.get("task_window_claims_process_tree_total"), 1);
    assert.ok(obs.activities.some((activity) => activity.type === "task_window_claims_process_tree"));
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

  it("runtime adapter commits both task layout and task workspace snapshot", async () => {
    const snapshot = makeSnapshot([1], { activeWorkspace: "paper-a" });
    const workspace = makeFakeWorkspace(snapshot);
    const obs = makeFakeObservability();
    const layoutWrites: Array<{ taskId: string; snapshot: WorkspaceSnapshot; now: Date }> = [];
    const taskSnapshotWrites: Array<{ taskId: string; snapshot: WorkspaceSnapshot; actorId?: string }> = [];
    const claims: Array<{ taskId: string; windowId?: string; source?: string }> = [];
    let nowMs = Date.parse("2026-05-10T15:00:00.000Z");
    const runtime = {
      workspace: makeFakeWorkspace({
        ...snapshot,
        windows: [{ id: 1, app: "Ghostty", title: "[task:alpha] codex", workspace: "paper-a" }],
      }),
      observability: obs.recorder,
      now: () => new Date(nowMs),
      store: {
        getCurrentTaskState: async () => ({ current_task_id: "task_alpha" }),
        updateTaskLayout: async (taskId: string, nextSnapshot: WorkspaceSnapshot, now: Date) => {
          assert.ok(now instanceof Date, "runtime adapter must pass the store timestamp");
          layoutWrites.push({ taskId, snapshot: nextSnapshot, now });
          return { task_id: taskId };
        },
        saveTaskWorkspaceSnapshot: async (input: { taskId: string; snapshot: WorkspaceSnapshot; actorId?: string }) => {
          taskSnapshotWrites.push({ taskId: input.taskId, snapshot: input.snapshot, actorId: input.actorId });
          return { task_id: input.taskId, snapshot: input.snapshot };
        },
        claimTaskWindow: async (input: { taskId: string; windowId?: string; source?: string }) => {
          claims.push({ taskId: input.taskId, windowId: input.windowId, source: input.source });
          return { task_id: input.taskId };
        },
        listTaskWindowClaims: async () => claims.map((claim) => ({
          task_id: claim.taskId,
          window_id: claim.windowId,
          source: claim.source,
        })),
        getManualModeState: async () => ({ active: false }),
      },
    } as unknown as Runtime;
    const saver = createAmbientWorkspaceSaverFromRuntime(runtime, { debounceMs: 3_000 });

    assert.ok(saver, "runtime adapter should create saver when workspace is configured");
    assert.equal((await saver.tick()).decision, "debounced");
    nowMs += 5_000;
    assert.equal((await saver.tick()).decision, "committed");
    assert.equal(layoutWrites.length, 1);
    assert.equal(taskSnapshotWrites.length, 1);
    assert.equal(layoutWrites[0].taskId, "task_alpha");
    assert.equal(layoutWrites[0].now.toISOString(), new Date(nowMs).toISOString());
    assert.equal(taskSnapshotWrites[0].taskId, "task_alpha");
    assert.equal(taskSnapshotWrites[0].actorId, "ambient-workspace-saver");
    assert.deepEqual(taskSnapshotWrites[0].snapshot, layoutWrites[0].snapshot);
    assert.deepEqual(claims, [{ taskId: "task_alpha", windowId: "1", source: "ambient_tagged_window" }]);
  });
});
