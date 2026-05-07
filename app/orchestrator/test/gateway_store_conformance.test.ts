import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createInMemoryGatewayStore, createPostgresGatewayStore, type GatewayStore } from "../src/gateway_store.js";
import { PostgresQueueStore } from "../src/db/postgres_queue_store.js";
import type { AgentRun } from "../src/contracts.js";
import type { McpEvent } from "../src/integrations/mcp_poll/types.js";
import type { ContextRestoreRequestRecord, InMemoryStore } from "../src/store.js";

const createdAt = "2026-05-06T12:00:00.000Z";
const now = new Date(createdAt);

type StoreHarness = {
  store: GatewayStore;
  cleanup(): Promise<void>;
};

describe("GatewayStore conformance", () => {
  let container: StartedPostgreSqlContainer | undefined;
  let postgres: PostgresQueueStore | undefined;
  let postgresSkipReason: string | undefined;

  before(async () => {
    if (process.env.EVENTLOOPOS_TEST_DATABASE_URL) {
      postgresSkipReason = "Postgres GatewayStore conformance skipped with EVENTLOOPOS_TEST_DATABASE_URL to avoid parallel DB resets";
      return;
    }

    try {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      postgres = new PostgresQueueStore({
        connectionString: container.getConnectionUri(),
        clock: () => now,
        defaultLeaseMs: 60_000,
      });
      await postgres.migrate();
    } catch (error) {
      postgresSkipReason = `Postgres GatewayStore conformance skipped: ${error instanceof Error ? error.message : String(error)}`;
      await postgres?.close();
      await container?.stop();
      postgres = undefined;
      container = undefined;
    }
  });

  after(async () => {
    await postgres?.close();
    await container?.stop();
  });

  runGatewayStoreContract("in-memory", async () => ({
    store: createInMemoryGatewayStore(createEmptyInMemoryStore()),
    async cleanup() {},
  }));

  runGatewayStoreContract("postgres", async (t) => {
    if (!postgres) {
      t.skip(postgresSkipReason);
      return undefined;
    }

    await clearPostgresTestData(postgres);
    return {
      store: createPostgresGatewayStore(postgres),
      async cleanup() {
        await clearPostgresTestData(postgres!);
      },
    };
  });
});

