import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import {
  restoreWorkspacePlan,
  type AerospaceWindow,
  type RestoreExecutionReceipt,
  type RestorePlan,
  type WorkspaceSnapshot,
} from "../src/workspace/aerospace.js";
import type { WorkspaceController } from "../src/workspace/controller.js";

// V13 — Manual-mode round-trip proof against a fake AeroSpace controller.
//
// Manual mode now has an orchestrator pause primitive at `/modes/manual`, but
// the Mac client still owns the held workspace snapshot in
// `manualWorkspaceSnapshot: WorkspaceSnapshot?`. The workspace round trip
// reduces to:
//
//   enter  → POST /workspace/capture       (save current workbench)
//   exit   → POST /workspace/restore       (restore the saved workbench)
//
// The orchestrator pauses automation through `/modes/manual` in separate tests;
// this test focuses on capture/restore semantics. Any AeroSpace plan written by
// the orchestrator therefore only fires on the exit leg (the restore-plan that
// drives the loop back onto the original workbench). The "personal desktop"
// layout on enter is the user's pre-existing AeroSpace state; eventloopOS does
// not synthesize a layout for it, it only saves a snapshot of it.
//
// This test boots the gateway in-process with a fake/recording AeroSpace
// controller and drives exactly the same sequence the Mac client does, then
// asserts the recorded plans match the original workbench.

type RecordingWorkspace = WorkspaceController & {
  setWindows: (windows: AerospaceWindow[]) => void;
  recordedPlans: () => RestorePlan[];
  recordedReceipts: () => RestoreExecutionReceipt[];
  captureCount: () => number;
};

function createRecordingWorkspace(initial: AerospaceWindow[]): RecordingWorkspace {
  let windows: AerospaceWindow[] = initial.map((window) => ({ ...window }));
  let captureCalls = 0;
  const plans: RestorePlan[] = [];
  const receipts: RestoreExecutionReceipt[] = [];
  return {
    status() {
      return { available: true, backend: "aerospace", monitorCount: 1 } as const;
    },
    capture(): WorkspaceSnapshot {
      captureCalls += 1;
      const focused = windows[0];
      return {
        backend: "aerospace",
        windows: windows.map((window) => ({ ...window })),
        activeWorkspace: focused?.workspace,
        focusedWindowId: focused?.id,
      };
    },
    planRestore(snapshot, currentWindows) {
      const current = currentWindows ?? windows;
      const plan = restoreWorkspacePlan(snapshot, current);
      plans.push(plan);
      return plan;
    },
    executeRestorePlan(plan: RestorePlan): RestoreExecutionReceipt {
      const receipt: RestoreExecutionReceipt = {
        commands: plan.commands.map((command) => ({ ...command, stdout: "", stderr: "" })),
        skipped: plan.skipped,
      };
      receipts.push(receipt);
      // Mirror the AeroSpace effect: actually move our recorded windows so a
      // subsequent capture reflects the restored layout. We only track the
      // workspace string here — that is what manual-mode round-trip verifies.
      for (const command of plan.commands) {
        if (command.args[0] === "move-node-to-workspace" && command.args[1] === "--window-id") {
          const windowId = Number(command.args[2]);
          const targetWorkspace = command.args[3]!;
          const target = windows.find((window) => window.id === windowId);
          if (target) target.workspace = targetWorkspace;
        }
      }
      return receipt;
    },
    setWindows(next) {
      windows = next.map((window) => ({ ...window }));
    },
    recordedPlans() {
      return plans.map((plan) => ({
        commands: plan.commands.map((command) => ({ ...command, args: [...command.args] })),
        skipped: [...plan.skipped],
      }));
    },
    recordedReceipts() {
      return receipts.map((receipt) => ({
        commands: receipt.commands.map((command) => ({ ...command, args: [...command.args] })),
        skipped: [...receipt.skipped],
      }));
    },
    captureCount() {
      return captureCalls;
    },
  };
}

