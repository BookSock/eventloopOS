import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Action, ContextResource, EvidenceRef, QueueItem, QueueItemWithPacket, ReviewPacket } from "./contracts.js";
import type { McpEvent } from "./integrations/mcp_poll/types.js";

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
  "fixtures",
  "seed-review-packets.json",
);

export type InMemoryStore = {
  queue: QueueItem[];
  reviewPackets: Map<string, ReviewPacket>;
  eventsByIdempotencyKey: Map<string, StoredEventResult>;
  eventsById: Map<string, StoredEventResult>;
  contextRestoreRequests: Map<string, ContextRestoreRequestRecord>;
  contextRestoreRequestIdsByIdempotencyKey: Map<string, string>;
};

export type RouteDecision = {
  id: string;
  event_id: string;
  action:
    | "ignore"
    | "store_only"
    | "attach_to_task"
    | "start_agent_thread"
    | "inject_into_agent_thread"
    | "create_review_packet"
    | "ask_human_now"
    | "defer_until_context";
  target_task_id?: string;
  target_task_session_id?: string;
  confidence: "low" | "medium" | "high";
  evidence: EvidenceRef[];
  created_at: string;
};

export type StoredEventResult = {
  event: McpEvent;
  route_decision: RouteDecision;
  review_packet?: ReviewPacket;
  queue_item?: QueueItemWithPacket;
};

export type ContextEntry = {
  event_id: string;
  event_title: string;
  event_source: string;
  task_id?: string;
  route_decision: RouteDecision;
  resource: Record<string, unknown>;
  captured_at: string;
  relevance_score: number;
  match_reasons: string[];
};

export type ContextQuery = {
  source?: string;
  task_id?: string;
  q?: string;
  limit?: number;
};

export type ContextRestoreRequestStatus = "pending" | "leased" | "done" | "failed";

export type ContextRestoreRequestRecord = {
  id: string;
  status: ContextRestoreRequestStatus;
  created_at: string;
  updated_at: string;
  idempotency_key?: string;
  resource: Record<string, unknown>;
  restore_plan: Record<string, unknown>;
  result?: unknown;
  lease_owner?: string;
  lease_expires_at?: string;
};

export type ReviewArtifacts = {
  route_decision: RouteDecision;
  review_packet: ReviewPacket;
  queue_item: QueueItem;
};