function runGatewayStoreContract(
  name: string,
  createHarness: (t: TestContext) => Promise<StoreHarness | undefined>,
): void {
  describe(name, () => {
    it("deduplicates event ingest and exposes stored context search", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const firstEvent = makeEvent("evt_gateway_context", "idem_gateway_context", {
          title: "Launch context needs review",
          task_hint: "blog",
          resources: [makeBrowserResource("ctx_gateway_launch", "Launch paragraph", "https://example.test/launch#intro")],
        });
        const retryEvent = makeEvent("evt_gateway_context_retry", "idem_gateway_context", {
          title: "Retry should not replace stored event",
          task_hint: "blog",
          resources: [makeBrowserResource("ctx_gateway_retry", "Retry paragraph", "https://example.test/retry")],
        });

        const first = await harness.store.ingestEventAsReviewPacket(firstEvent, now);
        const second = await harness.store.ingestEventAsReviewPacket(retryEvent, new Date("2026-05-06T12:01:00.000Z"));
        const stored = await harness.store.getEventByIdempotencyKey("slack", "idem_gateway_context");
        const contexts = await harness.store.listContextEntries({
          task_id: "task_blog",
          q: "launch paragraph",
          limit: 10,
        });

        assert.equal(first.event.id, "evt_gateway_context");
        assert.equal(first.queue_item?.id, "qit_evt_gateway_context");
        assert.equal(second.event.id, "evt_gateway_context");
        assert.equal(second.queue_item?.id, first.queue_item?.id);
        assert.equal(stored?.event.id, "evt_gateway_context");
        assert.equal(stored?.queue_item?.id, first.queue_item?.id);
        assert.deepEqual(contexts.map((entry) => entry.resource.id), ["ctx_gateway_launch"]);
        assert.equal(contexts[0]?.task_id, "task_blog");
      } finally {
        await harness.cleanup();
      }
    });

    it("leases, renews, defers, requeues, and ignores queue items consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const event = makeEvent("evt_gateway_queue", "idem_gateway_queue", {
          title: "Queue contract work",
          task_hint: "queue",
        });
        await harness.store.ingestEventAsReviewPacket(event, now);

        const leased = await harness.store.leaseNextQueueItem("worker_a", now, 1_000);
        assert.equal(leased?.id, "qit_evt_gateway_queue");
        assert.equal(leased?.state, "leased");
        assert.equal(leased?.lease_owner, "worker_a");
        assert.equal(leased?.lease_expires_at, "2026-05-06T12:00:01.000Z");

        const renewed = await harness.store.renewQueueLease("qit_evt_gateway_queue", "worker_a", now, 2_000);
        assert.equal(renewed?.lease_expires_at, "2026-05-06T12:00:02.000Z");
        assert.equal(await harness.store.renewQueueLease("qit_evt_gateway_queue", "worker_b", now, 2_000), undefined);
        assert.equal(await harness.store.leaseNextQueueItem("worker_b", now, 1_000), undefined);

        const reaped = await harness.store.nextQueueItem(new Date("2026-05-06T12:00:02.001Z"));
        assert.equal(reaped?.id, "qit_evt_gateway_queue");
        assert.equal(reaped?.state, "ready");

        const deferred = await harness.store.deferQueueItem(
          "qit_evt_gateway_queue",
          "user_jason",
          new Date("2026-05-06T12:05:00.000Z"),
          now,
        );
        assert.equal(deferred?.state, "deferred");
        assert.equal(deferred?.due_at, "2026-05-06T12:05:00.000Z");
        assert.equal(await harness.store.leaseNextQueueItem("worker_before_due", now, 1_000), undefined);

        const readyAfterDue = await harness.store.listQueue(undefined, new Date("2026-05-06T12:05:01.000Z"));
        assert.deepEqual(readyAfterDue.map((item) => item.id), ["qit_evt_gateway_queue"]);
        assert.equal(readyAfterDue[0]?.state, "ready");

        const ignored = await harness.store.ignoreQueueItem("qit_evt_gateway_queue", "user_jason", now);
        assert.equal(ignored?.state, "dead");
        assert.equal(await harness.store.leaseNextQueueItem("worker_after_ignore", now, 1_000), undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("deduplicates and completes context restore requests consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const first = await harness.store.createContextRestoreRequest(
          makeContextRestoreRequest("ctx_restore_gateway", "idem_restore_gateway"),
          now,
        );
        const duplicate = await harness.store.createContextRestoreRequest(
          makeContextRestoreRequest("ctx_restore_gateway_retry", "idem_restore_gateway"),
          new Date("2026-05-06T12:01:00.000Z"),
        );

        assert.equal(first.inserted, true);
        assert.equal(first.record.status, "pending");
        assert.equal(duplicate.inserted, false);
        assert.equal(duplicate.record.id, first.record.id);
        assert.equal((await harness.store.peekNextContextRestoreRequest(now))?.id, first.record.id);

        const leased = await harness.store.claimNextContextRestoreRequest("browser_a", now, 1_000);
        assert.equal(leased?.status, "leased");
        assert.equal(leased?.lease_owner, "browser_a");
        assert.equal(await harness.store.claimNextContextRestoreRequest("browser_b", now, 1_000), undefined);

        const failed = await harness.store.markContextRestoreRequestFailed(
          first.record.id,
          { ok: false, error: "tab missing" },
          new Date("2026-05-06T12:00:01.000Z"),
        );
        assert.equal(failed?.status, "failed");
        assert.equal(failed?.lease_owner, undefined);
        assert.deepEqual(failed?.result, { ok: false, error: "tab missing" });
        assert.equal(await harness.store.claimNextContextRestoreRequest("browser_after_failed", now, 1_000), undefined);

        const retried = await harness.store.retryContextRestoreRequest(first.record.id, new Date("2026-05-06T12:00:02.000Z"));
        assert.equal(retried?.status, "pending");
        assert.equal(retried?.result, undefined);

        const leasedAgain = await harness.store.claimNextContextRestoreRequest("browser_b", now, 1_000);
        assert.equal(leasedAgain?.lease_owner, "browser_b");

        const done = await harness.store.markContextRestoreRequestDone(
          first.record.id,
          { ok: true, tabId: 7 },
          new Date("2026-05-06T12:00:03.000Z"),
        );
        assert.equal(done?.status, "done");
        assert.equal(done?.lease_owner, undefined);
        assert.deepEqual(done?.result, { ok: true, tabId: 7 });
        assert.equal(await harness.store.claimNextContextRestoreRequest("browser_after_done", now, 1_000), undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("replays workspace restore receipts consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const first = await harness.store.recordWorkspaceRestoreReceipt({
          idempotencyKey: "idem_workspace_gateway",
          plan: {
            commands: [{ command: "aerospace", args: ["workspace", "eventloop-blog"] }],
            skipped: [],
          },
          receipt: {
            commands: [{ command: "aerospace", args: ["workspace", "eventloop-blog"], stdout: "ok" }],
            skipped: [],
          },
          now,
        });
        const second = await harness.store.recordWorkspaceRestoreReceipt({
          idempotencyKey: "idem_workspace_gateway",
          plan: {
            commands: [{ command: "aerospace", args: ["workspace", "different"] }],
            skipped: [],
          },
          receipt: {
            commands: [{ command: "aerospace", args: ["workspace", "different"], stdout: "changed" }],
            skipped: [],
          },
          now: new Date("2026-05-06T12:01:00.000Z"),
        });
        const fetched = await harness.store.getWorkspaceRestoreReceipt("idem_workspace_gateway");

        assert.equal(second.id, first.id);
        assert.deepEqual(second.plan, first.plan);
        assert.deepEqual(second.receipt, first.receipt);
        assert.deepEqual(fetched, first);
      } finally {
        await harness.cleanup();
      }
    });

    it("persists MCP poll cursor state consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const first = await harness.store.saveMcpPollState(
          "slack_dm_source",
          {
            cursor: "456.000",
            seen: new Set(["slack_dm_source:123.000", "slack_dm_source:456.000"]),
          },
          now,
        );
        const second = await harness.store.saveMcpPollState(
          "slack_dm_source",
          {
            cursor: "789.000",
            seen: new Set(["slack_dm_source:456.000", "slack_dm_source:789.000"]),
          },
          new Date("2026-05-06T12:01:00.000Z"),
        );
        const fetched = await harness.store.getMcpPollState("slack_dm_source");

        assert.equal(first.cursor, "456.000");
        assert.deepEqual(first.seen, ["slack_dm_source:123.000", "slack_dm_source:456.000"]);
        assert.equal(second.cursor, "789.000");
        assert.deepEqual(fetched, {
          source_id: "slack_dm_source",
          cursor: "789.000",
          seen: ["slack_dm_source:456.000", "slack_dm_source:789.000"],
          updated_at: "2026-05-06T12:01:00.000Z",
        });
      } finally {
        await harness.cleanup();
      }
    });

    it("upserts waiting agent runs into one queue item consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const first = await harness.store.upsertAgentRun(makeAgentRun({
          id: "run_gateway_agent",
          task_id: "task_gateway",
          status: "waiting_approval",
          blocked_reason: "Needs approval.",
        }), now);
        const second = await harness.store.upsertAgentRun(makeAgentRun({
          id: "run_gateway_agent",
          task_id: "task_gateway",
          status: "waiting_approval",
          blocked_reason: "Needs updated approval.",
        }), new Date("2026-05-06T12:01:00.000Z"));
        const fetched = await harness.store.getAgentRun("run_gateway_agent");
        const queue = await harness.store.listQueue("ready", now);
        const running = await harness.store.upsertAgentRun(makeAgentRun({
          id: "run_gateway_agent",
          task_id: "task_gateway",
          status: "running",
          blocked_reason: "Agent resumed.",
        }), new Date("2026-05-06T12:02:00.000Z"));
        const readyAfterRunning = await harness.store.listQueue("ready", now);
        const doneAfterRunning = await harness.store.listQueue("done", now);
        const reblocked = await harness.store.upsertAgentRun(makeAgentRun({
          id: "run_gateway_agent",
          task_id: "task_gateway",
          status: "blocked",
          blocked_reason: "Needs another answer.",
        }), new Date("2026-05-06T12:03:00.000Z"));
        const readyAfterReblocked = await harness.store.listQueue("ready", now);

        assert.equal(first.agent_run.id, "run_gateway_agent");
        assert.equal(first.queue_item?.id, "qit_run_gateway_agent_agent_waiting");
        assert.equal(first.review_packet?.summary, "Needs approval.");
        assert.equal(second.queue_item?.id, first.queue_item?.id);
        assert.equal(second.review_packet?.summary, "Needs updated approval.");
        assert.equal(second.review_packet?.created_at, first.review_packet?.created_at);
        assert.equal(fetched?.blocked_reason, "Needs updated approval.");
        assert.deepEqual(queue.map((item) => item.id), ["qit_run_gateway_agent_agent_waiting"]);
        assert.equal(running.queue_item, undefined);
        assert.deepEqual(readyAfterRunning.map((item) => item.id), []);
        assert.deepEqual(doneAfterRunning.map((item) => item.id), ["qit_run_gateway_agent_agent_waiting"]);
        assert.equal(reblocked.queue_item?.id, "qit_run_gateway_agent_agent_waiting");
        assert.equal(reblocked.queue_item?.state, "ready");
        assert.equal(reblocked.queue_item?.priority_score, 850);
        assert.deepEqual(readyAfterReblocked.map((item) => item.id), ["qit_run_gateway_agent_agent_waiting"]);
      } finally {
        await harness.cleanup();
      }
    });

    it("dedupes and finalizes task message history consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const first = await harness.store.recordTaskMessageAttempt({
          task_session_id: "task_session_blog",
          text: "Continue blog work.",
          event_ids: ["evt_gateway_task_message"],
          idempotency_key: "idem_gateway_task_message",
          origin: "event_route",
          occurred_at: createdAt,
          task_id: "task_blog",
          source_id: "slack:T123:C123:1",
        });
        const duplicate = await harness.store.recordTaskMessageAttempt({
          task_session_id: "task_session_blog",
          text: "Different text should not replace first attempt.",
          event_ids: ["evt_gateway_task_message_retry"],
          idempotency_key: "idem_gateway_task_message",
          origin: "event_route",
          occurred_at: "2026-05-06T12:01:00.000Z",
        });
        const sent = await harness.store.finalizeTaskMessage({
          idempotency_key: "idem_gateway_task_message",
          status: "sent",
          occurred_at: "2026-05-06T12:02:00.000Z",
          message: {
            id: "codex_task_msg_idem_gateway_task_message",
            task_session_id: "task_session_blog",
            native_thread_id: "thread_123",
            native_turn_id: "turn_456",
            status: "sent",
            text: "raw text must not be persisted in sanitized message",
          },
        });
        await harness.store.recordTaskMessageAttempt({
          task_session_id: "task_session_other",
          text: "Second message can share runtime-local message id.",
          event_ids: ["evt_gateway_task_message_2"],
          idempotency_key: "idem_gateway_task_message_2",
          origin: "task_session_api",
          occurred_at: "2026-05-06T12:03:00.000Z",
        });
        const sentWithSameRuntimeId = await harness.store.finalizeTaskMessage({
          idempotency_key: "idem_gateway_task_message_2",
          status: "sent",
          occurred_at: "2026-05-06T12:04:00.000Z",
          message: {
            id: "codex_task_msg_idem_gateway_task_message",
            task_session_id: "task_session_other",
            native_thread_id: "thread_789",
            status: "sent",
          },
        });
        const fetched = await harness.store.getTaskMessageByIdempotencyKey("idem_gateway_task_message");
        const blogMessages = await harness.store.listTaskMessages({
          task_session_id: "task_session_blog",
          event_id: "evt_gateway_task_message",
        });
        const sentMessages = await harness.store.listTaskMessages({
          status: "sent",
          limit: 1,
        });
        const missingMessages = await harness.store.listTaskMessages({
          queue_item_id: "qit_missing",
        });

        assert.equal(first.status, "attempted");
        assert.equal(first.text_length, "Continue blog work.".length);
        assert.equal(duplicate.id, first.id);
        assert.equal(duplicate.text_hash, first.text_hash);
        assert.equal(sent?.status, "sent");
        assert.equal(sent?.provider, "codex");
        assert.equal(sent?.id, first.id);
        assert.equal(sent?.native_thread_id, "thread_123");
        assert.equal(sent?.native_turn_id, "turn_456");
        assert.equal(sent?.sent_at, "2026-05-06T12:02:00.000Z");
        assert.equal(sent?.message.text, undefined);
        assert.equal(sentWithSameRuntimeId?.status, "sent");
        assert.notEqual(sentWithSameRuntimeId?.id, sent?.id);
        assert.equal(sentWithSameRuntimeId?.message.id, sent?.message.id);
        assert.deepEqual(fetched, sent);
        assert.deepEqual(blogMessages, [sent]);
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0]?.id, sentWithSameRuntimeId?.id);
        assert.deepEqual(missingMessages, []);
      } finally {
        await harness.cleanup();
      }
    });
  });
}

