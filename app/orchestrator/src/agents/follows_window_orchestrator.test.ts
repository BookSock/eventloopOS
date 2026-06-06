import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFollowsWindowOrchestrator,
  type FollowsWindowOrchestratorDeps,
} from "./follows_window_orchestrator.js";
import type { AerospaceCommand, WorkspaceSnapshot } from "../workspace/aerospace.js";
import type { FollowsWindowRecord } from "../store.js";

type RecordedActivity = { type: string; status?: string; details?: Record<string, unknown> };

function makeDeps(overrides: Partial<{
  manualMode: boolean;
  currentTaskId: string | null;
  focusedWorkspace: string | undefined;
  follows: FollowsWindowRecord[];
  snapshot: WorkspaceSnapshot;
  runError: Error | undefined;
  captureSnapshots: WorkspaceSnapshot[];
  claims: Array<{
    claim_id: string;
    task_id: string;
    window_id?: string;
    app_bundle?: string;
    title_prefix?: string;
    process_root_pid?: number;
    created_at: string;
  }>;
  taskWorkspaces: Record<string, string | undefined>;
  taskLayoutWorkspaces: Record<string, string | undefined>;
  taskSessions: Array<Record<string, unknown>>;
}> = {}): {
  deps: FollowsWindowOrchestratorDeps;
  ranCommands: AerospaceCommand[];
  activities: RecordedActivity[];
  prunedCalls: Date[];
} {
  const ranCommands: AerospaceCommand[] = [];
  const activities: RecordedActivity[] = [];
  const prunedCalls: Date[] = [];

  const focusedWorkspace = overrides.focusedWorkspace ?? "ws-2";
  const snapshot: WorkspaceSnapshot = overrides.snapshot ?? {
    backend: "aerospace",
    activeWorkspace: focusedWorkspace,
    windows: [
      { id: 100, app: "Slack", title: "Slack", workspace: "ws-1" },
      { id: 200, app: "Ghostty", title: "codex", workspace: "ws-2" },
    ],
  };
  const follows = overrides.follows ?? [{ window_id: "100", known_workspaces: ["ws-1", "ws-2"] }];
  let captureCount = 0;

  const deps: FollowsWindowOrchestratorDeps = {
    store: {
      async listFollowsWindows() {
        return follows;
      },
      async getCurrentTaskState() {
        return {
          current_task_id: overrides.currentTaskId === undefined ? "task_a" : overrides.currentTaskId,
          updated_at: "2026-05-06T12:00:00.000Z",
        };
      },
      async getManualModeState() {
        return { active: overrides.manualMode ?? false, updated_at: "2026-05-06T12:00:00.000Z" };
      },
      async pruneWindowWorkspaceObservations(olderThan: Date) {
        prunedCalls.push(olderThan);
        return 0;
      },
      async listTaskWindowClaims() {
        return overrides.claims ?? [];
      },
      async getTask(taskId: string) {
        const workspaceId = overrides.taskWorkspaces?.[taskId];
        if (!workspaceId) return undefined;
        return {
          task_id: taskId,
          primary_anchor_kind: "codex_thread",
          primary_anchor_id: `${taskId}_thread`,
          aerospace_workspace_id: workspaceId,
          created_at: "2026-05-06T12:00:00.000Z",
          updated_at: "2026-05-06T12:00:00.000Z",
          auto_paper_idle_seconds: 300,
        };
      },
      async getTaskLayout(taskId: string) {
        const workspaceId = overrides.taskLayoutWorkspaces?.[taskId];
        if (!workspaceId) return undefined;
        return {
          task_id: taskId,
          layout: {
            backend: "aerospace",
            activeWorkspace: workspaceId,
            windows: [],
          },
          updated_at: "2026-05-06T12:00:00.000Z",
        };
      },
    },
    workspace: {
      async capture() {
        const captureSnapshots = overrides.captureSnapshots;
        if (!captureSnapshots || captureSnapshots.length === 0) return snapshot;
        const next = captureSnapshots[Math.min(captureCount, captureSnapshots.length - 1)] ?? snapshot;
        captureCount += 1;
        return next;
      },
    },
    async getFocusedWorkspace() {
      return overrides.focusedWorkspace === undefined ? "ws-2" : overrides.focusedWorkspace;
    },
    async listTaskSessions() {
      return overrides.taskSessions ?? [];
    },
    async runAerospaceCommand(command) {
      if (overrides.runError) throw overrides.runError;
      ranCommands.push(command);
    },
    async getProcessAncestorPids(pid) {
      return pid === 520 ? [510, 500, 1] : [1];
    },
    observability: {
      async incrementCounter() {},
      async recordActivity(input) {
        activities.push({ type: input.type, status: input.status, details: input.details });
        return { id: `actv_${activities.length}`, ...input } as never;
      },
      async listActivity() {
        return [];
      },
      async snapshot() {
        return { counters: {}, activity_count: activities.length };
      },
    },
    pollIntervalMs: 1_000,
    ttlMs: 60 * 60 * 1_000,
    pruneIntervalMs: 60 * 60 * 1_000,
    now: () => new Date("2026-05-06T12:00:00.000Z"),
  };

  return { deps, ranCommands, activities, prunedCalls };
}

