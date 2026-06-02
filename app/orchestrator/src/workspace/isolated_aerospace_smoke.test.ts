import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
  runIsolatedAerospaceSmoke,
  type SmokeWindowHandle,
  type SmokeWindowLauncher,
} from "./isolated_aerospace_smoke.js";
import type { AerospaceWindow, RestoreExecutionReceipt, RestorePlan, WorkspaceCapabilityStatus, WorkspaceSnapshot } from "./aerospace.js";
import type { WorkspaceController } from "./controller.js";

describe("isolated AeroSpace smoke", () => {
  it("skips unless explicitly enabled", async () => {
    const result = await runIsolatedAerospaceSmoke({ enabled: false });

    assert.deepEqual(result, {
      ok: true,
      skipped: true,
      reason: "not_enabled",
    });
  });

  it("moves only a newly-created smoke window to scratch and back, then verifies cleanup", async () => {
    const controller = new FakeWorkspaceController([{ id: 11, app: "Ghostty", title: "codex", workspace: "dev" }]);
    const cleanupCalls: string[] = [];

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: fakeLauncher(controller, {
        id: 12,
        title: "eventloopOS-isolated-smoke-test.txt",
        workspace: "main",
        cleanupCalls,
      }),
      scratchWorkspace: "eventloop-smoke",
      waitTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (result.ok && !result.skipped) {
      assert.equal(result.target_window_id, 12);
      assert.equal(result.original_workspace, "main");
      assert.equal(result.scratch_workspace, "eventloop-smoke");
      assert.equal(result.restored_workspace, "main");
      assert.equal(result.non_test_window_count, 1);
      assert.deepEqual(result.non_test_changed_windows, []);
      assert.deepEqual(
        result.commands.map((command) => command.args),
        [
          ["move-node-to-workspace", "--window-id", "12", "eventloop-smoke"],
          ["move-node-to-workspace", "--window-id", "12", "main"],
        ],
      );
      assert.deepEqual(result.cleanup, { attempted: true, ok: true });
      assert.equal(result.cleanup_verified, true);
    }
    assert.deepEqual(cleanupCalls, ["cleanup"]);
    assert.equal(controller.window(11)?.workspace, "dev");
    assert.equal(controller.window(12), undefined);
  });

  it("falls back to exactly one new TextEdit window when macOS hides window titles", async () => {
    const controller = new FakeWorkspaceController([{ id: 11, app: "Ghostty", title: "", workspace: "dev" }]);

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: async (): Promise<SmokeWindowHandle> => {
        controller.addWindow({ id: 12, app: "TextEdit", title: "", workspace: "main" });
        return {
          title: "eventloopOS-isolated-smoke-test.txt",
          appName: "TextEdit",
          cleanup: async () => {
            controller.removeWindow(12);
            return { attempted: true, ok: true };
          },
        };
      },
      scratchWorkspace: "eventloop-smoke",
      waitTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (result.ok && !result.skipped) {
      assert.equal(result.target_window_id, 12);
      assert.equal(result.original_workspace, "main");
      assert.equal(result.scratch_workspace, "eventloop-smoke");
      assert.deepEqual(result.non_test_changed_windows, []);
    }
  });

  it("uses a fallback scratch workspace when smoke window already lives in scratch", async () => {
    const controller = new FakeWorkspaceController([]);

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: fakeLauncher(controller, {
        id: 12,
        title: "eventloopOS-isolated-smoke-test.txt",
        workspace: "eventloop-smoke",
      }),
      scratchWorkspace: "eventloop-smoke",
      waitTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (result.ok && !result.skipped) {
      assert.equal(result.scratch_workspace, "eventloop-smoke-2");
      assert.deepEqual(
        result.commands.map((command) => command.args),
        [
          ["move-node-to-workspace", "--window-id", "12", "eventloop-smoke-2"],
          ["move-node-to-workspace", "--window-id", "12", "eventloop-smoke"],
        ],
      );
    }
  });

  it("fails closed if the smoke window title already existed before launch", async () => {
    const controller = new FakeWorkspaceController([
      { id: 12, app: "TextEdit", title: "eventloopOS-isolated-smoke-test.txt", workspace: "main" },
    ]);
    const cleanupCalls: string[] = [];

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: fakeLauncher(controller, {
        id: 13,
        title: "eventloopOS-isolated-smoke-test.txt",
        workspace: "main",
        cleanupCalls,
      }),
      waitTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    if (!result.ok) {
      assert.equal(result.reason, "smoke_window_title_collision");
      assert.equal(result.cleanup_verified, false);
    }
    assert.deepEqual(cleanupCalls, ["cleanup"]);
    assert.equal(controller.window(13), undefined);
  });

  it("fails closed if any non-test window workspace changes", async () => {
    const controller = new FakeWorkspaceController([{ id: 11, app: "Ghostty", title: "codex", workspace: "dev" }]);
    controller.afterFirstMove = () => {
      controller.moveWindow(11, "other");
    };
    const cleanupCalls: string[] = [];

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: fakeLauncher(controller, {
        id: 12,
        title: "eventloopOS-isolated-smoke-test.txt",
        workspace: "main",
        cleanupCalls,
      }),
      scratchWorkspace: "eventloop-smoke",
      waitTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    if (!result.ok) {
      assert.equal(result.reason, "non_test_window_moved");
      assert.deepEqual(result.non_test_changed_windows, [
        {
          window_id: 11,
          app: "Ghostty",
          title: "codex",
          before_workspace: "dev",
          after_workspace: "other",
        },
      ]);
      assert.deepEqual(result.cleanup, { attempted: true, ok: true });
      assert.equal(result.cleanup_verified, true);
    }
    assert.deepEqual(cleanupCalls, ["cleanup"]);
  });

  it("fails when cleanup reports success but the smoke window remains visible", async () => {
    const controller = new FakeWorkspaceController([]);

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: async (): Promise<SmokeWindowHandle> => {
        controller.addWindow({ id: 12, app: "TextEdit", title: "eventloopOS-isolated-smoke-test.txt", workspace: "main" });
        return {
          title: "eventloopOS-isolated-smoke-test.txt",
          cleanup: async () => ({ attempted: true, ok: true }),
        };
      },
      waitTimeoutMs: 2,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    if (!result.ok) {
      assert.equal(result.reason, "smoke_window_cleanup_failed");
      assert.equal(result.cleanup_verified, false);
    }
  });

  it("reports restore execution failure and cleans up smoke window", async () => {
    const controller = new FakeWorkspaceController([{ id: 11, app: "Ghostty", title: "codex", workspace: "dev" }]);
    controller.failOnMoveCount = 2;
    const cleanupCalls: string[] = [];

    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller,
      launchWindow: fakeLauncher(controller, {
        id: 12,
        title: "eventloopOS-isolated-smoke-test.txt",
        workspace: "main",
        cleanupCalls,
      }),
      scratchWorkspace: "eventloop-smoke",
      waitTimeoutMs: 20,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    if (!result.ok) {
      assert.equal(result.reason, "isolated_smoke_failed");
      assert.match(result.detail ?? "", /AeroSpace server unavailable during restore/);
      assert.deepEqual(result.cleanup, { attempted: true, ok: true });
      assert.equal(result.cleanup_verified, true);
    }
    assert.deepEqual(cleanupCalls, ["cleanup"]);
    assert.equal(controller.window(12), undefined);
    assert.equal(controller.window(11)?.workspace, "dev");
  });

  it("cleans up if smoke window never appears", async () => {
    const cleanupCalls: string[] = [];
    const result = await runIsolatedAerospaceSmoke({
      enabled: true,
      runId: "test",
      controller: new FakeWorkspaceController([{ id: 11, app: "Ghostty", title: "codex", workspace: "dev" }]),
      launchWindow: async (): Promise<SmokeWindowHandle> => ({
        title: "missing-smoke-window.txt",
        cleanup: async () => {
          cleanupCalls.push("cleanup");
          return { attempted: true, ok: true };
        },
      }),
      waitTimeoutMs: 2,
      pollIntervalMs: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    if (!result.ok) {
      assert.equal(result.reason, "isolated_smoke_failed");
      assert.match(result.detail ?? "", /timed out waiting for smoke window/);
      assert.deepEqual(result.cleanup, { attempted: true, ok: true });
      assert.equal(result.cleanup_verified, false);
    }
    assert.deepEqual(cleanupCalls, ["cleanup"]);
  });

  it("writes a machine-readable manifest when artifactDir is provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloopos-isolated-manifest-test-"));
    const controller = new FakeWorkspaceController([]);
    try {
      const result = await runIsolatedAerospaceSmoke({
        enabled: true,
        runId: "manifest-test",
        controller,
        launchWindow: fakeLauncher(controller, {
          id: 12,
          title: "eventloopOS-isolated-smoke-test.txt",
          workspace: "main",
        }),
        artifactDir: dir,
        waitTimeoutMs: 20,
        pollIntervalMs: 1,
      });

      assert.equal(result.ok, true);
      assert.equal(result.skipped, false);
      if (result.ok && !result.skipped) {
        assert.equal(result.manifest_path, join(dir, "manifest.json"));
      }
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { ok: boolean; cleanup_verified: boolean };
      assert.equal(manifest.ok, true);
      assert.equal(manifest.cleanup_verified, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function fakeLauncher(
  controller: FakeWorkspaceController,
  input: { id: number; title: string; workspace: string; cleanupCalls?: string[] },
): SmokeWindowLauncher {
  return async (): Promise<SmokeWindowHandle> => {
    controller.addWindow({ id: input.id, app: "TextEdit", title: input.title, workspace: input.workspace });
    return {
      title: input.title,
      appName: "TextEdit",
      cleanup: async () => {
        input.cleanupCalls?.push("cleanup");
        controller.removeWindow(input.id);
        return { attempted: true, ok: true };
      },
    };
  };
}

class FakeWorkspaceController implements WorkspaceController {
  afterFirstMove?: () => void;
  failOnMoveCount?: number;
  private moveCount = 0;

  constructor(private readonly windows: AerospaceWindow[]) {}

  status(): WorkspaceCapabilityStatus {
    return {
      available: true,
      backend: "aerospace",
    };
  }

  capture(): WorkspaceSnapshot {
    return {
      backend: "aerospace",
      windows: this.windows.map((window) => ({ ...window })),
    };
  }

  planRestore(snapshot: WorkspaceSnapshot): RestorePlan {
    return {
      commands: snapshot.windows.map((window) => ({
        command: "aerospace",
        args: ["move-node-to-workspace", "--window-id", String(window.id), window.workspace],
      })),
      skipped: [],
    };
  }

  executeRestorePlan(plan: RestorePlan): RestoreExecutionReceipt {
    for (const command of plan.commands) {
      const windowId = Number(command.args[2]);
      const workspace = command.args[3] ?? "";
      this.moveCount += 1;
      if (this.failOnMoveCount === this.moveCount) {
        throw new Error("AeroSpace server unavailable during restore");
      }
      this.moveWindow(windowId, workspace);
      if (this.moveCount === 1) {
        this.afterFirstMove?.();
      }
    }
    return {
      commands: plan.commands.map((command) => ({ ...command, stdout: "" })),
      skipped: [],
    };
  }

  addWindow(window: AerospaceWindow): void {
    this.windows.push({ ...window });
  }

  removeWindow(windowId: number): void {
    const index = this.windows.findIndex((item) => item.id === windowId);
    if (index >= 0) {
      this.windows.splice(index, 1);
    }
  }

  moveWindow(windowId: number, workspace: string): void {
    const window = this.windows.find((item) => item.id === windowId);
    if (!window) {
      throw new Error(`missing fake window ${windowId}`);
    }
    window.workspace = workspace;
  }

  window(windowId: number): AerospaceWindow | undefined {
    return this.windows.find((item) => item.id === windowId);
  }
}
