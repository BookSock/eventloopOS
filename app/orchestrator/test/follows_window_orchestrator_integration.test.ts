import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFollowsWindowOrchestrator } from "../src/agents/follows_window_orchestrator.js";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createInMemoryObservability } from "../src/observability.js";
import { createSeededStore } from "../src/store.js";
import type { AerospaceCommand, WorkspaceSnapshot } from "../src/workspace/aerospace.js";
import type { WorkspaceController } from "../src/workspace/controller.js";

function makeWorkspace(initial: WorkspaceSnapshot): WorkspaceController & { setSnapshot(next: WorkspaceSnapshot): void } {
  let snapshot = clone(initial);
  return {
    status() {
      return { available: true, backend: "aerospace" } as const;
    },
    capture() {
      return clone(snapshot);
    },
    planRestore() {
      throw new Error("planRestore not used in this test");
    },
    setSnapshot(next) {
      snapshot = clone(next);
    },
  };
}

function clone(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot;
}

describe("follows_window_orchestrator integration", () => {
  it("on workspace switch, moves a follows window onto the new workspace via the gateway store", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const observability = createInMemoryObservability();
    const baseTime = new Date("2026-05-10T12:00:00.000Z");

    const layout: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-1",
      focusedWindowId: 200,
      windows: [
        { id: 100, app: "Slack", title: "Slack", workspace: "ws-1" },
        { id: 200, app: "Ghostty", title: "codex", workspace: "ws-1" },
      ],
    };
    const taskA = await store.createTask({
      primaryAnchor: { kind: "ghostty_window", id: "win-200-task-a" },
      capturedLayout: layout,
      aerospaceWorkspaceId: "ws-1",
      now: baseTime,
    });
    const taskB = await store.createTask({
      primaryAnchor: { kind: "ghostty_window", id: "win-300-task-b" },
      capturedLayout: layout,
      aerospaceWorkspaceId: "ws-2",
      now: baseTime,
    });
    await store.createTask({
      primaryAnchor: { kind: "ghostty_window", id: "win-400-task-c" },
      capturedLayout: layout,
      aerospaceWorkspaceId: "ws-3",
      now: baseTime,
    });

    // Seed observations: window 100 (Slack) seen on three task workspaces.
    await store.recordWindowWorkspaceObservation({
      windowId: "100",
      workspaceId: "ws-1",
      isTaskWorkspace: true,
      observedAt: baseTime,
    });
    await store.recordWindowWorkspaceObservation({
      windowId: "100",
      workspaceId: "ws-2",
      isTaskWorkspace: true,
      observedAt: new Date(baseTime.getTime() + 60_000),
    });
    await store.recordWindowWorkspaceObservation({
      windowId: "100",
      workspaceId: "ws-3",
      isTaskWorkspace: true,
      observedAt: new Date(baseTime.getTime() + 90_000),
    });
    // Non-follows window 200: only on ws-1.
    await store.recordWindowWorkspaceObservation({
      windowId: "200",
      workspaceId: "ws-1",
      isTaskWorkspace: true,
      observedAt: baseTime,
    });

    await store.setCurrentTaskId(taskA.task.task_id, baseTime);

    const startSnapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-1",
      windows: [
        { id: 100, app: "Slack", title: "Slack", workspace: "ws-1" },
        { id: 200, app: "Ghostty", title: "codex A", workspace: "ws-1" },
        { id: 300, app: "Ghostty", title: "codex B", workspace: "ws-2" },
      ],
    };
    const workspace = makeWorkspace(startSnapshot);

    let focused = "ws-1";
    const ranCommands: AerospaceCommand[] = [];
    const orch = createFollowsWindowOrchestrator({
      store,
      workspace,
      async getFocusedWorkspace() {
        return focused;
      },
      async runAerospaceCommand(command) {
        ranCommands.push(command);
      },
      observability,
      pollIntervalMs: 1_000,
      ttlMs: 24 * 60 * 60 * 1_000,
      pruneIntervalMs: 60 * 60 * 1_000,
      now: () => baseTime,
    });

    const initial = await orch.tick();
    assert.equal(initial.decision, "switch_handled");
    if (initial.decision !== "switch_handled") return;
    assert.equal(initial.newWorkspace, "ws-1");
    assert.equal(initial.moved, 0, "Slack already on ws-1, no move");
    assert.equal(initial.alreadyOnTarget, 1);

    // User switches to ws-2 (task B). Slack must follow.
    focused = "ws-2";
    await store.setCurrentTaskId(taskB.task.task_id, new Date(baseTime.getTime() + 120_000));

    const switched = await orch.tick();
    assert.equal(switched.decision, "switch_handled");
    if (switched.decision !== "switch_handled") return;
    assert.equal(switched.newWorkspace, "ws-2");
    assert.equal(switched.moved, 1);
    assert.equal(switched.alreadyOnTarget, 0);
    assert.equal(ranCommands.length, 1);
    assert.deepEqual(ranCommands[0]?.args, ["move-node-to-workspace", "--window-id", "100", "ws-2"]);

    const activities = await observability.listActivity({ limit: 50 });
    assert.ok(activities.some((a) => a.type === "follows_window_moved"));
  });

  it("moves inactive task agent-spawned windows back to their owning task workspace", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const observability = createInMemoryObservability();
    const baseTime = new Date("2026-05-10T12:00:00.000Z");
    const layout: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "ws-a",
      windows: [],
    };

    const taskA = await store.createTask({
      primaryAnchor: { kind: "ghostty_window", id: "win-task-a" },
      capturedLayout: layout,
      aerospaceWorkspaceId: "ws-a",
      now: baseTime,
    });
    const taskB = await store.createTask({
      primaryAnchor: { kind: "ghostty_window", id: "win-task-b" },
      capturedLayout: layout,
      aerospaceWorkspaceId: "ws-b",
      now: baseTime,
    });
    await store.setCurrentTaskId(taskA.task.task_id, baseTime);
    await store.claimTaskWindow({
      taskId: taskB.task.task_id,
      processRootPid: 500,
      source: "agent_spawn_root",
      now: baseTime,
      ttlMs: 60_000,
    });

    const workspace = makeWorkspace({
      backend: "aerospace",
      activeWorkspace: "ws-a",
      focusedWindowId: 300,
      windows: [
        { id: 100, app: "Ghostty", title: "Task A", workspace: "ws-a", pid: 100 },
        { id: 300, app: "Google Chrome", appBundleId: "com.google.Chrome", title: "Playwright", workspace: "ws-a", pid: 520 },
      ],
    });
    const ranCommands: AerospaceCommand[] = [];
    const orch = createFollowsWindowOrchestrator({
      store,
      workspace,
      async getFocusedWorkspace() {
        return "ws-a";
      },
      async runAerospaceCommand(command) {
        ranCommands.push(command);
      },
      async getProcessAncestorPids(pid) {
        return pid === 520 ? [510, 500, 1] : [1];
      },
      observability,
      pollIntervalMs: 1_000,
      ttlMs: 24 * 60 * 60 * 1_000,
      pruneIntervalMs: 60 * 60 * 1_000,
      now: () => baseTime,
    });

    const result = await orch.tick();

    assert.equal(result.decision, "switch_handled");
    if (result.decision !== "switch_handled") return;
    assert.equal(result.foreignClaimedMoved, 1);
    assert.deepEqual(ranCommands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "300", "ws-b"],
    ]);
    const activities = await observability.listActivity({ limit: 50 });
    assert.ok(activities.some((a) => a.type === "foreign_claimed_window_redirected"));
  });
});
