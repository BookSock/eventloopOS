import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import type { WorkspaceSnapshot } from "../src/contracts.js";

const fixedNow = new Date("2026-05-10T12:00:00.000Z");

const layout: WorkspaceSnapshot = {
  backend: "aerospace",
  activeWorkspace: "eventloop-trig",
  focusedWindowId: 11,
  windows: [{ id: 11, app: "Ghostty", title: "codex trig", workspace: "eventloop-trig" }],
};

describe("triggers route — phase 7b", () => {
  let server: Server;
  let baseUrl: string;
  let taskId: string;

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({ store, now: () => fixedNow });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const body = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-trig-1" },
        captured_layout: layout,
      }),
    }).then((r) => r.json()) as { task: { task_id: string } };
    taskId = body.task.task_id;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("creates, lists, gets, patches, and deletes a paper trigger", async () => {
    const created = await fetch(`${baseUrl}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        name: "deploy watcher",
        match_event_type: "slack.message_received",
        match_body_substring: "deploy",
      }),
    });
    assert.equal(created.status, 200);
    const createdBody = await created.json() as { trigger: { trigger_id: string; enabled: boolean } };
    assert.ok(createdBody.trigger.trigger_id.startsWith("trg_"));
    assert.equal(createdBody.trigger.enabled, true);
    const triggerId = createdBody.trigger.trigger_id;

    const list = await fetch(`${baseUrl}/triggers?task_id=${taskId}`).then((r) => r.json()) as {
      triggers: Array<{ trigger_id: string }>;
    };
    assert.equal(list.triggers.length, 1);
    assert.equal(list.triggers[0].trigger_id, triggerId);

    const got = await fetch(`${baseUrl}/triggers/${triggerId}`).then((r) => r.json()) as {
      trigger: { trigger_id: string; name: string };
    };
    assert.equal(got.trigger.name, "deploy watcher");

    const patched = await fetch(`${baseUrl}/triggers/${triggerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, name: "deploy watcher v2" }),
    }).then((r) => r.json()) as { trigger: { name: string; enabled: boolean } };
    assert.equal(patched.trigger.enabled, false);
    assert.equal(patched.trigger.name, "deploy watcher v2");

    const onlyEnabled = await fetch(`${baseUrl}/triggers?only_enabled=1`).then((r) => r.json()) as {
      triggers: unknown[];
    };
    assert.equal(onlyEnabled.triggers.length, 0);

    const deleted = await fetch(`${baseUrl}/triggers/${triggerId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);

    const afterDelete = await fetch(`${baseUrl}/triggers/${triggerId}`);
    assert.equal(afterDelete.status, 404);
  });

  it("rejects creating a trigger for an unknown task", async () => {
    const response = await fetch(`${baseUrl}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: "task_does_not_exist",
        name: "x",
        match_event_type: "slack.message_received",
      }),
    });
    assert.equal(response.status, 404);
  });

  it("validates required fields", async () => {
    const response = await fetch(`${baseUrl}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: taskId, name: "" }),
    });
    assert.equal(response.status, 400);
  });
});

describe("triggers integration — firing on matching event", () => {
  let server: Server;
  let baseUrl: string;
  let taskId: string;

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({ store, now: () => fixedNow });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const body = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-fire-1" },
        captured_layout: layout,
      }),
    }).then((r) => r.json()) as { task: { task_id: string } };
    taskId = body.task.task_id;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("emits a paper for the trigger task when a matching event arrives, and dedupes on retry", async () => {
    await fetch(`${baseUrl}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        name: "deploy fires",
        match_event_type: "slack.message_received",
        match_body_substring: "deploy",
      }),
    });

    const event = {
      id: "evt_trig_1",
      source: "slack",
      source_id: "slack:T1:C1",
      idempotency_key: "slack-trig-1",
      occurred_at: "2026-05-10T12:00:00.000Z",
      received_at: "2026-05-10T12:00:00.000Z",
      actor: { id: "u", type: "human" },
      type: "slack.message_received",
      title: "deploy ready",
      summary: "please ship",
      raw_ref: { id: "raw_1", uri: "slack://x", media_type: "application/json" },
      links: [],
      resources: [],
    };

    const first = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    assert.equal(first.status, 202);
    const firstBody = await first.json() as {
      trigger_fires?: Array<{ trigger_id: string; task_id: string; event_id: string }>;
    };
    assert.ok(firstBody.trigger_fires, "first event should record trigger fires");
    assert.equal(firstBody.trigger_fires!.length, 1);
    assert.equal(firstBody.trigger_fires![0].task_id, taskId);

    // Same event id+idempotency = no double-fire (event-level dedup short-circuits ingestion).
    const replay = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    const replayBody = await replay.json() as { trigger_fires?: unknown[] };
    assert.ok(!replayBody.trigger_fires || replayBody.trigger_fires.length === 0);

    // Different event with same idempotency_key as previous still dedupes via firing table.
    const secondEvent = { ...event, id: "evt_trig_2", idempotency_key: "slack-trig-1-other" };
    const second = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(secondEvent),
    });
    const secondBody = await second.json() as {
      trigger_fires?: Array<{ event_id: string }>;
    };
    assert.ok(secondBody.trigger_fires, "different event should re-fire trigger");
    assert.equal(secondBody.trigger_fires!.length, 1);
  });

  it("does not fire for non-matching events", async () => {
    const event = {
      id: "evt_no_match",
      source: "slack",
      source_id: "slack:T1:C1",
      idempotency_key: "slack-no-match",
      occurred_at: "2026-05-10T12:00:00.000Z",
      received_at: "2026-05-10T12:00:00.000Z",
      actor: { id: "u", type: "human" },
      type: "slack.message_received",
      title: "lunch plans",
      summary: "tacos at noon",
      raw_ref: { id: "raw_2", uri: "slack://y", media_type: "application/json" },
      links: [],
      resources: [],
    };
    const response = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    const body = await response.json() as { trigger_fires?: unknown[] };
    assert.ok(!body.trigger_fires || body.trigger_fires.length === 0);
  });

  it("does not fire when manual mode is active", async () => {
    await fetch(`${baseUrl}/modes/manual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true, reason: "test" }),
    });

    const event = {
      id: "evt_during_manual",
      source: "slack",
      source_id: "slack:T1:C1",
      idempotency_key: "slack-manual-mode",
      occurred_at: "2026-05-10T12:00:00.000Z",
      received_at: "2026-05-10T12:00:00.000Z",
      actor: { id: "u", type: "human" },
      type: "slack.message_received",
      title: "deploy now",
      summary: "deploy fast",
      raw_ref: { id: "raw_3", uri: "slack://z", media_type: "application/json" },
      links: [],
      resources: [],
    };
    const response = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    const body = await response.json() as { trigger_fires?: unknown[] };
    assert.ok(!body.trigger_fires || body.trigger_fires.length === 0);

    await fetch(`${baseUrl}/modes/manual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
  });
});
