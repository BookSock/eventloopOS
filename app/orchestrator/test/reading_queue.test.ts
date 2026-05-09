import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";

type ReadingQueueListBody = {
  contexts: Array<{ id: string; title: string; url?: string; captured_at: string; event_id: string; source: string }>;
  count: number;
};

type ReadingQueuePromoteBody = {
  ok: boolean;
  promoted: Array<{ context_id: string; queue_item_id?: string; review_packet_id?: string; event_id: string; idempotent: boolean }>;
  promoted_count: number;
  missing_context_ids: string[];
};

describe("reading-queue route", () => {
  let server: Server;
  let baseUrl: string;
  let store: ReturnType<typeof createInMemoryGatewayStore>;

  before(async () => {
    store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Seed two unbound captured tabs (no task_hint) and one bound tab.
    await store.recordEventRoute({
      id: "evt_capture_tab_1",
      source: "browser",
      source_id: "browser:tab1",
      idempotency_key: "browser:tab1",
      occurred_at: "2026-05-09T11:55:00.000Z",
      received_at: "2026-05-09T11:55:00.000Z",
      actor: { id: "chrome_extension", type: "system" },
      type: "browser.context_captured",
      title: "Captured tab 1",
      summary: "Captured browser tab.",
      raw_ref: { id: "raw_tab_1", uri: "browser://tabs/1", media_type: "application/json" },
      links: [],
      resources: [{
        id: "browser_tab:1",
        kind: "browser_tab",
        title: "How agents reshape OS",
        url: "https://example.test/agents-os",
        source: "chrome-extension",
        captured_at: "2026-05-09T11:55:00.000Z",
        restore_confidence: "high",
        window_id: "1",
        tab_id: "1",
      }],
    }, {
      id: "rte_capture_tab_1",
      event_id: "evt_capture_tab_1",
      action: "store_only",
      confidence: "medium",
      evidence: [],
      created_at: "2026-05-09T11:55:00.000Z",
    }, new Date("2026-05-09T11:55:00.000Z"));

    await store.recordEventRoute({
      id: "evt_capture_tab_2",
      source: "browser",
      source_id: "browser:tab2",
      idempotency_key: "browser:tab2",
      occurred_at: "2026-05-09T11:56:00.000Z",
      received_at: "2026-05-09T11:56:00.000Z",
      actor: { id: "chrome_extension", type: "system" },
      type: "browser.context_captured",
      title: "Captured tab 2",
      summary: "Captured browser tab.",
      raw_ref: { id: "raw_tab_2", uri: "browser://tabs/2", media_type: "application/json" },
      links: [],
      resources: [{
        id: "browser_tab:2",
        kind: "browser_tab",
        title: "Workspace graph paper",
        url: "https://example.test/workspace-graph",
        source: "chrome-extension",
        captured_at: "2026-05-09T11:56:00.000Z",
        restore_confidence: "medium",
      }],
    }, {
      id: "rte_capture_tab_2",
      event_id: "evt_capture_tab_2",
      action: "store_only",
      confidence: "medium",
      evidence: [],
      created_at: "2026-05-09T11:56:00.000Z",
    }, new Date("2026-05-09T11:56:00.000Z"));

    await store.recordEventRoute({
      id: "evt_capture_tab_blog",
      source: "browser",
      source_id: "browser:tab_blog",
      idempotency_key: "browser:tab_blog",
      occurred_at: "2026-05-09T11:57:00.000Z",
      received_at: "2026-05-09T11:57:00.000Z",
      actor: { id: "chrome_extension", type: "system" },
      task_hint: "blog",
      type: "browser.context_captured",
      title: "Captured tab bound to blog",
      summary: "Captured browser tab.",
      raw_ref: { id: "raw_tab_blog", uri: "browser://tabs/3", media_type: "application/json" },
      links: [],
      resources: [{
        id: "browser_tab:3",
        kind: "browser_tab",
        title: "Blog draft",
        url: "https://example.test/blog-draft",
        source: "chrome-extension",
        captured_at: "2026-05-09T11:57:00.000Z",
        restore_confidence: "high",
      }],
    }, {
      id: "rte_capture_tab_blog",
      event_id: "evt_capture_tab_blog",
      action: "attach_to_task",
      target_task_id: "task_blog",
      confidence: "high",
      evidence: [],
      created_at: "2026-05-09T11:57:00.000Z",
    }, new Date("2026-05-09T11:57:00.000Z"));
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("lists only unbound captured tabs", async () => {
    const response = await fetch(`${baseUrl}/reading-queue`);
    assert.equal(response.status, 200);
    const body = await response.json() as ReadingQueueListBody;
    assert.equal(body.count, 2);
    const ids = body.contexts.map((entry) => entry.id).sort();
    assert.deepEqual(ids, ["browser_tab:1", "browser_tab:2"]);
    assert.equal(body.contexts.find((entry) => entry.id === "browser_tab:1")?.url, "https://example.test/agents-os");
  });

  it("promotes selected tabs into queue papers and is idempotent", async () => {
    const response = await fetch(`${baseUrl}/reading-queue/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_ids: ["browser_tab:1"], actor_id: "test_user" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as ReadingQueuePromoteBody;
    assert.equal(body.ok, true);
    assert.equal(body.promoted_count, 1);
    assert.equal(body.promoted[0]?.context_id, "browser_tab:1");
    assert.ok(body.promoted[0]?.queue_item_id);
    assert.equal(body.promoted[0]?.idempotent, false);

    // Promote again — should remain idempotent (no new queue item created).
    const repeat = await fetch(`${baseUrl}/reading-queue/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_ids: ["browser_tab:1"] }),
    });
    const repeatBody = await repeat.json() as ReadingQueuePromoteBody;
    assert.equal(repeatBody.promoted_count, 1);
    assert.equal(repeatBody.promoted[0]?.idempotent, true);

    // Queue should now contain a reading-queue paper.
    const queueResponse = await fetch(`${baseUrl}/queue`);
    const queueBody = await queueResponse.json() as { items: Array<{ id: string; task_id?: string; review_packet?: { title?: string; context?: Array<{ kind?: string; url?: string }> } }> };
    const readingPaper = queueBody.items.find((item) => item.task_id === "task_reading_queue");
    assert.ok(readingPaper, "expected queue paper for reading queue");
    assert.match(readingPaper!.review_packet?.title ?? "", /agents/i);
    const tabContext = readingPaper!.review_packet?.context?.find((entry) => entry.kind === "browser_tab");
    assert.equal(tabContext?.url, "https://example.test/agents-os");
  });

  it("promotes all unbound tabs when no context_ids are provided", async () => {
    const response = await fetch(`${baseUrl}/reading-queue/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as ReadingQueuePromoteBody;
    // browser_tab:1 was already promoted above; browser_tab:2 should be the only fresh one.
    const tab2 = body.promoted.find((entry) => entry.context_id === "browser_tab:2");
    assert.ok(tab2);
    assert.equal(tab2!.idempotent, false);
  });

  it("reports missing context ids without erroring", async () => {
    const response = await fetch(`${baseUrl}/reading-queue/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_ids: ["browser_tab:does-not-exist"] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as ReadingQueuePromoteBody;
    assert.equal(body.promoted_count, 0);
    assert.deepEqual(body.missing_context_ids, ["browser_tab:does-not-exist"]);
  });
});