export async function createSeededStore(fixturePath = FIXTURE_PATH): Promise<InMemoryStore> {
  const packets = await loadReviewPackets(fixturePath);
  const queue = packets.map((packet, index): QueueItem => {
    const priorityScore = 1000 - index;

    return {
      id: `qit_${packet.id.replace(/^pkt_/, "")}`,
      review_packet_id: packet.id,
      task_id: packet.task_id,
      state: "ready",
      priority_score: priorityScore,
      priority_reasons: ["seeded_review_packet"],
      created_at: packet.created_at,
      updated_at: packet.updated_at,
    };
  });

  return {
    queue,
    reviewPackets: new Map(packets.map((packet) => [packet.id, packet])),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}

export function listQueue(store: InMemoryStore): QueueItemWithPacket[] {
  return store.queue
    .filter((item) => item.state === "ready" || item.state === "leased")
    .sort((left, right) => {
      if (right.priority_score !== left.priority_score) {
        return right.priority_score - left.priority_score;
      }

      return left.created_at.localeCompare(right.created_at);
    })
    .map((item) => attachPacket(store, item));
}

export function nextQueueItem(store: InMemoryStore, now = new Date()): QueueItemWithPacket | undefined {
  return listQueue(store).find((item) => item.state === "ready" && isQueueItemDue(item, now));
}

export function leaseNextQueueItem(
  store: InMemoryStore,
  leaseOwner: string,
  now: Date,
  leaseMs = 60_000,
): QueueItemWithPacket | undefined {
  reapExpiredLeases(store, now);
  const item = store.queue
    .filter((candidate) => candidate.state === "ready" && isQueueItemDue(candidate, now))
    .sort((left, right) => {
      if (right.priority_score !== left.priority_score) {
        return right.priority_score - left.priority_score;
      }
      return left.created_at.localeCompare(right.created_at);
    })[0];

  if (!item) return undefined;

  item.state = "leased";
  item.lease_owner = leaseOwner;
  item.lease_expires_at = new Date(now.getTime() + leaseMs).toISOString();
  item.updated_at = now.toISOString();
  return attachPacket(store, item);
}

export function isQueueItemDue(item: { due_at?: string }, now: Date): boolean {
  return !item.due_at || new Date(item.due_at).getTime() <= now.getTime();
}

export function markQueueItemDone(
  store: InMemoryStore,
  queueItemId: string,
  now: Date,
): QueueItemWithPacket | undefined {
  const item = store.queue.find((candidate) => candidate.id === queueItemId);
  if (!item) return undefined;

  item.state = "done";
  item.lease_owner = undefined;
  item.lease_expires_at = undefined;
  item.updated_at = now.toISOString();
  return attachPacket(store, item);
}

export function renewQueueLease(
  store: InMemoryStore,
  queueItemId: string,
  leaseOwner: string,
  now: Date,
  leaseMs = 60_000,
): QueueItemWithPacket | undefined {
  const item = store.queue.find((candidate) => candidate.id === queueItemId);
  if (!item || item.state !== "leased" || item.lease_owner !== leaseOwner) return undefined;

  item.lease_expires_at = new Date(now.getTime() + leaseMs).toISOString();
  item.updated_at = now.toISOString();
  return attachPacket(store, item);
}

export function reapExpiredLeases(store: InMemoryStore, now: Date): number {
  let reaped = 0;
  for (const item of store.queue) {
    if (item.state !== "leased" || !item.lease_expires_at) continue;
    if (new Date(item.lease_expires_at).getTime() > now.getTime()) continue;

    item.state = "ready";
    item.lease_owner = undefined;
    item.lease_expires_at = undefined;
    item.updated_at = now.toISOString();
    reaped += 1;
  }
  return reaped;
}

export function getReviewPacket(store: InMemoryStore, id: string): ReviewPacket | undefined {
  return store.reviewPackets.get(id);
}

export function ingestEventAsReviewPacket(
  store: InMemoryStore,
  event: McpEvent,
  now: Date,
): StoredEventResult {
  const existing = store.eventsByIdempotencyKey.get(eventIdempotencyKey(event.source, event.idempotency_key));
  if (existing) {
    return existing;
  }

  const routeDecision = decideRouteForEvent(event, now);
  if (routeDecision.action === "ignore" || routeDecision.action === "store_only" || routeDecision.action === "attach_to_task") {
    const result: StoredEventResult = {
      event,
      route_decision: routeDecision,
    };
    store.eventsByIdempotencyKey.set(eventIdempotencyKey(event.source, event.idempotency_key), result);
    store.eventsById.set(event.id, result);
    return result;
  }

  const artifacts = buildReviewArtifactsFromEvent(event, now, routeDecision);
  store.reviewPackets.set(artifacts.review_packet.id, artifacts.review_packet);
  store.queue.push(artifacts.queue_item);

  const result: StoredEventResult = {
    event,
    route_decision: artifacts.route_decision,
    review_packet: artifacts.review_packet,
    queue_item: attachPacket(store, artifacts.queue_item),
  };
  store.eventsByIdempotencyKey.set(eventIdempotencyKey(event.source, event.idempotency_key), result);
  store.eventsById.set(event.id, result);
  return result;
}

export function recordEventRoute(
  store: InMemoryStore,
  event: McpEvent,
  routeDecision: RouteDecision,
): StoredEventResult {
  const existing = store.eventsByIdempotencyKey.get(eventIdempotencyKey(event.source, event.idempotency_key));
  if (existing) {
    return existing;
  }

  const result: StoredEventResult = {
    event,
    route_decision: routeDecision,
  };
  store.eventsByIdempotencyKey.set(eventIdempotencyKey(event.source, event.idempotency_key), result);
  store.eventsById.set(event.id, result);
  return result;
}

export function getStoredEvent(store: InMemoryStore, eventId: string): StoredEventResult | undefined {
  return store.eventsById.get(eventId);
}

export function getStoredEventByIdempotencyKey(
  store: InMemoryStore,
  source: string,
  idempotencyKey: string,
): StoredEventResult | undefined {
  return store.eventsByIdempotencyKey.get(eventIdempotencyKey(source, idempotencyKey));
}

export function listContextEntries(store: InMemoryStore, query: ContextQuery = {}): ContextEntry[] {
  const limit = query.limit ?? 100;
  return rankContextEntries(
    [...store.eventsById.values()]
    .filter((result) => eventMatchesContextQuery(result.event, query))
    .flatMap(contextEntriesForResult)
      .filter((entry) => contextEntryMatchesQuery(entry, query)),
    query,
  )
    .slice(0, limit);
}

export function createContextRestoreRequest(
  store: InMemoryStore,
  request: Omit<ContextRestoreRequestRecord, "status" | "created_at" | "updated_at">,
  now: Date,
): { record: ContextRestoreRequestRecord; inserted: boolean } {
  if (request.idempotency_key) {
    const existingId = store.contextRestoreRequestIdsByIdempotencyKey.get(request.idempotency_key);
    const existing = existingId ? store.contextRestoreRequests.get(existingId) : undefined;
    if (existing) {
      return { record: existing, inserted: false };
    }
  }

  const timestamp = now.toISOString();
  const record: ContextRestoreRequestRecord = {
    ...request,
    status: "pending",
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.contextRestoreRequests.set(record.id, record);
  if (record.idempotency_key) {
    store.contextRestoreRequestIdsByIdempotencyKey.set(record.idempotency_key, record.id);
  }

  return { record, inserted: true };
}

export function claimNextContextRestoreRequest(
  store: InMemoryStore,
  leaseOwner: string,
  now: Date,
  leaseMs: number,
): ContextRestoreRequestRecord | undefined {
  reapExpiredContextRestoreRequestLeases(store, now);
  const record = peekNextContextRestoreRequest(store, now);

  if (!record) return undefined;

  record.status = "leased";
  record.lease_owner = leaseOwner;
  record.lease_expires_at = new Date(now.getTime() + leaseMs).toISOString();
  record.updated_at = now.toISOString();
  return record;
}

export function peekNextContextRestoreRequest(
  store: InMemoryStore,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  reapExpiredContextRestoreRequestLeases(store, now);
  return Array.from(store.contextRestoreRequests.values())
    .filter((candidate) => candidate.status === "pending")
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))[0];
}

