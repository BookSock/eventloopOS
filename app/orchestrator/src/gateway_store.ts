import type { QueueItemWithPacket, QueueState, ReviewPacket } from "./contracts.js";
import type { PostgresQueueStore } from "./db/postgres_queue_store.js";
import type { RestoreExecutionReceipt, RestorePlan } from "./workspace/aerospace.js";
import type { WorkspaceRestoreReceiptRecord } from "./workspace/restore_receipts.js";
import type { McpCursorState, McpEvent } from "./integrations/mcp_poll/types.js";
import type { McpPollStateSnapshot } from "./integrations/mcp_poll/persistent_cursor_store.js";
import {
  buildTaskMessageAttemptRecord,
  finalizeTaskMessageRecord,
  type DurableTaskMessageAttemptInput,
  type DurableTaskMessageFinalInput,
  type DurableTaskMessageRecord,
  type TaskMessageHistoryQuery,
} from "./task_sessions/task_message_history.js";
import {
  getReviewPacket,
  getStoredEvent,
  getStoredEventByIdempotencyKey,
  getContextRestoreRequest,
  deferQueueItem,
  ingestEventAsReviewPacket,
  ignoreQueueItem,
  isQueueItemDue,
  claimNextContextRestoreRequest,
  createContextRestoreRequest,
  leaseNextQueueItem,
  listContextEntries,
  listQueue,
  markContextRestoreRequestDone,
  markContextRestoreRequestFailed,
  markQueueItemDone,
  nextQueueItem,
  peekNextContextRestoreRequest,
  recordEventRoute,
  reapExpiredLeases,
  reapDueDeferredItems,
  retryContextRestoreRequest,
  renewQueueLease,
  type InMemoryStore,
  type ContextEntry,
  type ContextQuery,
  type ContextRestoreRequestRecord,
  type RouteDecision,
  type StoredEventResult,
} from "./store.js";
import { eventToRecord } from "./db/postgres_queue_store.js";

export type GatewayStore = {
  listQueue(state?: QueueState, now?: Date): Promise<QueueItemWithPacket[]>;
  nextQueueItem(now: Date): Promise<QueueItemWithPacket | undefined>;
  leaseNextQueueItem(leaseOwner: string, now: Date, leaseMs: number): Promise<QueueItemWithPacket | undefined>;
  renewQueueLease(queueItemId: string, leaseOwner: string, now: Date, leaseMs: number): Promise<QueueItemWithPacket | undefined>;
  markQueueItemDone(queueItemId: string, actorId: string, now: Date): Promise<QueueItemWithPacket | undefined>;
  deferQueueItem(queueItemId: string, actorId: string, dueAt: Date, now: Date): Promise<QueueItemWithPacket | undefined>;
  ignoreQueueItem(queueItemId: string, actorId: string, now: Date): Promise<QueueItemWithPacket | undefined>;
  getReviewPacket(id: string): Promise<ReviewPacket | undefined>;
  getEvent(eventId: string): Promise<StoredEventResult | undefined>;
  getEventByIdempotencyKey(source: string, idempotencyKey: string): Promise<StoredEventResult | undefined>;
  listContextEntries(query?: ContextQuery): Promise<ContextEntry[]>;
  createContextRestoreRequest(
    request: Omit<ContextRestoreRequestRecord, "status" | "created_at" | "updated_at">,
    now: Date,
  ): Promise<{ record: ContextRestoreRequestRecord; inserted: boolean }>;
  claimNextContextRestoreRequest(
    leaseOwner: string,
    now: Date,
    leaseMs: number,
  ): Promise<ContextRestoreRequestRecord | undefined>;
  peekNextContextRestoreRequest(now: Date): Promise<ContextRestoreRequestRecord | undefined>;
  getContextRestoreRequest(id: string): Promise<ContextRestoreRequestRecord | undefined>;
  markContextRestoreRequestDone(id: string, result: unknown, now: Date): Promise<ContextRestoreRequestRecord | undefined>;
  markContextRestoreRequestFailed(id: string, result: unknown, now: Date): Promise<ContextRestoreRequestRecord | undefined>;
  retryContextRestoreRequest(id: string, now: Date): Promise<ContextRestoreRequestRecord | undefined>;
  ingestEventAsReviewPacket(event: McpEvent, now: Date): Promise<StoredEventResult>;
  recordEventRoute(event: McpEvent, routeDecision: RouteDecision, now: Date): Promise<StoredEventResult>;
  getWorkspaceRestoreReceipt(idempotencyKey: string): Promise<WorkspaceRestoreReceiptRecord | undefined>;
  recordWorkspaceRestoreReceipt(input: {
    idempotencyKey: string;
    plan: RestorePlan;
    receipt: RestoreExecutionReceipt;
    now: Date;
  }): Promise<WorkspaceRestoreReceiptRecord>;
  getMcpPollState(sourceId: string): Promise<McpPollStateSnapshot | undefined>;
  saveMcpPollState(sourceId: string, state: McpCursorState, now: Date): Promise<McpPollStateSnapshot>;
  getTaskMessageByIdempotencyKey(idempotencyKey: string): Promise<DurableTaskMessageRecord | undefined>;
  listTaskMessages(query?: TaskMessageHistoryQuery): Promise<DurableTaskMessageRecord[]>;
  recordTaskMessageAttempt(input: DurableTaskMessageAttemptInput): Promise<DurableTaskMessageRecord>;
  finalizeTaskMessage(input: DurableTaskMessageFinalInput): Promise<DurableTaskMessageRecord | undefined>;
};

