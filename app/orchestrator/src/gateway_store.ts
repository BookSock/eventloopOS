import type { QueueItemWithPacket, QueueState, ReviewPacket } from "./contracts.js";
import type { PostgresQueueStore } from "./db/postgres_queue_store.js";
import type { McpEvent } from "./integrations/mcp_poll/types.js";
import {
  getReviewPacket,
  getStoredEvent,
  getStoredEventByIdempotencyKey,
  getContextRestoreRequest,
  ingestEventAsReviewPacket,
  claimNextContextRestoreRequest,
  createContextRestoreRequest,
  leaseNextQueueItem,
  listContextEntries,
  listQueue,
  markContextRestoreRequestDone,
  markQueueItemDone,
  nextQueueItem,
  peekNextContextRestoreRequest,
  recordEventRoute,
  reapExpiredLeases,
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
  listQueue(state?: QueueState): Promise<QueueItemWithPacket[]>;
  nextQueueItem(now: Date): Promise<QueueItemWithPacket | undefined>;
  leaseNextQueueItem(leaseOwner: string, now: Date, leaseMs: number): Promise<QueueItemWithPacket | undefined>;
  renewQueueLease(queueItemId: string, leaseOwner: string, now: Date, leaseMs: number): Promise<QueueItemWithPacket | undefined>;
  markQueueItemDone(queueItemId: string, actorId: string, now: Date): Promise<QueueItemWithPacket | undefined>;
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
  ingestEventAsReviewPacket(event: McpEvent, now: Date): Promise<StoredEventResult>;
  recordEventRoute(event: McpEvent, routeDecision: RouteDecision, now: Date): Promise<StoredEventResult>;
};

export function createInMemoryGatewayStore(store: InMemoryStore): GatewayStore {
  return {
    async listQueue(state) {
      return listQueue(store).filter((item) => (state ? item.state === state : true));
    },
    async nextQueueItem(now) {
      reapExpiredLeases(store, now);
      return nextQueueItem(store);
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
    async ingestEventAsReviewPacket(event, now) {
      return ingestEventAsReviewPacket(store, event, now);
    },
    async recordEventRoute(event, routeDecision) {
      return recordEventRoute(store, event, routeDecision);
    },
  };
}

export function createPostgresGatewayStore(store: PostgresQueueStore): GatewayStore {
  return {
    async listQueue(state) {
      return store.listQueue(state);
    },
    async nextQueueItem(now) {
      await store.reapStaleLeases(now);
      const items = await store.listQueue("ready");
      return items[0];
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
    async ingestEventAsReviewPacket(event) {
      const result = await store.recordEventAsReviewPacket(event);
      return {
        event,
        route_decision: result.route_decision,
        review_packet: result.item?.review_packet,
        queue_item: result.item,
      };
    },
    async recordEventRoute(event, routeDecision) {
      const result = await store.recordRoutedEvent(eventToRecord(event), routeDecision);
      return {
        event,
        route_decision: result.route_decision,
      };
    },
  };
}