describe("follows_window_orchestrator", () => {
  it("skips when manual mode is active", async () => {
    const { deps, ranCommands, activities } = makeDeps({ manualMode: true });
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "skipped_manual_mode");
    assert.equal(ranCommands.length, 0);
    assert.ok(activities.some((a) => a.type === "follows_window_orchestrator_skipped_manual_mode"));
  });

  it("skips when no current task is bound", async () => {
    const { deps, ranCommands } = makeDeps({ currentTaskId: null });
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "skipped_no_current_task");
    assert.equal(ranCommands.length, 0);
  });

  it("moves follows windows on the first observed workspace switch", async () => {
    const { deps, ranCommands, activities } = makeDeps();
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.newWorkspace, "ws-2");
    assert.equal(result.moved, 1);
    assert.equal(result.alreadyOnTarget, 0);
    assert.equal(ranCommands.length, 1);
    assert.deepEqual(ranCommands[0]?.args, ["move-node-to-workspace", "--window-id", "100", "ws-2"]);
    assert.ok(activities.some((a) => a.type === "follows_window_moved"));
  });

  it("is idempotent — already-on-target windows are not moved again", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-2",
      windows: [
        { id: 100, app: "Slack", title: "Slack", workspace: "ws-2" },
        { id: 200, app: "Ghostty", title: "codex", workspace: "ws-2" },
      ],
    };
    const { deps, ranCommands, activities } = makeDeps({ snapshot });
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.moved, 0);
    assert.equal(result.alreadyOnTarget, 1);
    assert.equal(ranCommands.length, 0);
    assert.ok(activities.some((a) => a.type === "follows_window_already_on_target"));
  });

  it("does not re-fire when focused workspace is unchanged across ticks", async () => {
    const { deps, ranCommands } = makeDeps();
    const orch = createFollowsWindowOrchestrator(deps);
    const first = await orch.tick();
    assert.equal(first.decision, "switch_handled");
    const second = await orch.tick();
    assert.equal(second.decision, "no_change");
    assert.equal(ranCommands.length, 1, "second tick on same workspace must not re-issue moves");
  });

  it("moves a foreign task-claimed window back to the owning task workspace", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      windows: [
        { id: 100, app: "Ghostty", title: "paper A", workspace: "ws-a" },
        { id: 200, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Paper B Playwright", workspace: "ws-a" },
      ],
    };
    const { deps, ranCommands, activities } = makeDeps({
      focusedWorkspace: "ws-a",
      follows: [],
      snapshot,
      claims: [
        {
          claim_id: "twc_b_chrome",
          task_id: "task_b",
          window_id: "200",
          created_at: "2026-05-06T12:00:00.000Z",
        },
      ],
      taskWorkspaces: { task_b: "ws-b" },
    });

    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();

    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "200", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
    assert.ok(activities.some((a) => a.type === "foreign_claimed_window_redirected"));
    assert.ok(activities.some((a) => a.type === "foreign_claimed_window_focus_restored"));
  });

  it("retries focus restore after moving a foreign task-claimed window", async () => {
    const contaminatedSnapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      focusedWindowId: 200,
      windows: [
        { id: 100, app: "Ghostty", title: "paper A", workspace: "ws-a" },
        { id: 200, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Paper B Playwright", workspace: "ws-a" },
      ],
    };
    const stillOnOwnerSnapshot: WorkspaceSnapshot = {
      ...contaminatedSnapshot,
      activeWorkspace: "ws-b",
      windows: contaminatedSnapshot.windows.map((window) =>
        window.id === 200 ? { ...window, workspace: "ws-b" } : window,
      ),
    };
    const restoredFocusSnapshot: WorkspaceSnapshot = {
      ...stillOnOwnerSnapshot,
      activeWorkspace: "ws-a",
      focusedWindowId: 100,
    };
    const { deps, ranCommands, activities } = makeDeps({
      focusedWorkspace: "ws-a",
      follows: [],
      snapshot: contaminatedSnapshot,
      captureSnapshots: [contaminatedSnapshot, stillOnOwnerSnapshot, restoredFocusSnapshot],
      claims: [
        {
          claim_id: "twc_b_chrome",
          task_id: "task_b",
          window_id: "200",
          created_at: "2026-05-06T12:00:00.000Z",
        },
      ],
      taskWorkspaces: { task_b: "ws-b" },
    });

    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();

    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "200", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
    const restored = activities.find((activity) => activity.type === "foreign_claimed_window_focus_restored");
    assert.equal(restored?.details?.attempts, 2);
    assert.equal(restored?.details?.focus_window_id, 100);
  });

  it("moves a process-root descendant window away even when focused workspace is unchanged", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      windows: [
        { id: 100, app: "Ghostty", title: "paper A", workspace: "ws-a", pid: 100 },
        { id: 300, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Spawned Browser", workspace: "ws-a", pid: 520 },
      ],
    };
    const { deps, ranCommands } = makeDeps({
      focusedWorkspace: "ws-a",
      follows: [],
      snapshot,
      claims: [
        {
          claim_id: "twc_b_root",
          task_id: "task_b",
          process_root_pid: 500,
          created_at: "2026-05-06T12:00:00.000Z",
        },
      ],
      taskWorkspaces: { task_b: "ws-b" },
    });

    const orch = createFollowsWindowOrchestrator(deps);
    const first = await orch.tick();
    assert.equal(first.decision, "switch_handled");
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "300", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
    ranCommands.length = 0;

    const second = await orch.tick();
    assert.equal(second.decision, "no_change");
    if (second.decision !== "no_change") return;
    assert.equal(second.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "300", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
  });

  it("moves a task-session descendant window away before ambient autosave creates a claim", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      windows: [
        { id: 100, app: "Ghostty", title: "paper A", workspace: "ws-a", pid: 100 },
        { id: 302, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Task B Playwright", workspace: "ws-a", pid: 520 },
      ],
    };
    const { deps, ranCommands, activities } = makeDeps({
      focusedWorkspace: "ws-a",
      follows: [],
      snapshot,
      claims: [],
      taskSessions: [
        { id: "session_b", task_id: "task_b", provider: "codex", pid: 500 },
      ],
      taskWorkspaces: { task_b: "ws-b" },
    });

    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();

    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "302", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
    assert.ok(activities.some((activity) => activity.type === "foreign_claimed_window_redirected"));
  });

  it("uses the owner task saved layout when explicit workspace id is missing", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      windows: [
        { id: 100, app: "Ghostty", title: "paper A", workspace: "ws-a", pid: 100 },
        { id: 303, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Task B detached browser", workspace: "ws-a" },
      ],
    };
    const { deps, ranCommands } = makeDeps({
      focusedWorkspace: "ws-a",
      follows: [],
      snapshot,
      claims: [
        {
          claim_id: "twc_b_detached",
          task_id: "task_b",
          window_id: "303",
          created_at: "2026-05-06T12:00:00.000Z",
        },
      ],
      taskWorkspaces: {},
      taskLayoutWorkspaces: { task_b: "ws-b" },
    });

    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();

    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "303", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
  });

  it("moves a detached agent-claimed browser window away from the user's current paper", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      windows: [
        { id: 100, app: "Ghostty", title: "paper A", workspace: "ws-a", pid: 100 },
        {
          id: 301,
          app: "Google Chrome",
          appBundleId: "com.google.Chrome",
          title: "Task B checkout smoke - Google Chrome",
          workspace: "ws-a",
        },
      ],
    };
    const { deps, ranCommands } = makeDeps({
      focusedWorkspace: "ws-a",
      follows: [],
      snapshot,
      claims: [
        {
          claim_id: "twc_b_browser_title",
          task_id: "task_b",
          app_bundle: "com.google.chrome",
          title_prefix: "task b checkout smoke",
          created_at: "2026-05-06T12:00:00.000Z",
        },
      ],
      taskWorkspaces: { task_b: "ws-b" },
    });

    const orch = createFollowsWindowOrchestrator(deps);
    await orch.tick();
    ranCommands.length = 0;

    const result = await orch.tick();

    assert.equal(result.decision, "no_change");
    if (result.decision !== "no_change") return;
    assert.equal(result.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "301", "ws-b"],
      ["workspace", "ws-a"],
      ["focus", "--window-id", "100"],
    ]);
  });

  it("skips system windows in the blocklist", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-2",
      windows: [
        { id: 100, app: "Dock", title: "Dock", workspace: "ws-1" },
      ],
    };
    const { deps, ranCommands } = makeDeps({ snapshot });
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.moved, 0);
    assert.equal(result.skipped, 1);
    assert.equal(ranCommands.length, 0);
  });

  it("moves the slot's current window_id after a window restart (app_bundle+title_prefix slot path)", async () => {
    // Slot-resolved follows record: A1 was the original window, A2 is the new
    // window observed after the user killed+reopened the app.
    const follows: FollowsWindowRecord[] = [
      {
        window_id: "1002",
        known_workspaces: ["ws-1", "ws-2"],
        app_bundle: "com.tinyspeck.slackmacgap",
        title_prefix: "team-eng | slack",
        slot_window_ids: ["1001", "1002"],
      },
    ];
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-2",
      windows: [
        { id: 1002, app: "Slack", title: "Slack — team-eng", workspace: "ws-1" },
        { id: 999, app: "Ghostty", title: "codex", workspace: "ws-2" },
      ],
    };
    const { deps, ranCommands, activities } = makeDeps({ follows, snapshot });
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.moved, 1, "orchestrator must move the slot's current window_id, not the stale one");
    assert.equal(ranCommands.length, 1);
    assert.deepEqual(ranCommands[0]?.args, ["move-node-to-workspace", "--window-id", "1002", "ws-2"]);
    assert.ok(activities.some((a) => a.type === "follows_window_moved"));
  });

  it("skips follows windows not present in the snapshot", async () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-2",
      windows: [{ id: 200, app: "Ghostty", title: "codex", workspace: "ws-2" }],
    };
    const { deps, ranCommands, activities } = makeDeps({ snapshot });
    const orch = createFollowsWindowOrchestrator(deps);
    const result = await orch.tick();
    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.moved, 0);
    assert.equal(result.skipped, 1);
    assert.equal(ranCommands.length, 0);
    assert.ok(activities.some((a) => a.type === "follows_window_orchestrator_skipped_window"));
  });
});
