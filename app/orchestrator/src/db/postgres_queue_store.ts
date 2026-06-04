import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type {
  AgentRun,
  AgentRunQueueResult,
  QueueItem,
  QueueItemWithPacket,
  QueueState,
  ReviewPacket,
  WorkspaceSnapshot,
} from "../contracts.js";
import type { McpCursorState, McpEvent } from "../integrations/mcp_poll/types.js";
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
  type StoredActionAttempt,
  type StoredEventResult,
  type TaskSessionTerminalRefRecord,
  type TaskWorkspaceSnapshotRecord,
  type OnboardingRejectionRecord,
  type OnboardingApprovalBatchRecord,
  type ManualModeStateRecord,
  type TaskRecord,
  type TaskLayoutRecord,
  type TaskAnchorKind,
  type CurrentTaskStateRecord,
  type WindowWorkspaceObservationRecord,
  type FollowsWindowRecord,
  type FollowsWindowExclusionRecord,
  type TaskWindowClaimRecord,
  type PaperTriggerRecord,
  type PaperTriggerCreateInput,
  type PaperTriggerPatch,
} from "../store.js";
import { stableId } from "../store/ids.js";
import { runMigrations } from "./migrations.js";
import {
  buildQueueItemFromAgentRunForPostgres,
  buildReviewPacketFromAgentRunForPostgres,
  eventToRecord,
  jsonOrNull,
  normalizeNewQueueItem,
  normalizeTaskMessageLimit,
  queueSelectColumns,
  reviewPacketSelectColumns,
  rowToAgentRun,
  rowToContextRestoreRequestRecord,
  rowToEvent,
  rowToMcpPollStateSnapshot,
  rowToQueueItemWithPacket,
  rowToReviewPacket,
  rowToRouteDecision,
  rowToTaskMessageRecord,
  rowToWorkspaceRestoreReceipt,
  type EventRecord,
  type NewQueueItem,
} from "./postgres_queue_rows.js";

export { eventToRecord, type EventRecord, type NewQueueItem } from "./postgres_queue_rows.js";

