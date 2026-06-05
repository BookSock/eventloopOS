import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AerospaceWorkspaceAdapter,
  attachWindowFrames,
  captureFocusedWindowPlan,
  captureFocusedWorkspacePlan,
  captureWorkspacePlan,
  focusWindowPlan,
  moveToWorkspacePlan,
  parseWindowFrameObservations,
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
          "window-layout": "floating",
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
        layout: undefined,
        frame: undefined,
      },
      {
        id: 42,
        app: "Terminal",
        title: "vim",
        workspace: "dev",
        monitorId: 2,
        pid: 1234,
        appBundleId: undefined,
        layout: "floating",
        frame: undefined,
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

  it("parses optional frame geometry from snapshots", () => {
    const windows = parseAerospaceWindows(
      JSON.stringify([
        {
          "window-id": 11,
          "app-name": "TextEdit",
          "window-title": "notes",
          workspace: "paper-a",
          frame: { x: 20, y: 40, width: 500, height: 300 },
        },
      ]),
    );

    assert.deepEqual(windows[0]?.frame, { x: 20, y: 40, width: 500, height: 300 });
  });

  it("parses System Events frame observations and attaches them by bundle/title", () => {
    const observations = parseWindowFrameObservations(
      [
        "TextEdit\tcom.apple.TextEdit\tShared Note\t10\t20\t500\t300",
        "Google Chrome\tcom.google.Chrome\tDocs\t700\t40\t900\t800",
      ].join("\n"),
    );
    const windows = attachWindowFrames(
      [
        { id: 21, app: "TextEdit", appBundleId: "com.apple.TextEdit", title: "Shared Note", workspace: "paper-a" },
        { id: 22, app: "Slack", appBundleId: "com.tinyspeck.slackmacgap", title: "Team", workspace: "paper-a" },
      ],
      observations,
    );

    assert.deepEqual(windows[0]?.frame, { x: 10, y: 20, width: 500, height: 300 });
    assert.equal(windows[1]?.frame, undefined);
  });

  it("uses a bounded timeout for System Events frame capture", async () => {
    const calls: Array<{ command: string; timeoutMs?: number }> = [];
    const adapter = new AerospaceWorkspaceAdapter(async (command, args, options) => {
      calls.push({ command, timeoutMs: options?.timeoutMs });
      if (command === "aerospace" && args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": 21, workspace: "paper-a" }]) };
      }
      if (command === "aerospace" && args[0] === "list-workspaces") {
        return { stdout: "paper-a\n" };
      }
      if (command === "aerospace") {
        return {
          stdout: JSON.stringify([
            {
              "window-id": 21,
              "app-name": "TextEdit",
              "app-bundle-id": "com.apple.TextEdit",
              "window-title": "Shared Note",
              workspace: "paper-a",
              "window-layout": "floating",
            },
          ]),
        };
      }
      return { stdout: "TextEdit\tcom.apple.TextEdit\tShared Note\t10\t20\t500\t300\n" };
    }, { frameCaptureTimeoutMs: 1_234 });

    const snapshot = await adapter.capture();

    assert.deepEqual(snapshot.windows[0]?.frame, { x: 10, y: 20, width: 500, height: 300 });
    assert.equal(calls.find((call) => call.command === "osascript")?.timeoutMs, 1_234);
    assert.deepEqual(snapshot.frameCapture, { status: "captured", timeoutMs: 1_234, observed: 1 });
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
      if (command === "osascript") {
        return { stdout: "Terminal\tcom.apple.Terminal\tshell\t20\t30\t640\t480\n" };
      }
      return {
        stdout: JSON.stringify([
          {
            "window-id": 3,
            "app-name": "Terminal",
            "app-bundle-id": "com.apple.Terminal",
            "window-title": "shell",
            workspace: "dev",
            "window-layout": "floating",
          },
        ]),
      };
    };

    const adapter = new AerospaceWorkspaceAdapter(exec);
    const snapshot = await adapter.capture();

    assert.deepEqual(calls, [
      captureWorkspacePlan(),
      captureFocusedWorkspacePlan(),
      captureFocusedWindowPlan(),
      { command: "osascript", args: ["-e", calls[3]?.args[1] ?? ""] },
    ]);
    assert.equal(snapshot.activeWorkspace, "dev");
    assert.equal(snapshot.focusedWindowId, 3);
    assert.deepEqual(snapshot.frameCapture, { status: "captured", timeoutMs: 2_500, observed: 1 });
    assert.deepEqual(snapshot.windows, [
      {
        id: 3,
        app: "Terminal",
        title: "shell",
        workspace: "dev",
        monitorId: undefined,
        pid: undefined,
        appBundleId: "com.apple.Terminal",
        layout: "floating",
        frame: { x: 20, y: 30, width: 640, height: 480 },
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

  it("does not move windows that are already on the saved paper workspace", () => {
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
      { id: 11, app: "Terminal", title: "shell", workspace: "dev" },
      { id: 12, app: "Safari", title: "docs", workspace: "manual" },
    ]);

    assert.deepEqual(plan, {
      skipped: [],
      commands: [
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

  it("restores floating layout, focuses workspace, then restores geometry before final focus", () => {
    const snapshot: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      focusedWindowId: 44,
      windows: [
        {
          id: 44,
          app: "TextEdit",
          appBundleId: "com.apple.TextEdit",
          title: "Shared Note",
          workspace: "paper-a",
          layout: "floating",
          frame: { x: 25, y: 50, width: 600, height: 420 },
        },
      ],
    };

    const plan = restoreWorkspacePlan(snapshot, [
      {
        id: 44,
        app: "TextEdit",
        appBundleId: "com.apple.TextEdit",
        title: "Shared Note",
        workspace: "paper-b",
        layout: "h_tiles",
      },
    ]);

    assert.equal(plan.skipped.length, 0);
    assert.deepEqual(plan.commands.slice(0, 4).map((command) => command.args[0]), [
      "move-node-to-workspace",
      "layout",
      "workspace",
      "-e",
    ]);
    assert.equal(plan.commands[1]?.command, "aerospace");
    assert.deepEqual(plan.commands[1]?.args, ["layout", "--window-id", "44", "floating"]);
    assert.deepEqual(plan.commands[2], { command: "aerospace", args: ["workspace", "paper-a"] });
    assert.equal(plan.commands[3]?.command, "osascript");
    assert.match(plan.commands[3]?.args[1] ?? "", /set position of candidateWindow to \{25, 50\}/);
    assert.match(plan.commands[3]?.args[1] ?? "", /set size of candidateWindow to \{600, 420\}/);
    assert.deepEqual(plan.commands.slice(-1), [
      { command: "aerospace", args: ["focus", "--window-id", "44"] },
    ]);
  });

  it("plans the same shared window at different geometry for different papers", () => {
    const current = [{ id: 44, app: "TextEdit", title: "Shared Note", workspace: "limbo", layout: "floating" as const }];
    const paperA: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-a",
      windows: [{ ...current[0]!, workspace: "paper-a", frame: { x: 10, y: 20, width: 500, height: 300 } }],
    };
    const paperB: WorkspaceSnapshot = {
      backend: "aerospace",
      activeWorkspace: "paper-b",
      windows: [{ ...current[0]!, workspace: "paper-b", frame: { x: 700, y: 100, width: 900, height: 650 } }],
    };

    const planA = restoreWorkspacePlan(paperA, current);
    const planB = restoreWorkspacePlan(paperB, current);

    assert.match(planA.commands.find((command) => command.command === "osascript")?.args[1] ?? "", /\{10, 20\}/);
    assert.match(planB.commands.find((command) => command.command === "osascript")?.args[1] ?? "", /\{700, 100\}/);
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
