import pg from "pg";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  Action,
  Confidence,
  ContextResource,
  EvidenceRef,
  QueueItem,
  QueueItemWithPacket,
  QueueState,
  ReviewPacket,
  RiskLevel,
} from "../contracts.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { McpCursorState } from "../integrations/mcp_poll/types.js";
import type { McpPollStateSnapshot } from "../integrations/mcp_poll/persistent_cursor_store.js";
import {
  buildTaskMessageAttemptRecord,
  finalizeTaskMessageRecord,
  type DurableTaskMessageAttemptInput,
  type DurableTaskMessageFinalInput,
  type DurableTaskMessageRecord,
  type TaskMessageHistoryQuery,
} from "../task_sessions/task_message_history.js";
import type { RestoreExecutionReceipt, RestorePlan } from "../workspace/aerospace.js";
import type { WorkspaceRestoreReceiptRecord } from "../workspace/restore_receipts.js";
import {
  buildReviewArtifactsFromEvent,
  contextEntriesForResult,
  contextEntryMatchesQuery,
  decideRouteForEvent,
  rankContextEntries,
  taskIdForHint,
  type ContextEntry,
  type ContextQuery,
  type ContextRestoreRequestRecord,
  type RouteDecision,
  type StoredEventResult,
} from "../store.js";
import { runMigrations } from "./migrations.js";

const { Pool: PgPool } = pg;

export type EventRecord = {
  id: string;
  source: string;
  source_id: string;
  idempotency_key: string;
  occurred_at: string;
  received_at: string;
  actor?: Record<string, unknown>;
  project_hint?: string;
  task_hint?: string;
  type: string;
  title: string;
  summary?: string;
  raw_ref: Record<string, unknown>;
  links: Array<Record<string, unknown>>;
  resources: ContextResource[];
};

export type NewQueueItem = Omit<QueueItem, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export type PostgresQueueStoreOptions = {
  connectionString?: string;
  pool?: Pool;
  migrationsDir?: string;
  clock?: () => Date;
  defaultLeaseMs?: number;
};

export type RecordEventWithReviewPacketResult = {
  inserted: boolean;
  event_id: string;
  route_decision: RouteDecision;
  item?: QueueItemWithPacket;
};

export class PostgresQueueStore {
  readonly pool: Pool;
  readonly defaultLeaseMs: number;
  private readonly ownsPool: boolean;
  private readonly migrationsDir?: string;
  private readonly clock: () => Date;

  constructor(options: PostgresQueueStoreOptions = {}) {
    if (!options.pool && !options.connectionString) {
      throw new Error("PostgresQueueStore requires connectionString or pool");
    }

    this.pool = options.pool ?? new PgPool({ connectionString: options.connectionString });
    this.ownsPool = !options.pool;
    this.migrationsDir = options.migrationsDir;
    this.clock = options.clock ?? (() => new Date());
    this.defaultLeaseMs = options.defaultLeaseMs ?? 5 * 60 * 1000;
  }

