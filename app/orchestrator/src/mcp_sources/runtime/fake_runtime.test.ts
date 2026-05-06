import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateMcpPollSourceConfig } from "../../integrations/mcp_poll/config_schema.js";
import type { McpPollSourceConfig } from "../../integrations/mcp_poll/types.js";
import { FakeMcpRuntime, filterMcpServerEnv, type FakeMcpBehavior } from "./fake_runtime.js";

describe("fake MCP runtime hardening", () => {
  it("opens circuit after repeated timeouts, half-opens, then recovers", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    let now = 1_000;
    const behaviors = new Map<string, FakeMcpBehavior[]>([
      [
        config.id,
        [
          { kind: "hang", stderr: "first hang\n" },
          { kind: "hang", stderr: "second hang\n" },
          { kind: "success", result: { items: [] }, stderr: "probe ok\n" },
        ],
      ],
    ]);
    const runtime = new FakeMcpRuntime(behaviors, () => now, {
      timeoutMs: 20,
      failureThreshold: 2,
      halfOpenAfterMs: 100,
      initialBackoffMs: 10,
      maxBackoffMs: 40,
    });

    await assert.rejects(() => runtime.callTool(config, {}), /timed out after 20ms/);
    assert.equal(runtime.getState(config.id)?.circuit, "closed");

    await assert.rejects(() => runtime.callTool(config, {}), /timed out after 20ms/);
    assert.equal(runtime.getState(config.id)?.circuit, "open");
    assert.equal(runtime.getState(config.id)?.childCleanupRequested, true);
    assert.equal(runtime.getState(config.id)?.stderrLogPath, "var/log/mcp/slack_dm_source.stderr.log");

    await assert.rejects(() => runtime.callTool(config, {}), /MCP circuit open/);

    now += 100;
    const recovered = await runtime.callTool(config, {});

    assert.deepEqual(recovered, { items: [] });
    assert.equal(runtime.getState(config.id)?.circuit, "closed");
    assert.equal(runtime.getState(config.id)?.failures, 0);
    assert.deepEqual(runtime.stderrWrites.map((write) => write.text), ["first hang\n", "second hang\n", "probe ok\n"]);
  });

  it("filters server env to declared allowlist", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");

    assert.deepEqual(
      filterMcpServerEnv(config, {
        SLACK_MCP_TOKEN: "token",
        AWS_SECRET_ACCESS_KEY: "must-not-pass",
      }),
      {
        SLACK_MCP_TOKEN: "token",
      },
    );
  });
});

async function readConfig(path: string): Promise<McpPollSourceConfig> {
  const parsed = JSON.parse(await readFile(join(process.cwd(), path), "utf8")) as unknown;
  const result = validateMcpPollSourceConfig(parsed);
  if (!result.ok) {
    throw new Error(result.issues.join(", "));
  }
  return result.value;
}
