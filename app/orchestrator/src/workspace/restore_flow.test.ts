import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import { createInMemoryObservability } from "../observability.js";
import { handleWorkspaceRoute } from "../routes/workspace.js";
import { createRuntime } from "../runtime.js";
import type { InMemoryStore } from "../store.js";
import { restoreWorkspacePlan, type WorkspaceSnapshot } from "./aerospace.js";
import { parseWorkspaceSnapshot, type WorkspaceController } from "./controller.js";

describe("workspace restore flow routes", () => {
  it("proves capture, planning, disabled execution, and status without moving windows", async () => {
    const calls: string[] = [];
    const snapshot = {
      backend: "aerospace" as const,
      activeWorkspace: "eventloop-blog",
      focusedWindowId: 21,
      windows: [
        { id: 21, app: "Ghostty", title: "codex", workspace: "eventloop-blog" },
        { id: 22, app: "Chrome", title: "draft", workspace: "eventloop-web" },
      ],
    };
    const currentWindows = [
      { id: 21, app: "Ghostty", title: "codex", workspace: "manual" },
      { id: 22, app: "Chrome", title: "draft", workspace: "manual" },
    ];
    const parsedSnapshot = {
      ...snapshot,
      windows: snapshot.windows.map((window) => ({
        ...window,
        monitorId: undefined,
        pid: undefined,
        appBundleId: undefined,
        layout: undefined,
        frame: undefined,
      })),
    };
    const parsedCurrentWindows = currentWindows.map((window) => ({
      ...window,
      monitorId: undefined,
      pid: undefined,
      appBundleId: undefined,
      layout: undefined,
      frame: undefined,
    }));
    const workspace: WorkspaceController = {
      status() {
        calls.push("status");
        return { available: true, backend: "aerospace" };
      },
      capture() {
        calls.push("capture");
        return snapshot;
      },
      planRestore(snapshotInput, currentWindowsInput) {
        calls.push("planRestore");
        assert.deepEqual(snapshotInput, parsedSnapshot);
        assert.deepEqual(currentWindowsInput, parsedCurrentWindows);
        return {
          skipped: [],
          commands: [
            { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "21", "eventloop-blog"] },
            { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "22", "eventloop-web"] },
            { command: "aerospace", args: ["workspace", "eventloop-blog"] },
            { command: "aerospace", args: ["focus", "--window-id", "21"] },
          ],
        };
      },
      executeRestorePlan() {
        throw new Error("executeRestorePlan must stay gated off");
      },
    };
    const store = createInMemoryGatewayStore(emptyStore());
    const runtime = createRuntime({
      store,
      workspace,
      workspaceExecuteEnabled: false,
      observability: createInMemoryObservability(),
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });
    const base = {
      runtime,
      now: new Date("2026-05-07T12:00:00.000Z"),
    };

    const capture = await handleWorkspaceRoute({
      ...base,
      method: "POST",
      pathname: "/workspace/capture",
      readJsonBody: async () => ({ ok: true, value: {} }),
      requestId: "req_capture",
    });
    const plan = await handleWorkspaceRoute({
      ...base,
      method: "POST",
      pathname: "/workspace/restore-plan",
      readJsonBody: async () => ({ ok: true, value: { snapshot, current_windows: currentWindows } }),
      requestId: "req_plan",
    });
    const restore = await handleWorkspaceRoute({
      ...base,
      method: "POST",
      pathname: "/workspace/restore",
      readJsonBody: async () => ({ ok: true, value: { confirm_execute: true, snapshot, current_windows: currentWindows } }),
      requestId: "req_restore",
      idempotencyKey: "idem_workspace_restore_disabled",
    });
    const status = await handleWorkspaceRoute({
      ...base,
      method: "GET",
      pathname: "/workspace/status",
      readJsonBody: async () => ({ ok: true, value: {} }),
      requestId: "req_status",
    });

    assert.equal(capture?.status, 200);
    assert.equal(capture?.ok, true);
    assert.deepEqual(capture.body.snapshot, snapshot);
    assert.equal(plan?.status, 200);
    assert.equal(plan?.ok, true);
    assert.equal(plan.body.execute_supported, false);
    assert.deepEqual((plan.body.plan as { commands: unknown[] }).commands, [
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "21", "eventloop-blog"] },
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "22", "eventloop-web"] },
      { command: "aerospace", args: ["workspace", "eventloop-blog"] },
      { command: "aerospace", args: ["focus", "--window-id", "21"] },
    ]);
    assert.equal(restore?.status, 403);
    assert.equal(restore?.ok, false);
    assert.equal(restore?.code, "workspace_execute_disabled");
    assert.equal(await store.getWorkspaceRestoreReceipt("idem_workspace_restore_disabled"), undefined);
    assert.equal(status?.status, 200);
    assert.equal(status?.ok, true);
    assert.equal(status.body.execute_supported, false);
    assert.deepEqual(calls, ["capture", "planRestore", "status"]);
  });
});

