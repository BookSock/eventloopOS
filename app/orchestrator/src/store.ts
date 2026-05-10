import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Action,
  AgentRun,
  AgentRunQueueResult,
  ContextResource,
  EvidenceRef,
  QueueItem,
  QueueItemWithPacket,
  QueueState,
  ReviewPacket,
  WorkspaceSnapshot,
} from "./contracts.js";
import type { McpPollStateSnapshot } from "./integrations/mcp_poll/persistent_cursor_store.js";
import type { McpEvent } from "./integrations/mcp_poll/types.js";
import { findPromptInjectionPattern } from "./hooks/evaluator.js";
import type { DurableTaskMessageRecord } from "./task_sessions/task_message_history.js";
import type { WorkspaceRestoreReceiptRecord } from "./workspace/restore_receipts.js";
import {
  contextEntriesForResult,
  contextEntryMatchesQuery,
  listContextEntries,
  rankContextEntries,
  resourceSearchParts,
  type ContextEntry,
  type ContextQuery,
} from "./store/context_entries.js";
import {
  claimNextContextRestoreRequest,
  createContextRestoreRequest,
  getContextRestoreRequest,
  markContextRestoreRequestDone,
  markContextRestoreRequestFailed,
  peekNextContextRestoreRequest,
  reapExpiredContextRestoreRequestLeases,
  retryContextRestoreRequest,
  type ContextRestoreRequestRecord,
  type ContextRestoreRequestStatus,
} from "./store/context_restore_store.js";
import { eventIdempotencyKey, stableId, taskIdForHint } from "./store/ids.js";

export {
  contextEntriesForResult,
  contextEntryMatchesQuery,
  listContextEntries,
  rankContextEntries,
  type ContextEntry,
  type ContextQuery,
} from "./store/context_entries.js";
export {
  claimNextContextRestoreRequest,
  createContextRestoreRequest,
  getContextRestoreRequest,
  markContextRestoreRequestDone,
  markContextRestoreRequestFailed,
  peekNextContextRestoreRequest,
  reapExpiredContextRestoreRequestLeases,
  retryContextRestoreRequest,
  type ContextRestoreRequestRecord,
  type ContextRestoreRequestStatus,
} from "./store/context_restore_store.js";
export { taskIdForHint } from "./store/ids.js";

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
  agentRuns?: Map<string, AgentRun>;
  workspaceRestoreReceipts?: Map<string, WorkspaceRestoreReceiptRecord>;
  mcpPollStates?: Map<string, McpPollStateSnapshot>;
  taskMessagesByIdempotencyKey?: Map<string, DurableTaskMessageRecord>;
  taskWorkspaceSnapshots?: Map<string, TaskWorkspaceSnapshotRecord>;
  queueActionAttempts?: Map<string, StoredActionAttempt>;
  taskSessionTerminalRefs?: Map<string, TaskSessionTerminalRefRecord>;
  onboardingRejections?: Map<string, OnboardingRejectionRecord>;
  onboardingApprovalBatches?: Map<string, OnboardingApprovalBatchRecord>;
  manualModeState?: { value: ManualModeStateRecord };
  tasks?: Map<string, TaskRecord>;
  taskLayouts?: Map<string, TaskLayoutRecord>;
  currentTaskState?: { value: CurrentTaskStateRecord };
};

export type TaskAnchorKind = "codex_thread" | "ghostty_window";

export type TaskRecord = {
  task_id: string;
  primary_anchor_kind: TaskAnchorKind;
  primary_anchor_id: string;
  aerospace_workspace_id?: string;
  created_at: string;
  updated_at: string;
  last_paper_emitted_at?: string;
  auto_paper_idle_seconds: number;
};

export type TaskLayoutRecord = {
  task_id: string;
  layout: WorkspaceSnapshot;
  updated_at: string;
};

export type CurrentTaskStateRecord = {
  current_task_id: string | null;
  entered_at?: string;
  updated_at: string;
};

export type ManualModeStateRecord = {
  active: boolean;
  entered_at?: string;
  reason?: string;
  updated_at: string;
};

export type TaskSessionTerminalRefRecord = {
  task_session_id: string;
  terminal_ref: string;
  created_at: string;
  updated_at: string;
};

export type OnboardingRejectionRecord = {
  proposal_key: string;
  reason?: string;
  rejected_at: string;
};

export type OnboardingApprovalBatchRecord = {
  idempotency_key: string;
  results: Array<Record<string, unknown>>;
  created_at: string;
};