  async migrate(): Promise<string[]> {
    return runMigrations(this.pool, this.migrationsDir);
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  async getWorkspaceRestoreReceipt(idempotencyKey: string): Promise<WorkspaceRestoreReceiptRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM receipts
        WHERE receipt_type = 'workspace_restore'
          AND details->>'idempotency_key' = $1
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [idempotencyKey],
    );
    const row = result.rows[0];
    return row ? rowToWorkspaceRestoreReceipt(row) : undefined;
  }

  async getMcpPollState(sourceId: string): Promise<McpPollStateSnapshot | undefined> {
    const result = await this.pool.query(
      `
        SELECT source_id, cursor, seen, updated_at
        FROM mcp_poll_states
        WHERE source_id = $1
      `,
      [sourceId],
    );
    const row = result.rows[0];
    return row ? rowToMcpPollStateSnapshot(row) : undefined;
  }

  async saveMcpPollState(sourceId: string, state: McpCursorState, now: Date): Promise<McpPollStateSnapshot> {
    const result = await this.pool.query(
      `
        INSERT INTO mcp_poll_states (
          source_id,
          cursor,
          seen,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)
        ON CONFLICT (source_id) DO UPDATE SET
          cursor = EXCLUDED.cursor,
          seen = EXCLUDED.seen,
          updated_at = EXCLUDED.updated_at
        RETURNING source_id, cursor, seen, updated_at
      `,
      [sourceId, state.cursor ?? null, JSON.stringify(Array.from(state.seen)), now.toISOString()],
    );
    return rowToMcpPollStateSnapshot(result.rows[0]);
  }

  async clearMcpPollState(sourceId: string): Promise<void> {
    await this.pool.query("DELETE FROM mcp_poll_states WHERE source_id = $1", [sourceId]);
  }

  async getTaskMessageByIdempotencyKey(idempotencyKey: string): Promise<DurableTaskMessageRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM task_messages
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    );
    const row = result.rows[0];
    return row ? rowToTaskMessageRecord(row) : undefined;
  }

  async listTaskMessages(query: TaskMessageHistoryQuery = {}): Promise<DurableTaskMessageRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const addClause = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace("$?", `$${values.length}`));
    };

    if (query.task_session_id) addClause("task_session_id = $?", query.task_session_id);
    if (query.task_id) addClause("task_id = $?", query.task_id);
    if (query.queue_item_id) addClause("queue_item_id = $?", query.queue_item_id);
    if (query.idempotency_key) addClause("idempotency_key = $?", query.idempotency_key);
    if (query.status) addClause("status = $?", query.status);
    if (query.event_id) addClause("event_ids ? $?", query.event_id);

    values.push(normalizeTaskMessageLimit(query.limit));
    const limitPlaceholder = `$${values.length}`;
    const result = await this.pool.query(
      `
        SELECT *
        FROM task_messages
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY updated_at DESC, id ASC
        LIMIT ${limitPlaceholder}
      `,
      values,
    );
    return result.rows.map(rowToTaskMessageRecord);
  }

  async recordTaskMessageAttempt(input: DurableTaskMessageAttemptInput): Promise<DurableTaskMessageRecord> {
    const record = buildTaskMessageAttemptRecord(input);
    await this.pool.query(
      `
        INSERT INTO task_messages (
          id,
          idempotency_key,
          task_session_id,
          task_id,
          queue_item_id,
          event_ids,
          origin,
          source_id,
          mode,
          status,
          text_hash,
          text_length,
          message,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::jsonb,
          $14::timestamptz, $15::timestamptz
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `,
      [
        record.id,
        record.idempotency_key,
        record.task_session_id,
        record.task_id ?? null,
        record.queue_item_id ?? null,
        JSON.stringify(record.event_ids),
        record.origin,
        record.source_id ?? null,
        record.mode,
        record.status,
        record.text_hash,
        record.text_length,
        JSON.stringify(record.message),
        record.created_at,
        record.updated_at,
      ],
    );
    const existing = await this.getTaskMessageByIdempotencyKey(input.idempotency_key);
    if (!existing) {
      throw new Error(`task message ${input.idempotency_key} was not found after insert`);
    }
    return existing;
  }

  async finalizeTaskMessage(input: DurableTaskMessageFinalInput): Promise<DurableTaskMessageRecord | undefined> {
    const existing = await this.getTaskMessageByIdempotencyKey(input.idempotency_key);
    if (!existing) return undefined;

    const record = finalizeTaskMessageRecord(existing, input);
    const result = await this.pool.query(
      `
        UPDATE task_messages
        SET status = $2,
            provider = $3,
            native_thread_id = $4,
            native_turn_id = $5,
            native_session_id = $6,
            native_result_session_id = $7,
            error = $8,
            message = $9::jsonb,
            updated_at = $10::timestamptz,
            sent_at = $11::timestamptz
        WHERE idempotency_key = $1
        RETURNING *
      `,
      [
        record.idempotency_key,
        record.status,
        record.provider ?? null,
        record.native_thread_id ?? null,
        record.native_turn_id ?? null,
        record.native_session_id ?? null,
        record.native_result_session_id ?? null,
        record.error ?? null,
        JSON.stringify(record.message),
        record.updated_at,
        record.sent_at ?? null,
      ],
    );
    return result.rows[0] ? rowToTaskMessageRecord(result.rows[0]) : undefined;
  }

  async recordWorkspaceRestoreReceipt(input: {
    idempotencyKey: string;
    plan: RestorePlan;
    receipt: RestoreExecutionReceipt;
    now: Date;
  }): Promise<WorkspaceRestoreReceiptRecord> {
    const id = `rcpt_workspace_restore_${stableId(input.idempotencyKey)}`;
    const details = {
      idempotency_key: input.idempotencyKey,
      plan: input.plan,
      receipt: input.receipt,
    };

    await this.pool.query(
      `
        INSERT INTO receipts (
          id,
          receipt_type,
          status,
          details,
          created_at
        )
        VALUES ($1, 'workspace_restore', 'ok', $2::jsonb, $3::timestamptz)
        ON CONFLICT (id) DO NOTHING
      `,
      [id, JSON.stringify(details), input.now.toISOString()],
    );

    const existing = await this.getWorkspaceRestoreReceipt(input.idempotencyKey);
    if (!existing) {
      throw new Error(`workspace restore receipt ${input.idempotencyKey} was not found after insert`);
    }
    return existing;
  }

  async recordEventWithReviewPacket(
    event: EventRecord,
    packet: ReviewPacket,
    queueItem: NewQueueItem,
  ): Promise<RecordEventWithReviewPacketResult> {
    const routeDecision: RouteDecision = {
      id: `rte_${stableId(event.id)}`,
      event_id: event.id,
      action: "ask_human_now",
      target_task_id: event.task_hint ? `task_${stableId(event.task_hint)}` : undefined,
      confidence: event.task_hint || event.project_hint ? "medium" : "low",
      human_queue_reason: event.task_hint ? "human_blocked" : "ambiguous",
      evidence: packet.evidence,
      created_at: packet.created_at,
    };
    return this.recordRoutedEvent(event, routeDecision, packet, queueItem);
  }

  async recordRoutedEvent(
    event: EventRecord,
    routeDecision: RouteDecision,
    packet?: ReviewPacket,
    queueItem?: NewQueueItem,
  ): Promise<RecordEventWithReviewPacketResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const insertedEvent = await client.query<{ id: string }>(
        `
          INSERT INTO events (
            id,
            source,
            source_id,
            idempotency_key,
            occurred_at,
            received_at,
            actor,
            project_hint,
            task_hint,
            type,
            title,
            summary,
            raw_ref,
            links,
            resources
          )
          VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb)
          ON CONFLICT (source, idempotency_key) DO NOTHING
          RETURNING id
        `,
        [
          event.id,
          event.source,
          event.source_id,
          event.idempotency_key,
          event.occurred_at,
          event.received_at,
          jsonOrNull(event.actor),
          event.project_hint ?? null,
          event.task_hint ?? null,
          event.type,
          event.title,
          event.summary ?? null,
          JSON.stringify(event.raw_ref),
          JSON.stringify(event.links),
          JSON.stringify(event.resources),
        ],
      );

      const inserted = insertedEvent.rowCount === 1;
      const eventId = inserted
        ? insertedEvent.rows[0].id
        : await this.findExistingEventId(client, event.source, event.idempotency_key);

      if (inserted) {
        await this.insertRouteDecision(client, routeDecision);
        if (packet && queueItem) {
          await this.insertReviewPacket(client, packet);
          await this.insertQueueItem(client, normalizeNewQueueItem(queueItem, this.clock().toISOString()));
        }
      }

      const item = packet ? await this.getQueueItemByReviewPacketId(client, packet.id) : undefined;

      await client.query("COMMIT");
      return { inserted, event_id: eventId, route_decision: routeDecision, item };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordEventAsReviewPacket(event: McpEvent): Promise<RecordEventWithReviewPacketResult> {
    const now = this.clock();
    const routeDecision = decideRouteForEvent(event, now);
    const eventRecord = eventToRecord(event);
    if (routeDecision.action === "ignore" || routeDecision.action === "store_only" || routeDecision.action === "attach_to_task") {
      return this.recordRoutedEvent(eventRecord, routeDecision);
    }

    const artifacts = buildReviewArtifactsFromEvent(event, now, routeDecision);
    return this.recordRoutedEvent(eventRecord, routeDecision, artifacts.review_packet, artifacts.queue_item);
  }

  async listQueue(state?: QueueState): Promise<QueueItemWithPacket[]> {
    const values: unknown[] = [];
    const where = state ? "WHERE q.state = $1" : "WHERE q.state IN ('ready', 'leased')";
    if (state) {
      values.push(state);
    }

    const result = await this.pool.query(
      `
        SELECT ${queueSelectColumns("q")}, ${reviewPacketSelectColumns("p")}
        FROM queue_items q
        JOIN review_packets p ON p.id = q.review_packet_id
        ${where}
        ORDER BY q.priority_score DESC, q.created_at ASC, q.id ASC
      `,
      values,
    );

    return result.rows.map(rowToQueueItemWithPacket);
  }

  async getReviewPacket(id: string): Promise<ReviewPacket | undefined> {
    const result = await this.pool.query(
      `SELECT ${reviewPacketSelectColumns("p")} FROM review_packets p WHERE p.id = $1`,
      [id],
    );

    return result.rows[0] ? rowToReviewPacket(result.rows[0]) : undefined;
  }

  async getEventResult(eventId: string): Promise<StoredEventResult | undefined> {
    const client = await this.pool.connect();
    try {
      const eventResult = await client.query("SELECT * FROM events WHERE id = $1", [eventId]);
      const event = eventResult.rows[0] ? rowToEvent(eventResult.rows[0]) : undefined;
      if (!event) return undefined;

      const decisionResult = await client.query(
        `
          SELECT *
          FROM route_decisions
          WHERE event_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [eventId],
      );
      const routeDecision = decisionResult.rows[0]
        ? rowToRouteDecision(decisionResult.rows[0])
        : decideRouteForEvent(event, new Date(event.received_at));

      const packet = await this.getReviewPacket(`pkt_${stableId(event.id)}`);
      const queueItem = packet ? await this.getQueueItemByReviewPacketId(client, packet.id) : undefined;

      return {
        event,
        route_decision: routeDecision,
        review_packet: packet,
        queue_item: queueItem,
      };
    } finally {
      client.release();
    }
  }

  async getEventResultByIdempotencyKey(
    source: string,
    idempotencyKey: string,
  ): Promise<StoredEventResult | undefined> {
    const result = await this.pool.query(
      "SELECT id FROM events WHERE source = $1 AND idempotency_key = $2",
      [source, idempotencyKey],
    );
    const eventId = result.rows[0]?.id;
    return eventId ? this.getEventResult(eventId) : undefined;
  }

  async listContextEntries(query: ContextQuery = {}): Promise<ContextEntry[]> {
    const limit = query.limit ?? 100;
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.source) {
      values.push(query.source);
      where.push(`source = $${values.length}`);
    }

    values.push(Math.max(limit * 4, limit));
    const result = await this.pool.query(
      `
        SELECT *
        FROM events
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY received_at DESC, id ASC
        LIMIT $${values.length}
      `,
      values,
    );

    const entries: ContextEntry[] = [];
    for (const row of result.rows) {
      const event = rowToEvent(row);
      if (query.task_id && taskIdForHint(event.task_hint) !== query.task_id) {
        continue;
      }
      const eventResult = await this.getEventResult(event.id);
      if (!eventResult) continue;
      entries.push(...contextEntriesForResult(eventResult).filter((entry) => contextEntryMatchesQuery(entry, query)));
    }

    return rankContextEntries(entries, query).slice(0, limit);
  }

  async createContextRestoreRequest(
    request: Omit<ContextRestoreRequestRecord, "status" | "created_at" | "updated_at">,
    now: Date,
  ): Promise<{ record: ContextRestoreRequestRecord; inserted: boolean }> {
    const result = await this.pool.query(
      `
        INSERT INTO context_restore_requests (
          id,
          status,
          idempotency_key,
          resource,
          restore_plan,
          result,
          lease_owner,
          lease_expires_at,
          created_at,
          updated_at
        )
        VALUES ($1, 'pending', $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::timestamptz, $8::timestamptz, $8::timestamptz)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *
      `,
      [
        request.id,
        request.idempotency_key ?? null,
        JSON.stringify(request.resource),
        JSON.stringify(request.restore_plan),
        jsonOrNull(request.result),
        request.lease_owner ?? null,
        request.lease_expires_at ?? null,
        now.toISOString(),
      ],
    );

    if (result.rows[0]) {
      return { record: rowToContextRestoreRequestRecord(result.rows[0]), inserted: true };
    }

    if (!request.idempotency_key) {
      const existing = await this.getContextRestoreRequest(request.id);
      if (existing) {
        return { record: existing, inserted: false };
      }
      throw new Error(`context restore request ${request.id} was not found after conflict`);
    }

    const existingByIdempotency = await this.pool.query(
      "SELECT * FROM context_restore_requests WHERE idempotency_key = $1",
      [request.idempotency_key],
    );
    if (!existingByIdempotency.rows[0]) {
      throw new Error(`context restore request ${request.idempotency_key} was not found after conflict`);
    }

    return { record: rowToContextRestoreRequestRecord(existingByIdempotency.rows[0]), inserted: false };
  }

  async peekNextContextRestoreRequest(now = this.clock()): Promise<ContextRestoreRequestRecord | undefined> {
    await this.reapExpiredContextRestoreRequestLeases(now);
    const result = await this.pool.query(
      `
        SELECT *
        FROM context_restore_requests
        WHERE status = 'pending'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
    );

    return result.rows[0] ? rowToContextRestoreRequestRecord(result.rows[0]) : undefined;
  }

  async claimNextContextRestoreRequest(
    leaseOwner: string,
    leaseMs = this.defaultLeaseMs,
  ): Promise<ContextRestoreRequestRecord | undefined> {
    const client = await this.pool.connect();
    const now = this.clock();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    try {
      await client.query("BEGIN");
      await this.reapExpiredContextRestoreRequestLeasesWithClient(client, now);
      const result = await client.query(
        `
          WITH next_request AS (
            SELECT id
            FROM context_restore_requests
            WHERE status = 'pending'
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE context_restore_requests r
          SET status = 'leased',
              lease_owner = $2,
              lease_expires_at = $3::timestamptz,
              updated_at = $1::timestamptz
          FROM next_request
          WHERE r.id = next_request.id
          RETURNING r.*
        `,
        [now.toISOString(), leaseOwner, leaseExpiresAt.toISOString()],
      );
      await client.query("COMMIT");
      return result.rows[0] ? rowToContextRestoreRequestRecord(result.rows[0]) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getContextRestoreRequest(id: string): Promise<ContextRestoreRequestRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM context_restore_requests WHERE id = $1", [id]);
    return result.rows[0] ? rowToContextRestoreRequestRecord(result.rows[0]) : undefined;
  }

  async markContextRestoreRequestDone(
    id: string,
    resultValue: unknown,
    now: Date,
  ): Promise<ContextRestoreRequestRecord | undefined> {
    const result = await this.pool.query(
      `
        UPDATE context_restore_requests
        SET status = 'done',
            result = $2::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = $3::timestamptz
        WHERE id = $1
        RETURNING *
      `,
      [id, JSON.stringify(resultValue), now.toISOString()],
    );

    return result.rows[0] ? rowToContextRestoreRequestRecord(result.rows[0]) : undefined;
  }

  async markContextRestoreRequestFailed(
    id: string,
    resultValue: unknown,
    now: Date,
  ): Promise<ContextRestoreRequestRecord | undefined> {
    const result = await this.pool.query(
      `
        UPDATE context_restore_requests
        SET status = 'failed',
            result = $2::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = $3::timestamptz
        WHERE id = $1
        RETURNING *
      `,
      [id, JSON.stringify(resultValue), now.toISOString()],
    );

    return result.rows[0] ? rowToContextRestoreRequestRecord(result.rows[0]) : undefined;
  }

  async retryContextRestoreRequest(
    id: string,
    now: Date,
  ): Promise<ContextRestoreRequestRecord | undefined> {
    const result = await this.pool.query(
      `
        UPDATE context_restore_requests
        SET status = 'pending',
            result = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = $2::timestamptz
        WHERE id = $1
        RETURNING *
      `,
      [id, now.toISOString()],
    );

    return result.rows[0] ? rowToContextRestoreRequestRecord(result.rows[0]) : undefined;
  }

  async reapExpiredContextRestoreRequestLeases(now = this.clock()): Promise<ContextRestoreRequestRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await this.reapExpiredContextRestoreRequestLeasesWithClient(client, now);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async reapExpiredContextRestoreRequestLeasesWithClient(
    client: PoolClient,
    now: Date,
  ): Promise<ContextRestoreRequestRecord[]> {
    const result = await client.query(
      `
        UPDATE context_restore_requests
        SET status = 'pending',
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = $1::timestamptz
        WHERE status = 'leased'
          AND lease_expires_at <= $1::timestamptz
        RETURNING *
      `,
      [now.toISOString()],
    );

    return result.rows.map(rowToContextRestoreRequestRecord);
  }

  async leaseNext(owner: string, leaseMs = this.defaultLeaseMs): Promise<QueueItemWithPacket | undefined> {
    const client = await this.pool.connect();
    const now = this.clock();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          WITH next_item AS (
            SELECT id
            FROM queue_items
            WHERE state = 'ready'
              AND (due_at IS NULL OR due_at <= $1::timestamptz)
            ORDER BY priority_score DESC, created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE queue_items q
          SET state = 'leased',
              lease_owner = $2,
              lease_expires_at = $3::timestamptz,
              updated_at = $1::timestamptz
          FROM next_item
          WHERE q.id = next_item.id
          RETURNING q.id
        `,
        [now.toISOString(), owner, leaseExpiresAt.toISOString()],
      );

      if (!result.rows[0]) {
        await client.query("COMMIT");
        return undefined;
      }

      const item = await this.getQueueItemById(client, result.rows[0].id);
      await client.query("COMMIT");
      return item;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markDone(queueItemId: string, actorId: string): Promise<QueueItemWithPacket | undefined> {
    void actorId;
    const client = await this.pool.connect();
    const now = this.clock().toISOString();

    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET state = 'done',
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = $2::timestamptz
          WHERE id = $1
          RETURNING id
        `,
        [queueItemId, now],
      );

      if (!result.rows[0]) {
        await client.query("COMMIT");
        return undefined;
      }

      const item = await this.getQueueItemById(client, queueItemId);
      await client.query("COMMIT");
      return item;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deferQueueItem(queueItemId: string, actorId: string, dueAt: Date): Promise<QueueItemWithPacket | undefined> {
    void actorId;
    const client = await this.pool.connect();
    const now = this.clock().toISOString();

    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET state = 'deferred',
              due_at = $2::timestamptz,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = $3::timestamptz
          WHERE id = $1
          RETURNING id
        `,
        [queueItemId, dueAt.toISOString(), now],
      );

      if (!result.rows[0]) {
        await client.query("COMMIT");
        return undefined;
      }

      const item = await this.getQueueItemById(client, queueItemId);
      await client.query("COMMIT");
      return item;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ignoreQueueItem(queueItemId: string, actorId: string): Promise<QueueItemWithPacket | undefined> {
    void actorId;
    const client = await this.pool.connect();
    const now = this.clock().toISOString();

    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET state = 'dead',
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = $2::timestamptz
          WHERE id = $1
          RETURNING id
        `,
        [queueItemId, now],
      );

      if (!result.rows[0]) {
        await client.query("COMMIT");
        return undefined;
      }

      const item = await this.getQueueItemById(client, queueItemId);
      await client.query("COMMIT");
      return item;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reapDueDeferredItems(now = this.clock()): Promise<QueueItemWithPacket[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET state = 'ready',
              updated_at = $1::timestamptz
          WHERE state = 'deferred'
            AND due_at IS NOT NULL
            AND due_at <= $1::timestamptz
          RETURNING id
        `,
        [now.toISOString()],
      );
      const items = [];
      for (const row of result.rows) {
        const item = await this.getQueueItemById(client, row.id);
        if (item) items.push(item);
      }
      await client.query("COMMIT");
      return items;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async renewLease(queueItemId: string, leaseOwner: string, leaseMs = this.defaultLeaseMs): Promise<QueueItemWithPacket | undefined> {
    const client = await this.pool.connect();
    const now = this.clock();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET lease_expires_at = $3::timestamptz,
              updated_at = $4::timestamptz
          WHERE id = $1
            AND state = 'leased'
            AND lease_owner = $2
          RETURNING id
        `,
        [queueItemId, leaseOwner, leaseExpiresAt.toISOString(), now.toISOString()],
      );

      if (!result.rows[0]) {
        await client.query("COMMIT");
        return undefined;
      }

      const item = await this.getQueueItemById(client, queueItemId);
      await client.query("COMMIT");
      return item;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reapStaleLeases(now = this.clock()): Promise<QueueItemWithPacket[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stale = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET state = 'ready',
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = $1::timestamptz
          WHERE state = 'leased'
            AND lease_expires_at <= $1::timestamptz
          RETURNING id
        `,
        [now.toISOString()],
      );

      const items = await Promise.all(stale.rows.map((row) => this.getQueueItemById(client, row.id)));
      await client.query("COMMIT");
      return items.filter((item): item is QueueItemWithPacket => item !== undefined);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async findExistingEventId(client: PoolClient, source: string, idempotencyKey: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM events WHERE source = $1 AND idempotency_key = $2",
      [source, idempotencyKey],
    );

    if (!result.rows[0]) {
      throw new Error(`event ${source}/${idempotencyKey} was not found after conflict`);
    }

    return result.rows[0].id;
  }

  private async insertReviewPacket(client: PoolClient, packet: ReviewPacket): Promise<void> {
    await client.query(
      `
        INSERT INTO review_packets (
          id,
          task_id,
          agent_run_id,
          title,
          summary,
          decision_needed,
          risk_level,
          confidence,
          risk_tags,
          evidence,
          context,
          recommended_action,
          alternate_actions,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::timestamptz, $15::timestamptz)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        packet.id,
        packet.task_id ?? null,
        packet.agent_run_id ?? null,
        packet.title,
        packet.summary,
        packet.decision_needed,
        packet.risk_level,
        packet.confidence,
        packet.risk_tags,
        JSON.stringify(packet.evidence),
        JSON.stringify(packet.context),
        JSON.stringify(packet.recommended_action),
        JSON.stringify(packet.alternate_actions),
        packet.created_at,
        packet.updated_at,
      ],
    );
  }

  private async insertRouteDecision(client: PoolClient, decision: RouteDecision): Promise<void> {
    await client.query(
      `
        INSERT INTO route_decisions (
          id,
          event_id,
          action,
          target_task_id,
          target_task_session_id,
          confidence,
          human_queue_reason,
          evidence,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        decision.id,
        decision.event_id,
        decision.action,
        decision.target_task_id ?? null,
        decision.target_task_session_id ?? null,
        decision.confidence,
        decision.human_queue_reason ?? null,
        JSON.stringify(decision.evidence),
        decision.created_at,
      ],
    );
  }

  private async insertQueueItem(client: PoolClient, item: QueueItem): Promise<void> {
    await client.query(
      `
        INSERT INTO queue_items (
          id,
          review_packet_id,
          task_id,
          state,
          priority_score,
          priority_reasons,
          due_at,
          lease_owner,
          lease_expires_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::text[], $7::timestamptz, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        item.id,
        item.review_packet_id,
        item.task_id ?? null,
        item.state,
        item.priority_score,
        item.priority_reasons,
        item.due_at ?? null,
        item.lease_owner ?? null,
        item.lease_expires_at ?? null,
        item.created_at,
        item.updated_at,
      ],
    );
  }

  private async getQueueItemByReviewPacketId(client: PoolClient, reviewPacketId: string): Promise<QueueItemWithPacket | undefined> {
    const result = await client.query(
      `
        SELECT ${queueSelectColumns("q")}, ${reviewPacketSelectColumns("p")}
        FROM queue_items q
        JOIN review_packets p ON p.id = q.review_packet_id
        WHERE q.review_packet_id = $1
      `,
      [reviewPacketId],
    );

    return result.rows[0] ? rowToQueueItemWithPacket(result.rows[0]) : undefined;
  }

  private async getQueueItemById(client: PoolClient, id: string): Promise<QueueItemWithPacket | undefined> {
    const result = await client.query(
      `
        SELECT ${queueSelectColumns("q")}, ${reviewPacketSelectColumns("p")}
        FROM queue_items q
        JOIN review_packets p ON p.id = q.review_packet_id
        WHERE q.id = $1
      `,
      [id],
    );

    return result.rows[0] ? rowToQueueItemWithPacket(result.rows[0]) : undefined;
  }
}

