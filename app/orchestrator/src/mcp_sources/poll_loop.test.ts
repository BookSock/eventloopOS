import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollLoopOptionsFromEnv, runMcpPollLoop } from "./poll_loop.js";

describe("MCP poll loop", () => {
  it("builds loop options from environment", () => {
    const options = pollLoopOptionsFromEnv({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      EVENTLOOPOS_MCP_SOURCE_IDS: "slack_dm_source",
      EVENTLOOPOS_MCP_POLL_INTERVAL_MS: "2500",
      EVENTLOOPOS_MCP_POLL_MAX_CYCLES: "3",
    });

    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
    assert.deepEqual(options.sourceIds, ["slack_dm_source"]);
    assert.equal(options.intervalMs, 2500);
    assert.equal(options.maxCycles, 3);
  });

  it("polls repeatedly until max cycles without real sleeps", async () => {
    const writes: string[] = [];
    const sleeps: number[] = [];
    let requests = 0;

    const summary = await runMcpPollLoop({
      baseUrl: "http://127.0.0.1:4377",
      intervalMs: 500,
      maxCycles: 3,
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      fetchFn: async () => {
        requests += 1;
        return response({ ok: true, events_seen: requests }, 200);
      },
    });

    assert.deepEqual(summary, {
      cycles: 3,
      failures: 0,
      stopped_by: "max_cycles",
    });
    assert.equal(requests, 3);
    assert.deepEqual(sleeps, [500, 500]);
    assert.equal(writes.length, 3);
  });

  it("counts failed poll cycles and exits after max cycles", async () => {
    const summary = await runMcpPollLoop({
      baseUrl: "http://127.0.0.1:4377",
      intervalMs: 1,
      maxCycles: 2,
      stderr: {
        write() {
          return true;
        },
      },
      sleepFn: async () => {},
      fetchFn: async () => {
        throw new Error("orchestrator unavailable");
      },
    });

    assert.deepEqual(summary, {
      cycles: 2,
      failures: 2,
      stopped_by: "max_cycles",
    });
  });
});

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
