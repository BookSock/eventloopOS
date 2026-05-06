import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresQueueStore, type EventRecord, type NewQueueItem } from "../src/db/postgres_queue_store.js";
import type { ReviewPacket } from "../src/contracts.js";

const createdAt = "2026-05-06T12:00:00.000Z";

describe("PostgresQueueStore", () => {
  let container: StartedPostgreSqlContainer | undefined;
  let store: PostgresQueueStore | undefined;
  let skipReason: string | undefined;

  before(async () => {
    try {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      store = new PostgresQueueStore({
        connectionString: container.getConnectionUri(),
        clock: () => new Date(createdAt),
        defaultLeaseMs: 60_000,
      });
      await store.migrate();
    } catch (error) {
      skipReason = `live Postgres skipped: ${error instanceof Error ? error.message : String(error)}`;
      await store?.close();
      await container?.stop();
      store = undefined;
      container = undefined;
    }
  });

  after(async () => {
    await store?.close();
    await container?.stop();
  });

  it("applies migrations to empty Postgres", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const result = await store.pool.query("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepEqual(result.rows, [{ id: "0001_core_queue.sql" }]);
  });

  it("deduplicates events by source and idempotency key", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const event = makeEvent("evt_duplicate", "idem_duplicate");
    const packet = makePacket("pkt_duplicate");
    const queueItem = makeQueueItem("qit_duplicate", packet.id);

    const first = await store.recordEventWithReviewPacket(event, packet, queueItem);
    const second = await store.recordEventWithReviewPacket(
      { ...event, id: "evt_duplicate_retry", title: "Retry should not replace original event" },
      packet,
      queueItem,
    );

    const eventCount = await store.pool.query("SELECT count(*)::int AS count FROM events WHERE idempotency_key = $1", [
      event.idempotency_key,
    ]);
    const queueCount = await store.pool.query("SELECT count(*)::int AS count FROM queue_items WHERE review_packet_id = $1", [
      packet.id,
    ]);

    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.event_id, event.id);
    assert.ok(second.item);
    assert.equal(second.item.id, queueItem.id);
    assert.equal(eventCount.rows[0].count, 1);
    assert.equal(queueCount.rows[0].count, 1);
  });

  it("leases next ready item with SKIP LOCKED semantics and reaps stale leases", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const packet = makePacket("pkt_stale_lease", { title: "Stale lease packet" });
    await store.recordEventWithReviewPacket(
      makeEvent("evt_stale_lease", "idem_stale_lease"),
      packet,
      makeQueueItem("qit_stale_lease", packet.id, { priority_score: 900 }),
    );

    const leased = await store.leaseNext("worker_a", 1_000);
    assert.equal(leased?.id, "qit_stale_lease");
    assert.equal(leased?.state, "leased");
    assert.equal(leased?.lease_owner, "worker_a");
    assert.equal(await store.leaseNext("worker_b", 1_000), undefined);

    const reapedBeforeExpiry = await store.reapStaleLeases(new Date("2026-05-06T12:00:00.500Z"));
    assert.deepEqual(reapedBeforeExpiry.map((item) => item.id), []);

    const reapedAfterExpiry = await store.reapStaleLeases(new Date("2026-05-06T12:00:01.001Z"));
    assert.deepEqual(reapedAfterExpiry.map((item) => item.id), ["qit_stale_lease"]);
    assert.equal(reapedAfterExpiry[0].state, "ready");
    assert.equal(reapedAfterExpiry[0].lease_owner, undefined);

    const leasedAgain = await store.leaseNext("worker_b", 1_000);
    assert.equal(leasedAgain?.id, "qit_stale_lease");
    assert.equal(leasedAgain?.lease_owner, "worker_b");
  });

  it("marks queue item done and clears lease fields", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const packet = makePacket("pkt_mark_done", { title: "Mark done packet" });
    await store.recordEventWithReviewPacket(
      makeEvent("evt_mark_done", "idem_mark_done"),
      packet,
      makeQueueItem("qit_mark_done", packet.id, { priority_score: 950 }),
    );

    const leased = await store.leaseNext("worker_done", 10_000);
    assert.equal(leased?.id, "qit_mark_done");
    assert.equal(leased?.state, "leased");

    const renewed = await store.renewLease("qit_mark_done", "worker_done", 20_000);
    assert.equal(renewed?.id, "qit_mark_done");
    assert.equal(renewed?.lease_owner, "worker_done");
    assert.equal(renewed?.lease_expires_at, "2026-05-06T12:00:20.000Z");
    assert.equal(await store.renewLease("qit_mark_done", "wrong_owner", 20_000), undefined);

    const done = await store.markDone("qit_mark_done", "user_jason");
    assert.equal(done?.id, "qit_mark_done");
    assert.equal(done?.state, "done");
    assert.equal(done?.lease_owner, undefined);
    assert.equal(done?.lease_expires_at, undefined);
    assert.equal(await store.leaseNext("worker_after_done", 1_000), undefined);
    assert.equal(await store.markDone("qit_missing", "user_jason"), undefined);
  });
});

function makeEvent(id: string, idempotencyKey: string): EventRecord {
  return {
    id,
    source: "local",
    source_id: "local_fixture",
    idempotency_key: idempotencyKey,
    occurred_at: createdAt,
    received_at: createdAt,
    type: "fixture.review_needed",
    title: "Fixture event",
    raw_ref: {
      kind: "fixture",
      path: "test/db_postgres_queue_store.test.ts",
    },
    links: [],
    resources: [],
  };
}

function makePacket(id: string, overrides: Partial<ReviewPacket> = {}): ReviewPacket {
  return {
    id,
    title: "Review fixture packet",
    summary: "Packet created by deterministic DB test.",
    decision_needed: "Approve or reject fixture action.",
    risk_level: "low",
    confidence: "high",
    risk_tags: [],
    evidence: [
      {
        id: `ev_${id}`,
        kind: "test",
        title: "DB test fixture",
      },
    ],
    context: [],
    recommended_action: {
      id: `act_${id}`,
      type: "approve",
      label: "Approve",
      requires_confirmation: false,
      side_effect: "none",
      payload: {},
    },
    alternate_actions: [],
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function makeQueueItem(id: string, reviewPacketId: string, overrides: Partial<NewQueueItem> = {}): NewQueueItem {
  return {
    id,
    review_packet_id: reviewPacketId,
    state: "ready",
    priority_score: 100,
    priority_reasons: ["db_test"],
    ...overrides,
  };
}
