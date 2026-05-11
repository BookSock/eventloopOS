import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AerospaceWorkspaceAdapter,
  captureFocusedWindowPlan,
  captureFocusedWorkspacePlan,
  captureWorkspacePlan,
  focusWindowPlan,
  moveToWorkspacePlan,
  parseAerospaceWindows,
  restoreWorkspacePlan,
  type ExecFunction,
  type WorkspaceSnapshot,
} from "./aerospace.js";

describe("Aerospace workspace adapter", () => {
  it("parses aerospace list-windows --json output deterministically", () => {
    const windows = parseAerospaceWindows(
      JSON.stringify([
        {
          "window-id": 42,
          "app-name": "Terminal",
          "window-title": "vim",
          workspace: "dev",
          "monitor-id": 2,
          "app-pid": 1234,
        },
        {
          "window-id": 7,
          "app-name": "Safari",
          "window-title": "Docs",
          workspace: "web",
        },
      ]),
    );

    assert.deepEqual(windows, [
      {
        id: 7,
        app: "Safari",
        title: "Docs",
        workspace: "web",
        monitorId: undefined,
        pid: undefined,
        appBundleId: undefined,
      },
      {
        id: 42,
        app: "Terminal",
        title: "vim",
        workspace: "dev",
        monitorId: 2,
        pid: 1234,
        appBundleId: undefined,
      },
    ]);
  });

  it("parses app-bundle-id when AeroSpace exposes it", () => {
    const windows = parseAerospaceWindows(
      JSON.stringify([
        {
          "window-id": 11,
          "app-name": "Slack",
          "app-bundle-id": "com.tinyspeck.slackmacgap",
          "window-title": "team-eng",
          workspace: "ws-1",
        },
      ]),
    );
    assert.equal(windows[0]?.appBundleId, "com.tinyspeck.slackmacgap");
  });

  it("reports missing aerospace binary from injected exec", async () => {
    const adapter = new AerospaceWorkspaceAdapter(async () => {
      const error = new Error("spawn aerospace ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    });

    const status = await adapter.capabilityStatus();

    assert.deepEqual(status, {
      available: false,
      backend: "aerospace",
      reason: "binary_missing",
      detail: "spawn aerospace ENOENT",
    });
  });

  it("reports permission denial from injected exec", async () => {
    const adapter = new AerospaceWorkspaceAdapter(async () => {
      const error = new Error("permission denied") as Error & { code: string };
      error.code = "EACCES";
      throw error;
    });

    const status = await adapter.capabilityStatus();

    assert.deepEqual(status, {
      available: false,
      backend: "aerospace",
      reason: "permission_denied",
      detail: "permission denied",
    });
  });

  it("reports unavailable AeroSpace server separately from malformed JSON", async () => {
    const adapter = new AerospaceWorkspaceAdapter(async () => {
      throw new Error("Can't connect to AeroSpace server. Is AeroSpace.app running?");
    });

    const status = await adapter.capabilityStatus();

    assert.deepEqual(status, {
      available: false,
      backend: "aerospace",
      reason: "server_unavailable",
      detail: "Can't connect to AeroSpace server. Is AeroSpace.app running?",
    });
  });

  it("uses injected exec for capture and never shells directly in unit tests", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const exec: ExecFunction = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "list-workspaces") return { stdout: "dev\n" };
      if (args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": 3, workspace: "dev" }]) };
      }
      return {
        stdout: JSON.stringify([{ "window-id": 3, "app-name": "Terminal", "window-title": "shell", workspace: "dev" }]),
      };
    };

    const adapter = new AerospaceWorkspaceAdapter(exec);
    const snapshot = await adapter.capture();

    assert.deepEqual(calls, [captureWorkspacePlan(), captureFocusedWorkspacePlan(), captureFocusedWindowPlan()]);
    assert.equal(snapshot.activeWorkspace, "dev");
    assert.equal(snapshot.focusedWindowId, 3);
    assert.deepEqual(snapshot.windows, [
      {
        id: 3,
        app: "Terminal",
        title: "shell",
        workspace: "dev",
        monitorId: undefined,
        pid: undefined,
        appBundleId: undefined,
      },
    ]);
  });

  it("generates safe command plans for move and focus", () => {
    assert.deepEqual(moveToWorkspacePlan(15, "dev"), {
      command: "aerospace",
      args: ["move-node-to-workspace", "--window-id", "15", "dev"],
    });

    assert.deepEqual(focusWindowPlan(15), {
      command: "aerospace",
      args: ["focus", "--window-id", "15"],
    });

    assert.throws(() => moveToWorkspacePlan(15, "dev;rm"), /unsafe aerospace workspace/);
    assert.throws(() => focusWindowPlan(-1), /unsafe aerospace window id/);
  });

  it("skips stale window ids during restore", () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      windows: [
        { id: 1, app: "Terminal", title: "old", workspace: "dev" },
        { id: 2, app: "Safari", title: "docs", workspace: "web" },
      ],
    };

    const plan = restoreWorkspacePlan(snapshot, [{ id: 2, app: "Safari", title: "docs", workspace: "dev" }]);

    assert.deepEqual(plan.skipped, [{ reason: "stale_window_id", windowId: 1, workspace: "dev" }]);
    assert.deepEqual(plan.commands, [
      {
        command: "aerospace",
        args: ["move-node-to-workspace", "--window-id", "2", "web"],
      },
    ]);
  });

  it("restores windows before focusing workspace and window", () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "dev",
      focusedWindowId: 11,
      windows: [
        { id: 11, app: "Terminal", title: "shell", workspace: "dev" },
        { id: 12, app: "Safari", title: "docs", workspace: "web" },
      ],
    };

    const plan = restoreWorkspacePlan(snapshot, [
      { id: 11, app: "Terminal", title: "shell", workspace: "web" },
      { id: 12, app: "Safari", title: "docs", workspace: "dev" },
    ]);

    assert.deepEqual(plan, {
      skipped: [],
      commands: [
        {
          command: "aerospace",
          args: ["move-node-to-workspace", "--window-id", "11", "dev"],
        },
        {
          command: "aerospace",
          args: ["move-node-to-workspace", "--window-id", "12", "web"],
        },
        {
          command: "aerospace",
          args: ["workspace", "dev"],
        },
        {
          command: "aerospace",
          args: ["focus", "--window-id", "11"],
        },
      ],
    });
  });

  it("executes only generated safe restore commands", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const adapter = new AerospaceWorkspaceAdapter(async (command, args) => {
      calls.push({ command, args });
      return { stdout: "ok", stderr: "" };
    });
    const plan = restoreWorkspacePlan(
      {
        backend: "aerospace",
        activeWorkspace: "dev",
        windows: [{ id: 11, app: "Terminal", title: "shell", workspace: "dev" }],
      },
      [{ id: 11, app: "Terminal", title: "shell", workspace: "manual" }],
    );

    const receipt = await adapter.executeRestorePlan(plan);

    assert.deepEqual(calls, [
      { command: "aerospace", args: ["move-node-to-workspace", "--window-id", "11", "dev"] },
      { command: "aerospace", args: ["workspace", "dev"] },
    ]);
    assert.equal(receipt.commands[0]?.stdout, "ok");
  });

  it("blocks unsafe restore execution commands", async () => {
    const adapter = new AerospaceWorkspaceAdapter(async () => {
      throw new Error("exec should not be called");
    });

    await assert.rejects(
      () => adapter.executeRestorePlan({
        commands: [{ command: "aerospace", args: ["workspace", "dev;rm"] }],
        skipped: [],
      }),
      /unsafe aerospace workspace/,
    );
  });
});