function normalizeNewQueueItem(item: NewQueueItem, fallbackNow: string): QueueItem {
  return {
    ...item,
    created_at: item.created_at ?? fallbackNow,
    updated_at: item.updated_at ?? fallbackNow,
  };
}

export function eventToRecord(event: McpEvent): EventRecord {
  return {
    id: event.id,
    source: event.source,
    source_id: event.source_id,
    idempotency_key: event.idempotency_key,
    occurred_at: event.occurred_at,
    received_at: event.received_at,
    actor: event.actor,
    project_hint: event.project_hint,
    task_hint: event.task_hint,
    type: event.type,
    title: event.title,
    summary: event.summary,
    raw_ref: event.raw_ref,
    links: event.links,
    resources: event.resources as ContextResource[],
  };
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function queueSelectColumns(alias: string): string {
  return [
    `${alias}.id AS q_id`,
    `${alias}.review_packet_id AS q_review_packet_id`,
    `${alias}.task_id AS q_task_id`,
    `${alias}.state AS q_state`,
    `${alias}.priority_score AS q_priority_score`,
    `${alias}.priority_reasons AS q_priority_reasons`,
    `${alias}.due_at AS q_due_at`,
    `${alias}.lease_owner AS q_lease_owner`,
    `${alias}.lease_expires_at AS q_lease_expires_at`,
    `${alias}.created_at AS q_created_at`,
    `${alias}.updated_at AS q_updated_at`,
  ].join(", ");
}

function reviewPacketSelectColumns(alias: string): string {
  return [
    `${alias}.id AS p_id`,
    `${alias}.task_id AS p_task_id`,
    `${alias}.agent_run_id AS p_agent_run_id`,
    `${alias}.title AS p_title`,
    `${alias}.summary AS p_summary`,
    `${alias}.decision_needed AS p_decision_needed`,
    `${alias}.risk_level AS p_risk_level`,
    `${alias}.confidence AS p_confidence`,
    `${alias}.risk_tags AS p_risk_tags`,
    `${alias}.evidence AS p_evidence`,
    `${alias}.context AS p_context`,
    `${alias}.recommended_action AS p_recommended_action`,
    `${alias}.alternate_actions AS p_alternate_actions`,
    `${alias}.created_at AS p_created_at`,
    `${alias}.updated_at AS p_updated_at`,
  ].join(", ");
}

function rowToQueueItemWithPacket(row: QueryResultRow): QueueItemWithPacket {
  return {
    id: row.q_id,
    review_packet_id: row.q_review_packet_id,
    task_id: row.q_task_id ?? undefined,
    state: row.q_state,
    priority_score: Number(row.q_priority_score),
    priority_reasons: row.q_priority_reasons,
    due_at: dateToIso(row.q_due_at),
    lease_owner: row.q_lease_owner ?? undefined,
    lease_expires_at: dateToIso(row.q_lease_expires_at),
    created_at: requiredDateToIso(row.q_created_at),
    updated_at: requiredDateToIso(row.q_updated_at),
    review_packet: rowToReviewPacket(row),
  };
}

function rowToReviewPacket(row: QueryResultRow): ReviewPacket {
  return {
    id: row.p_id,
    task_id: row.p_task_id ?? undefined,
    agent_run_id: row.p_agent_run_id ?? undefined,
    title: row.p_title,
    summary: row.p_summary,
    decision_needed: row.p_decision_needed,
    risk_level: row.p_risk_level as RiskLevel,
    confidence: row.p_confidence as Confidence,
    risk_tags: row.p_risk_tags,
    evidence: row.p_evidence as EvidenceRef[],
    context: row.p_context as ContextResource[],
    recommended_action: row.p_recommended_action as Action,
    alternate_actions: row.p_alternate_actions as Action[],
    created_at: requiredDateToIso(row.p_created_at),
    updated_at: requiredDateToIso(row.p_updated_at),
  };
}

function rowToEvent(row: QueryResultRow): McpEvent {
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    idempotency_key: row.idempotency_key,
    occurred_at: requiredDateToIso(row.occurred_at),
    received_at: requiredDateToIso(row.received_at),
    actor: row.actor ?? {
      id: "actor_unknown",
      type: "system",
    },
    project_hint: row.project_hint ?? undefined,
    task_hint: row.task_hint ?? undefined,
    type: row.type,
    title: row.title,
    summary: row.summary ?? "",
    raw_ref: row.raw_ref,
    links: row.links,
    resources: row.resources,
  };
}