export function getContextRestoreRequest(
  store: InMemoryStore,
  restoreRequestId: string,
): ContextRestoreRequestRecord | undefined {
  return store.contextRestoreRequests.get(restoreRequestId);
}

export function markContextRestoreRequestDone(
  store: InMemoryStore,
  restoreRequestId: string,
  result: unknown,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  const record = store.contextRestoreRequests.get(restoreRequestId);
  if (!record) return undefined;

  record.status = "done";
  record.updated_at = now.toISOString();
  record.result = result;
  record.lease_owner = undefined;
  record.lease_expires_at = undefined;
  return record;
}

export function markContextRestoreRequestFailed(
  store: InMemoryStore,
  restoreRequestId: string,
  result: unknown,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  const record = store.contextRestoreRequests.get(restoreRequestId);
  if (!record) return undefined;

  record.status = "failed";
  record.updated_at = now.toISOString();
  record.result = result;
  record.lease_owner = undefined;
  record.lease_expires_at = undefined;
  return record;
}

export function retryContextRestoreRequest(
  store: InMemoryStore,
  restoreRequestId: string,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  const record = store.contextRestoreRequests.get(restoreRequestId);
  if (!record) return undefined;

  record.status = "pending";
  record.updated_at = now.toISOString();
  record.result = undefined;
  record.lease_owner = undefined;
  record.lease_expires_at = undefined;
  return record;
}

export function reapExpiredContextRestoreRequestLeases(store: InMemoryStore, now: Date): number {
  let reaped = 0;
  for (const record of store.contextRestoreRequests.values()) {
    if (record.status !== "leased" || !record.lease_expires_at) continue;
    if (new Date(record.lease_expires_at).getTime() > now.getTime()) continue;

    record.status = "pending";
    record.lease_owner = undefined;
    record.lease_expires_at = undefined;
    record.updated_at = now.toISOString();
    reaped += 1;
  }
  return reaped;
}

export function buildReviewArtifactsFromEvent(
  event: McpEvent,
  now: Date,
  routeDecision = decideRouteForEvent(event, now),
): ReviewArtifacts {
  const createdAt = now.toISOString();
  const evidence = routeDecision.evidence.length > 0 ? routeDecision.evidence : evidenceForEvent(event);

  const packet = createReviewPacketFromEvent(event, evidence, createdAt, routeDecision);

  return {
    route_decision: routeDecision,
    review_packet: packet,
    queue_item: {
      id: `qit_${stableId(event.id)}`,
      review_packet_id: packet.id,
      task_id: packet.task_id,
      state: "ready",
      priority_score: scoreEventPriority(event),
      priority_reasons: priorityReasonsForEvent(event),
      created_at: createdAt,
      updated_at: createdAt,
    },
  };
}

export function decideRouteForEvent(event: McpEvent, now: Date): RouteDecision {
  const evidence = evidenceForEvent(event);
  const targetTaskId = taskIdForHint(event.task_hint);
  const action = routeActionForEvent(event);

  return {
    id: `rte_${stableId(event.id)}`,
    event_id: event.id,
    action,
    target_task_id: targetTaskId,
    confidence: routeConfidenceForEvent(event, action),
    evidence,
    created_at: now.toISOString(),
  };
}

