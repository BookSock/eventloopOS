import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createInMemoryGatewayStore, createPostgresGatewayStore, type GatewayStore } from "../src/gateway_store.js";
import { PostgresQueueStore } from "../src/db/postgres_queue_store.js";
import type { AgentRun, WorkspaceSnapshot } from "../src/contracts.js";
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

        const beforeBump = await harness.store.listQueue();
        const beforePriority = beforeBump.find((item) => item.id === "qit_evt_gateway_queue")?.priority_score ?? 0;
        const bumped = await harness.store.bumpQueueItemPriority(
          "qit_evt_gateway_queue",
          { delta: 250, reason: "user_priority_bump" },
          now,
        );
        assert.equal(bumped?.priority_score, beforePriority + 250);
        assert.ok(bumped?.priority_reasons.includes("user_priority_bump"));

        const ignored = await harness.store.ignoreQueueItem("qit_evt_gateway_queue", "user_jason", now);
        assert.equal(ignored?.state, "dead");
        assert.equal(await harness.store.leaseNextQueueItem("worker_after_ignore", now, 1_000), undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("saves latest task workspace snapshot and attaches it to future queue items", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        await harness.store.saveTaskWorkspaceSnapshot({
          taskId: "task_blog",
          snapshot: {
            backend: "aerospace",
            activeWorkspace: "blog-workspace",
            focusedWindowId: 42,
            windows: [
              { id: 42, app: "Ghostty", title: "codex blog", workspace: "blog-workspace" },
            ],
          },
          capturedAt: now,
          sourceQueueItemId: "qit_previous_blog",
          actorId: "mac_queue_app",
        });
        const event = makeEvent("evt_gateway_task_workspace", "idem_gateway_task_workspace", {
          title: "Blog queue item should restore workspace",
          task_hint: "blog",
        });
        await harness.store.ingestEventAsReviewPacket(event, now);

        const item = await harness.store.leaseNextQueueItem("worker_a", now, 1_000);
        const workspaceContext = item?.review_packet.context.find((resource) => resource.kind === "workspace_snapshot");

        assert.equal(item?.task_id, "task_blog");
        assert.equal(workspaceContext?.source, "task_workspace_memory");
        assert.equal(workspaceContext?.snapshot?.activeWorkspace, "blog-workspace");
        assert.equal(workspaceContext?.snapshot?.windows[0]?.id, 42);
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

    it("records, terminal-sends, and completes queue action attempts consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const idempotencyKey = "queue_action_qit_blog_act_blog_review";
        const queueItemId = "qit_blog";

        const first = await harness.store.recordQueueActionAttempt({
          idempotencyKey,
          queueItemId,
          now,
        });
        assert.equal(first.existing, undefined);
        assert.equal(first.record.idempotency_key, idempotencyKey);
        assert.equal(first.record.queue_item_id, queueItemId);
        assert.equal(first.record.terminal_send_ok, false);
        assert.equal(first.record.completed, false);
        assert.equal(first.record.action_result, undefined);
        assert.equal(first.record.terminal_send_result, undefined);

        const replay = await harness.store.recordQueueActionAttempt({
          idempotencyKey,
          queueItemId,
          now: new Date("2026-05-06T12:00:01.000Z"),
        });
        assert.equal(replay.existing?.idempotency_key, idempotencyKey);
        assert.equal(replay.record.created_at, first.record.created_at);

        const sent = await harness.store.markQueueActionTerminalSent({
          idempotencyKey,
          terminalSendResult: { ok: true, transport: "ghostty", commandCount: 1 },
          now: new Date("2026-05-06T12:00:02.000Z"),
        });
        assert.equal(sent?.terminal_send_ok, true);
        assert.equal(sent?.completed, false);
        assert.deepEqual(sent?.terminal_send_result, { ok: true, transport: "ghostty", commandCount: 1 });
        assert.equal(sent?.updated_at, "2026-05-06T12:00:02.000Z");

        const completed = await harness.store.markQueueActionCompleted({
          idempotencyKey,
          actionResult: {
            type: "resume_agent",
            queue_item_id: queueItemId,
            task_session_id: "task_session_blog",
          },
          now: new Date("2026-05-06T12:00:03.000Z"),
        });
        assert.equal(completed?.completed, true);
        assert.equal(completed?.terminal_send_ok, true);
        assert.equal((completed?.action_result as Record<string, unknown>)?.task_session_id, "task_session_blog");
        assert.equal(completed?.updated_at, "2026-05-06T12:00:03.000Z");

        const fetched = await harness.store.getQueueActionAttempt(idempotencyKey);
        assert.deepEqual(fetched, completed);

        const missing = await harness.store.getQueueActionAttempt("queue_action_unknown");
        assert.equal(missing, undefined);

        const missingTerminalSent = await harness.store.markQueueActionTerminalSent({
          idempotencyKey: "queue_action_unknown",
          now,
        });
        assert.equal(missingTerminalSent, undefined);

        const missingCompleted = await harness.store.markQueueActionCompleted({
          idempotencyKey: "queue_action_unknown",
          actionResult: { type: "resume_agent" },
          now,
        });
        assert.equal(missingCompleted, undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("upserts and clears task session terminal refs consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const taskSessionId = "task_session_blog";
        const initialFetch = await harness.store.getTaskSessionTerminalRef(taskSessionId);
        assert.equal(initialFetch, undefined);

        const inserted = await harness.store.setTaskSessionTerminalRef(taskSessionId, "ghostty:front", now);
        assert.equal(inserted.task_session_id, taskSessionId);
        assert.equal(inserted.terminal_ref, "ghostty:front");
        assert.equal(inserted.created_at, createdAt);
        assert.equal(inserted.updated_at, createdAt);

        const updatedAt = "2026-05-06T12:01:00.000Z";
        const updated = await harness.store.setTaskSessionTerminalRef(
          taskSessionId,
          "tmux:codex-blog",
          new Date(updatedAt),
        );
        assert.equal(updated.terminal_ref, "tmux:codex-blog");
        assert.equal(updated.created_at, inserted.created_at);
        assert.equal(updated.updated_at, updatedAt);

        const fetched = await harness.store.getTaskSessionTerminalRef(taskSessionId);
        assert.deepEqual(fetched, updated);

        const cleared = await harness.store.clearTaskSessionTerminalRef(taskSessionId);
        assert.deepEqual(cleared, updated);

        const afterClear = await harness.store.getTaskSessionTerminalRef(taskSessionId);
        assert.equal(afterClear, undefined);

        const clearMissing = await harness.store.clearTaskSessionTerminalRef("task_session_unknown");
        assert.equal(clearMissing, undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("records, lists, and clears onboarding rejections consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const initial = await harness.store.listOnboardingRejections();
        assert.deepEqual(initial, []);

        const inserted = await harness.store.recordOnboardingRejection("task_blog", "manual reject", now);
        assert.equal(inserted.proposal_key, "task_blog");
        assert.equal(inserted.reason, "manual reject");
        assert.equal(inserted.rejected_at, createdAt);

        const updatedAt = "2026-05-06T12:01:00.000Z";
        const updated = await harness.store.recordOnboardingRejection(
          "task_blog",
          "still rejecting",
          new Date(updatedAt),
        );
        assert.equal(updated.reason, "still rejecting");
        assert.equal(updated.rejected_at, updatedAt);

        await harness.store.recordOnboardingRejection("task_reports", undefined, now);
        const listed = await harness.store.listOnboardingRejections();
        assert.equal(listed.length, 2);
        const reportsEntry = listed.find((entry) => entry.proposal_key === "task_reports");
        assert.equal(reportsEntry?.reason, undefined);

        const cleared = await harness.store.clearOnboardingRejection("task_blog");
        assert.equal(cleared?.proposal_key, "task_blog");
        const afterClear = await harness.store.listOnboardingRejections();
        assert.deepEqual(afterClear.map((entry) => entry.proposal_key), ["task_reports"]);

        const missing = await harness.store.clearOnboardingRejection("task_unknown");
        assert.equal(missing, undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("caches onboarding approval batch results consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const initial = await harness.store.getOnboardingApprovalBatch("idem_batch_a");
        assert.equal(initial, undefined);

        const results = [
          { ok: true, proposal_id: "p1" },
          { ok: false, error: { code: "schema_error", message: "bad" } },
        ];
        const recorded = await harness.store.recordOnboardingApprovalBatch({
          idempotencyKey: "idem_batch_a",
          results,
          now,
        });
        assert.equal(recorded.idempotency_key, "idem_batch_a");
        assert.deepEqual(recorded.results, results);
        assert.equal(recorded.created_at, createdAt);

        const replay = await harness.store.recordOnboardingApprovalBatch({
          idempotencyKey: "idem_batch_a",
          results: [{ ok: true, proposal_id: "different" }],
          now: new Date("2026-05-06T12:01:00.000Z"),
        });
        assert.deepEqual(replay.results, results);
        assert.equal(replay.created_at, recorded.created_at);

        const fetched = await harness.store.getOnboardingApprovalBatch("idem_batch_a");
        assert.deepEqual(fetched, recorded);
      } finally {
        await harness.cleanup();
      }
    });

    it("toggles manual-mode singleton state consistently", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const initial = await harness.store.getManualModeState();
        assert.equal(initial.active, false);
        assert.equal(initial.entered_at, undefined);

        const activated = await harness.store.setManualModeActive(true, "personal email", now);
        assert.equal(activated.active, true);
        assert.equal(activated.entered_at, createdAt);
        assert.equal(activated.reason, "personal email");

        // Re-activating preserves entered_at (idempotent enter).
        const reactivated = await harness.store.setManualModeActive(true, "still working", new Date("2026-05-06T12:05:00.000Z"));
        assert.equal(reactivated.active, true);
        assert.equal(reactivated.entered_at, createdAt, "entered_at should pin to first activation");
        assert.equal(reactivated.reason, "still working");

        const fetched = await harness.store.getManualModeState();
        assert.equal(fetched.active, true);
        assert.equal(fetched.entered_at, createdAt);

        const deactivated = await harness.store.setManualModeActive(false, undefined, new Date("2026-05-06T12:10:00.000Z"));
        assert.equal(deactivated.active, false);
        assert.equal(deactivated.entered_at, undefined);
        assert.equal(deactivated.reason, undefined);

        // Re-entering after deactivation captures a fresh entered_at.
        const reentered = await harness.store.setManualModeActive(true, "second pass", new Date("2026-05-06T12:15:00.000Z"));
        assert.equal(reentered.active, true);
        assert.equal(reentered.entered_at, "2026-05-06T12:15:00.000Z");
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

    it("creates tasks idempotently by primary anchor and tracks current-task singleton", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const layoutA: WorkspaceSnapshot = {
          backend: "aerospace",
          activeWorkspace: "eventloop-blog",
          focusedWindowId: 11,
          windows: [{ id: 11, app: "Ghostty", title: "codex blog", workspace: "eventloop-blog" }],
        };
        const layoutB: WorkspaceSnapshot = {
          backend: "aerospace",
          activeWorkspace: "eventloop-reports",
          focusedWindowId: 22,
          windows: [{ id: 22, app: "Ghostty", title: "codex reports", workspace: "eventloop-reports" }],
        };

        const initialState = await harness.store.getCurrentTaskState();
        assert.equal(initialState.current_task_id, null);

        const first = await harness.store.createTask({
          primaryAnchor: { kind: "codex_thread", id: "thread-aaaa" },
          capturedLayout: layoutA,
          autoPaperIdleSeconds: 90,
          now,
        });
        assert.equal(first.created, true);
        assert.equal(first.task.primary_anchor_kind, "codex_thread");
        assert.equal(first.task.primary_anchor_id, "thread-aaaa");
        assert.equal(first.task.auto_paper_idle_seconds, 90);
        assert.equal(first.layout.layout.activeWorkspace, "eventloop-blog");

        const replay = await harness.store.createTask({
          primaryAnchor: { kind: "codex_thread", id: "thread-aaaa" },
          capturedLayout: layoutB,
          now: new Date("2026-05-06T12:01:00.000Z"),
        });
        assert.equal(replay.created, false);
        assert.equal(replay.task.task_id, first.task.task_id);
        assert.equal(replay.layout.layout.activeWorkspace, "eventloop-blog", "layout must not be overwritten on idempotent replay");

        const fetchedByAnchor = await harness.store.getTaskByAnchor("codex_thread", "thread-aaaa");
        assert.equal(fetchedByAnchor?.task_id, first.task.task_id);

        const second = await harness.store.createTask({
          primaryAnchor: { kind: "ghostty_window", id: "win-7" },
          capturedLayout: layoutB,
          now: new Date("2026-05-06T12:02:00.000Z"),
        });
        assert.equal(second.created, true);
        assert.notEqual(second.task.task_id, first.task.task_id);
        assert.equal(second.task.auto_paper_idle_seconds, 60);

        const list = await harness.store.listTasks();
        assert.deepEqual(list.map((entry) => entry.task_id).sort(), [first.task.task_id, second.task.task_id].sort());

        const setA = await harness.store.setCurrentTaskId(first.task.task_id, new Date("2026-05-06T12:03:00.000Z"));
        assert.equal(setA.current_task_id, first.task.task_id);
        assert.equal(setA.entered_at, "2026-05-06T12:03:00.000Z");

        const reEnterSame = await harness.store.setCurrentTaskId(first.task.task_id, new Date("2026-05-06T12:04:00.000Z"));
        assert.equal(reEnterSame.entered_at, "2026-05-06T12:03:00.000Z", "entered_at must pin while same task remains current");

        const switchToB = await harness.store.setCurrentTaskId(second.task.task_id, new Date("2026-05-06T12:05:00.000Z"));
        assert.equal(switchToB.current_task_id, second.task.task_id);
        assert.equal(switchToB.entered_at, "2026-05-06T12:05:00.000Z");

        const cleared = await harness.store.setCurrentTaskId(null, new Date("2026-05-06T12:06:00.000Z"));
        assert.equal(cleared.current_task_id, null);
        assert.equal(cleared.entered_at, undefined);

        const layoutUpdated = await harness.store.updateTaskLayout(first.task.task_id, layoutB, new Date("2026-05-06T12:07:00.000Z"));
        assert.equal(layoutUpdated?.task_id, first.task.task_id);
        assert.equal(layoutUpdated?.updated_at, "2026-05-06T12:07:00.000Z");
        const layoutAfter = await harness.store.getTaskLayout(first.task.task_id);
        assert.equal(layoutAfter?.layout.activeWorkspace, "eventloop-reports");

        const paperEmitted = await harness.store.recordTaskPaperEmitted(first.task.task_id, new Date("2026-05-06T12:08:00.000Z"));
        assert.equal(paperEmitted?.last_paper_emitted_at, "2026-05-06T12:08:00.000Z");

        const missingTaskUpdate = await harness.store.updateTaskLayout("task_missing", layoutA, now);
        assert.equal(missingTaskUpdate, undefined);
        const missingPaper = await harness.store.recordTaskPaperEmitted("task_missing", now);
        assert.equal(missingPaper, undefined);
      } finally {
        await harness.cleanup();
      }
    });

    it("records window-workspace observations and surfaces multi-workspace follows", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const baseTime = new Date("2026-05-06T12:00:00.000Z");
        const initial = await harness.store.listFollowsWindows({ now: baseTime, ttlMs: 24 * 60 * 60 * 1_000 });
        assert.deepEqual(initial, []);

        await harness.store.recordWindowWorkspaceObservation({
          windowId: "win-100",
          workspaceId: "ws-alpha",
          isTaskWorkspace: true,
          observedAt: baseTime,
        });
        const second = await harness.store.recordWindowWorkspaceObservation({
          windowId: "win-100",
          workspaceId: "ws-alpha",
          isTaskWorkspace: true,
          observedAt: new Date("2026-05-06T12:00:30.000Z"),
        });
        assert.equal(second.window_id, "win-100");
        assert.equal(second.workspace_id, "ws-alpha");
        assert.equal(second.first_seen_at, "2026-05-06T12:00:00.000Z");
        assert.equal(second.last_seen_at, "2026-05-06T12:00:30.000Z");

        const stillSingle = await harness.store.listFollowsWindows({
          now: new Date("2026-05-06T12:00:30.000Z"),
          ttlMs: 24 * 60 * 60 * 1_000,
        });
        assert.deepEqual(stillSingle, [], "single-workspace observation must not become follows");

        await harness.store.recordWindowWorkspaceObservation({
          windowId: "win-100",
          workspaceId: "ws-beta",
          isTaskWorkspace: true,
          observedAt: new Date("2026-05-06T12:01:00.000Z"),
        });
        await harness.store.recordWindowWorkspaceObservation({
          windowId: "win-200",
          workspaceId: "ws-alpha",
          isTaskWorkspace: false,
          observedAt: new Date("2026-05-06T12:01:00.000Z"),
        });
        await harness.store.recordWindowWorkspaceObservation({
          windowId: "win-200",
          workspaceId: "ws-beta",
          isTaskWorkspace: false,
          observedAt: new Date("2026-05-06T12:01:00.000Z"),
        });

        const follows = await harness.store.listFollowsWindows({
          now: new Date("2026-05-06T12:01:00.000Z"),
          ttlMs: 24 * 60 * 60 * 1_000,
        });
        assert.equal(follows.length, 1);
        assert.equal(follows[0]?.window_id, "win-100");
        assert.deepEqual(follows[0]?.known_workspaces, ["ws-alpha", "ws-beta"]);

        const expired = await harness.store.listFollowsWindows({
          now: new Date("2026-05-08T12:00:00.000Z"),
          ttlMs: 60 * 60 * 1_000,
        });
        assert.deepEqual(expired, [], "expired observations must drop out of follows");

        const removed = await harness.store.pruneWindowWorkspaceObservations(new Date("2026-05-06T12:00:45.000Z"));
        assert.ok(removed >= 1, "prune should remove observations older than cutoff");

        const followsAfterPrune = await harness.store.listFollowsWindows({
          now: new Date("2026-05-06T12:01:00.000Z"),
          ttlMs: 24 * 60 * 60 * 1_000,
        });
        assert.equal(followsAfterPrune.length, 0, "after pruning win-100 ws-alpha row, win-100 only on ws-beta");
      } finally {
        await harness.cleanup();
      }
    });

    it("binds tasks to aerospace workspaces and looks them up by workspace id", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;

      try {
        const layout: WorkspaceSnapshot = {
          backend: "aerospace",
          activeWorkspace: "ws-alpha",
          focusedWindowId: 31,
          windows: [{ id: 31, app: "Ghostty", title: "codex alpha", workspace: "ws-alpha" }],
        };

        const created = await harness.store.createTask({
          primaryAnchor: { kind: "codex_thread", id: "thread-ws-1" },
          capturedLayout: layout,
          aerospaceWorkspaceId: "ws-alpha",
          now,
        });
        assert.equal(created.created, true);
        assert.equal(created.task.aerospace_workspace_id, "ws-alpha");

        const fetched = await harness.store.getTaskByAnchor("codex_thread", "thread-ws-1");
        assert.equal(fetched?.aerospace_workspace_id, "ws-alpha");

        const onAlpha = await harness.store.getTasksByWorkspaceId("ws-alpha");
        assert.equal(onAlpha.length, 1);
        assert.equal(onAlpha[0]?.task_id, created.task.task_id);

        const onUnknown = await harness.store.getTasksByWorkspaceId("ws-nope");
        assert.deepEqual(onUnknown, []);

        const moved = await harness.store.createTask({
          primaryAnchor: { kind: "codex_thread", id: "thread-ws-1" },
          capturedLayout: layout,
          aerospaceWorkspaceId: "ws-beta",
          now: new Date("2026-05-06T12:10:00.000Z"),
        });
        assert.equal(moved.created, false);
        assert.equal(moved.task.task_id, created.task.task_id);
        assert.equal(moved.task.aerospace_workspace_id, "ws-beta");

        const onAlphaAfterMove = await harness.store.getTasksByWorkspaceId("ws-alpha");
        assert.deepEqual(onAlphaAfterMove, []);
        const onBeta = await harness.store.getTasksByWorkspaceId("ws-beta");
        assert.equal(onBeta.length, 1);
        assert.equal(onBeta[0]?.task_id, created.task.task_id);

        const replayWithoutWorkspace = await harness.store.createTask({
          primaryAnchor: { kind: "codex_thread", id: "thread-ws-1" },
          capturedLayout: layout,
          now: new Date("2026-05-06T12:11:00.000Z"),
        });
        assert.equal(replayWithoutWorkspace.task.aerospace_workspace_id, "ws-beta", "missing workspace_id must not clobber existing binding");

        const list = await harness.store.listTasks();
        assert.equal(list.length, 1, "listTasks unfiltered still returns the row");

        const noWorkspaceTask = await harness.store.createTask({
          primaryAnchor: { kind: "ghostty_window", id: "win-no-ws" },
          capturedLayout: layout,
          now: new Date("2026-05-06T12:12:00.000Z"),
        });
        assert.equal(noWorkspaceTask.task.aerospace_workspace_id, undefined);

        const listAfter = await harness.store.listTasks();
        assert.equal(listAfter.length, 2);
      } finally {
        await harness.cleanup();
      }
    });

    it("creates, lists, updates, deletes paper triggers and dedupes firings", async (t) => {
      const harness = await createHarness(t);
      if (!harness) return;
      try {
        const layout: WorkspaceSnapshot = {
          backend: "aerospace",
          activeWorkspace: "ws-trig",
          focusedWindowId: 42,
          windows: [{ id: 42, app: "Ghostty", title: "trig", workspace: "ws-trig" }],
        };
        const task = await harness.store.createTask({
          primaryAnchor: { kind: "codex_thread", id: "trig-thread-1" },
          capturedLayout: layout,
          now,
        });

        const trigger = await harness.store.createPaperTrigger(
          {
            task_id: task.task.task_id,
            name: "deploy watch",
            match_event_type: "slack.message_received",
            match_body_substring: "deploy",
          },
          now,
        );
        assert.ok(trigger.trigger_id.startsWith("trg_"));
        assert.equal(trigger.enabled, true);

        const listed = await harness.store.listPaperTriggers({ task_id: task.task.task_id });
        assert.equal(listed.length, 1);

        const onlyEnabled = await harness.store.listPaperTriggers({ only_enabled: true });
        assert.equal(onlyEnabled.length, 1);

        const got = await harness.store.getPaperTrigger(trigger.trigger_id);
        assert.equal(got?.name, "deploy watch");

        const patched = await harness.store.updatePaperTrigger(
          trigger.trigger_id,
          { enabled: false, match_body_substring: null },
          new Date("2026-05-06T12:30:00.000Z"),
        );
        assert.equal(patched?.enabled, false);
        assert.equal(patched?.match_body_substring, undefined);

        const onlyEnabledAfter = await harness.store.listPaperTriggers({ only_enabled: true });
        assert.equal(onlyEnabledAfter.length, 0);

        const fired = await harness.store.recordPaperTriggerFired(
          trigger.trigger_id,
          new Date("2026-05-06T12:35:00.000Z"),
        );
        assert.ok(fired?.last_fired_at);

        const claimedFirst = await harness.store.tryRegisterPaperTriggerFiring(trigger.trigger_id, "dk-1");
        const claimedDup = await harness.store.tryRegisterPaperTriggerFiring(trigger.trigger_id, "dk-1");
        assert.equal(claimedFirst, true);
        assert.equal(claimedDup, false);
        const claimedDifferent = await harness.store.tryRegisterPaperTriggerFiring(trigger.trigger_id, "dk-2");
        assert.equal(claimedDifferent, true);

        const removed = await harness.store.deletePaperTrigger(trigger.trigger_id);
        assert.ok(removed);
        const afterDelete = await harness.store.getPaperTrigger(trigger.trigger_id);
        assert.equal(afterDelete, undefined);
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
      task_workspace_snapshots,
      mcp_poll_states,
      task_messages,
      activity_events,
      receipts,
      route_decisions,
      queue_items,
      review_packets,
      agent_runs,
      events,
      context_restore_requests,
      queue_action_attempts,
      task_session_terminal_refs,
      onboarding_rejections,
      onboarding_approval_batches,
      manual_mode_state,
      paper_trigger_firings,
      paper_triggers,
      task_layouts,
      current_task_state,
      tasks,
      window_workspace_observations
    RESTART IDENTITY CASCADE
  `);
}