const { Pool: PgPool } = pg;

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

  async getLatestTaskWorkspaceSnapshot(taskId: string): Promise<TaskWorkspaceSnapshotRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT task_id, snapshot, captured_at, updated_at, source_queue_item_id, actor_id
        FROM task_workspace_snapshots
        WHERE task_id = $1
      `,
      [taskId],
    );
    const row = result.rows[0];
    return row ? rowToTaskWorkspaceSnapshotRecord(row) : undefined;
  }

  async saveTaskWorkspaceSnapshot(input: {
    taskId: string;
    snapshot: WorkspaceSnapshot;
    capturedAt: Date;
    sourceQueueItemId?: string;
    actorId?: string;
  }): Promise<TaskWorkspaceSnapshotRecord> {
    const result = await this.pool.query(
      `
        INSERT INTO task_workspace_snapshots (
          task_id,
          snapshot,
          captured_at,
          updated_at,
          source_queue_item_id,
          actor_id
        )
        VALUES ($1, $2::jsonb, $3::timestamptz, $3::timestamptz, $4, $5)
        ON CONFLICT (task_id) DO UPDATE SET
          snapshot = EXCLUDED.snapshot,
          captured_at = EXCLUDED.captured_at,
          updated_at = EXCLUDED.updated_at,
          source_queue_item_id = EXCLUDED.source_queue_item_id,
          actor_id = EXCLUDED.actor_id
        RETURNING task_id, snapshot, captured_at, updated_at, source_queue_item_id, actor_id
      `,
      [
        input.taskId,
        JSON.stringify(input.snapshot),
        input.capturedAt.toISOString(),
        input.sourceQueueItemId ?? null,
        input.actorId ?? null,
      ],
    );
    return rowToTaskWorkspaceSnapshotRecord(result.rows[0]);
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

  async getQueueActionAttempt(idempotencyKey: string): Promise<StoredActionAttempt | undefined> {
    const result = await this.pool.query(
      `
        SELECT idempotency_key, queue_item_id, terminal_send_ok, completed, action_result, terminal_send_result, created_at, updated_at
        FROM queue_action_attempts
        WHERE idempotency_key = $1
      `,
      [idempotencyKey],
    );
    const row = result.rows[0];
    return row ? rowToStoredActionAttempt(row) : undefined;
  }

  async recordQueueActionAttempt(input: {
    idempotencyKey: string;
    queueItemId: string;
    now: Date;
  }): Promise<{ existing?: StoredActionAttempt; record: StoredActionAttempt }> {
    const timestamp = input.now.toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO queue_action_attempts (
          idempotency_key,
          queue_item_id,
          terminal_send_ok,
          completed,
          action_result,
          terminal_send_result,
          created_at,
          updated_at
        )
        VALUES ($1, $2, false, false, NULL, NULL, $3::timestamptz, $3::timestamptz)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key, queue_item_id, terminal_send_ok, completed, action_result, terminal_send_result, created_at, updated_at
      `,
      [input.idempotencyKey, input.queueItemId, timestamp],
    );

    if (result.rows[0]) {
      return { record: rowToStoredActionAttempt(result.rows[0]) };
    }

    const existing = await this.getQueueActionAttempt(input.idempotencyKey);
    if (!existing) {
      throw new Error(`queue action attempt ${input.idempotencyKey} was not found after conflict`);
    }
    return { existing, record: existing };
  }

  async markQueueActionTerminalSent(input: {
    idempotencyKey: string;
    terminalSendResult?: Record<string, unknown>;
    now: Date;
  }): Promise<StoredActionAttempt | undefined> {
    const result = await this.pool.query(
      `
        UPDATE queue_action_attempts
        SET terminal_send_ok = true,
            terminal_send_result = $2::jsonb,
            updated_at = $3::timestamptz
        WHERE idempotency_key = $1
        RETURNING idempotency_key, queue_item_id, terminal_send_ok, completed, action_result, terminal_send_result, created_at, updated_at
      `,
      [
        input.idempotencyKey,
        input.terminalSendResult ? JSON.stringify(input.terminalSendResult) : null,
        input.now.toISOString(),
      ],
    );
    return result.rows[0] ? rowToStoredActionAttempt(result.rows[0]) : undefined;
  }

  async markQueueActionCompleted(input: {
    idempotencyKey: string;
    actionResult: Record<string, unknown>;
    now: Date;
  }): Promise<StoredActionAttempt | undefined> {
    const result = await this.pool.query(
      `
        UPDATE queue_action_attempts
        SET completed = true,
            action_result = $2::jsonb,
            updated_at = $3::timestamptz
        WHERE idempotency_key = $1
        RETURNING idempotency_key, queue_item_id, terminal_send_ok, completed, action_result, terminal_send_result, created_at, updated_at
      `,
      [input.idempotencyKey, JSON.stringify(input.actionResult), input.now.toISOString()],
    );
    return result.rows[0] ? rowToStoredActionAttempt(result.rows[0]) : undefined;
  }

  async getTaskSessionTerminalRef(taskSessionId: string): Promise<TaskSessionTerminalRefRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT task_session_id, terminal_ref, created_at, updated_at
        FROM task_session_terminal_refs
        WHERE task_session_id = $1
      `,
      [taskSessionId],
    );
    return result.rows[0] ? rowToTaskSessionTerminalRefRecord(result.rows[0]) : undefined;
  }

  async setTaskSessionTerminalRef(
    taskSessionId: string,
    terminalRef: string,
    now: Date,
  ): Promise<TaskSessionTerminalRefRecord> {
    const timestamp = now.toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO task_session_terminal_refs (task_session_id, terminal_ref, created_at, updated_at)
        VALUES ($1, $2, $3::timestamptz, $3::timestamptz)
        ON CONFLICT (task_session_id) DO UPDATE
          SET terminal_ref = EXCLUDED.terminal_ref,
              updated_at = EXCLUDED.updated_at
        RETURNING task_session_id, terminal_ref, created_at, updated_at
      `,
      [taskSessionId, terminalRef, timestamp],
    );
    return rowToTaskSessionTerminalRefRecord(result.rows[0]);
  }

  async clearTaskSessionTerminalRef(taskSessionId: string): Promise<TaskSessionTerminalRefRecord | undefined> {
    const result = await this.pool.query(
      `
        DELETE FROM task_session_terminal_refs
        WHERE task_session_id = $1
        RETURNING task_session_id, terminal_ref, created_at, updated_at
      `,
      [taskSessionId],
    );
    return result.rows[0] ? rowToTaskSessionTerminalRefRecord(result.rows[0]) : undefined;
  }

  async recordOnboardingRejection(
    proposalKey: string,
    reason: string | undefined,
    now: Date,
  ): Promise<OnboardingRejectionRecord> {
    const timestamp = now.toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO onboarding_rejections (proposal_key, reason, rejected_at)
        VALUES ($1, $2, $3::timestamptz)
        ON CONFLICT (proposal_key) DO UPDATE
          SET reason = EXCLUDED.reason,
              rejected_at = EXCLUDED.rejected_at
        RETURNING proposal_key, reason, rejected_at
      `,
      [proposalKey, reason ?? null, timestamp],
    );
    return rowToOnboardingRejectionRecord(result.rows[0]);
  }

  async listOnboardingRejections(): Promise<OnboardingRejectionRecord[]> {
    const result = await this.pool.query(
      `SELECT proposal_key, reason, rejected_at FROM onboarding_rejections ORDER BY rejected_at ASC`,
    );
    return result.rows.map(rowToOnboardingRejectionRecord);
  }

  async clearOnboardingRejection(proposalKey: string): Promise<OnboardingRejectionRecord | undefined> {
    const result = await this.pool.query(
      `DELETE FROM onboarding_rejections WHERE proposal_key = $1 RETURNING proposal_key, reason, rejected_at`,
      [proposalKey],
    );
    return result.rows[0] ? rowToOnboardingRejectionRecord(result.rows[0]) : undefined;
  }

  async getOnboardingApprovalBatch(idempotencyKey: string): Promise<OnboardingApprovalBatchRecord | undefined> {
    const result = await this.pool.query(
      `SELECT idempotency_key, results, created_at FROM onboarding_approval_batches WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ? rowToOnboardingApprovalBatchRecord(result.rows[0]) : undefined;
  }

  async recordOnboardingApprovalBatch(input: {
    idempotencyKey: string;
    results: Array<Record<string, unknown>>;
    now: Date;
  }): Promise<OnboardingApprovalBatchRecord> {
    const timestamp = input.now.toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO onboarding_approval_batches (idempotency_key, results, created_at)
        VALUES ($1, $2::jsonb, $3::timestamptz)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key, results, created_at
      `,
      [input.idempotencyKey, JSON.stringify(input.results), timestamp],
    );
    if (result.rows[0]) return rowToOnboardingApprovalBatchRecord(result.rows[0]);
    const fetched = await this.getOnboardingApprovalBatch(input.idempotencyKey);
    if (!fetched) throw new Error(`failed to record onboarding approval batch ${input.idempotencyKey}`);
    return fetched;
  }

  async getManualModeState(): Promise<ManualModeStateRecord> {
    const result = await this.pool.query(
      `SELECT active, entered_at, reason, updated_at FROM manual_mode_state WHERE id = 'singleton'`,
    );
    const row = result.rows[0];
    if (!row) {
      return { active: false, updated_at: new Date(0).toISOString() };
    }
    return rowToManualModeStateRecord(row);
  }

  async setManualModeActive(
    active: boolean,
    reason: string | undefined,
    now: Date,
  ): Promise<ManualModeStateRecord> {
    const timestamp = now.toISOString();
    if (active) {
      const result = await this.pool.query(
        `
          INSERT INTO manual_mode_state (id, active, entered_at, reason, updated_at)
          VALUES ('singleton', true, $1::timestamptz, $2, $1::timestamptz)
          ON CONFLICT (id) DO UPDATE
            SET active = true,
                entered_at = CASE WHEN manual_mode_state.active THEN manual_mode_state.entered_at ELSE EXCLUDED.entered_at END,
                reason = COALESCE(EXCLUDED.reason, manual_mode_state.reason),
                updated_at = EXCLUDED.updated_at
          RETURNING active, entered_at, reason, updated_at
        `,
        [timestamp, reason ?? null],
      );
      return rowToManualModeStateRecord(result.rows[0]);
    }
    const result = await this.pool.query(
      `
        INSERT INTO manual_mode_state (id, active, entered_at, reason, updated_at)
        VALUES ('singleton', false, NULL, NULL, $1::timestamptz)
        ON CONFLICT (id) DO UPDATE
          SET active = false,
              entered_at = NULL,
              reason = NULL,
              updated_at = EXCLUDED.updated_at
        RETURNING active, entered_at, reason, updated_at
      `,
      [timestamp],
    );
    return rowToManualModeStateRecord(result.rows[0]);
  }

  async createTask(input: {
    taskId?: string;
    primaryAnchor: { kind: TaskAnchorKind; id: string };
    capturedLayout: WorkspaceSnapshot;
    autoPaperIdleSeconds?: number;
    aerospaceWorkspaceId?: string;
    now: Date;
  }): Promise<{ task: TaskRecord; layout: TaskLayoutRecord; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const taskSelectColumns = "task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds";
      const existingByIdResult = input.taskId
        ? await client.query(`SELECT ${taskSelectColumns} FROM tasks WHERE task_id = $1`, [input.taskId])
        : { rows: [] };
      const existingResult = existingByIdResult.rows[0]
        ? existingByIdResult
        : await client.query(
            `
              SELECT ${taskSelectColumns}
              FROM tasks
              WHERE primary_anchor_kind = $1 AND primary_anchor_id = $2
            `,
            [input.primaryAnchor.kind, input.primaryAnchor.id],
          );
      if (existingResult.rows[0]) {
        let row = existingResult.rows[0];
        const timestamp = input.now.toISOString();
        if (
          (input.aerospaceWorkspaceId !== undefined &&
            (row.aerospace_workspace_id ?? undefined) !== input.aerospaceWorkspaceId) ||
          row.dormant_at
        ) {
          const updated = await client.query(
            `
              UPDATE tasks
                 SET aerospace_workspace_id = COALESCE($2, aerospace_workspace_id),
                     dormant_at = NULL,
                     updated_at = $3::timestamptz
               WHERE task_id = $1
              RETURNING task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
            `,
            [row.task_id, input.aerospaceWorkspaceId ?? null, timestamp],
          );
          row = updated.rows[0];
        }
        const task = rowToTaskRecord(row);
        const layoutResult = await client.query(
          `SELECT task_id, layout_json, updated_at FROM task_layouts WHERE task_id = $1`,
          [task.task_id],
        );
        await client.query("COMMIT");
        const layoutRow = layoutResult.rows[0];
        const layout = layoutRow
          ? rowToTaskLayoutRecord(layoutRow)
          : { task_id: task.task_id, layout: input.capturedLayout, updated_at: task.updated_at };
        return { task, layout, created: false };
      }
      const timestamp = input.now.toISOString();
      const idleSeconds =
        typeof input.autoPaperIdleSeconds === "number" && Number.isFinite(input.autoPaperIdleSeconds)
          ? Math.max(1, Math.floor(input.autoPaperIdleSeconds))
          : 60;
      const taskId = input.taskId ?? `task_${stableId(`${input.primaryAnchor.kind}_${input.primaryAnchor.id}_${timestamp}`)}`;
      const inserted = await client.query(
        `
          INSERT INTO tasks (task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, auto_paper_idle_seconds)
          VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz, $6)
          RETURNING task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
        `,
        [taskId, input.primaryAnchor.kind, input.primaryAnchor.id, input.aerospaceWorkspaceId ?? null, timestamp, idleSeconds],
      );
      const layoutInserted = await client.query(
        `
          INSERT INTO task_layouts (task_id, layout_json, updated_at)
          VALUES ($1, $2::jsonb, $3::timestamptz)
          RETURNING task_id, layout_json, updated_at
        `,
        [taskId, JSON.stringify(input.capturedLayout), timestamp],
      );
      await client.query("COMMIT");
      return {
        task: rowToTaskRecord(inserted.rows[0]),
        layout: rowToTaskLayoutRecord(layoutInserted.rows[0]),
        created: true,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
        FROM tasks
        WHERE task_id = $1
      `,
      [taskId],
    );
    const row = result.rows[0];
    return row ? rowToTaskRecord(row) : undefined;
  }

  async getTaskByAnchor(kind: TaskAnchorKind, id: string): Promise<TaskRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
        FROM tasks
        WHERE primary_anchor_kind = $1 AND primary_anchor_id = $2
      `,
      [kind, id],
    );
    const row = result.rows[0];
    return row ? rowToTaskRecord(row) : undefined;
  }

  async getTasksByWorkspaceId(workspaceId: string): Promise<TaskRecord[]> {
    const result = await this.pool.query(
      `
        SELECT task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
        FROM tasks
        WHERE aerospace_workspace_id = $1
        ORDER BY created_at ASC, task_id ASC
      `,
      [workspaceId],
    );
    return result.rows.map(rowToTaskRecord);
  }

  async listTasks(): Promise<TaskRecord[]> {
    const result = await this.pool.query(
      `
        SELECT task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
        FROM tasks
        ORDER BY created_at ASC, task_id ASC
      `,
    );
    return result.rows.map(rowToTaskRecord);
  }

  async getTaskLayout(taskId: string): Promise<TaskLayoutRecord | undefined> {
    const result = await this.pool.query(
      `SELECT task_id, layout_json, updated_at FROM task_layouts WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    return row ? rowToTaskLayoutRecord(row) : undefined;
  }

  async updateTaskLayout(taskId: string, layout: WorkspaceSnapshot, now: Date): Promise<TaskRecord | undefined> {
    const timestamp = now.toISOString();
    const updated = await this.pool.query(
      `
        UPDATE tasks SET updated_at = $2::timestamptz
        WHERE task_id = $1
        RETURNING task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
      `,
      [taskId, timestamp],
    );
    if (!updated.rows[0]) return undefined;
    await this.pool.query(
      `
        INSERT INTO task_layouts (task_id, layout_json, updated_at)
        VALUES ($1, $2::jsonb, $3::timestamptz)
        ON CONFLICT (task_id) DO UPDATE SET
          layout_json = EXCLUDED.layout_json,
          updated_at = EXCLUDED.updated_at
      `,
      [taskId, JSON.stringify(layout), timestamp],
    );
    return rowToTaskRecord(updated.rows[0]);
  }

  async getCurrentTaskState(): Promise<CurrentTaskStateRecord> {
    const result = await this.pool.query(
      `SELECT current_task_id, entered_at, updated_at FROM current_task_state WHERE id = 'singleton'`,
    );
    const row = result.rows[0];
    if (!row) {
      return { current_task_id: null, updated_at: new Date(0).toISOString() };
    }
    return rowToCurrentTaskStateRecord(row);
  }

  async setCurrentTaskId(taskId: string | null, now: Date): Promise<CurrentTaskStateRecord> {
    const timestamp = now.toISOString();
    if (taskId === null) {
      const result = await this.pool.query(
        `
          INSERT INTO current_task_state (id, current_task_id, entered_at, updated_at)
          VALUES ('singleton', NULL, NULL, $1::timestamptz)
          ON CONFLICT (id) DO UPDATE SET
            current_task_id = NULL,
            entered_at = NULL,
            updated_at = EXCLUDED.updated_at
          RETURNING current_task_id, entered_at, updated_at
        `,
        [timestamp],
      );
      return rowToCurrentTaskStateRecord(result.rows[0]);
    }
    const result = await this.pool.query(
      `
        INSERT INTO current_task_state (id, current_task_id, entered_at, updated_at)
        VALUES ('singleton', $1, $2::timestamptz, $2::timestamptz)
        ON CONFLICT (id) DO UPDATE SET
          current_task_id = EXCLUDED.current_task_id,
          entered_at = CASE
            WHEN current_task_state.current_task_id = EXCLUDED.current_task_id AND current_task_state.entered_at IS NOT NULL
              THEN current_task_state.entered_at
            ELSE EXCLUDED.entered_at
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING current_task_id, entered_at, updated_at
      `,
      [taskId, timestamp],
    );
    return rowToCurrentTaskStateRecord(result.rows[0]);
  }

  async recordTaskPaperEmitted(taskId: string, now: Date): Promise<TaskRecord | undefined> {
    const timestamp = now.toISOString();
    const result = await this.pool.query(
      `
        UPDATE tasks SET last_paper_emitted_at = $2::timestamptz, updated_at = $2::timestamptz
        WHERE task_id = $1
        RETURNING task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
      `,
      [taskId, timestamp],
    );
    const row = result.rows[0];
    return row ? rowToTaskRecord(row) : undefined;
  }

  async markTaskDormant(taskId: string, dormantAt: Date): Promise<TaskRecord | undefined> {
    const timestamp = dormantAt.toISOString();
    const result = await this.pool.query(
      `
        UPDATE tasks SET dormant_at = $2::timestamptz, updated_at = $2::timestamptz
        WHERE task_id = $1
        RETURNING task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
      `,
      [taskId, timestamp],
    );
    const row = result.rows[0];
    return row ? rowToTaskRecord(row) : undefined;
  }

  async wakeTask(taskId: string, now: Date): Promise<TaskRecord | undefined> {
    const timestamp = now.toISOString();
    const result = await this.pool.query(
      `
        UPDATE tasks SET dormant_at = NULL, updated_at = $2::timestamptz
        WHERE task_id = $1
        RETURNING task_id, primary_anchor_kind, primary_anchor_id, aerospace_workspace_id, created_at, updated_at, last_paper_emitted_at, dormant_at, auto_paper_idle_seconds
      `,
      [taskId, timestamp],
    );
    const row = result.rows[0];
    return row ? rowToTaskRecord(row) : undefined;
  }

  async recordWindowWorkspaceObservation(input: {
    windowId: string;
    workspaceId: string;
    isTaskWorkspace: boolean;
    observedAt: Date;
    appBundle?: string;
    titlePrefix?: string;
  }): Promise<WindowWorkspaceObservationRecord> {
    const timestamp = input.observedAt.toISOString();
    const appBundle = input.appBundle !== undefined && input.appBundle.length > 0 ? input.appBundle : null;
    const titlePrefix = input.titlePrefix !== undefined && input.titlePrefix.length > 0 ? input.titlePrefix : null;
    const result = await this.pool.query(
      `
        INSERT INTO window_workspace_observations (
          window_id,
          workspace_id,
          is_task_workspace,
          first_seen_at,
          last_seen_at,
          app_bundle,
          title_prefix
        )
        VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $5, $6)
        ON CONFLICT (window_id, workspace_id) DO UPDATE SET
          is_task_workspace = window_workspace_observations.is_task_workspace OR EXCLUDED.is_task_workspace,
          last_seen_at = EXCLUDED.last_seen_at,
          app_bundle = COALESCE(EXCLUDED.app_bundle, window_workspace_observations.app_bundle),
          title_prefix = COALESCE(EXCLUDED.title_prefix, window_workspace_observations.title_prefix)
        RETURNING window_id, workspace_id, is_task_workspace, first_seen_at, last_seen_at, app_bundle, title_prefix
      `,
      [input.windowId, input.workspaceId, input.isTaskWorkspace, timestamp, appBundle, titlePrefix],
    );
    return rowToWindowWorkspaceObservation(result.rows[0]);
  }

  async listFollowsWindows(input: { now: Date; ttlMs: number; minWorkspaceCount?: number }): Promise<FollowsWindowRecord[]> {
    const cutoff = new Date(input.now.getTime() - input.ttlMs).toISOString();
    const minWorkspaceCount = Math.max(2, Math.floor(input.minWorkspaceCount ?? 3));
    const result = await this.pool.query(
      `
        WITH live AS (
          SELECT window_id, workspace_id, last_seen_at, app_bundle, title_prefix
          FROM window_workspace_observations
          WHERE is_task_workspace = TRUE
            AND last_seen_at >= $1::timestamptz
            AND NOT EXISTS (
              SELECT 1
              FROM follows_window_exclusions ex
              WHERE (ex.app_bundle IS NULL OR lower(ex.app_bundle) = lower(window_workspace_observations.app_bundle))
                AND (ex.title_substring IS NULL OR lower(window_workspace_observations.title_prefix) LIKE '%' || lower(ex.title_substring) || '%')
            )
        ),
        slot_groups AS (
          SELECT
            app_bundle,
            title_prefix,
            array_agg(DISTINCT workspace_id ORDER BY workspace_id) AS workspaces,
            count(DISTINCT workspace_id) AS workspace_count,
            (
              array_agg(window_id ORDER BY last_seen_at DESC, window_id DESC)
            )[1] AS current_window_id,
            array_agg(DISTINCT window_id ORDER BY window_id) AS slot_window_ids
          FROM live
          WHERE app_bundle IS NOT NULL AND title_prefix IS NOT NULL
          GROUP BY app_bundle, title_prefix
          HAVING count(DISTINCT workspace_id) >= $2
        ),
        window_groups AS (
          SELECT
            window_id,
            array_agg(DISTINCT workspace_id ORDER BY workspace_id) AS workspaces,
            count(DISTINCT workspace_id) AS workspace_count
          FROM live
          GROUP BY window_id
          HAVING count(DISTINCT workspace_id) >= $2
        ),
        slot_emitted AS (
          SELECT DISTINCT unnest(slot_window_ids) AS window_id FROM slot_groups
        )
        SELECT
          current_window_id AS window_id,
          workspaces,
          app_bundle,
          title_prefix,
          slot_window_ids
        FROM slot_groups
        UNION ALL
        SELECT
          wg.window_id,
          wg.workspaces,
          NULL::text AS app_bundle,
          NULL::text AS title_prefix,
          NULL::text[] AS slot_window_ids
        FROM window_groups wg
        WHERE wg.window_id NOT IN (SELECT window_id FROM slot_emitted)
        ORDER BY window_id ASC
      `,
      [cutoff, minWorkspaceCount],
    );
    return result.rows.map((row) => {
      const appBundle = row.app_bundle;
      const titlePrefix = row.title_prefix;
      const slotIds = row.slot_window_ids;
      const record: FollowsWindowRecord = {
        window_id: String(row.window_id),
        known_workspaces: Array.isArray(row.workspaces) ? row.workspaces.map(String) : [],
      };
      if (typeof appBundle === "string" && appBundle.length > 0) record.app_bundle = appBundle;
      if (typeof titlePrefix === "string" && titlePrefix.length > 0) record.title_prefix = titlePrefix;
      if (Array.isArray(slotIds)) record.slot_window_ids = slotIds.map(String);
      return record;
    });
  }

  async addFollowsWindowExclusion(input: { appBundle?: string; titleSubstring?: string; now: Date }): Promise<FollowsWindowExclusionRecord> {
    const appBundle = normalizeOptionalText(input.appBundle)?.toLowerCase() ?? null;
    const titleSubstring = normalizeOptionalText(input.titleSubstring)?.toLowerCase() ?? null;
    if (!appBundle && !titleSubstring) {
      throw new Error("follows window exclusion needs appBundle or titleSubstring");
    }
    const exclusionId = `fwex_${stableId(`${appBundle ?? ""}_${titleSubstring ?? ""}`)}`;
    const timestamp = input.now.toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO follows_window_exclusions (exclusion_id, app_bundle, title_substring, created_at)
        VALUES ($1, $2, $3, $4::timestamptz)
        ON CONFLICT (exclusion_id) DO UPDATE SET created_at = follows_window_exclusions.created_at
        RETURNING exclusion_id, app_bundle, title_substring, created_at
      `,
      [exclusionId, appBundle, titleSubstring, timestamp],
    );
    return rowToFollowsWindowExclusionRecord(result.rows[0]);
  }

  async listFollowsWindowExclusions(): Promise<FollowsWindowExclusionRecord[]> {
    const result = await this.pool.query(
      `
        SELECT exclusion_id, app_bundle, title_substring, created_at
        FROM follows_window_exclusions
        ORDER BY exclusion_id ASC
      `,
    );
    return result.rows.map(rowToFollowsWindowExclusionRecord);
  }

  async deleteFollowsWindowExclusion(exclusionId: string): Promise<FollowsWindowExclusionRecord | undefined> {
    const result = await this.pool.query(
      `
        DELETE FROM follows_window_exclusions
        WHERE exclusion_id = $1
        RETURNING exclusion_id, app_bundle, title_substring, created_at
      `,
      [exclusionId],
    );
    return result.rows[0] ? rowToFollowsWindowExclusionRecord(result.rows[0]) : undefined;
  }

  async claimTaskWindow(input: {
    taskId: string;
    windowId?: string;
    appBundle?: string;
    titlePrefix?: string;
    processRootPid?: number;
    source?: string;
    now: Date;
    ttlMs?: number;
  }): Promise<TaskWindowClaimRecord> {
    const windowId = normalizeOptionalText(input.windowId) ?? null;
    const appBundle = normalizeOptionalText(input.appBundle)?.toLowerCase() ?? null;
    const titlePrefix = normalizeOptionalText(input.titlePrefix)?.toLowerCase().slice(0, 40) ?? null;
    const rawProcessRootPid = input.processRootPid;
    const processRootPid = Number.isInteger(rawProcessRootPid) && rawProcessRootPid !== undefined && rawProcessRootPid > 0
      ? rawProcessRootPid
      : null;
    if (!windowId && !appBundle && !titlePrefix && processRootPid === null) {
      throw new Error("task window claim needs windowId, appBundle, titlePrefix, or processRootPid");
    }
    const claimId = `twc_${stableId(`${input.taskId}_${windowId ?? ""}_${appBundle ?? ""}_${titlePrefix ?? ""}_${processRootPid ?? ""}`)}`;
    const timestamp = input.now.toISOString();
    const expiresAt = input.ttlMs && input.ttlMs > 0 ? new Date(input.now.getTime() + input.ttlMs).toISOString() : null;
    const result = await this.pool.query(
      `
        INSERT INTO task_window_claims (
          claim_id,
          task_id,
          window_id,
          app_bundle,
          title_prefix,
          process_root_pid,
          source,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
        ON CONFLICT (claim_id) DO UPDATE SET
          source = COALESCE(EXCLUDED.source, task_window_claims.source),
          expires_at = EXCLUDED.expires_at
        RETURNING claim_id, task_id, window_id, app_bundle, title_prefix, process_root_pid, source, created_at, expires_at
      `,
      [claimId, input.taskId, windowId, appBundle, titlePrefix, processRootPid, normalizeOptionalText(input.source) ?? null, timestamp, expiresAt],
    );
    return rowToTaskWindowClaimRecord(result.rows[0]);
  }

  async listTaskWindowClaims(input: { now: Date; taskId?: string }): Promise<TaskWindowClaimRecord[]> {
    const values: unknown[] = [input.now.toISOString()];
    const taskFilter = input.taskId ? "AND task_id = $2" : "";
    if (input.taskId) values.push(input.taskId);
    const result = await this.pool.query(
      `
        SELECT claim_id, task_id, window_id, app_bundle, title_prefix, process_root_pid, source, created_at, expires_at
        FROM task_window_claims
        WHERE (expires_at IS NULL OR expires_at >= $1::timestamptz)
          ${taskFilter}
        ORDER BY claim_id ASC
      `,
      values,
    );
    return result.rows.map(rowToTaskWindowClaimRecord);
  }

  async pruneWindowWorkspaceObservations(olderThan: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM window_workspace_observations WHERE last_seen_at < $1::timestamptz`,
      [olderThan.toISOString()],
    );
    return result.rowCount ?? 0;
  }

  async createPaperTrigger(input: PaperTriggerCreateInput, now: Date): Promise<PaperTriggerRecord> {
    const timestamp = now.toISOString();
    const triggerId = `trg_${stableId(`${input.task_id}_${input.name}_${timestamp}_${Math.random()}`)}`;
    const result = await this.pool.query(
      `
        INSERT INTO paper_triggers (
          trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz)
        RETURNING trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at, last_fired_at
      `,
      [
        triggerId,
        input.task_id,
        input.name,
        input.match_event_type,
        input.match_source_id_pattern ?? null,
        input.match_body_substring ?? null,
        input.enabled ?? true,
        timestamp,
      ],
    );
    return rowToPaperTriggerRecord(result.rows[0]);
  }

  async listPaperTriggers(filter?: { task_id?: string; only_enabled?: boolean }): Promise<PaperTriggerRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.task_id) {
      params.push(filter.task_id);
      conditions.push(`task_id = $${params.length}`);
    }
    if (filter?.only_enabled) {
      conditions.push(`enabled = TRUE`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query(
      `
        SELECT trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at, last_fired_at
        FROM paper_triggers
        ${where}
        ORDER BY created_at ASC
      `,
      params,
    );
    return result.rows.map(rowToPaperTriggerRecord);
  }

  async getPaperTrigger(triggerId: string): Promise<PaperTriggerRecord | undefined> {
    const result = await this.pool.query(
      `
        SELECT trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at, last_fired_at
        FROM paper_triggers WHERE trigger_id = $1
      `,
      [triggerId],
    );
    const row = result.rows[0];
    return row ? rowToPaperTriggerRecord(row) : undefined;
  }

  async updatePaperTrigger(
    triggerId: string,
    patch: PaperTriggerPatch,
    now: Date,
  ): Promise<PaperTriggerRecord | undefined> {
    const timestamp = now.toISOString();
    const result = await this.pool.query(
      `
        UPDATE paper_triggers
           SET name = COALESCE($2, name),
               match_event_type = COALESCE($3, match_event_type),
               match_source_id_pattern = CASE
                 WHEN $4::text = '__clear__' THEN NULL
                 WHEN $4 IS NOT NULL THEN $4
                 ELSE match_source_id_pattern
               END,
               match_body_substring = CASE
                 WHEN $5::text = '__clear__' THEN NULL
                 WHEN $5 IS NOT NULL THEN $5
                 ELSE match_body_substring
               END,
               enabled = COALESCE($6, enabled),
               updated_at = $7::timestamptz
         WHERE trigger_id = $1
        RETURNING trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at, last_fired_at
      `,
      [
        triggerId,
        patch.name ?? null,
        patch.match_event_type ?? null,
        patch.match_source_id_pattern === null
          ? "__clear__"
          : patch.match_source_id_pattern ?? null,
        patch.match_body_substring === null
          ? "__clear__"
          : patch.match_body_substring ?? null,
        patch.enabled ?? null,
        timestamp,
      ],
    );
    const row = result.rows[0];
    return row ? rowToPaperTriggerRecord(row) : undefined;
  }

  async deletePaperTrigger(triggerId: string): Promise<PaperTriggerRecord | undefined> {
    const result = await this.pool.query(
      `
        DELETE FROM paper_triggers WHERE trigger_id = $1
        RETURNING trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at, last_fired_at
      `,
      [triggerId],
    );
    const row = result.rows[0];
    return row ? rowToPaperTriggerRecord(row) : undefined;
  }

  async recordPaperTriggerFired(triggerId: string, at: Date): Promise<PaperTriggerRecord | undefined> {
    const timestamp = at.toISOString();
    const result = await this.pool.query(
      `
        UPDATE paper_triggers
           SET last_fired_at = $2::timestamptz, updated_at = $2::timestamptz
         WHERE trigger_id = $1
        RETURNING trigger_id, task_id, name, match_event_type,
          match_source_id_pattern, match_body_substring,
          enabled, created_at, updated_at, last_fired_at
      `,
      [triggerId, timestamp],
    );
    const row = result.rows[0];
    return row ? rowToPaperTriggerRecord(row) : undefined;
  }

  async tryRegisterPaperTriggerFiring(triggerId: string, dedupeKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        INSERT INTO paper_trigger_firings (trigger_id, dedupe_key, fired_at)
        VALUES ($1, $2, now())
        ON CONFLICT (trigger_id, dedupe_key) DO NOTHING
      `,
      [triggerId, dedupeKey],
    );
    return (result.rowCount ?? 0) > 0;
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

  async getAgentRun(id: string): Promise<AgentRun | undefined> {
    const result = await this.pool.query("SELECT * FROM agent_runs WHERE id = $1", [id]);
    return result.rows[0] ? rowToAgentRun(result.rows[0]) : undefined;
  }

  async upsertAgentRun(run: AgentRun, now: Date): Promise<AgentRunQueueResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO agent_runs (
            id,
            provider,
            task_id,
            thread_id,
            status,
            started_at,
            updated_at,
            completed_at,
            blocked_reason,
            risk_tags,
            evidence,
            output_refs,
            resume_actions
          )
          VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, $10::text[], $11::jsonb, $12::jsonb, $13::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            provider = EXCLUDED.provider,
            task_id = EXCLUDED.task_id,
            thread_id = EXCLUDED.thread_id,
            status = EXCLUDED.status,
            started_at = EXCLUDED.started_at,
            updated_at = EXCLUDED.updated_at,
            completed_at = EXCLUDED.completed_at,
            blocked_reason = EXCLUDED.blocked_reason,
            risk_tags = EXCLUDED.risk_tags,
            evidence = EXCLUDED.evidence,
            output_refs = EXCLUDED.output_refs,
            resume_actions = EXCLUDED.resume_actions
        `,
        [
          run.id,
          run.provider,
          run.task_id ?? null,
          run.thread_id ?? null,
          run.status,
          run.started_at ?? null,
          run.updated_at,
          run.completed_at ?? null,
          run.blocked_reason ?? null,
          run.risk_tags,
          JSON.stringify(run.evidence),
          JSON.stringify(run.output_refs),
          JSON.stringify(run.resume_actions),
        ],
      );

      const storedRun = await this.getAgentRunWithClient(client, run.id);
      if (!storedRun) throw new Error(`agent run ${run.id} was not found after upsert`);

      if (storedRun.status !== "waiting_approval" && storedRun.status !== "blocked") {
        await this.clearAgentRunQueueItem(client, storedRun.id, now.toISOString());
        await client.query("COMMIT");
        return { agent_run: storedRun };
      }

      const timestamp = now.toISOString();
      const packet = buildReviewPacketFromAgentRunForPostgres(storedRun, timestamp);
      const queueItem = buildQueueItemFromAgentRunForPostgres(storedRun, packet, timestamp);
      const existingItem = await this.getQueueItemByReviewPacketId(client, packet.id);
      await this.insertReviewPacket(client, packet);
      if (!existingItem) {
        await this.insertQueueItem(client, normalizeNewQueueItem(queueItem, timestamp));
      } else {
        await this.reactivateAgentRunQueueItem(client, queueItem, timestamp);
      }
      const item = await this.getQueueItemByReviewPacketId(client, packet.id);

      await client.query("COMMIT");
      return {
        agent_run: storedRun,
        review_packet: item?.review_packet ?? packet,
        queue_item: item,
        queue_item_created: !existingItem,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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

  async leaseNext(owner: string, leaseMs = this.defaultLeaseMs, excludeQueueItemId?: string): Promise<QueueItemWithPacket | undefined> {
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
              AND ($4::text IS NULL OR id <> $4)
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
        [now.toISOString(), owner, leaseExpiresAt.toISOString(), excludeQueueItemId ?? null],
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

  async bumpPriority(
    queueItemId: string,
    input: { delta?: number; score?: number; reason?: string },
  ): Promise<QueueItemWithPacket | undefined> {
    const client = await this.pool.connect();
    const now = this.clock().toISOString();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ priority_score: number; priority_reasons: string[] }>(
        "SELECT priority_score, priority_reasons FROM queue_items WHERE id = $1 FOR UPDATE",
        [queueItemId],
      );
      if (!current.rows[0]) {
        await client.query("COMMIT");
        return undefined;
      }
      const before = Number(current.rows[0].priority_score);
      const next = typeof input.score === "number" && Number.isFinite(input.score)
        ? Math.round(input.score)
        : before + Math.round(input.delta ?? 0);
      const clamped = Math.max(0, Math.min(10_000, next));
      const reasonTag = input.reason ?? "manual_priority_bump";
      const reasons = current.rows[0].priority_reasons ?? [];
      const nextReasons = reasons.includes(reasonTag) ? reasons : [...reasons, reasonTag];

      await client.query(
        `
          UPDATE queue_items
          SET priority_score = $2,
              priority_reasons = $3::text[],
              updated_at = $4::timestamptz
          WHERE id = $1
        `,
        [queueItemId, clamped, nextReasons, now],
      );

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
        ON CONFLICT (id) DO UPDATE SET
          task_id = EXCLUDED.task_id,
          agent_run_id = EXCLUDED.agent_run_id,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          decision_needed = EXCLUDED.decision_needed,
          risk_level = EXCLUDED.risk_level,
          confidence = EXCLUDED.confidence,
          risk_tags = EXCLUDED.risk_tags,
          evidence = EXCLUDED.evidence,
          context = EXCLUDED.context,
          recommended_action = EXCLUDED.recommended_action,
          alternate_actions = EXCLUDED.alternate_actions,
          updated_at = EXCLUDED.updated_at
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

  private async getAgentRunWithClient(client: PoolClient, id: string): Promise<AgentRun | undefined> {
    const result = await client.query("SELECT * FROM agent_runs WHERE id = $1", [id]);
    return result.rows[0] ? rowToAgentRun(result.rows[0]) : undefined;
  }

  private async clearAgentRunQueueItem(client: PoolClient, agentRunId: string, timestamp: string): Promise<void> {
    await client.query(
      `
        UPDATE queue_items
        SET state = 'done',
            due_at = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = $2::timestamptz
        WHERE review_packet_id = $1
          AND state IN ('ready', 'leased', 'deferred')
      `,
      [`pkt_${stableId(agentRunId)}_agent_waiting`, timestamp],
    );
  }

  private async reactivateAgentRunQueueItem(client: PoolClient, item: NewQueueItem, timestamp: string): Promise<void> {
    await client.query(
      `
        UPDATE queue_items
        SET task_id = $2,
            state = 'ready',
            priority_score = $3,
            priority_reasons = $4::text[],
            due_at = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = $5::timestamptz
        WHERE id = $1
      `,
      [
        item.id,
        item.task_id ?? null,
        item.priority_score,
        item.priority_reasons,
        timestamp,
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

function rowToStoredActionAttempt(row: Record<string, unknown>): StoredActionAttempt {
  return {
    idempotency_key: String(row.idempotency_key),
    queue_item_id: String(row.queue_item_id),
    terminal_send_ok: Boolean(row.terminal_send_ok),
    completed: Boolean(row.completed),
    action_result: row.action_result ? row.action_result as Record<string, unknown> : undefined,
    terminal_send_result: row.terminal_send_result ? row.terminal_send_result as Record<string, unknown> : undefined,
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
  };
}

function rowToOnboardingRejectionRecord(row: Record<string, unknown>): OnboardingRejectionRecord {
  return {
    proposal_key: String(row.proposal_key),
    reason: row.reason === null || row.reason === undefined ? undefined : String(row.reason),
    rejected_at: requiredDateToIso(row.rejected_at),
  };
}

function rowToOnboardingApprovalBatchRecord(row: Record<string, unknown>): OnboardingApprovalBatchRecord {
  return {
    idempotency_key: String(row.idempotency_key),
    results: (row.results ?? []) as Array<Record<string, unknown>>,
    created_at: requiredDateToIso(row.created_at),
  };
}

function rowToManualModeStateRecord(row: Record<string, unknown>): ManualModeStateRecord {
  const active = Boolean(row.active);
  const enteredAt = row.entered_at;
  const reason = row.reason;
  return {
    active,
    entered_at: enteredAt instanceof Date
      ? enteredAt.toISOString()
      : typeof enteredAt === "string" && enteredAt
        ? new Date(enteredAt).toISOString()
        : undefined,
    reason: typeof reason === "string" && reason ? reason : undefined,
    updated_at: requiredDateToIso(row.updated_at),
  };
}

function rowToTaskSessionTerminalRefRecord(row: Record<string, unknown>): TaskSessionTerminalRefRecord {
  return {
    task_session_id: String(row.task_session_id),
    terminal_ref: String(row.terminal_ref),
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
  };
}

function rowToTaskWorkspaceSnapshotRecord(row: Record<string, unknown>): TaskWorkspaceSnapshotRecord {
  return {
    task_id: String(row.task_id),
    snapshot: row.snapshot as WorkspaceSnapshot,
    captured_at: requiredDateToIso(row.captured_at),
    updated_at: requiredDateToIso(row.updated_at),
    source_queue_item_id: row.source_queue_item_id ? String(row.source_queue_item_id) : undefined,
    actor_id: row.actor_id ? String(row.actor_id) : undefined,
  };
}

function rowToTaskRecord(row: Record<string, unknown>): TaskRecord {
  const lastPaper = row.last_paper_emitted_at;
  const dormantAt = row.dormant_at;
  const workspaceId = row.aerospace_workspace_id;
  return {
    task_id: String(row.task_id),
    primary_anchor_kind: row.primary_anchor_kind as TaskAnchorKind,
    primary_anchor_id: String(row.primary_anchor_id),
    aerospace_workspace_id:
      typeof workspaceId === "string" && workspaceId ? workspaceId : undefined,
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
    last_paper_emitted_at:
      lastPaper instanceof Date
        ? lastPaper.toISOString()
        : typeof lastPaper === "string" && lastPaper
          ? new Date(lastPaper).toISOString()
          : undefined,
    dormant_at:
      dormantAt instanceof Date
        ? dormantAt.toISOString()
        : typeof dormantAt === "string" && dormantAt
          ? new Date(dormantAt).toISOString()
          : undefined,
    auto_paper_idle_seconds: Number(row.auto_paper_idle_seconds),
  };
}

function rowToFollowsWindowExclusionRecord(row: Record<string, unknown>): FollowsWindowExclusionRecord {
  const appBundle = row.app_bundle;
  const titleSubstring = row.title_substring;
  return {
    exclusion_id: String(row.exclusion_id),
    app_bundle: typeof appBundle === "string" && appBundle ? appBundle : undefined,
    title_substring: typeof titleSubstring === "string" && titleSubstring ? titleSubstring : undefined,
    created_at: requiredDateToIso(row.created_at),
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function rowToTaskLayoutRecord(row: Record<string, unknown>): TaskLayoutRecord {
  return {
    task_id: String(row.task_id),
    layout: row.layout_json as WorkspaceSnapshot,
    updated_at: requiredDateToIso(row.updated_at),
  };
}

function rowToWindowWorkspaceObservation(row: Record<string, unknown>): WindowWorkspaceObservationRecord {
  const appBundle = row.app_bundle;
  const titlePrefix = row.title_prefix;
  const record: WindowWorkspaceObservationRecord = {
    window_id: String(row.window_id),
    workspace_id: String(row.workspace_id),
    is_task_workspace: row.is_task_workspace === true,
    first_seen_at: requiredDateToIso(row.first_seen_at),
    last_seen_at: requiredDateToIso(row.last_seen_at),
  };
  if (typeof appBundle === "string" && appBundle.length > 0) record.app_bundle = appBundle;
  if (typeof titlePrefix === "string" && titlePrefix.length > 0) record.title_prefix = titlePrefix;
  return record;
}

function rowToTaskWindowClaimRecord(row: Record<string, unknown>): TaskWindowClaimRecord {
  const windowId = row.window_id;
  const appBundle = row.app_bundle;
  const titlePrefix = row.title_prefix;
  const processRootPid = row.process_root_pid;
  const source = row.source;
  const expiresAt = row.expires_at;
  const record: TaskWindowClaimRecord = {
    claim_id: String(row.claim_id),
    task_id: String(row.task_id),
    created_at: requiredDateToIso(row.created_at),
  };
  if (typeof windowId === "string" && windowId.length > 0) record.window_id = windowId;
  if (typeof appBundle === "string" && appBundle.length > 0) record.app_bundle = appBundle;
  if (typeof titlePrefix === "string" && titlePrefix.length > 0) record.title_prefix = titlePrefix;
  if (typeof processRootPid === "number" && Number.isInteger(processRootPid) && processRootPid > 0) record.process_root_pid = processRootPid;
  if (typeof source === "string" && source.length > 0) record.source = source;
  if (expiresAt) record.expires_at = requiredDateToIso(expiresAt);
  return record;
}

function rowToPaperTriggerRecord(row: Record<string, unknown>): PaperTriggerRecord {
  const sourcePattern = row.match_source_id_pattern;
  const bodySubstring = row.match_body_substring;
  const lastFired = row.last_fired_at;
  return {
    trigger_id: String(row.trigger_id),
    task_id: String(row.task_id),
    name: String(row.name),
    match_event_type: String(row.match_event_type),
    match_source_id_pattern:
      typeof sourcePattern === "string" && sourcePattern ? sourcePattern : undefined,
    match_body_substring:
      typeof bodySubstring === "string" && bodySubstring ? bodySubstring : undefined,
    enabled: row.enabled === true,
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
    last_fired_at:
      lastFired instanceof Date
        ? lastFired.toISOString()
        : typeof lastFired === "string" && lastFired
          ? new Date(lastFired).toISOString()
          : undefined,
  };
}

function rowToCurrentTaskStateRecord(row: Record<string, unknown>): CurrentTaskStateRecord {
  const enteredAt = row.entered_at;
  const currentTaskId = row.current_task_id;
  return {
    current_task_id: currentTaskId === null || currentTaskId === undefined ? null : String(currentTaskId),
    entered_at:
      enteredAt instanceof Date
        ? enteredAt.toISOString()
        : typeof enteredAt === "string" && enteredAt
          ? new Date(enteredAt).toISOString()
          : undefined,
    updated_at: requiredDateToIso(row.updated_at),
  };
}

function requiredDateToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return new Date(value).toISOString();
  throw new Error("expected timestamp value");
}
