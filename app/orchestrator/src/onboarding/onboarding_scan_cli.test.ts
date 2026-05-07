import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onboardingScanOptionsFromEnvAndArgv, runOnboardingScanCli } from "./onboarding_scan_cli.js";

describe("onboarding scan CLI", () => {
  it("parses env and argv", () => {
    assert.deepEqual(onboardingScanOptionsFromEnvAndArgv(
      { EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test" },
      ["--format", "text"],
    ), {
      baseUrl: "http://env.test",
      format: "text",
    });
  });

  it("prints text summary", async () => {
    let output = "";
    const exitCode = await runOnboardingScanCli({
      baseUrl: "http://example.test",
      format: "text",
      stdout: { write: (chunk: string) => { output += chunk; return true; } },
      fetchFn: async () => new Response(JSON.stringify({
        ok: true,
        proposals: [
          { task_id: "task_blog", title: "Blog", confidence: "high", windows: [{ id: 1 }], task_sessions: [] },
        ],
        warnings: [],
      }), { status: 200 }),
    });

    assert.equal(exitCode, 0);
    assert.match(output, /task_blog/);
  });
});