function rowToRouteDecision(row: QueryResultRow): RouteDecision {
  return {
    id: row.id,
    event_id: row.event_id,
    action: row.action,
    target_task_id: row.target_task_id ?? undefined,
    target_task_session_id: row.target_task_session_id ?? undefined,
    confidence: row.confidence,
    human_queue_reason: row.human_queue_reason ?? undefined,
    evidence: row.evidence,
    created_at: requiredDateToIso(row.created_at),
  };
}

function rowToContextRestoreRequestRecord(row: QueryResultRow): ContextRestoreRequestRecord {
  return {
    id: row.id,
    status: row.status,
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
    idempotency_key: row.idempotency_key ?? undefined,
    resource: row.resource,
    restore_plan: row.restore_plan,
    result: row.result ?? undefined,
    lease_owner: row.lease_owner ?? undefined,
    lease_expires_at: dateToIso(row.lease_expires_at),
  };
}

function rowToWorkspaceRestoreReceipt(row: QueryResultRow): WorkspaceRestoreReceiptRecord {
  const details = isRecord(row.details) ? row.details : {};
  return {
    id: String(row.id),
    idempotency_key: String(details.idempotency_key),
    plan: details.plan as RestorePlan,
    receipt: details.receipt as RestoreExecutionReceipt,
    created_at: requiredDateToIso(row.created_at),
  };
}