export function createInMemoryGatewayStore(store: InMemoryStore): GatewayStore {
  const workspaceRestoreReceipts = store.workspaceRestoreReceipts ?? new Map<string, WorkspaceRestoreReceiptRecord>();
  const mcpPollStates = store.mcpPollStates ?? new Map<string, McpPollStateSnapshot>();
  const taskMessagesByIdempotencyKey = store.taskMessagesByIdempotencyKey ?? new Map<string, DurableTaskMessageRecord>();
  store.workspaceRestoreReceipts = workspaceRestoreReceipts;
  store.mcpPollStates = mcpPollStates;
  store.taskMessagesByIdempotencyKey = taskMessagesByIdempotencyKey;

  return {
    async listQueue(state, now) {
      if (now) reapDueDeferredItems(store, now);
      return listQueue(store, state);
    },
    async nextQueueItem(now) {
      reapExpiredLeases(store, now);
      return nextQueueItem(store, now);
    },
    async leaseNextQueueItem(leaseOwner, now, leaseMs) {
      return leaseNextQueueItem(store, leaseOwner, now, leaseMs);
    },
    async renewQueueLease(queueItemId, leaseOwner, now, leaseMs) {
      return renewQueueLease(store, queueItemId, leaseOwner, now, leaseMs);
    },
    async markQueueItemDone(queueItemId, _actorId, now) {
      return markQueueItemDone(store, queueItemId, now);
    },
    async deferQueueItem(queueItemId, _actorId, dueAt, now) {
      return deferQueueItem(store, queueItemId, dueAt, now);
    },
    async ignoreQueueItem(queueItemId, _actorId, now) {
      return ignoreQueueItem(store, queueItemId, now);
    },
    async getReviewPacket(id) {
      return getReviewPacket(store, id);
    },
    async getEvent(eventId) {
      return getStoredEvent(store, eventId);
    },
    async getEventByIdempotencyKey(source, idempotencyKey) {
      return getStoredEventByIdempotencyKey(store, source, idempotencyKey);
    },
    async listContextEntries(query) {
      return listContextEntries(store, query);
    },
    async createContextRestoreRequest(request, now) {
      return createContextRestoreRequest(store, request, now);
    },
    async claimNextContextRestoreRequest(leaseOwner, now, leaseMs) {
      return claimNextContextRestoreRequest(store, leaseOwner, now, leaseMs);
    },
    async peekNextContextRestoreRequest(now) {
      return peekNextContextRestoreRequest(store, now);
    },
    async getContextRestoreRequest(id) {
      return getContextRestoreRequest(store, id);
    },
    async markContextRestoreRequestDone(id, result, now) {
      return markContextRestoreRequestDone(store, id, result, now);
    },
    async markContextRestoreRequestFailed(id, result, now) {
      return markContextRestoreRequestFailed(store, id, result, now);
    },
    async retryContextRestoreRequest(id, now) {
      return retryContextRestoreRequest(store, id, now);
    },
    async ingestEventAsReviewPacket(event, now) {
      return ingestEventAsReviewPacket(store, event, now);
    },
    async recordEventRoute(event, routeDecision) {
      return recordEventRoute(store, event, routeDecision);
    },
    async getWorkspaceRestoreReceipt(idempotencyKey) {
      return workspaceRestoreReceipts.get(idempotencyKey);
    },
    async recordWorkspaceRestoreReceipt(input) {
      const existing = workspaceRestoreReceipts.get(input.idempotencyKey);
      if (existing) return existing;

      const record = {
        id: `rcpt_workspace_restore_${stableId(input.idempotencyKey)}`,
        idempotency_key: input.idempotencyKey,
        plan: input.plan,
        receipt: input.receipt,
        created_at: input.now.toISOString(),
      };
      workspaceRestoreReceipts.set(input.idempotencyKey, record);
      return record;
    },
    async getMcpPollState(sourceId) {
      return mcpPollStates.get(sourceId);
    },
    async saveMcpPollState(sourceId, state, now) {
      const snapshot = {
        source_id: sourceId,
        cursor: state.cursor,
        seen: Array.from(state.seen),
        updated_at: now.toISOString(),
      };
      mcpPollStates.set(sourceId, snapshot);
      return snapshot;
    },
    async getTaskMessageByIdempotencyKey(idempotencyKey) {
      return taskMessagesByIdempotencyKey.get(idempotencyKey);
    },
    async listTaskMessages(query = {}) {
      const limit = normalizeTaskMessageLimit(query.limit);
      return Array.from(taskMessagesByIdempotencyKey.values())
        .filter((record) => taskMessageMatchesQuery(record, query))
        .sort(compareTaskMessagesNewestFirst)
        .slice(0, limit);
    },
    async recordTaskMessageAttempt(input) {
      const existing = taskMessagesByIdempotencyKey.get(input.idempotency_key);
      if (existing) return existing;

      const record = buildTaskMessageAttemptRecord(input);
      taskMessagesByIdempotencyKey.set(record.idempotency_key, record);
      return record;
    },
    async finalizeTaskMessage(input) {
      const existing = taskMessagesByIdempotencyKey.get(input.idempotency_key);
      if (!existing) return undefined;

      const record = finalizeTaskMessageRecord(existing, input);
      taskMessagesByIdempotencyKey.set(record.idempotency_key, record);
      return record;
    },
  };
}