describe("workspace restore plan multi-display moves", () => {
  it("emits move-node-to-monitor before move-node-to-workspace when monitor changed", () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      windows: [
        { id: 21, app: "Ghostty", title: "codex", workspace: "eventloop-blog", monitorId: 2 },
      ],
    };
    const currentWindows = [
      { id: 21, app: "Ghostty", title: "codex", workspace: "manual", monitorId: 1 },
    ];

    const plan = restoreWorkspacePlan(snapshot, currentWindows);

    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.commands, [
      { command: "aerospace", args: ["move-node-to-monitor", "--window-id", "21", "2"] },
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "21", "eventloop-blog"] },
    ]);
  });

  it("omits monitor move when saved monitor matches current monitor", () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      windows: [
        { id: 21, app: "Ghostty", title: "codex", workspace: "eventloop-blog", monitorId: 1 },
      ],
    };
    const currentWindows = [
      { id: 21, app: "Ghostty", title: "codex", workspace: "manual", monitorId: 1 },
    ];

    const plan = restoreWorkspacePlan(snapshot, currentWindows);

    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.commands, [
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "21", "eventloop-blog"] },
    ]);
  });

  it("round-trips three windows on three different monitors through snapshot parse and plan", () => {
    const rawSnapshot = {
      backend: "aerospace",
      windows: [
        { id: 31, app: "Ghostty", title: "codex", workspace: "eventloop-blog", "monitor-id": 1 },
        { id: 32, app: "Chrome", title: "draft", workspace: "eventloop-web", "monitor-id": 2 },
        { id: 33, app: "Slack", title: "team", workspace: "eventloop-comms", "monitor-id": 3 },
      ],
    };
    const parsed = parseWorkspaceSnapshot(rawSnapshot);
    assert.deepEqual(
      parsed.windows.map((window) => ({ id: window.id, monitorId: window.monitorId, workspace: window.workspace })),
      [
        { id: 31, monitorId: 1, workspace: "eventloop-blog" },
        { id: 32, monitorId: 2, workspace: "eventloop-web" },
        { id: 33, monitorId: 3, workspace: "eventloop-comms" },
      ],
    );

    // Current state: every window has drifted to monitor 1.
    const currentWindows = [
      { id: 31, app: "Ghostty", title: "codex", workspace: "manual", monitorId: 1 },
      { id: 32, app: "Chrome", title: "draft", workspace: "manual", monitorId: 1 },
      { id: 33, app: "Slack", title: "team", workspace: "manual", monitorId: 1 },
    ];

    const plan = restoreWorkspacePlan(parsed, currentWindows);

    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.commands, [
      // window 31 already on monitor 1, no monitor move
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "31", "eventloop-blog"] },
      { command: "aerospace", args: ["move-node-to-monitor", "--window-id", "32", "2"] },
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "32", "eventloop-web"] },
      { command: "aerospace", args: ["move-node-to-monitor", "--window-id", "33", "3"] },
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "33", "eventloop-comms"] },
    ]);
  });
});

function emptyStore(): InMemoryStore {
  return {
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}
