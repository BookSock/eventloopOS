import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLiveAerospaceSmoke } from "./live_aerospace_smoke.js";
import type { ExecFunction } from "./aerospace.js";

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

    assert.deepEqual(calls, [
      { command: "aerospace", args: ["list-windows", "--all", "--json"] },
      { command: "aerospace", args: ["list-windows", "--all", "--json"] },
      { command: "aerospace", args: ["list-windows", "--all", "--json"] },
    ]);
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
});