async function loadReviewPackets(path: string): Promise<ReviewPacket[]> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Seed fixture must be an array");
  }

  return parsed.map((packet, index) => validateReviewPacket(packet, index));
}

function attachPacket(store: InMemoryStore, item: QueueItem): QueueItemWithPacket {
  const reviewPacket = store.reviewPackets.get(item.review_packet_id);

  if (!reviewPacket) {
    throw new Error(`Queue item ${item.id} references missing review packet ${item.review_packet_id}`);
  }

  return { ...item, review_packet: reviewPacket };
}

function validateReviewPacket(value: unknown, index: number): ReviewPacket {
  if (!isRecord(value)) {
    throw new Error(`Seed fixture item ${index} must be an object`);
  }

  const requiredStringFields = [
    "id",
    "title",
    "summary",
    "decision_needed",
    "risk_level",
    "confidence",
    "created_at",
    "updated_at",
  ];

  for (const field of requiredStringFields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`Seed fixture item ${index}.${field} must be a non-empty string`);
    }
  }

  if (!Array.isArray(value.risk_tags) || !Array.isArray(value.evidence) || !Array.isArray(value.context)) {
    throw new Error(`Seed fixture item ${index} must include array risk_tags, evidence, and context`);
  }

  if (!isRecord(value.recommended_action) || !Array.isArray(value.alternate_actions)) {
    throw new Error(`Seed fixture item ${index} must include recommended_action and alternate_actions`);
  }

  return value as ReviewPacket;
}

function createReviewPacketFromEvent(
  event: McpEvent,
  evidence: EvidenceRef[],
  timestamp: string,
  routeDecision: RouteDecision,
): ReviewPacket {
  const stableEventId = stableId(event.id);
  const taskId = taskIdForHint(event.task_hint);
  const recommendedAction: Action = {
    id: `act_${stableEventId}_review`,
    type: "resume_agent",
    label: "Route to task agent",
    requires_confirmation: true,
    side_effect: "local",
    payload: {
      event_id: event.id,
      task_hint: event.task_hint,
      project_hint: event.project_hint,
      route_decision_id: routeDecision.id,
    },
  };

  return {
    id: `pkt_${stableEventId}`,
    task_id: taskId,
    title: `Review ${event.title}`,
    summary: event.summary || event.title,
    decision_needed: decisionNeededForRoute(routeDecision),
    risk_level: "medium",
    confidence: routeDecision.confidence,
    risk_tags: ["external_send"],
    evidence,
    context: event.resources.map(resourceFromEvent),
    recommended_action: recommendedAction,
    alternate_actions: [
      {
        id: `act_${stableEventId}_done`,
        type: "mark_done",
        label: "Ignore for now",
        requires_confirmation: false,
        side_effect: "none",
        payload: {
          event_id: event.id,
        },
      },
    ],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function evidenceForEvent(event: McpEvent): EvidenceRef[] {
  return [
    {
      id: `ev_${stableId(event.id)}_raw`,
      kind: "raw",
      title: "Source event",
      url: event.raw_ref.uri,
    },
  ];
}

function routeActionForEvent(event: McpEvent): RouteDecision["action"] {
  if (event.type === "browser.context_captured") {
    if (event.task_hint) return "attach_to_task";
    return "store_only";
  }

  if (event.type === "browser.review_requested" || event.type === "manual.review_requested") {
    return "ask_human_now";
  }

  return "ask_human_now";
}

function routeConfidenceForEvent(event: McpEvent, action: RouteDecision["action"]): RouteDecision["confidence"] {
  if (action === "store_only" && event.type === "browser.context_captured") return "high";
  if (event.task_hint || event.project_hint) return "medium";
  return "low";
}

export function taskIdForHint(taskHint: string | undefined): string | undefined {
  return taskHint ? `task_${stableId(taskHint)}` : undefined;
}

function eventMatchesContextQuery(event: McpEvent, query: ContextQuery): boolean {
  if (query.source && event.source !== query.source) return false;
  if (query.task_id && taskIdForHint(event.task_hint) !== query.task_id) return false;
  return true;
}

export function contextEntryMatchesQuery(entry: ContextEntry, query: ContextQuery): boolean {
  if (!query.q) return true;
  const needle = query.q.toLowerCase();
  const searchText = contextEntrySearchText(entry).toLowerCase();
  if (searchText.includes(needle)) return true;
  const terms = contextQueryTerms(needle);
  return terms.length > 0 && terms.every((term) => searchText.includes(term));
}

export function rankContextEntries(entries: ContextEntry[], query: ContextQuery = {}): ContextEntry[] {
  return entries
    .map((entry) => scoreContextEntry(entry, query))
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }
      return right.captured_at.localeCompare(left.captured_at);
    });
}