function createEmptyInMemoryStore(): InMemoryStore {
  return {
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}

function makeEvent(id: string, idempotencyKey: string, overrides: Partial<McpEvent> = {}): McpEvent {
  return {
    id,
    source: "slack",
    source_id: "slack_fixture",
    idempotency_key: idempotencyKey,
    occurred_at: createdAt,
    received_at: createdAt,
    actor: {
      id: "user_fixture",
      type: "human",
      name: "Fixture User",
    },
    type: "manual.review_requested",
    title: "Gateway contract event",
    summary: "Gateway contract event summary.",
    raw_ref: {
      id: `raw_${id}`,
      uri: `fixture://${id}`,
      media_type: "application/json",
    },
    links: [],
    resources: [],
    ...overrides,
  };
}

function makeBrowserResource(id: string, title: string, url: string): Record<string, unknown> {
  return {
    id,
    kind: "browser_tab",
    title,
    url,
    text_quote: "Launch paragraph needs one human decision.",
    restore_confidence: "high",
    captured_at: createdAt,
  };
}

function makeAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run_gateway_fixture",
    provider: "fake",
    task_id: "task_gateway_fixture",
    thread_id: "thread_gateway_fixture",
    status: "running",
    started_at: "2026-05-06T12:00:00.000Z",
    updated_at: "2026-05-06T12:00:00.000Z",
    risk_tags: ["task_message"],
    evidence: [
      {
        id: "ev_run_gateway_fixture",
        kind: "raw",
        title: "Gateway agent run fixture",
        url: "artifact://raw/gateway-agent-run.jsonl",
      },
    ],
    output_refs: [
      {
        id: "raw_run_gateway_fixture",
        uri: "artifact://raw/gateway-agent-run.jsonl",
        media_type: "application/jsonl",
      },
    ],
    resume_actions: [
      {
        id: "act_run_gateway_fixture_resume",
        type: "resume_agent",
        label: "Resume agent run",
        requires_confirmation: true,
        side_effect: "local",
        payload: {
          agent_run_id: "run_gateway_fixture",
        },
      },
    ],
    ...overrides,
  };
}

function makeContextRestoreRequest(
  id: string,
  idempotencyKey: string,
): Omit<ContextRestoreRequestRecord, "status" | "created_at" | "updated_at"> {
  const resource = makeBrowserResource(`ctx_browser_${id}`, "Launch doc", "https://example.test/launch");
  return {
    id,
    idempotency_key: idempotencyKey,
    resource,
    restore_plan: {
      kind: "browser_extension_message",
      side_effect: "local",
      execute_supported: false,
      target: "eventloopOS browser extension runtime",
      message: {
        type: "eventloop.restore",
        resource,
      },
    },
  };
}

async function clearPostgresTestData(store: PostgresQueueStore): Promise<void> {
  await store.pool.query(`
    TRUNCATE
      metric_counters,
      mcp_poll_states,
      task_messages,
      activity_events,
      receipts,
      route_decisions,
      queue_items,
      review_packets,
      agent_runs,
      events,
      context_restore_requests
    RESTART IDENTITY CASCADE
  `);
}
