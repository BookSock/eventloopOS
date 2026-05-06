import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollMcpSourcesOnce, pollOnceOptionsFromEnv } from "./poll_once.js";

describe("MCP poll once CLI", () => {
  it("builds options from environment", () => {
    const options = pollOnceOptionsFromEnv({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      EVENTLOOPOS_MCP_SOURCE_IDS: "slack_dm_source, generic_mcp_source ",
    });

    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
    assert.deepEqual(options.sourceIds, ["slack_dm_source", "generic_mcp_source"]);
  });

  it("posts poll-all request and writes machine-readable result", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";
    const exitCode = await pollMcpSourcesOnce({
      baseUrl: "http://127.0.0.1:4377",
      sourceIds: ["generic_mcp_source"],
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
      fetchFn: async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        return response({ ok: true, events_seen: 1 }, 200);
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/mcp-sources/poll-all-and-route");
    assert.equal(requestedBody, JSON.stringify({ source_ids: ["generic_mcp_source"] }));
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, events_seen: 1 })}\n`]);
  });

  it("returns non-zero and writes error when request fails before response", async () => {
    const errors: string[] = [];
    const exitCode = await pollMcpSourcesOnce({
      baseUrl: "http://127.0.0.1:4377",
      stderr: {
        write(chunk: string) {
          errors.push(chunk);
          return true;
        },
      },
      fetchFn: async () => {
        throw new Error("orchestrator unavailable");
      },
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(errors, ["orchestrator unavailable\n"]);
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
