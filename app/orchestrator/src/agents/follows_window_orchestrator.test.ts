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
    },
    workspace: {
      async capture() {
        return snapshot;
      },
    },
    async getFocusedWorkspace() {
      return overrides.focusedWorkspace === undefined ? "ws-2" : overrides.focusedWorkspace;
    },
    async runAerospaceCommand(command) {
      if (overrides.runError) throw overrides.runError;
      ranCommands.push(command);
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