export function createPostgresGatewayStore(store: PostgresQueueStore): GatewayStore {
  return {
    async listQueue(state, now) {
      if (now) await store.reapDueDeferredItems(now);
      return store.listQueue(state);
    },
    async nextQueueItem(now) {
      await store.reapStaleLeases(now);
      const items = await store.listQueue("ready");
      return items.find((item) => isQueueItemDue(item, now));
    },
    async leaseNextQueueItem(leaseOwner, _now, leaseMs) {
      return store.leaseNext(leaseOwner, leaseMs);
    },
    async renewQueueLease(queueItemId, leaseOwner, _now, leaseMs) {
      return store.renewLease(queueItemId, leaseOwner, leaseMs);
    },
    async markQueueItemDone(queueItemId, actorId) {
      return store.markDone(queueItemId, actorId);
    },
    async deferQueueItem(queueItemId, actorId, dueAt) {
      return store.deferQueueItem(queueItemId, actorId, dueAt);
    },
    async ignoreQueueItem(queueItemId, actorId) {
      return store.ignoreQueueItem(queueItemId, actorId);
    },
    async getReviewPacket(id) {
      return store.getReviewPacket(id);
    },
    async getEvent(eventId) {
      return store.getEventResult(eventId);
    },
    async getEventByIdempotencyKey(source, idempotencyKey) {
      return store.getEventResultByIdempotencyKey(source, idempotencyKey);
    },
    async listContextEntries(query) {
      return store.listContextEntries(query);
    },
    async createContextRestoreRequest(request, now) {
      return store.createContextRestoreRequest(request, now);
    },
    async claimNextContextRestoreRequest(leaseOwner, _now, leaseMs) {
      return store.claimNextContextRestoreRequest(leaseOwner, leaseMs);
    },
    async peekNextContextRestoreRequest(now) {
      return store.peekNextContextRestoreRequest(now);
    },
    async getContextRestoreRequest(id) {
      return store.getContextRestoreRequest(id);
    },
    async markContextRestoreRequestDone(id, result, now) {
      return store.markContextRestoreRequestDone(id, result, now);
    },
    async markContextRestoreRequestFailed(id, result, now) {
      return store.markContextRestoreRequestFailed(id, result, now);
    },
    async retryContextRestoreRequest(id, now) {
      return store.retryContextRestoreRequest(id, now);
    },
    async ingestEventAsReviewPacket(event) {
      const result = await store.recordEventAsReviewPacket(event);
      if (!result.inserted) {
        const existing = await store.getEventResult(result.event_id);
        if (existing) return existing;
      }
      return {
        event,
        route_decision: result.route_decision,
        review_packet: result.item?.review_packet,
        queue_item: result.item,
      };
    },
    async recordEventRoute(event, routeDecision) {
      const result = await store.recordRoutedEvent(eventToRecord(event), routeDecision);
      if (!result.inserted) {
        const existing = await store.getEventResult(result.event_id);
        if (existing) return existing;
      }
      return {
        event,
        route_decision: result.route_decision,
      };
    },
    async getWorkspaceRestoreReceipt(idempotencyKey) {
      return store.getWorkspaceRestoreReceipt(idempotencyKey);
    },
    async recordWorkspaceRestoreReceipt(input) {
      return store.recordWorkspaceRestoreReceipt(input);
    },
    async getMcpPollState(sourceId) {
      return store.getMcpPollState(sourceId);
    },
    async saveMcpPollState(sourceId, state, now) {
      return store.saveMcpPollState(sourceId, state, now);
    },
    async getTaskMessageByIdempotencyKey(idempotencyKey) {
      return store.getTaskMessageByIdempotencyKey(idempotencyKey);
    },
    async listTaskMessages(query) {
      return store.listTaskMessages(query);
    },
    async recordTaskMessageAttempt(input) {
      return store.recordTaskMessageAttempt(input);
    },
    async finalizeTaskMessage(input) {
      return store.finalizeTaskMessage(input);
    },
  };
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function normalizeTaskMessageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

function taskMessageMatchesQuery(record: DurableTaskMessageRecord, query: TaskMessageHistoryQuery): boolean {
  if (query.task_session_id && record.task_session_id !== query.task_session_id) return false;
  if (query.task_id && record.task_id !== query.task_id) return false;
  if (query.queue_item_id && record.queue_item_id !== query.queue_item_id) return false;
  if (query.event_id && !record.event_ids.includes(query.event_id)) return false;
  if (query.idempotency_key && record.idempotency_key !== query.idempotency_key) return false;
  if (query.status && record.status !== query.status) return false;
  return true;
}

function compareTaskMessagesNewestFirst(left: DurableTaskMessageRecord, right: DurableTaskMessageRecord): number {
  const updated = Date.parse(right.updated_at) - Date.parse(left.updated_at);
  if (updated !== 0) return updated;
  return left.id.localeCompare(right.id);
}
