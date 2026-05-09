import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";

describe("master fan-out route", () => {
  let server: Server;
  let baseUrl: string;
  const sentMessages: Array<{ task_session_id: string; text: string; idempotency_key: string }> = [];

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));

    // Seed three task sessions covering different topics.
    const sessions = [
      { id: "session_blog_email", task_id: "task_blog_email_draft", provider: "fake", status: "idle" },
      { id: "session_blog_outreach", task_id: "task_blog_partner_email", provider: "fake", status: "idle" },
      { id: "session_recruiting", task_id: "task_recruiting_review", provider: "fake", status: "idle" },
    ];

    server = createGatewayServer({
      store,
      now: () => new Date("2026-05-09T12:00:00.000Z"),
      taskSessions: {
        listSessions() { return sessions; },
        sendFollowupMessage(input) {
          sentMessages.push({ task_session_id: input.task_session_id, text: input.text, idempotency_key: input.idempotency_key });
          return {
            id: `msg_${sentMessages.length}`,
            task_session_id: input.task_session_id,
            mode: "followup",
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects request with no selector", async () => {
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "schema_error");
  });

  it("returns matched preview on dry run", async () => {
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "use new sign off",
        selector: { task_hint_substring: "blog" },
        dry_run: true,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      ok: boolean;
      dry_run: boolean;
      matched_count: number;
      preview: Array<{ task_id: string; task_session_id?: string }>;
    };
    assert.equal(body.dry_run, true);
    assert.equal(body.matched_count, 2);
    const taskIds = body.preview.map((entry) => entry.task_id).sort();
    assert.deepEqual(taskIds, ["task_blog_email_draft", "task_blog_partner_email"]);
  });

  it("delivers fan-out message to all matched bound sessions", async () => {
    sentMessages.length = 0;
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Please use the new sign off when drafting these emails.",
        selector: { task_hint_substring: "blog" },
        idempotency_key: "test_fan_out_blog_v1",
        target: "all blog email tasks",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      ok: boolean;
      delivered_count: number;
      delivered: Array<{ task_id: string; task_session_id: string }>;
      skipped: Array<{ task_id: string; reason: string }>;
    };
    assert.equal(body.ok, true);
    assert.equal(body.delivered_count, 2);
    const deliveredSessions = body.delivered.map((entry) => entry.task_session_id).sort();
    assert.deepEqual(deliveredSessions, ["session_blog_email", "session_blog_outreach"]);
    assert.equal(body.skipped.length, 0);

    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[0].text, /broadcast/);
    assert.match(sentMessages[0].text, /sign off/);
  });

  it("is idempotent on repeat", async () => {
    const callCountBefore = sentMessages.length;
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Please use the new sign off when drafting these emails.",
        selector: { task_hint_substring: "blog" },
        idempotency_key: "test_fan_out_blog_v1",
        target: "all blog email tasks",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { delivered_count: number };
    assert.equal(body.delivered_count, 2);
    // Underlying followup helper deduplicates by idempotency key, so no new send.
    assert.equal(sentMessages.length, callCountBefore);
  });

  it("supports task_id_pattern regex selectors", async () => {
    sentMessages.length = 0;
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Pause work for 1 hour.",
        selector: { task_id_pattern: "^task_(blog|recruiting)" },
        idempotency_key: "test_fan_out_pause_v1",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { delivered: Array<{ task_id: string }> };
    const delivered = body.delivered.map((entry) => entry.task_id).sort();
    assert.deepEqual(delivered, ["task_blog_email_draft", "task_blog_partner_email", "task_recruiting_review"]);
  });

  it("reports skipped tasks when no session is bound", async () => {
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Hello unbound task.",
        selector: { task_ids: ["task_does_not_exist"] },
        idempotency_key: "test_fan_out_missing_v1",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      delivered_count: number;
      delivered: Array<unknown>;
      skipped: Array<{ task_id: string; reason: string }>;
    };
    assert.equal(body.delivered_count, 0);
    assert.equal(body.skipped.length, 1);
    assert.equal(body.skipped[0].task_id, "task_does_not_exist");
    assert.equal(body.skipped[0].reason, "no_bound_session");
  });
});
