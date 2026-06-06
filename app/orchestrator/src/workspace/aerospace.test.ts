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
  restoreWindowFramePlan,
  restoreWorkspaceResidualPlan,
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

  it("attaches Chrome frames when AeroSpace appends the app name to the title", () => {
    const observations = parseWindowFrameObservations(
      "Google Chrome\tcom.google.Chrome\teventloopOS Human Demo Customer Thread\t40\t60\t980\t720\n",
    );
    const windows = attachWindowFrames(
      [
        {
          id: 514,
          app: "Google Chrome",
          appBundleId: "com.google.Chrome",
          title: "eventloopOS Human Demo Customer Thread - Google Chrome",
          workspace: "demo-customer",
        },
      ],
      observations,
    );

    assert.deepEqual(windows[0]?.frame, { x: 40, y: 60, width: 980, height: 720 });
  });

  it("restores Chrome frames when System Events strips the app suffix from the window title", () => {
    const plan = restoreWindowFramePlan({
      id: 568,
      app: "Google Chrome",
      appBundleId: "com.google.Chrome",
      title: "eventloopOS Human Demo Metrics Review - Google Chrome",
      workspace: "demo-metrics",
      frame: { x: 760, y: 70, width: 980, height: 690 },
    });

    assert.equal(plan?.command, "osascript");
    const script = plan?.args[1] ?? "";
    assert.match(script, /windowName is "eventloopOS Human Demo Metrics Review"/);
    assert.match(script, /windowName is "eventloopOS Human Demo Metrics Review - Google Chrome"/);
    assert.match(script, /set position of candidateWindow to \{760, 70\}/);
  });

  it("does not attach stripped-title observations across different Chrome windows", () => {
    const observations = parseWindowFrameObservations(
      "Google Chrome\tcom.google.Chrome\teventloopOS Human Demo Metrics Review\t760\t70\t980\t690\n",
    );
    const windows = attachWindowFrames(
      [
        {
          id: 514,
          app: "Google Chrome",
          appBundleId: "com.google.Chrome",
          title: "eventloopOS Human Demo Customer Thread - Google Chrome",
          workspace: "demo-customer",
        },
      ],
      observations,
    );

    assert.equal(windows[0]?.frame, undefined);
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

  it("limits frame capture to requested window ids", async () => {
    const osascripts: string[] = [];
    const adapter = new AerospaceWorkspaceAdapter(async (command, args) => {
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
            },
            {
              "window-id": 22,
              "app-name": "Ghostty",
              "app-bundle-id": "com.mitchellh.ghostty",
              "window-title": "~",
              workspace: "paper-a",
            },
          ]),
        };
      }
      osascripts.push(args[1] ?? "");
      return { stdout: "TextEdit\tcom.apple.TextEdit\tShared Note\t10\t20\t500\t300\n" };
    });

    const snapshot = await adapter.capture({ frameWindowIds: [21] });

    assert.deepEqual(snapshot.windows[0]?.frame, { x: 10, y: 20, width: 500, height: 300 });
    assert.equal(snapshot.windows[1]?.frame, undefined);
    assert.equal(osascripts.length, 1);
    assert.match(osascripts[0] ?? "", /com\.apple\.TextEdit/);
    assert.doesNotMatch(osascripts[0] ?? "", /com\.mitchellh\.ghostty/);
  });

  it("skips frame capture when captureFrames is false", async () => {
    const calls: string[] = [];
    const adapter = new AerospaceWorkspaceAdapter(async (command, args) => {
      calls.push(`${command}:${args[0]}`);
      if (command === "osascript") throw new Error("osascript should not be called");
      if (command === "aerospace" && args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": 21, workspace: "paper-a" }]) };
      }
      if (command === "aerospace" && args[0] === "list-workspaces") {
        return { stdout: "paper-a\n" };
      }
      return {
        stdout: JSON.stringify([
          {
            "window-id": 21,
            "app-name": "TextEdit",
            "app-bundle-id": "com.apple.TextEdit",
            "window-title": "Shared Note",
            workspace: "paper-a",
          },
        ]),
      };
    });

    const snapshot = await adapter.capture({ captureFrames: false });

    assert.equal(snapshot.windows[0]?.frame, undefined);
    assert.deepEqual(snapshot.frameCapture, { status: "skipped", timeoutMs: 2_500, observed: 0 });
    assert.deepEqual(calls, [
      "aerospace:list-windows",
      "aerospace:list-workspaces",
      "aerospace:list-windows",
    ]);
  });

  it("captures active workspace frames without redundant focus commands", async () => {
    const events: string[] = [];
    const adapter = new AerospaceWorkspaceAdapter(async (command, args) => {
      if (command === "aerospace" && args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": 21, workspace: "paper-a" }]) };
      }
      if (command === "aerospace" && args[0] === "list-workspaces") {
        return { stdout: "paper-a\n" };
      }
      if (command === "aerospace" && args[0] === "workspace") {
        events.push(`workspace:${args[1]}`);
        return { stdout: "ok" };
      }
      if (command === "aerospace" && args[0] === "focus") {
        events.push(`focus:${args[2]}`);
        return { stdout: "ok" };
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
            },
          ]),
        };
      }
      events.push("osascript");
      return { stdout: "TextEdit\tcom.apple.TextEdit\tShared Note\t10\t20\t500\t300\n" };
    }, {
      workspaceFocusSettleMs: 0,
    });

    const snapshot = await adapter.capture({
      frameWindowIds: [21],
      focusFrameWorkspaces: true,
      restoreFrameCaptureFocus: true,
    });

    assert.deepEqual(snapshot.windows[0]?.frame, { x: 10, y: 20, width: 500, height: 300 });
    assert.deepEqual(events, ["osascript"]);
  });

  it("captures requested frames by workspace without refocusing the active workspace", async () => {
    const events: string[] = [];
    let currentWorkspace = "paper-a";
    const adapter = new AerospaceWorkspaceAdapter(async (command, args) => {
      if (command === "aerospace" && args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": 21, workspace: "paper-a" }]) };
      }
      if (command === "aerospace" && args[0] === "list-workspaces") {
        return { stdout: "paper-a\n" };
      }
      if (command === "aerospace" && args[0] === "workspace") {
        currentWorkspace = args[1] ?? "";
        events.push(`workspace:${currentWorkspace}`);
        return { stdout: "ok" };
      }
      if (command === "aerospace" && args[0] === "focus") {
        events.push(`focus:${args[2]}`);
        return { stdout: "ok" };
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
            },
            {
              "window-id": 22,
              "app-name": "Google Chrome",
              "app-bundle-id": "com.google.Chrome",
              "window-title": "Metrics - Google Chrome",
              workspace: "paper-b",
            },
            {
              "window-id": 23,
              "app-name": "Ghostty",
              "app-bundle-id": "com.mitchellh.ghostty",
              "window-title": "~",
              workspace: "paper-b",
            },
          ]),
        };
      }
      events.push(`osascript:${currentWorkspace}`);
      return currentWorkspace === "paper-a"
        ? { stdout: "TextEdit\tcom.apple.TextEdit\tShared Note\t10\t20\t500\t300\n" }
        : { stdout: "Google Chrome\tcom.google.Chrome\tMetrics\t700\t100\t900\t650\n" };
    }, {
      workspaceFocusSettleMs: 0,
    });

    const snapshot = await adapter.capture({
      frameWindowIds: [21, 22],
      focusFrameWorkspaces: true,
      restoreFrameCaptureFocus: true,
    });

    assert.deepEqual(snapshot.windows[0]?.frame, { x: 10, y: 20, width: 500, height: 300 });
    assert.deepEqual(snapshot.windows[1]?.frame, { x: 700, y: 100, width: 900, height: 650 });
    assert.equal(snapshot.windows[2]?.frame, undefined);
    assert.deepEqual(snapshot.frameCapture, { status: "captured", timeoutMs: 2_500, observed: 2 });
    assert.deepEqual(events, [
      "osascript:paper-a",
      "workspace:paper-b",
      "osascript:paper-b",
      "focus:21",
    ]);
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

  it("focuses each target workspace before restoring that workspace's frames", () => {
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
          frame: { x: 10, y: 20, width: 500, height: 300 },
        },
        {
          id: 45,
          app: "Google Chrome",
          appBundleId: "com.google.Chrome",
          title: "Metrics - Google Chrome",
          workspace: "paper-b",
          layout: "floating",
          frame: { x: 700, y: 100, width: 900, height: 650 },
        },
      ],
    };

    const plan = restoreWorkspacePlan(snapshot, [
      { ...snapshot.windows[0]!, frame: undefined },
      { ...snapshot.windows[1]!, frame: undefined },
    ]);

    assert.deepEqual(plan.commands.map((command) =>
      command.command === "osascript" ? [command.command, command.args[0]] : [command.command, ...command.args],
    ), [
      ["aerospace", "workspace", "paper-a"],
      ["osascript", "-e"],
      ["aerospace", "workspace", "paper-b"],
      ["osascript", "-e"],
      ["aerospace", "workspace", "paper-a"],
      ["aerospace", "focus", "--window-id", "44"],
    ]);
    assert.match(plan.commands[1]?.args[1] ?? "", /set position of candidateWindow to \{10, 20\}/);
    assert.match(plan.commands[3]?.args[1] ?? "", /set position of candidateWindow to \{700, 100\}/);
  });

  it("residual restore is empty when active workspace, focus, layout, and frame already match", () => {
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
          frame: { x: 10, y: 20, width: 500, height: 300 },
        },
      ],
    };

    const plan = restoreWorkspaceResidualPlan(snapshot, {
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
          frame: { x: 14, y: 17, width: 505, height: 294 },
        },
      ],
    });

    assert.deepEqual(plan, { commands: [], skipped: [] });
  });

  it("residual restore retries only active workspace, focus, and unmet frame drift", () => {
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
          frame: { x: 10, y: 20, width: 500, height: 300 },
        },
      ],
    };

    const plan = restoreWorkspaceResidualPlan(snapshot, {
      backend: "aerospace",
      activeWorkspace: "paper-b",
      focusedWindowId: 55,
      windows: [
        {
          id: 44,
          app: "TextEdit",
          appBundleId: "com.apple.TextEdit",
          title: "Shared Note",
          workspace: "paper-a",
          layout: "floating",
          frame: { x: 80, y: 90, width: 500, height: 300 },
        },
      ],
    });

    assert.equal(plan.skipped.length, 0);
    assert.deepEqual(plan.commands[0], { command: "aerospace", args: ["workspace", "paper-a"] });
    assert.equal(plan.commands[1]?.command, "osascript");
    assert.match(plan.commands[1]?.args[1] ?? "", /set position of candidateWindow to \{10, 20\}/);
    assert.deepEqual(plan.commands[2], { command: "aerospace", args: ["focus", "--window-id", "44"] });
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

  it("uses a bounded timeout for System Events frame restore", async () => {
    const calls: Array<{ command: string; args: string[]; timeoutMs?: number }> = [];
    const adapter = new AerospaceWorkspaceAdapter(
      async (command, args, options) => {
        calls.push({ command, args, timeoutMs: options?.timeoutMs });
        return { stdout: "ok", stderr: "" };
      },
      { frameRestoreTimeoutMs: 1_789, workspaceFocusSettleMs: 0 },
    );
    const plan = restoreWorkspacePlan(
      {
        backend: "aerospace",
        activeWorkspace: "dev",
        focusedWindowId: 11,
        windows: [
          {
            id: 11,
            app: "TextEdit",
            appBundleId: "com.apple.TextEdit",
            title: "Shared Note",
            workspace: "dev",
            layout: "floating",
            frame: { x: 20, y: 30, width: 640, height: 480 },
          },
        ],
      },
      [{ id: 11, app: "TextEdit", appBundleId: "com.apple.TextEdit", title: "Shared Note", workspace: "dev", layout: "floating" }],
    );

    await adapter.executeRestorePlan(plan);

    assert.deepEqual(calls.map((call) => ({ command: call.command, subcommand: call.args[0], timeoutMs: call.timeoutMs })), [
      { command: "aerospace", subcommand: "workspace", timeoutMs: undefined },
      { command: "osascript", subcommand: "-e", timeoutMs: 1_789 },
      { command: "aerospace", subcommand: "focus", timeoutMs: undefined },
    ]);
  });

  it("waits for workspace focus to settle before restoring window frames", async () => {
    const events: string[] = [];
    const adapter = new AerospaceWorkspaceAdapter(
      async (command, args) => {
        events.push(`${command}:${args[0]}`);
        return { stdout: "ok", stderr: "" };
      },
      {
        workspaceFocusSettleMs: 123,
        sleep: async (ms) => {
          events.push(`sleep:${ms}`);
        },
      },
    );
    const plan = restoreWorkspacePlan(
      {
        backend: "aerospace",
        activeWorkspace: "dev",
        focusedWindowId: 11,
        windows: [
          {
            id: 11,
            app: "TextEdit",
            appBundleId: "com.apple.TextEdit",
            title: "Shared Note",
            workspace: "dev",
            layout: "floating",
            frame: { x: 20, y: 30, width: 640, height: 480 },
          },
        ],
      },
      [{ id: 11, app: "TextEdit", appBundleId: "com.apple.TextEdit", title: "Shared Note", workspace: "manual", layout: "floating" }],
    );

    const receipt = await adapter.executeRestorePlan(plan);

    assert.deepEqual(events, [
      "aerospace:move-node-to-workspace",
      "aerospace:workspace",
      "sleep:123",
      "osascript:-e",
      "aerospace:focus",
    ]);
    assert.equal(receipt.commands.length, 4);
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
