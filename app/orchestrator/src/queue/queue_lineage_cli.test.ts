import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  queueLineageCliOptionsFromEnvAndArgv,
  runQueueLineageCli,
} from "./queue_lineage_cli.js";

describe("queue lineage CLI", () => {
  it("parses queue lineage options from argv and env", () => {
    const options = queueLineageCliOptionsFromEnvAndArgv(
      {
        EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test",
        EVENTLOOPOS_QUEUE_ITEM_ID: "qit_env",
      },
      ["--base-url", "http://arg.test", "--queue-item-id", "qit_arg", "--limit", "5"],
    );

    assert.equal(options.baseUrl, "http://arg.test");
    assert.equal(options.queueItemId, "qit_arg");
    assert.equal(options.limit, 5);
  });

  it("fetches lineage for a selected queue item", async () => {
    const writes: string[] = [];
    let requestedUrl = "";

    const exitCode = await runQueueLineageCli({
      baseUrl: "http://127.0.0.1:4377",
      queueItemId: "qit_review_1",
      limit: 10,
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url) => {
        requestedUrl = String(url);
        return response({ lineage: { counts: { activity: 1 } } }, 200);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/queue/qit_review_1/lineage?limit=10");
    assert.deepEqual(writes, [`${JSON.stringify({ lineage: { counts: { activity: 1 } } })}\n`]);
  });

  it("rejects missing queue item id before network calls", async () => {
    let called = false;
    const errors: string[] = [];

    const exitCode = await runQueueLineageCli({
      baseUrl: "http://127.0.0.1:4377",
      stderr: { write: (chunk) => { errors.push(String(chunk)); return true; } },
      fetchFn: (async () => {
        called = true;
        return response({}, 500);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 1);
    assert.equal(called, false);
    assert.match(errors.join(""), /queue item id must be provided/);
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
