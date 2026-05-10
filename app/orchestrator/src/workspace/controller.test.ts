import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AerospaceWorkspaceController,
  parseRestoreExecuteRequest,
  parseRestorePlanRequest,
  parseWorkspaceSnapshot,
} from "./controller.js";
import { captureWorkspacePlan, type ExecFunction, type WorkspaceSnapshot } from "./aerospace.js";

describe("workspace controller", () => {
  it("captures AeroSpace workspace snapshots through injected exec", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const exec: ExecFunction = async (command, args) => {
      calls.push({ command, args });
      return {
        stdout: JSON.stringify([
          { "window-id": 9, "app-name": "Ghostty", "window-title": "codex", workspace: "eventloop-blog" },
        ]),
      };
    };

    const controller = new AerospaceWorkspaceController(exec);
    const snapshot = await controller.capture();

    assert.deepEqual(calls, [captureWorkspacePlan()]);
    assert.deepEqual(snapshot, {
      backend: "aerospace",
      windows: [
        {
          id: 9,
          app: "Ghostty",
          title: "codex",
          workspace: "eventloop-blog",
          monitorId: undefined,
          pid: undefined,
          appBundleId: undefined,
        },
      ],
    });
  });

  it("plans restore without executing workspace commands", async () => {
    const exec: ExecFunction = async () => {
      throw new Error("exec should not be called when current windows supplied");
    };
    const controller = new AerospaceWorkspaceController(exec);
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "eventloop-blog",
      focusedWindowId: 9,
      windows: [
        { id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog" },
        { id: 10, app: "Chrome", title: "draft", workspace: "eventloop-web" },
      ],
    };

    const plan = await controller.planRestore(snapshot, [
      { id: 9, app: "Ghostty", title: "codex", workspace: "manual" },
      { id: 10, app: "Chrome", title: "draft", workspace: "manual" },
    ]);

    assert.deepEqual(plan.commands.map((command) => command.args), [
      ["move-node-to-workspace", "--window-id", "9", "eventloop-blog"],
      ["move-node-to-workspace", "--window-id", "10", "eventloop-web"],
      ["workspace", "eventloop-blog"],
      ["focus", "--window-id", "9"],
    ]);
    assert.deepEqual(plan.skipped, []);
  });

  it("parses restore requests with snake-case active and focused fields", () => {
    const request = parseRestorePlanRequest({
      snapshot: {
        backend: "aerospace",
        active_workspace: "eventloop-blog",
        focused_window_id: 9,
        windows: [{ id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog" }],
      },
      current_windows: [{ id: 9, app: "Ghostty", title: "codex", workspace: "manual" }],
    });

    assert.equal(request.snapshot.activeWorkspace, "eventloop-blog");
    assert.equal(request.snapshot.focusedWindowId, 9);
    assert.equal(request.currentWindows?.[0].workspace, "manual");
  });

  it("requires explicit confirmation for restore execute requests", () => {
    assert.throws(
      () => parseRestoreExecuteRequest({ snapshot: { backend: "aerospace", windows: [] } }),
      /confirm_execute true/,
    );

    const request = parseRestoreExecuteRequest({
      confirm_execute: true,
      snapshot: {
        backend: "aerospace",
        windows: [{ id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog" }],
      },
    });
    assert.equal(request.snapshot.windows[0]?.id, 9);
  });

  it("rejects malformed snapshots", () => {
    assert.throws(() => parseWorkspaceSnapshot({ backend: "spaces", windows: [] }), /backend must be aerospace/);
    assert.throws(
      () => parseWorkspaceSnapshot({ backend: "aerospace", windows: [{ id: 1, workspace: "bad;name" }] }),
      /unsafe aerospace workspace/,
    );
  });
});