describe("manual mode round-trip — V13 integration proof", () => {
  let server: Server;
  let baseUrl: string;
  let workspace: RecordingWorkspace;
  const fixedNow = new Date("2026-05-10T12:00:00.000Z");

  // Original event-loop workbench: the layout we expect to be restored when
  // the user toggles manual mode off and returns to the loop.
  const originalWorkbench: AerospaceWindow[] = [
    { id: 201, app: "Ghostty", title: "[task:blog] codex", workspace: "eventloop-blog", monitorId: 1 },
    { id: 202, app: "Chrome", title: "blog draft", workspace: "eventloop-blog", monitorId: 1 },
    { id: 203, app: "Ghostty", title: "[task:reports] codex", workspace: "eventloop-reports", monitorId: 1 },
  ];

  before(async () => {
    workspace = createRecordingWorkspace(originalWorkbench);
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      workspace,
      workspaceExecuteEnabled: true,
      now: () => fixedNow,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  type CaptureResponse = { snapshot: WorkspaceSnapshot; request_id: string };
  type RestoreResponse = {
    ok: boolean;
    plan: RestorePlan;
    receipt: RestoreExecutionReceipt;
    execute_supported: boolean;
    idempotency_key: string;
    idempotency_replayed: boolean;
  };

  async function postCapture(): Promise<CaptureResponse> {
    const response = await fetch(`${baseUrl}/workspace/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    return await response.json() as CaptureResponse;
  }

  async function postRestore(snapshot: WorkspaceSnapshot, idempotencyKey: string): Promise<RestoreResponse> {
    const response = await fetch(`${baseUrl}/workspace/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        confirm_execute: true,
        snapshot,
      }),
    });
    assert.equal(response.status, 200, `restore unexpected status: ${response.status}`);
    return await response.json() as RestoreResponse;
  }

  it("enter manual mode: gateway captures the original workbench so the Mac can hold it", async () => {
    const capture = await postCapture();
    assert.equal(capture.snapshot.backend, "aerospace");
    assert.equal(capture.snapshot.windows.length, 3);
    assert.equal(workspace.captureCount(), 1);

    // The captured snapshot is exactly the original workbench. This is the
    // payload the Mac client stashes in `manualWorkspaceSnapshot` while the
    // user is in manual mode. No AeroSpace plan fires on enter — by design.
    assert.deepEqual(
      capture.snapshot.windows.map((window) => ({ id: window.id, workspace: window.workspace })),
      [
        { id: 201, workspace: "eventloop-blog" },
        { id: 202, workspace: "eventloop-blog" },
        { id: 203, workspace: "eventloop-reports" },
      ],
    );
    assert.equal(workspace.recordedPlans().length, 0, "no restore plan should fire on enter");
    assert.equal(workspace.recordedReceipts().length, 0, "no restore execution should fire on enter");
  });

  it("simulate manual-mode use: the user moves windows around to a personal desktop layout", () => {
    // While the user is in manual mode, AeroSpace state on the desktop drifts
    // because the user is doing whatever they want. This is the "personal
    // desktop" — eventloopOS does not synthesize it; it just lets the user
    // have it. We mutate the fake controller to reflect that.
    workspace.setWindows([
      { id: 201, app: "Ghostty", title: "[task:blog] codex", workspace: "personal", monitorId: 1 },
      { id: 202, app: "Chrome", title: "blog draft", workspace: "personal", monitorId: 1 },
      { id: 203, app: "Ghostty", title: "[task:reports] codex", workspace: "personal", monitorId: 1 },
    ]);
  });

  it("exit manual mode: gateway restores the original workbench from the held snapshot", async () => {
    // The Mac client holds the snapshot we returned from the enter-leg
    // capture. On exit it re-sends that exact snapshot to /workspace/restore.
    const heldSnapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "eventloop-blog",
      focusedWindowId: 201,
      windows: originalWorkbench.map((window) => ({ ...window })),
    };

    const restore = await postRestore(heldSnapshot, "idem_v13_exit_manual_mode");
    assert.equal(restore.ok, true);
    assert.equal(restore.idempotency_replayed, false);

    const plans = workspace.recordedPlans();
    assert.equal(plans.length, 1, "exactly one plan fires — the exit-manual restore");
    const plan = plans[0]!;

    // The plan must move every original window back to its original workspace.
    // Order matters per `restoreWorkspacePlan`: per-window workspace moves
    // first, then `workspace <activeWorkspace>` to focus, then `focus
    // --window-id <focusedWindowId>` last.
    assert.deepEqual(plan.commands, [
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "201", "eventloop-blog"] },
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "202", "eventloop-blog"] },
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "203", "eventloop-reports"] },
      { command: "aerospace", args: ["workspace", "eventloop-blog"] },
      { command: "aerospace", args: ["focus", "--window-id", "201"] },
    ]);
    assert.deepEqual(plan.skipped, []);

    const receipts = workspace.recordedReceipts();
    assert.equal(receipts.length, 1, "exactly one execution receipt — the exit leg");
    assert.equal(receipts[0]!.commands.length, plan.commands.length);
  });

  it("idempotency: re-sending the same exit-restore replays the cached receipt without firing a fresh plan", async () => {
    const heldSnapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "eventloop-blog",
      focusedWindowId: 201,
      windows: originalWorkbench.map((window) => ({ ...window })),
    };
    const planCountBefore = workspace.recordedPlans().length;
    const receiptCountBefore = workspace.recordedReceipts().length;

    const replay = await postRestore(heldSnapshot, "idem_v13_exit_manual_mode");
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotency_replayed, true, "second restore call must replay the cached receipt");

    assert.equal(workspace.recordedPlans().length, planCountBefore, "no fresh plan should fire on idempotent replay");
    assert.equal(workspace.recordedReceipts().length, receiptCountBefore, "no fresh execution should fire on idempotent replay");
  });
});

