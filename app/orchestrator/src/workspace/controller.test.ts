import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import {
  AerospaceWorkspaceController,
  parseRestoreExecuteRequest,
  parseRestorePlanRequest,
  parseWorkspaceSnapshot,
  type WorkspaceController,
} from "./controller.js";
import {
  captureFocusedWindowPlan,
  captureFocusedWorkspacePlan,
  captureWorkspacePlan,
  type ExecFunction,
  type RestorePlan,
  type WorkspaceSnapshot,
} from "./aerospace.js";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import { createInMemoryObservability } from "../observability.js";
import { createGatewayServer } from "../server.js";
import type { InMemoryStore } from "../store.js";

describe("workspace controller", () => {
  it("captures AeroSpace workspace snapshots through injected exec", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const exec: ExecFunction = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "list-workspaces") return { stdout: "eventloop-blog\n" };
      if (args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": 9, workspace: "eventloop-blog" }]) };
      }
      if (command === "osascript") return { stdout: "" };
      return {
        stdout: JSON.stringify([
          { "window-id": 9, "app-name": "Ghostty", "window-title": "codex", workspace: "eventloop-blog" },
        ]),
      };
    };

    const controller = new AerospaceWorkspaceController(exec);
    const snapshot = await controller.capture();

    assert.equal(calls.length, 4);
    assert.deepEqual(calls.slice(0, 3), [captureWorkspacePlan(), captureFocusedWorkspacePlan(), captureFocusedWindowPlan()]);
    assert.equal(calls[3]?.command, "osascript");
    assert.equal(calls[3]?.args[0], "-e");
    assert.deepEqual(snapshot, {
      backend: "aerospace",
      activeWorkspace: "eventloop-blog",
      focusedWindowId: 9,
      frameCapture: { status: "captured", timeoutMs: 2_500, observed: 0 },
      windows: [
        {
          id: 9,
          app: "Ghostty",
          title: "codex",
          workspace: "eventloop-blog",
          monitorId: undefined,
          pid: undefined,
          appBundleId: undefined,
          layout: undefined,
          frame: undefined,
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

  it("verified restore retries until captured workspace and focus match", async () => {
    let activeWorkspace = "manual";
    let focusedWindowId = 55;
    let windowWorkspace = "manual";
    let workspaceCommandCount = 0;
    let focusCommandCount = 0;
    const executed: string[][] = [];
    const exec: ExecFunction = async (command, args) => {
      if (command === "aerospace" && args[0] === "list-workspaces") return { stdout: `${activeWorkspace}\n` };
      if (command === "aerospace" && args[0] === "list-windows" && args.includes("--focused")) {
        return { stdout: JSON.stringify([{ "window-id": focusedWindowId, workspace: activeWorkspace }]) };
      }
      if (command === "aerospace" && args[0] === "list-windows") {
        return {
          stdout: JSON.stringify([
            { "window-id": 44, "app-name": "TextEdit", "window-title": "Shared Note", workspace: windowWorkspace },
          ]),
        };
      }
      if (command === "osascript") return { stdout: "" };

      executed.push(args);
      if (args[0] === "move-node-to-workspace") windowWorkspace = args[3] ?? windowWorkspace;
      if (args[0] === "workspace") {
        workspaceCommandCount += 1;
        if (workspaceCommandCount >= 2) activeWorkspace = args[1] ?? activeWorkspace;
      }
      if (args[0] === "focus") {
        focusCommandCount += 1;
        if (focusCommandCount >= 2) focusedWindowId = Number(args[2]);
      }
      return { stdout: "", stderr: "" };
    };
    const controller = new AerospaceWorkspaceController(exec, {
      restoreVerifySettleMs: 0,
      restoreVerifyRetries: 2,
    });

    const result = await controller.executeRestorePlanVerified(
      {
        backend: "aerospace",
        activeWorkspace: "paper-a",
        focusedWindowId: 44,
        windows: [{ id: 44, app: "TextEdit", title: "Shared Note", workspace: "paper-a" }],
      },
      [{ id: 44, app: "TextEdit", title: "Shared Note", workspace: "manual" }],
    );

    assert.equal(result.verified, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.residualPlan, undefined);
    assert.deepEqual(executed, [
      ["move-node-to-workspace", "--window-id", "44", "paper-a"],
      ["workspace", "paper-a"],
      ["focus", "--window-id", "44"],
      ["workspace", "paper-a"],
      ["focus", "--window-id", "44"],
    ]);
  });

  it("rejects non-AeroSpace snapshots in the AeroSpace restore planner", async () => {
    const controller = new AerospaceWorkspaceController(async () => {
      throw new Error("exec should not be called when current windows supplied");
    });
    const snapshot: WorkspaceSnapshot = {
      backend: "fake",
      windows: [{ id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog" }],
    };

    await assert.rejects(
      () => controller.planRestore(snapshot, [{ id: 9, app: "Ghostty", title: "codex", workspace: "manual" }]),
      /cannot restore fake snapshots/,
    );
  });

  it("parses restore requests with snake-case active and focused fields", () => {
    const request = parseRestorePlanRequest({
      snapshot: {
        backend: "aerospace",
        active_workspace: "eventloop-blog",
        focused_window_id: 9,
        frame_capture: { status: "captured", timeout_ms: 2_500, observed: 1 },
        windows: [{ id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog" }],
      },
      current_windows: [{ id: 9, app: "Ghostty", title: "codex", workspace: "manual" }],
    });

    assert.equal(request.snapshot.activeWorkspace, "eventloop-blog");
    assert.equal(request.snapshot.focusedWindowId, 9);
    assert.deepEqual(request.snapshot.frameCapture, { status: "captured", timeoutMs: 2_500, observed: 1, error: undefined });
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
    assert.equal(parseWorkspaceSnapshot({ backend: "spaces", windows: [] }).backend, "spaces");
    assert.throws(() => parseWorkspaceSnapshot({ backend: "", windows: [] }), /backend must be a non-empty string/);
    assert.throws(() => parseWorkspaceSnapshot({ backend: "bad/backend", windows: [] }), /unsafe workspace backend/);
    assert.throws(
      () => parseWorkspaceSnapshot({ backend: "aerospace", windows: [{ id: 1, workspace: "bad;name" }] }),
      /unsafe aerospace workspace/,
    );
    assert.throws(
      () => parseWorkspaceSnapshot({ backend: "aerospace", windows: [], frameCapture: { status: "partial", timeoutMs: 1, observed: 0 } }),
      /frame capture status/,
    );
    assert.throws(
      () => parseWorkspaceSnapshot({ backend: "aerospace", windows: [], frameCapture: { status: "captured", timeoutMs: -1, observed: 0 } }),
      /timeoutMs/,
    );
  });

  it("lets a fake AeroSpace-compatible backend drive workspace HTTP routes", async () => {
    const fake = new FakeWorkspaceController();
    const store = createInMemoryGatewayStore(makeStore());
    const server = createGatewayServer({
      store,
      workspace: fake,
      workspaceExecuteEnabled: true,
      observability: createInMemoryObservability(),
      now: () => new Date("2026-06-04T12:00:00.000Z"),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const status = await requestJson<{ execute_supported: boolean; status: { available: boolean; backend: string } }>(
        baseUrl,
        "/workspace/status",
      );
      assert.equal(status.execute_supported, true);
      assert.equal(status.status.available, true);
      assert.equal(status.status.backend, "fake");

      const captured = await requestJson<{ snapshot: WorkspaceSnapshot }>(baseUrl, "/workspace/capture", { method: "POST", body: {} });
      assert.equal(captured.snapshot.backend, "fake");
      assert.equal(captured.snapshot.activeWorkspace, "fake-main");
      assert.equal(captured.snapshot.windows[0].id, 101);

      const planned = await requestJson<{ plan: RestorePlan }>(baseUrl, "/workspace/restore-plan", {
        method: "POST",
        body: {
          snapshot: captured.snapshot,
          current_windows: [{ id: 101, app: "FakeApp", title: "Fake Docs", workspace: "manual" }],
        },
      });
      assert.deepEqual(planned.plan.commands.map((command) => [command.command, command.args[0]]), [
        ["aerospace", "fake-move"],
        ["aerospace", "workspace"],
        ["aerospace", "focus"],
      ]);

      const restored = await requestJson<{ ok: boolean }>(baseUrl, "/workspace/restore", {
        method: "POST",
        headers: { "Idempotency-Key": "fake-workspace-restore" },
        body: {
          confirm_execute: true,
          snapshot: captured.snapshot,
          current_windows: [{ id: 101, app: "FakeApp", title: "Fake Docs", workspace: "manual" }],
        },
      });
      assert.equal(restored.ok, true);
      assert.equal(fake.executed.length, 3);
      assert.deepEqual(fake.executed.map((command) => command.args[0]), ["fake-move", "workspace", "focus"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

class FakeWorkspaceController implements WorkspaceController {
  executed: RestorePlan["commands"] = [];

  status() {
    return {
      available: true as const,
      backend: "fake",
      detail: "fake backend emitting workspace-compatible snapshots",
      monitorCount: 1,
    };
  }

  capture(): WorkspaceSnapshot {
    return {
      backend: "fake",
      activeWorkspace: "fake-main",
      focusedWindowId: 101,
      windows: [
        {
          id: 101,
          app: "FakeApp",
          appBundleId: "dev.eventloopos.fake",
          title: "Fake Docs",
          workspace: "fake-main",
          monitorId: 1,
          layout: "floating",
          frame: { x: 20, y: 30, width: 640, height: 480 },
        },
      ],
    };
  }

  planRestore(snapshot: WorkspaceSnapshot, currentWindows = this.capture().windows): RestorePlan {
    const currentWindowsById = new Map(currentWindows.map((window) => [window.id, window]));
    return {
      commands: [
        ...snapshot.windows
          .filter((window) => currentWindowsById.has(window.id))
          .map((window) => ({ command: "aerospace" as const, args: ["fake-move", String(window.id), window.workspace] })),
        ...(snapshot.activeWorkspace ? [{ command: "aerospace" as const, args: ["workspace", snapshot.activeWorkspace] }] : []),
        ...(snapshot.focusedWindowId ? [{ command: "aerospace" as const, args: ["focus", String(snapshot.focusedWindowId)] }] : []),
      ],
      skipped: snapshot.windows
        .filter((window) => !currentWindowsById.has(window.id))
        .map((window) => ({ reason: "stale_window_id" as const, windowId: window.id, workspace: window.workspace })),
    };
  }

  executeRestorePlan(plan: RestorePlan) {
    this.executed.push(...plan.commands);
    return {
      commands: plan.commands.map((command) => ({ ...command, stdout: "ok\n", stderr: "" })),
      skipped: plan.skipped,
    };
  }
}

async function requestJson<T extends Record<string, unknown>>(
  baseUrl: string,
  route: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const headers = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(new URL(route, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body,
  });
  const parsed = await response.json() as T;
  assert.equal(response.ok, true, `${route} failed: ${JSON.stringify(parsed)}`);
  return parsed;
}

function makeStore(): InMemoryStore {
  return {
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}
