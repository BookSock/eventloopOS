import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresQueueStore, type EventRecord, type NewQueueItem } from "../src/db/postgres_queue_store.js";
import type { ReviewPacket } from "../src/contracts.js";
import { createPostgresGatewayStore } from "../src/gateway_store.js";
import { PostgresObservability } from "../src/observability.js";
import { createGatewayServer } from "../src/server.js";
import type { RestorePlan } from "../src/workspace/aerospace.js";
import type { WorkspaceController } from "../src/workspace/controller.js";

const createdAt = "2026-05-06T12:00:00.000Z";

describe("PostgresQueueStore", () => {
  let container: StartedPostgreSqlContainer | undefined;
  let store: PostgresQueueStore | undefined;
  let skipReason: string | undefined;
  const externalDatabaseUrl = process.env.EVENTLOOPOS_TEST_DATABASE_URL;

  before(async () => {
    try {
      container = externalDatabaseUrl ? undefined : await new PostgreSqlContainer("postgres:16-alpine").start();
      store = new PostgresQueueStore({
        connectionString: externalDatabaseUrl ?? container!.getConnectionUri(),
        clock: () => new Date(createdAt),
        defaultLeaseMs: 60_000,
      });
      if (externalDatabaseUrl) {
        assertSafeExternalTestDatabaseUrl(externalDatabaseUrl);
        await resetExternalTestDatabase(store);
      }
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

  beforeEach(async () => {
    if (!store) return;
    await clearTestData(store);
  });

  it("applies migrations to empty Postgres", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const result = await store.pool.query("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepEqual(result.rows, [
      { id: "0001_core_queue.sql" },
      { id: "0002_context_restore_requests.sql" },
      { id: "0003_observability.sql" },
      { id: "0004_context_restore_failures.sql" },
    ]);
  });

  it("persists activity events and counters", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const observability = new PostgresObservability(store.pool, () => "actv_db_fixture");
    await observability.incrementCounter("events_ingested_total");
    await observability.incrementCounter("events_ingested_total", 2);
    await observability.recordActivity({
      type: "event_routed",
      occurred_at: "2026-05-06T12:00:01.000Z",
      actor: "system",
      event_id: "evt_observability",
      task_id: "task_observability",
      task_session_id: "task_session_observability",
      source_id: "local_fixture",
      status: "ok",
      summary: "Event routed: fixture",
      details: {
        route_action: "ask_human_now",
      },
    });

    const restarted = new PostgresObservability(store.pool);
    assert.deepEqual(await restarted.snapshot(), {
      counters: {
        events_ingested_total: 3,
      },
      activity_count: 1,
    });
    assert.deepEqual(await restarted.listActivity(10), [
      {
        id: "actv_db_fixture",
        type: "event_routed",
        occurred_at: "2026-05-06T12:00:01.000Z",
        actor: "system",
        task_id: "task_observability",
        queue_item_id: undefined,
        event_id: "evt_observability",
        task_session_id: "task_session_observability",
        source_id: "local_fixture",
        status: "ok",
        summary: "Event routed: fixture",
        details: {
          route_action: "ask_human_now",
        },
      },
    ]);
    assert.deepEqual((await restarted.listActivity({
      task_session_id: "task_session_observability",
      status: "ok",
      since: "2026-05-06T12:00:00.000Z",
      limit: 10,
    })).map((event) => event.id), ["actv_db_fixture"]);
    assert.deepEqual(await restarted.listActivity({
      task_id: "task_missing",
      limit: 10,
    }), []);
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

  it("keeps event route idempotent across orchestrator restart", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const event = makeEvent("evt_api_restart", "idem_api_restart");
    const first = await withPostgresGateway(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      assert.equal(response.status, 202);
      return await response.json() as {
        route_decision: { id: string; action: string };
        queue_item: { id: string };
      };
    });

    const afterRestart = await withPostgresGateway(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: {
            ...event,
            id: "evt_api_restart_retry",
            title: "Retry should not replace first routed event",
          },
        }),
      });
      assert.equal(response.status, 202);
      return await response.json() as {
        route_decision: { id: string; action: string };
        queue_item: { id: string };
      };
    });

    assert.equal(afterRestart.route_decision.id, first.route_decision.id);
    assert.equal(afterRestart.route_decision.action, "ask_human_now");
    assert.equal(afterRestart.queue_item.id, first.queue_item.id);
    assert.equal((await store.pool.query("SELECT count(*)::int AS count FROM events")).rows[0]?.count, 1);
    assert.equal((await store.pool.query("SELECT count(*)::int AS count FROM queue_items")).rows[0]?.count, 1);
  });

  it("keeps failed restore request retryable across orchestrator restart", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const created = await withPostgresGateway(store, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/contexts/restore-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_restore_restart",
        },
        body: JSON.stringify({
          resource: {
            id: "ctx_restore_restart_browser",
            kind: "browser_tab",
            title: "Restore restart doc",
            url: "https://example.test/restore-restart",
            restore_confidence: "high",
          },
        }),
      });
      assert.equal(createResponse.status, 202);
      const createBody = await createResponse.json() as {
        restore_request: { id: string; status: string };
      };
      assert.equal(createBody.restore_request.status, "pending");

      const claimResponse = await fetch(`${baseUrl}/contexts/restore-requests/claim-next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lease_owner: "browser_before_restart", lease_ms: 1_000 }),
      });
      const claimBody = await claimResponse.json() as {
        restore_request: { id: string; status: string; lease_owner?: string };
      };
      assert.equal(claimResponse.status, 200);
      assert.equal(claimBody.restore_request.id, createBody.restore_request.id);
      assert.equal(claimBody.restore_request.status, "leased");

      const failedResponse = await fetch(`${baseUrl}/contexts/restore-requests/${createBody.restore_request.id}/failed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: { ok: false, error: "tab went away" } }),
      });
      const failedBody = await failedResponse.json() as {
        restore_request: { id: string; status: string; result: Record<string, unknown> };
      };
      assert.equal(failedResponse.status, 200);
      assert.equal(failedBody.restore_request.status, "failed");
      assert.deepEqual(failedBody.restore_request.result, { ok: false, error: "tab went away" });
      return failedBody.restore_request;
    });

    await withPostgresGateway(store, async (baseUrl) => {
      const getFailedResponse = await fetch(`${baseUrl}/contexts/restore-requests/${created.id}`);
      const getFailedBody = await getFailedResponse.json() as {
        restore_request: { id: string; status: string; result: Record<string, unknown> };
      };
      assert.equal(getFailedResponse.status, 200);
      assert.equal(getFailedBody.restore_request.status, "failed");
      assert.deepEqual(getFailedBody.restore_request.result, { ok: false, error: "tab went away" });

      const retryResponse = await fetch(`${baseUrl}/contexts/restore-requests/${created.id}/retry`, {
        method: "POST",
      });
      const retryBody = await retryResponse.json() as {
        restore_request: { id: string; status: string; result?: unknown };
      };
      assert.equal(retryResponse.status, 200);
      assert.equal(retryBody.restore_request.status, "pending");
      assert.equal(retryBody.restore_request.result, undefined);

      const claimResponse = await fetch(`${baseUrl}/contexts/restore-requests/claim-next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lease_owner: "browser_after_restart", lease_ms: 1_000 }),
      });
      const claimBody = await claimResponse.json() as {
        restore_request: { id: string; status: string; lease_owner?: string };
      };
      assert.equal(claimResponse.status, 200);
      assert.equal(claimBody.restore_request.id, created.id);
      assert.equal(claimBody.restore_request.status, "leased");
      assert.equal(claimBody.restore_request.lease_owner, "browser_after_restart");
    });

    assert.equal((await store.pool.query("SELECT count(*)::int AS count FROM context_restore_requests")).rows[0]?.count, 1);
  });

  it("replays workspace restore execution receipts across orchestrator restart", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const executedPlans: unknown[] = [];
    const first = await withPostgresGateway<{
      idempotency_replayed: boolean;
      receipt: { commands: Array<{ stdout: string }> };
    }>(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/workspace/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_workspace_restore_restart",
        },
        body: JSON.stringify({
          confirm_execute: true,
          snapshot: { backend: "aerospace", windows: [] },
        }),
      });
      assert.equal(response.status, 200);
      return await response.json() as {
        idempotency_replayed: boolean;
        receipt: { commands: Array<{ stdout: string }> };
      };
    }, {
      workspaceExecuteEnabled: true,
      workspace: makeWorkspaceController(executedPlans),
    });

    const afterRestart = await withPostgresGateway<{
      idempotency_replayed: boolean;
      receipt: { commands: Array<{ stdout: string }> };
    }>(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/workspace/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_workspace_restore_restart",
        },
        body: JSON.stringify({
          confirm_execute: true,
          snapshot: { backend: "aerospace", windows: [] },
        }),
      });
      assert.equal(response.status, 200);
      return await response.json() as {
        idempotency_replayed: boolean;
        receipt: { commands: Array<{ stdout: string }> };
      };
    }, {
      workspaceExecuteEnabled: true,
      workspace: makeWorkspaceController(executedPlans),
    });

    assert.equal(first.idempotency_replayed, false);
    assert.equal(afterRestart.idempotency_replayed, true);
    assert.equal(afterRestart.receipt.commands[0]?.stdout, "ok");
    assert.equal(executedPlans.length, 1);
    assert.equal((await store.pool.query("SELECT count(*)::int AS count FROM receipts")).rows[0]?.count, 1);
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

  it("defers, requeues, and ignores queue items", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const packet = makePacket("pkt_defer_ignore", { title: "Defer packet" });
    await store.recordEventWithReviewPacket(
      makeEvent("evt_defer_ignore", "idem_defer_ignore"),
      packet,
      makeQueueItem("qit_defer_ignore", packet.id, { priority_score: 940 }),
    );

    const deferred = await store.deferQueueItem("qit_defer_ignore", "user_jason", new Date("2026-05-06T12:05:00.000Z"));
    assert.equal(deferred?.state, "deferred");
    assert.equal(deferred?.due_at, "2026-05-06T12:05:00.000Z");
    assert.equal(await store.leaseNext("worker_before_due", 1_000), undefined);

    const reapedBeforeDue = await store.reapDueDeferredItems(new Date("2026-05-06T12:04:00.000Z"));
    assert.deepEqual(reapedBeforeDue, []);
    const reapedAfterDue = await store.reapDueDeferredItems(new Date("2026-05-06T12:06:00.000Z"));
    assert.deepEqual(reapedAfterDue.map((item) => item.id), ["qit_defer_ignore"]);
    assert.equal(reapedAfterDue[0]?.state, "ready");

    const ignored = await store.ignoreQueueItem("qit_defer_ignore", "user_jason");
    assert.equal(ignored?.state, "dead");
    assert.equal(await store.leaseNext("worker_after_ignore", 1_000), undefined);
  });

  it("deduplicates, leases, reclaims, and completes context restore requests", async (t) => {
    if (!store) {
      t.skip(skipReason);
      return;
    }

    const request = makeContextRestoreRequest("ctx_restore_db", "idem_ctx_restore_db");
    const first = await store.createContextRestoreRequest(request, new Date(createdAt));
    const second = await store.createContextRestoreRequest(
      makeContextRestoreRequest("ctx_restore_db_retry", "idem_ctx_restore_db"),
      new Date(createdAt),
    );

    assert.equal(first.inserted, true);
    assert.equal(first.record.status, "pending");
    assert.equal(second.inserted, false);
    assert.equal(second.record.id, first.record.id);

    const peeked = await store.peekNextContextRestoreRequest(new Date(createdAt));
    assert.equal(peeked?.id, first.record.id);
    assert.equal(peeked?.status, "pending");

    const leased = await store.claimNextContextRestoreRequest("browser_a", 1_000);
    assert.equal(leased?.id, first.record.id);
    assert.equal(leased?.status, "leased");
    assert.equal(leased?.lease_owner, "browser_a");
    assert.equal(await store.claimNextContextRestoreRequest("browser_b", 1_000), undefined);

    const failed = await store.markContextRestoreRequestFailed(
      first.record.id,
      { ok: false, error: "tab not found" },
      new Date("2026-05-06T12:00:01.500Z"),
    );
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.lease_owner, undefined);
    assert.deepEqual(failed?.result, { ok: false, error: "tab not found" });
    assert.equal(await store.claimNextContextRestoreRequest("browser_after_failed", 1_000), undefined);

    const retried = await store.retryContextRestoreRequest(
      first.record.id,
      new Date("2026-05-06T12:00:01.750Z"),
    );
    assert.equal(retried?.status, "pending");
    assert.equal(retried?.result, undefined);

    const reapedBeforeExpiry = await store.reapExpiredContextRestoreRequestLeases(new Date("2026-05-06T12:00:00.500Z"));
    assert.deepEqual(reapedBeforeExpiry.map((record) => record.id), []);

    const leasedForReap = await store.claimNextContextRestoreRequest("browser_reap", 1_000);
    assert.equal(leasedForReap?.status, "leased");

    const reapedAfterExpiry = await store.reapExpiredContextRestoreRequestLeases(new Date("2026-05-06T12:00:02.751Z"));
    assert.deepEqual(reapedAfterExpiry.map((record) => record.id), [first.record.id]);
    assert.equal(reapedAfterExpiry[0].status, "pending");

    const leasedAgain = await store.claimNextContextRestoreRequest("browser_b", 1_000);
    assert.equal(leasedAgain?.id, first.record.id);
    assert.equal(leasedAgain?.lease_owner, "browser_b");

    const done = await store.markContextRestoreRequestDone(
      first.record.id,
      { ok: true, tabId: 7, restoredScroll: true },
      new Date("2026-05-06T12:00:02.000Z"),
    );
    assert.equal(done?.status, "done");
    assert.equal(done?.lease_owner, undefined);
    assert.deepEqual(done?.result, { ok: true, tabId: 7, restoredScroll: true });
    assert.equal(await store.claimNextContextRestoreRequest("browser_c", 1_000), undefined);
  });
});

async function withPostgresGateway<T>(
  store: PostgresQueueStore,
  callback: (baseUrl: string) => Promise<T>,
  overrides: Partial<Parameters<typeof createGatewayServer>[0]> = {},
): Promise<T> {
  const server = createGatewayServer({
    store: createPostgresGatewayStore(store),
    observability: new PostgresObservability(store.pool),
    now: () => new Date(createdAt),
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

function makeWorkspaceController(executedPlans: unknown[]): WorkspaceController {
  return {
    status() {
      return {
        available: true,
        backend: "aerospace" as const,
      };
    },
    capture() {
      return {
        backend: "aerospace" as const,
        windows: [],
      };
    },
    planRestore() {
      return {
        commands: [
          {
            command: "aerospace" as const,
            args: ["workspace", "eventloop-blog"],
          },
        ],
        skipped: [],
      };
    },
    executeRestorePlan(plan: RestorePlan) {
      executedPlans.push(plan);
      return {
        commands: [
          {
            command: "aerospace" as const,
            args: ["workspace", "eventloop-blog"],
            stdout: "ok",
          },
        ],
        skipped: [],
      };
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function resetExternalTestDatabase(store: PostgresQueueStore) {
  await store.pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await store.pool.query("CREATE SCHEMA public");
}

async function clearTestData(store: PostgresQueueStore) {
  await store.pool.query(`
    TRUNCATE
      metric_counters,
      activity_events,
      receipts,
      route_decisions,
      queue_items,
      review_packets,
      events,
      context_restore_requests
    RESTART IDENTITY CASCADE
  `);
}

function assertSafeExternalTestDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (databaseName !== "eventloop_test" && process.env.EVENTLOOPOS_ALLOW_DATABASE_RESET !== "1") {
    throw new Error("EVENTLOOPOS_TEST_DATABASE_URL must point to database eventloop_test or set EVENTLOOPOS_ALLOW_DATABASE_RESET=1");
  }
}

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

function makeContextRestoreRequest(id: string, idempotencyKey: string) {
  return {
    id,
    idempotency_key: idempotencyKey,
    resource: {
      id: `ctx_browser_${id}`,
      kind: "browser_tab",
      title: "Launch doc",
      url: "https://example.test/launch",
      restore_confidence: "high",
    },
    restore_plan: {
      kind: "browser_extension_message",
      side_effect: "local",
      execute_supported: false,
      target: "eventloopOS browser extension runtime",
      message: {
        type: "eventloop.restore",
        resource: {
          id: `ctx_browser_${id}`,
          kind: "browser_tab",
          title: "Launch doc",
          url: "https://example.test/launch",
          restore_confidence: "high",
        },
      },
    },
  };
}