describe("manual mode round-trip — drift edge case", () => {
  // The honest concern from the V13 brief: while the user is in manual mode,
  // the queue/workbench can change (a new task arrives, an existing task
  // changes window layout). The Mac client's `manualWorkspaceSnapshot` must
  // remain stable — exit-manual should restore the *original* workbench, not
  // some drifted later snapshot. This test proves that the held snapshot
  // drives the restore unchanged regardless of capture-side drift.

  let server: Server;
  let baseUrl: string;
  let workspace: RecordingWorkspace;
  const fixedNow = new Date("2026-05-10T12:00:00.000Z");

  before(async () => {
    workspace = createRecordingWorkspace([
      { id: 301, app: "Ghostty", title: "[task:blog] codex", workspace: "eventloop-blog", monitorId: 1 },
      { id: 302, app: "Ghostty", title: "[task:reports] codex", workspace: "eventloop-reports", monitorId: 1 },
    ]);
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      workspace,
      workspaceExecuteEnabled: true,
      now: () => fixedNow,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("a new task arriving mid-manual-mode does not drift the held snapshot", async () => {
    // Enter manual mode → capture the original two-window workbench.
    const enterCapture = await fetch(`${baseUrl}/workspace/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const heldSnapshot = (await enterCapture.json() as { snapshot: WorkspaceSnapshot }).snapshot;
    assert.equal(heldSnapshot.windows.length, 2);

    // While in manual mode: a new task arrives — a third Ghostty window
    // appears, and the personal-desktop layout drifts.
    workspace.setWindows([
      { id: 301, app: "Ghostty", title: "[task:blog] codex", workspace: "personal", monitorId: 1 },
      { id: 302, app: "Ghostty", title: "[task:reports] codex", workspace: "personal", monitorId: 1 },
      { id: 303, app: "Ghostty", title: "[task:hotfix] codex", workspace: "personal", monitorId: 1 },
    ]);

    // Exit manual mode: the Mac client re-sends the *original* held snapshot,
    // not a fresh capture. Only the original two windows should be moved.
    const restore = await fetch(`${baseUrl}/workspace/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem_v13_drift_edge_exit",
      },
      body: JSON.stringify({
        confirm_execute: true,
        snapshot: heldSnapshot,
      }),
    });
    assert.equal(restore.status, 200);
    const restoreBody = await restore.json() as { plan: RestorePlan };

    // The new third window (id 303) must NOT appear in any move command —
    // the held snapshot only knows about 301 and 302.
    const moveTargets = restoreBody.plan.commands
      .filter((command) => command.args[0] === "move-node-to-workspace")
      .map((command) => ({ id: command.args[2], workspace: command.args[3] }));

    assert.deepEqual(moveTargets, [
      { id: "301", workspace: "eventloop-blog" },
      { id: "302", workspace: "eventloop-reports" },
    ]);
    // No move command should reference window 303.
    for (const command of restoreBody.plan.commands) {
      assert.notEqual(command.args[2], "303", "drifted-in window must not be touched by the restore plan");
    }
  });
});