export type StoredActionAttempt = {
  idempotency_key: string;
  queue_item_id: string;
  terminal_send_ok: boolean;
  completed: boolean;
  action_result?: Record<string, unknown>;
  terminal_send_result?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type TaskWorkspaceSnapshotRecord = {
  task_id: string;
  snapshot: WorkspaceSnapshot;
  captured_at: string;
  updated_at: string;
  source_queue_item_id?: string;
  actor_id?: string;
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
  human_queue_reason?: "human_blocked" | "ambiguous" | "risky";
  evidence: EvidenceRef[];
  created_at: string;
};

export type StoredEventResult = {
  event: McpEvent;
  route_decision: RouteDecision;
  review_packet?: ReviewPacket;
  queue_item?: QueueItemWithPacket;
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

export function listQueue(store: InMemoryStore, state?: QueueState): QueueItemWithPacket[] {
  const visibleStates = state ? [state] : ["ready", "leased"];
  return store.queue
    .filter((item) => visibleStates.includes(item.state))
    .sort((left, right) => {
      if (right.priority_score !== left.priority_score) {
        return right.priority_score - left.priority_score;
      }

      return left.created_at.localeCompare(right.created_at);
    })
    .map((item) => attachPacket(store, item));
}

export function nextQueueItem(store: InMemoryStore, now = new Date()): QueueItemWithPacket | undefined {
  reapDueDeferredItems(store, now);
  return listQueue(store).find((item) => item.state === "ready" && isQueueItemDue(item, now));
}

export function leaseNextQueueItem(
  store: InMemoryStore,
  leaseOwner: string,
  now: Date,
  leaseMs = 60_000,
  excludeQueueItemId?: string,
): QueueItemWithPacket | undefined {
  reapExpiredLeases(store, now);
  reapDueDeferredItems(store, now);
  const item = store.queue
    .filter((candidate) => candidate.state === "ready" && candidate.id !== excludeQueueItemId && isQueueItemDue(candidate, now))
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

export function deferQueueItem(
  store: InMemoryStore,
  queueItemId: string,
  dueAt: Date,
  now: Date,
): QueueItemWithPacket | undefined {
  const item = store.queue.find((candidate) => candidate.id === queueItemId);
  if (!item) return undefined;

  item.state = "deferred";
  item.due_at = dueAt.toISOString();
  item.lease_owner = undefined;
  item.lease_expires_at = undefined;
  item.updated_at = now.toISOString();
  return attachPacket(store, item);
}

export function ignoreQueueItem(
  store: InMemoryStore,
  queueItemId: string,
  now: Date,
): QueueItemWithPacket | undefined {
  const item = store.queue.find((candidate) => candidate.id === queueItemId);
  if (!item) return undefined;

  item.state = "dead";
  item.lease_owner = undefined;
  item.lease_expires_at = undefined;
  item.updated_at = now.toISOString();
  return attachPacket(store, item);
}

export function bumpQueueItemPriority(
  store: InMemoryStore,
  queueItemId: string,
  input: { delta?: number; score?: number; reason?: string },
  now: Date,
): QueueItemWithPacket | undefined {
  const item = store.queue.find((candidate) => candidate.id === queueItemId);
  if (!item) return undefined;
  const before = item.priority_score;
  const next = typeof input.score === "number" && Number.isFinite(input.score)
    ? Math.round(input.score)
    : before + Math.round(input.delta ?? 0);
  item.priority_score = Math.max(0, Math.min(10_000, next));
  if (item.priority_score !== before) {
    const reasonTag = input.reason ?? "manual_priority_bump";
    if (!item.priority_reasons.includes(reasonTag)) {
      item.priority_reasons = [...item.priority_reasons, reasonTag];
    }
    item.updated_at = now.toISOString();
  }
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

export function reapDueDeferredItems(store: InMemoryStore, now: Date): number {
  let reaped = 0;
  for (const item of store.queue) {
    if (item.state !== "deferred" || !item.due_at) continue;
    if (new Date(item.due_at).getTime() > now.getTime()) continue;

    item.state = "ready";
    item.updated_at = now.toISOString();
    reaped += 1;
  }
  return reaped;
}

export function getReviewPacket(store: InMemoryStore, id: string): ReviewPacket | undefined {
  return store.reviewPackets.get(id);
}

export function getAgentRun(store: InMemoryStore, id: string): AgentRun | undefined {
  return store.agentRuns?.get(id);
}

export function upsertAgentRun(store: InMemoryStore, run: AgentRun, now: Date): AgentRunQueueResult {
  const agentRuns = store.agentRuns ?? new Map<string, AgentRun>();
  store.agentRuns = agentRuns;
  const existing = agentRuns.get(run.id);
  const normalizedRun = {
    ...existing,
    ...run,
    risk_tags: run.risk_tags ?? existing?.risk_tags ?? [],
    evidence: run.evidence ?? existing?.evidence ?? [],
    output_refs: run.output_refs ?? existing?.output_refs ?? [],
    resume_actions: run.resume_actions ?? existing?.resume_actions ?? [],
  };
  agentRuns.set(run.id, normalizedRun);

  if (normalizedRun.status !== "waiting_approval" && normalizedRun.status !== "blocked") {
    clearAgentRunQueueItem(store, normalizedRun.id, now.toISOString());
    return { agent_run: normalizedRun };
  }

  const createdAt = existingReviewPacketCreatedAt(store, normalizedRun.id) ?? now.toISOString();
  const packet = buildReviewPacketFromAgentRun(normalizedRun, createdAt, now.toISOString());
  store.reviewPackets.set(packet.id, packet);

  const existingQueueItem = store.queue.find((item) => item.review_packet_id === packet.id);
  if (existingQueueItem) {
    reactivateAgentRunQueueItem(existingQueueItem, normalizedRun, packet, now.toISOString());
    existingQueueItem.updated_at = now.toISOString();
    return {
      agent_run: normalizedRun,
      review_packet: packet,
      queue_item: attachPacket(store, existingQueueItem),
      queue_item_created: false,
    };
  }

  const queueItem = buildQueueItemFromAgentRun(normalizedRun, packet, now.toISOString());
  store.queue.push(queueItem);
  return {
    agent_run: normalizedRun,
    review_packet: packet,
    queue_item: attachPacket(store, queueItem),
    queue_item_created: true,
  };
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

export function getLatestTaskWorkspaceSnapshot(store: InMemoryStore, taskId: string): TaskWorkspaceSnapshotRecord | undefined {
  return store.taskWorkspaceSnapshots?.get(taskId);
}

export function saveTaskWorkspaceSnapshot(
  store: InMemoryStore,
  input: {
    taskId: string;
    snapshot: WorkspaceSnapshot;
    capturedAt: Date;
    sourceQueueItemId?: string;
    actorId?: string;
  },
): TaskWorkspaceSnapshotRecord {
  const snapshots = store.taskWorkspaceSnapshots ?? new Map<string, TaskWorkspaceSnapshotRecord>();
  store.taskWorkspaceSnapshots = snapshots;
  const timestamp = input.capturedAt.toISOString();
  const record: TaskWorkspaceSnapshotRecord = {
    task_id: input.taskId,
    snapshot: input.snapshot,
    captured_at: timestamp,
    updated_at: timestamp,
    source_queue_item_id: input.sourceQueueItemId,
    actor_id: input.actorId,
  };
  snapshots.set(input.taskId, record);
  return record;
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
  const confidence = routeConfidenceForEvent(event, action);

  return {
    id: `rte_${stableId(event.id)}`,
    event_id: event.id,
    action,
    target_task_id: targetTaskId,
    confidence,
    human_queue_reason: humanQueueReasonForEvent(event, action, targetTaskId),
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
  const isOnboardingWorkbenchPaper = event.source === "onboarding" && event.type === "manual.review_requested";
  const recommendedAction: Action = {
    id: `act_${stableEventId}_review`,
    type: isOnboardingWorkbenchPaper ? "mark_done" : "resume_agent",
    label: isOnboardingWorkbenchPaper ? "Work this paper, then Done / Next" : "Route to task agent",
    requires_confirmation: !isOnboardingWorkbenchPaper,
    side_effect: isOnboardingWorkbenchPaper ? "none" : "local",
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
    confidence: isOnboardingWorkbenchPaper ? "high" : routeDecision.confidence,
    risk_tags: isOnboardingWorkbenchPaper ? ["onboarding_workbench"] : ["external_send"],
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

function buildReviewPacketFromAgentRun(run: AgentRun, createdAt: string, updatedAt: string): ReviewPacket {
  const stableRunId = stableId(run.id);
  const evidence = run.evidence.length > 0 ? run.evidence : [
    {
      id: `ev_${stableRunId}_agent_run`,
      kind: "agent_run",
      title: `${agentProviderLabel(run.provider)} run state`,
      url: run.output_refs[0]?.uri,
    },
  ];

  return {
    id: `pkt_${stableRunId}_agent_waiting`,
    task_id: run.task_id,
    agent_run_id: run.id,
    title: `${agentProviderLabel(run.provider)} needs human input`,
    summary: run.blocked_reason ?? `${agentProviderLabel(run.provider)} is ${humanizeRunStatus(run.status)}.`,
    decision_needed: run.status === "blocked"
      ? run.blocked_reason ?? "Unblock this agent run or send followup instructions."
      : "Approve resume action or send followup instructions.",
    risk_level: inferAgentRunRiskLevel(run),
    confidence: "medium",
    risk_tags: run.risk_tags,
    evidence,
    context: [],
    recommended_action: run.resume_actions[0] ?? {
      id: `act_${stableRunId}_resume`,
      type: "resume_agent",
      label: "Resume agent run",
      requires_confirmation: true,
      side_effect: "local",
      payload: {
        agent_run_id: run.id,
        thread_id: run.thread_id,
      },
    },
    alternate_actions: [
      {
        id: `act_${stableRunId}_done`,
        type: "mark_done",
        label: "Mark handled",
        requires_confirmation: false,
        side_effect: "none",
        payload: {
          agent_run_id: run.id,
        },
      },
    ],
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function buildQueueItemFromAgentRun(run: AgentRun, packet: ReviewPacket, timestamp: string): QueueItem {
  const stableRunId = stableId(run.id);
  return {
    id: `qit_${stableRunId}_agent_waiting`,
    review_packet_id: packet.id,
    task_id: run.task_id,
    state: "ready",
    priority_score: run.status === "blocked" ? 850 : 800,
    priority_reasons: ["agent_run_waiting"],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function existingReviewPacketCreatedAt(store: InMemoryStore, agentRunId: string): string | undefined {
  return store.reviewPackets.get(`pkt_${stableId(agentRunId)}_agent_waiting`)?.created_at;
}

function clearAgentRunQueueItem(store: InMemoryStore, agentRunId: string, timestamp: string): void {
  const packetId = `pkt_${stableId(agentRunId)}_agent_waiting`;
  const item = store.queue.find((candidate) => candidate.review_packet_id === packetId);
  if (!item || item.state === "done" || item.state === "dead") return;

  item.state = "done";
  item.lease_owner = undefined;
  item.lease_expires_at = undefined;
  item.due_at = undefined;
  item.updated_at = timestamp;
}

function reactivateAgentRunQueueItem(item: QueueItem, run: AgentRun, packet: ReviewPacket, timestamp: string): void {
  item.task_id = packet.task_id;
  item.state = "ready";
  item.priority_score = run.status === "blocked" ? 850 : 800;
  item.priority_reasons = ["agent_run_waiting"];
  item.due_at = undefined;
  item.lease_owner = undefined;
  item.lease_expires_at = undefined;
  item.updated_at = timestamp;
}

function agentProviderLabel(provider: AgentRun["provider"]): string {
  if (provider === "codex") return "Codex";
  if (provider === "claude") return "Claude Code";
  if (provider === "openai") return "OpenAI";
  if (provider === "manual") return "Manual agent";
  return "Fake agent";
}

function humanizeRunStatus(status: AgentRun["status"]): string {
  return status.replaceAll("_", " ");
}

function inferAgentRunRiskLevel(run: AgentRun): ReviewPacket["risk_level"] {
  if (run.risk_tags.includes("critical")) return "critical";
  if (run.risk_tags.some((tag) => tag === "external_send" || tag === "credential" || tag === "prod")) return "high";
  if (run.evidence.length === 0) return "medium";
  return run.status === "blocked" || run.risk_tags.length > 0 ? "medium" : "low";
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

function humanQueueReasonForEvent(
  event: McpEvent,
  action: RouteDecision["action"],
  targetTaskId: string | undefined,
): RouteDecision["human_queue_reason"] {
  if (action !== "ask_human_now" && action !== "create_review_packet") return undefined;
  if (findPromptInjectionPattern(untrustedRouteTextForEvent(event))) return "risky";
  if (targetTaskId) return "human_blocked";
  return "ambiguous";
}

function untrustedRouteTextForEvent(event: McpEvent): string {
  return [
    event.title,
    event.summary,
    ...event.links.flatMap((link) => [link.label, link.url]),
    ...event.resources.flatMap(resourceSearchParts),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function decisionNeededForRoute(routeDecision: RouteDecision): string {
  if (routeDecision.action === "ask_human_now" && routeDecision.event_id.startsWith("evt_onboarding_queue_")) {
    return "Review this approved workbench. Do the work, send instructions to the agent if needed, then Done / Next.";
  }
  if (routeDecision.action === "create_review_packet") {
    return "Review prepared work and decide next action.";
  }
  if (routeDecision.action === "ask_human_now" && routeDecision.target_task_id) {
    return "Human approval needed before this update is sent back to the task agent.";
  }
  if (routeDecision.action === "ask_human_now") {
    return "No confident task match. Decide whether this event needs a task, can be ignored, or should wait.";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
