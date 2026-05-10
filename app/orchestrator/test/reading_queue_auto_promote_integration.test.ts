import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";

// V11 — proves the reading-queue auto-promote behaviour end-to-end against
// fixture captured tabs. The orchestrator's setInterval timer in
// `app/orchestrator/src/index.ts` is a thin HTTP poller that POSTs to
// `/reading-queue/auto-promote`; this test drives that endpoint with an
// injectable clock to deterministically prove the threshold filter, the
// promotion side effects, and a real-timer end-to-end tick.

type AutoPromoteBody = {
  ok: boolean;
  evaluated_count: number;
  aged_count: number;
  promoted_count: number;
  promoted: Array<{ context_id: string; queue_item_id?: string; review_packet_id?: string; event_id: string; idempotent: boolean }>;
};

type QueueListBody = {
  items: Array<{ id: string; task_id?: string; review_packet?: { title?: string; context?: Array<{ kind?: string; url?: string; id?: string }> } }>;
};

async function seedCapturedTab(
  store: ReturnType<typeof createInMemoryGatewayStore>,
  options: { id: string; capturedAt: string; title: string; url: string; taskHint?: string; routeAction?: "store_only" | "attach_to_task"; targetTaskId?: string },
): Promise<void> {
  const eventId = `evt_capture_${options.id.replace(/[^a-z0-9]+/gi, "_")}`;
  const idemKey = `browser:${options.id}`;
  await store.recordEventRoute(
    {
      id: eventId,
      source: "browser",
      source_id: idemKey,
      idempotency_key: idemKey,
      occurred_at: options.capturedAt,
      received_at: options.capturedAt,
      actor: { id: "chrome_extension", type: "system" },
      type: "browser.context_captured",
      task_hint: options.taskHint,
      title: options.title,
      summary: "Captured browser tab.",
      raw_ref: { id: `raw_${eventId}`, uri: `browser://tabs/${options.id}`, media_type: "application/json" },
      links: [],
      resources: [{
        id: options.id,
        kind: "browser_tab",
        title: options.title,
        url: options.url,
        source: "chrome-extension",
        captured_at: options.capturedAt,
        restore_confidence: "high",
      }],
    },
    {
      id: `rte_${eventId}`,
      event_id: eventId,
      action: options.routeAction ?? "store_only",
      target_task_id: options.targetTaskId,
      confidence: "medium",
      evidence: [],
      created_at: options.capturedAt,
    },
    new Date(options.capturedAt),
  );
}