function rowToMcpPollStateSnapshot(row: QueryResultRow): McpPollStateSnapshot {
  return {
    source_id: row.source_id,
    cursor: row.cursor ?? undefined,
    seen: Array.isArray(row.seen) ? row.seen.filter((item): item is string => typeof item === "string") : [],
    updated_at: requiredDateToIso(row.updated_at),
  };
}

function rowToTaskMessageRecord(row: QueryResultRow): DurableTaskMessageRecord {
  return {
    id: String(row.id),
    idempotency_key: String(row.idempotency_key),
    task_session_id: String(row.task_session_id),
    task_id: row.task_id ?? undefined,
    queue_item_id: row.queue_item_id ?? undefined,
    event_ids: Array.isArray(row.event_ids) ? row.event_ids.filter((item): item is string => typeof item === "string") : [],
    origin: String(row.origin),
    source_id: row.source_id ?? undefined,
    mode: "followup",
    status: row.status,
    text_hash: String(row.text_hash),
    text_length: Number(row.text_length),
    provider: row.provider ?? undefined,
    native_thread_id: row.native_thread_id ?? undefined,
    native_turn_id: row.native_turn_id ?? undefined,
    native_session_id: row.native_session_id ?? undefined,
    native_result_session_id: row.native_result_session_id ?? undefined,
    error: row.error ?? undefined,
    message: isRecord(row.message) ? row.message : {},
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
    sent_at: dateToIso(row.sent_at),
  };
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function requiredDateToIso(value: unknown): string {
  const iso = dateToIso(value);
  if (!iso) {
    throw new Error("expected timestamp value");
  }

  return iso;
}

function dateToIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTaskMessageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit)));
}
