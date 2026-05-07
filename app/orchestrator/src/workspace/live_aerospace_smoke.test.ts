import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLiveAerospaceSmoke } from "./live_aerospace_smoke.js";
import { captureWorkspacePlan, type ExecFunction } from "./aerospace.js";

describe("live AeroSpace smoke", () => {
  it("skips unless explicitly enabled", async () => {
    const result = await runLiveAerospaceSmoke({ enabled: false });

    assert.deepEqual(result, {
      ok: true,
      skipped: true,
      reason: "not_enabled",
    });
  });

  it("fails with capability reason when AeroSpace is unavailable", async () => {
    const exec: ExecFunction = async () => {
      const error = new Error("spawn aerospace ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    };

    const result = await runLiveAerospaceSmoke({ enabled: true, exec });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    if (!result.ok) {
      assert.equal(result.reason, "binary_missing");
      assert.equal(result.status.reason, "binary_missing");
    }
  });

  it("captures and plans without executing workspace changes", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const stdout = JSON.stringify([
      { "window-id": 8, "app-name": "Ghostty", "window-title": "codex", workspace: "eventloop-dev" },
      { "window-id": 9, "app-name": "Chrome", "window-title": "docs", workspace: "eventloop-web" },
    ]);
    const exec: ExecFunction = async (command, args) => {
      calls.push({ command, args });
      return { stdout };
    };

    const result = await runLiveAerospaceSmoke({ enabled: true, exec });

    assert.deepEqual(calls, [captureWorkspacePlan(), captureWorkspacePlan(), captureWorkspacePlan()]);
    assert.deepEqual(result, {
      ok: true,
      skipped: false,
      status: {
        available: true,
        backend: "aerospace",
      },
      window_count: 2,
      restore_plan_command_count: 2,
      restore_plan_skip_count: 0,
    });
  });

  it("optionally proves restore execution by moving a window to a scratch workspace and back", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const windows = [
      { "window-id": 8, "app-name": "Ghostty", "window-title": "codex", workspace: "eventloop-dev" },
      { "window-id": 9, "app-name": "Chrome", "window-title": "docs", workspace: "eventloop-web" },
    ];
    const exec: ExecFunction = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "list-windows") {
        return { stdout: JSON.stringify(windows) };
      }
      if (args[0] === "move-node-to-workspace") {
        const windowId = Number(args[2]);
        const workspace = args[3] ?? "";
        const window = windows.find((item) => item["window-id"] === windowId);
        if (!window) throw new Error(`missing fake window ${windowId}`);
        window.workspace = workspace;
        return { stdout: "" };
      }
      if (args[0] === "workspace" || args[0] === "focus") {
        return { stdout: "" };
      }
      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    };

    const result = await runLiveAerospaceSmoke({
      enabled: true,
      executeRestore: true,
      scratchWorkspace: "eventloop-smoke",
      exec,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (result.ok && !result.skipped) {
      assert.equal(result.execution_proof?.target_window_id, 8);
      assert.equal(result.execution_proof?.original_workspace, "eventloop-dev");
      assert.equal(result.execution_proof?.disturbed_workspace, "eventloop-smoke");
      assert.equal(result.execution_proof?.restored_workspace, "eventloop-dev");
      assert.equal(result.execution_proof?.disturb_command_count, 3);
      assert.equal(result.execution_proof?.restore_command_count, 4);
    }
    assert.equal(windows[0]?.workspace, "eventloop-dev");
    assert.deepEqual(
      calls.filter((call) => call.args[0] === "move-node-to-workspace").map((call) => call.args),
      [
        ["move-node-to-workspace", "--window-id", "8", "eventloop-smoke"],
        ["move-node-to-workspace", "--window-id", "8", "eventloop-dev"],
        ["move-node-to-workspace", "--window-id", "9", "eventloop-web"],
      ],
    );
  });

  it("uses a fallback scratch workspace when target is already in the requested scratch workspace", async () => {
    const windows = [{ "window-id": 8, "app-name": "Ghostty", "window-title": "codex", workspace: "eventloop-smoke" }];
    const exec: ExecFunction = async (_command, args) => {
      if (args[0] === "list-windows") {
        return { stdout: JSON.stringify(windows) };
      }
      if (args[0] === "move-node-to-workspace") {
        windows[0]!.workspace = args[3] ?? "";
        return { stdout: "" };
      }
      return { stdout: "" };
    };

    const result = await runLiveAerospaceSmoke({
      enabled: true,
      executeRestore: true,
      scratchWorkspace: "eventloop-smoke",
      exec,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (result.ok && !result.skipped) {
      assert.equal(result.execution_proof?.scratch_workspace, "eventloop-smoke-2");
      assert.equal(result.execution_proof?.restored_workspace, "eventloop-smoke");
    }
  });

  it("fails cleanly when restore execution is requested with no windows", async () => {
    const exec: ExecFunction = async (_command, args) => {
      if (args[0] === "list-windows") {
        return { stdout: "[]" };
      }
      throw new Error(`unexpected command ${args.join(" ")}`);
    };

    await assert.rejects(
      () => runLiveAerospaceSmoke({ enabled: true, executeRestore: true, exec }),
      /no AeroSpace windows available for restore execution proof/,
    );
  });
});