describe("reading-queue auto-promote — V11 integration proof", () => {
  let server: Server;
  let baseUrl: string;
  let store: ReturnType<typeof createInMemoryGatewayStore>;
  // Mutable injected clock — every server `now()` call reads this.
  let clock = new Date("2026-05-10T12:00:00.000Z");

  before(async () => {
    store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      now: () => clock,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Three unbound captured tabs at different ages (relative to clock=12:00:00):
    //   tab_slack_yesterday — 24h old (well past any reasonable threshold)
    //   tab_notion_15m      — 15 min old
    //   tab_fresh_2m        — 2 min old (should never promote at sane thresholds)
    // Plus one tab already bound to a task — must never promote.
    await seedCapturedTab(store, {
      id: "browser_tab:slack_yesterday",
      capturedAt: "2026-05-09T12:00:00.000Z",
      title: "Slack — review #eng-runtime",
      url: "https://app.slack.test/eng-runtime",
    });
    await seedCapturedTab(store, {
      id: "browser_tab:notion_15m",
      capturedAt: "2026-05-10T11:45:00.000Z",
      title: "Notion — Q3 plan",
      url: "https://notion.test/q3",
    });
    await seedCapturedTab(store, {
      id: "browser_tab:fresh_2m",
      capturedAt: "2026-05-10T11:58:00.000Z",
      title: "Hacker News thread",
      url: "https://news.test/123",
    });
    await seedCapturedTab(store, {
      id: "browser_tab:bound_blog",
      capturedAt: "2026-05-09T08:00:00.000Z",
      title: "Bound blog draft",
      url: "https://example.test/blog",
      taskHint: "blog",
      routeAction: "attach_to_task",
      targetTaskId: "task_blog",
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("only promotes tabs older than the threshold; fresher tabs and bound tabs stay", async () => {
    // Threshold = 600s (10m). At clock=12:00:
    //   slack_yesterday (24h old) — qualifies
    //   notion_15m      (15m old) — qualifies
    //   fresh_2m        (2m old)  — does NOT qualify
    //   bound_blog               — bound to task_blog, never appears as unbound
    const response = await fetch(`${baseUrl}/reading-queue/auto-promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ min_age_seconds: 600, actor_id: "v11_proof_tick_1" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as AutoPromoteBody;
    assert.equal(body.ok, true);
    // evaluated = unbound tabs (3), aged = those past threshold (2), promoted_count = 2 fresh promotions.
    assert.equal(body.evaluated_count, 3, "evaluated_count should be 3 unbound tabs");
    assert.equal(body.aged_count, 2, "aged_count should be 2 tabs past threshold");
    assert.equal(body.promoted_count, 2, "should promote both aged tabs on first tick");
    const promotedIds = body.promoted.map((p) => p.context_id).sort();
    assert.deepEqual(promotedIds, ["browser_tab:notion_15m", "browser_tab:slack_yesterday"]);
    for (const p of body.promoted) {
      assert.ok(p.queue_item_id, `promoted ${p.context_id} should have queue_item_id`);
      assert.equal(p.idempotent, false);
    }
  });

  it("promoted tabs land on the active queue with task_hint=reading_queue and url context", async () => {
    const queueResp = await fetch(`${baseUrl}/queue`);
    assert.equal(queueResp.status, 200);
    const queue = await queueResp.json() as QueueListBody;
    const readingPapers = queue.items.filter((item) => item.task_id === "task_reading_queue");
    assert.equal(readingPapers.length, 2, "two reading-queue papers should be on the active queue");
    const contextUrls = new Set<string>();
    for (const paper of readingPapers) {
      const ctx = paper.review_packet?.context?.find((entry) => entry.kind === "browser_tab");
      assert.ok(ctx, `paper ${paper.id} missing browser_tab context`);
      if (ctx?.url) contextUrls.add(ctx.url);
      assert.match(paper.review_packet?.title ?? "", /\bRead: /i);
    }
    assert.ok(contextUrls.has("https://app.slack.test/eng-runtime"));
    assert.ok(contextUrls.has("https://notion.test/q3"));
    assert.ok(!contextUrls.has("https://news.test/123"), "fresh tab must not have been promoted");
    assert.ok(!contextUrls.has("https://example.test/blog"), "bound tab must not have been promoted");
  });

  it("is idempotent across repeated ticks at the same clock", async () => {
    const response = await fetch(`${baseUrl}/reading-queue/auto-promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ min_age_seconds: 600, actor_id: "v11_proof_tick_2" }),
    });
    const body = await response.json() as AutoPromoteBody;
    // The aged tabs are still aged (clock unchanged) but already have a stored event,
    // so the promotion is idempotent — no new queue item created.
    assert.equal(body.aged_count, 2);
    assert.equal(body.promoted_count, 0, "second tick at same clock should be a no-op promotion-wise");
    for (const p of body.promoted) {
      assert.equal(p.idempotent, true);
    }
    // Active queue should still have exactly 2 reading-queue papers — no duplicates.
    const queue = await (await fetch(`${baseUrl}/queue`)).json() as QueueListBody;
    const readingPapers = queue.items.filter((item) => item.task_id === "task_reading_queue");
    assert.equal(readingPapers.length, 2, "no duplicate reading-queue papers after idempotent tick");
  });

  it("advancing the clock past the fresh tab's threshold promotes it on the next tick", async () => {
    // Advance clock by 15 minutes → fresh_2m is now 17m old, past 600s threshold.
    clock = new Date("2026-05-10T12:15:00.000Z");
    const response = await fetch(`${baseUrl}/reading-queue/auto-promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ min_age_seconds: 600, actor_id: "v11_proof_tick_3" }),
    });
    const body = await response.json() as AutoPromoteBody;
    assert.equal(body.aged_count, 3, "all three unbound tabs are now past threshold");
    assert.equal(body.promoted_count, 1, "only the previously-fresh tab should be a fresh promotion");
    const fresh = body.promoted.find((p) => p.context_id === "browser_tab:fresh_2m");
    assert.ok(fresh, "fresh_2m must appear in promotion result");
    assert.equal(fresh!.idempotent, false);
    const queue = await (await fetch(`${baseUrl}/queue`)).json() as QueueListBody;
    const readingPapers = queue.items.filter((item) => item.task_id === "task_reading_queue");
    assert.equal(readingPapers.length, 3, "queue should now have all three reading-queue papers");
  });

  it("min_age_seconds=0 promotes everything immediately (verifies threshold is respected)", async () => {
    // Already-promoted tabs are idempotent; this just confirms aged_count == evaluated_count when threshold=0.
    const response = await fetch(`${baseUrl}/reading-queue/auto-promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ min_age_seconds: 0 }),
    });
    const body = await response.json() as AutoPromoteBody;
    assert.equal(body.evaluated_count, body.aged_count, "with threshold=0 every unbound tab is aged");
  });

  it("rejects invalid min_age_seconds with a schema error", async () => {
    const response = await fetch(`${baseUrl}/reading-queue/auto-promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ min_age_seconds: -5 }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string; message?: string } };
    assert.equal(body.error?.code, "schema_error");
    assert.match(body.error?.message ?? "", /min_age_seconds/);
  });
});

describe("reading-queue auto-promote — V11 real-timer end-to-end", () => {
  // Proves the orchestrator-side timer pattern works against a real running gateway:
  // a real `setInterval` POSTs to /reading-queue/auto-promote and the queue shows
  // promoted papers within a deterministic window. This is the closest possible
  // mirror of `app/orchestrator/src/index.ts`'s setInterval block.
  let server: Server;
  let baseUrl: string;
  let store: ReturnType<typeof createInMemoryGatewayStore>;
  let clock = new Date("2026-05-10T13:00:00.000Z");
  let timer: NodeJS.Timeout | undefined;

  before(async () => {
    store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      now: () => clock,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    await seedCapturedTab(store, {
      id: "browser_tab:rt_aged",
      capturedAt: "2026-05-10T12:30:00.000Z", // 30m old
      title: "Slack — async review",
      url: "https://app.slack.test/async",
    });
    await seedCapturedTab(store, {
      id: "browser_tab:rt_fresh",
      capturedAt: "2026-05-10T12:59:50.000Z", // 10s old
      title: "Quick check",
      url: "https://example.test/quick",
    });
  });

  after(async () => {
    if (timer) clearInterval(timer);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("a real setInterval timer ticks /reading-queue/auto-promote and promotes aged tabs", async () => {
    let tickCount = 0;
    let lastError: unknown;
    timer = setInterval(async () => {
      tickCount += 1;
      try {
        await fetch(`${baseUrl}/reading-queue/auto-promote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ min_age_seconds: 300, actor_id: "v11_real_timer" }),
        });
      } catch (error) {
        lastError = error;
      }
    }, 50);

    // Wait for at least 2 ticks (>=100ms) but cap at 1.5s for safety.
    const deadline = Date.now() + 1500;
    while (tickCount < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(tickCount >= 2, `timer did not fire enough; tickCount=${tickCount}`);
    assert.equal(lastError, undefined, `tick threw: ${lastError instanceof Error ? lastError.message : String(lastError)}`);

    const queue = await (await fetch(`${baseUrl}/queue`)).json() as QueueListBody;
    const readingPapers = queue.items.filter((item) => item.task_id === "task_reading_queue");
    assert.equal(readingPapers.length, 1, "exactly the aged tab should have been promoted");
    const ctx = readingPapers[0].review_packet?.context?.find((c) => c.kind === "browser_tab");
    assert.equal(ctx?.url, "https://app.slack.test/async");
  });
});