function scoreContextEntry(entry: ContextEntry, query: ContextQuery): ContextEntry {
  const reasons: string[] = [];
  let score = 0;

  if (query.task_id && entry.task_id === query.task_id) {
    score += 100;
    reasons.push("task_match");
  }

  const normalizedQuery = query.q?.toLowerCase();
  if (normalizedQuery) {
    const resource = entry.resource;
    const title = `${entry.event_title}\n${typeof resource.title === "string" ? resource.title : ""}`.toLowerCase();
    const url = typeof resource.url === "string" ? resource.url.toLowerCase() : "";
    const textQuote = typeof resource.text_quote === "string" ? resource.text_quote.toLowerCase() : "";
    const searchText = contextEntrySearchText(entry).toLowerCase();
    const terms = contextQueryTerms(normalizedQuery);

    if (title.includes(normalizedQuery)) {
      score += 60;
      reasons.push("title_phrase");
    }
    if (textQuote.includes(normalizedQuery)) {
      score += 40;
      reasons.push("quote_phrase");
    }
    if (url.includes(normalizedQuery)) {
      score += 30;
      reasons.push("url_phrase");
    }

    const matchingTerms = terms.filter((term) => searchText.includes(term));
    if (matchingTerms.length > 0) {
      score += matchingTerms.length * 10;
      reasons.push("term_match");
    }
  } else {
    reasons.push("recent");
  }

  return {
    ...entry,
    relevance_score: score,
    match_reasons: [...new Set(reasons)],
  };
}

function contextEntrySearchText(entry: ContextEntry): string {
  return [
    entry.event_id,
    entry.event_title,
    entry.event_source,
    entry.task_id,
    ...resourceSearchParts(entry.resource),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
}

function resourceSearchParts(resource: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const key of ["id", "kind", "title", "url", "source", "text_quote", "selector_hint"]) {
    const value = resource[key];
    if (typeof value === "string") parts.push(value);
  }
  const details = resource.details;
  if (details && typeof details === "object") {
    parts.push(JSON.stringify(details));
  }
  return parts;
}

function contextQueryTerms(normalizedQuery: string): string[] {
  return normalizedQuery.split(/\s+/).filter(Boolean);
}

export function contextEntriesForResult(result: StoredEventResult): ContextEntry[] {
  return result.event.resources.map((resource): ContextEntry => {
    const capturedAt = typeof resource.captured_at === "string" && resource.captured_at
      ? resource.captured_at
      : result.event.received_at;

    return {
      event_id: result.event.id,
      event_title: result.event.title,
      event_source: result.event.source,
      task_id: taskIdForHint(result.event.task_hint),
      route_decision: result.route_decision,
      resource,
      captured_at: capturedAt,
      relevance_score: 0,
      match_reasons: [],
    };
  });
}

function decisionNeededForRoute(routeDecision: RouteDecision): string {
  if (routeDecision.action === "create_review_packet") {
    return "Review prepared work and decide next action.";
  }
  return "Decide whether to route this new event into a task agent now.";
}

function resourceFromEvent(resource: Record<string, unknown>): ContextResource {
  const id = typeof resource.id === "string" && resource.id ? resource.id : "ctx_unknown";
  const kind = typeof resource.kind === "string" && resource.kind ? resource.kind : "url";
  const title = typeof resource.title === "string" && resource.title ? resource.title : "Source context";
  const restoreConfidence = resource.restore_confidence;

  return {
    ...resource,
    id,
    kind,
    title,
    restore_confidence:
      restoreConfidence === "high" || restoreConfidence === "medium" || restoreConfidence === "low"
        ? restoreConfidence
        : "medium",
  } as ContextResource;
}

function scoreEventPriority(event: McpEvent): number {
  let score = 500;
  if (event.task_hint) score += 200;
  if (event.project_hint) score += 100;
  if (event.source === "slack") score += 100;
  return score;
}

function priorityReasonsForEvent(event: McpEvent): string[] {
  return [
    "new_background_event",
    event.source === "slack" ? "slack_message" : `${event.source}_event`,
    event.task_hint ? "task_hint_present" : "needs_routing",
  ];
}

function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function eventIdempotencyKey(source: string, idempotencyKey: string): string {
  return `${source}:${idempotencyKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
