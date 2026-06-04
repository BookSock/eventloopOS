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
  windowWorkspaceObservations?: Map<string, WindowWorkspaceObservationRecord>;
  followsWindowExclusions?: Map<string, FollowsWindowExclusionRecord>;
  taskWindowClaims?: Map<string, TaskWindowClaimRecord>;
  paperTriggers?: Map<string, PaperTriggerRecord>;
  paperTriggerFirings?: Map<string, true>;
};

export type TaskAnchorKind = "codex_thread" | "ghostty_window";

export type PaperTriggerRecord = {
  trigger_id: string;
  task_id: string;
  name: string;
  match_event_type: string;
  match_source_id_pattern?: string;
  match_body_substring?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_fired_at?: string;
};

export type PaperTriggerCreateInput = {
  task_id: string;
  name: string;
  match_event_type: string;
  match_source_id_pattern?: string;
  match_body_substring?: string;
  enabled?: boolean;
};

export type PaperTriggerPatch = {
  name?: string;
  match_event_type?: string;
  match_source_id_pattern?: string | null;
  match_body_substring?: string | null;
  enabled?: boolean;
};

export type TaskRecord = {
  task_id: string;
  primary_anchor_kind: TaskAnchorKind;
  primary_anchor_id: string;
  aerospace_workspace_id?: string;
  created_at: string;
  updated_at: string;
  last_paper_emitted_at?: string;
  dormant_at?: string;
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

export type WindowWorkspaceObservationRecord = {
  window_id: string;
  workspace_id: string;
  is_task_workspace: boolean;
  first_seen_at: string;
  last_seen_at: string;
  app_bundle?: string;
  title_prefix?: string;
};

export type FollowsWindowRecord = {
  window_id: string;
  known_workspaces: string[];
  app_bundle?: string;
  title_prefix?: string;
  slot_window_ids?: string[];
};

export type FollowsWindowExclusionRecord = {
  exclusion_id: string;
  app_bundle?: string;
  title_substring?: string;
  created_at: string;
};

export type TaskWindowClaimRecord = {
  claim_id: string;
  task_id: string;
  window_id?: string;
  app_bundle?: string;
  title_prefix?: string;
  process_root_pid?: number;
  source?: string;
  created_at: string;
  expires_at?: string;
};

export const FOLLOWS_TITLE_PREFIX_MAX_LEN = 40;

export function normalizeTitlePrefix(title: string | undefined | null): string | undefined {
  if (typeof title !== "string") return undefined;
  const trimmed = title.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, FOLLOWS_TITLE_PREFIX_MAX_LEN);
}

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

export function recordWindowWorkspaceObservation(
  store: InMemoryStore,
  input: {
    windowId: string;
    workspaceId: string;
    isTaskWorkspace: boolean;
    observedAt: Date;
    appBundle?: string;
    titlePrefix?: string;
  },
): WindowWorkspaceObservationRecord {
  const observations = store.windowWorkspaceObservations ?? new Map<string, WindowWorkspaceObservationRecord>();
  store.windowWorkspaceObservations = observations;
  const key = observationKey(input.windowId, input.workspaceId);
  const timestamp = input.observedAt.toISOString();
  const existing = observations.get(key);
  const appBundle = input.appBundle !== undefined && input.appBundle.length > 0 ? input.appBundle : undefined;
  const titlePrefix = input.titlePrefix !== undefined && input.titlePrefix.length > 0 ? input.titlePrefix : undefined;
  const record: WindowWorkspaceObservationRecord = existing
    ? {
        ...existing,
        is_task_workspace: existing.is_task_workspace || input.isTaskWorkspace,
        last_seen_at: timestamp,
        app_bundle: appBundle ?? existing.app_bundle,
        title_prefix: titlePrefix ?? existing.title_prefix,
      }
    : {
        window_id: input.windowId,
        workspace_id: input.workspaceId,
        is_task_workspace: input.isTaskWorkspace,
        first_seen_at: timestamp,
        last_seen_at: timestamp,
        app_bundle: appBundle,
        title_prefix: titlePrefix,
      };
  observations.set(key, record);
  return record;
}

export function listFollowsWindows(
  store: InMemoryStore,
  options: { now: Date; ttlMs: number; minWorkspaceCount?: number },
): FollowsWindowRecord[] {
  const observations = store.windowWorkspaceObservations;
  if (!observations) return [];
  const cutoff = options.now.getTime() - options.ttlMs;
  const minWorkspaceCount = Math.max(2, Math.floor(options.minWorkspaceCount ?? 3));
  const exclusions = [...(store.followsWindowExclusions?.values() ?? [])];

  type WindowGroup = { workspaces: Set<string>; lastSeenMs: number };
  const windowGroups = new Map<string, WindowGroup>();

  type SlotGroup = {
    app_bundle: string;
    title_prefix: string;
    workspaces: Set<string>;
    windowIds: Map<string, number>;
  };
  const slotGroups = new Map<string, SlotGroup>();

  for (const record of observations.values()) {
    if (!record.is_task_workspace) continue;
    const lastSeenMs = Date.parse(record.last_seen_at);
    if (lastSeenMs < cutoff) continue;
    const wg = windowGroups.get(record.window_id) ?? { workspaces: new Set<string>(), lastSeenMs: 0 };
    wg.workspaces.add(record.workspace_id);
    if (lastSeenMs > wg.lastSeenMs) wg.lastSeenMs = lastSeenMs;
    windowGroups.set(record.window_id, wg);

    if (record.app_bundle && record.title_prefix) {
      const slotKey = `${record.app_bundle} ${record.title_prefix}`;
      const sg = slotGroups.get(slotKey) ?? {
        app_bundle: record.app_bundle,
        title_prefix: record.title_prefix,
        workspaces: new Set<string>(),
        windowIds: new Map<string, number>(),
      };
      sg.workspaces.add(record.workspace_id);
      const prior = sg.windowIds.get(record.window_id) ?? 0;
      if (lastSeenMs > prior) sg.windowIds.set(record.window_id, lastSeenMs);
      slotGroups.set(slotKey, sg);
    }
  }

  const emittedWindowIds = new Set<string>();
  const result: FollowsWindowRecord[] = [];

  for (const [slotKey, sg] of slotGroups.entries()) {
    if (sg.workspaces.size < minWorkspaceCount) continue;
    if (isFollowsExcluded({ app_bundle: sg.app_bundle, title_prefix: sg.title_prefix }, exclusions)) continue;
    let currentWindowId: string | undefined;
    let currentLastSeen = -1;
    for (const [winId, lastSeen] of sg.windowIds.entries()) {
      if (lastSeen > currentLastSeen) {
        currentLastSeen = lastSeen;
        currentWindowId = winId;
      }
    }
    if (!currentWindowId) continue;
    const slotWindowIds = Array.from(sg.windowIds.keys()).sort();
    result.push({
      window_id: currentWindowId,
      known_workspaces: Array.from(sg.workspaces).sort(),
      app_bundle: sg.app_bundle,
      title_prefix: sg.title_prefix,
      slot_window_ids: slotWindowIds,
    });
    for (const winId of slotWindowIds) emittedWindowIds.add(winId);
    void slotKey;
  }

  for (const [windowId, wg] of windowGroups.entries()) {
    if (wg.workspaces.size < minWorkspaceCount) continue;
    if (emittedWindowIds.has(windowId)) continue;
    result.push({
      window_id: windowId,
      known_workspaces: Array.from(wg.workspaces).sort(),
    });
    emittedWindowIds.add(windowId);
  }

  result.sort((a, b) => a.window_id.localeCompare(b.window_id));
  return result;
}

export function addFollowsWindowExclusion(
  store: InMemoryStore,
  input: { appBundle?: string; titleSubstring?: string; now: Date },
): FollowsWindowExclusionRecord {
  const exclusions = store.followsWindowExclusions ?? new Map<string, FollowsWindowExclusionRecord>();
  store.followsWindowExclusions = exclusions;
  const appBundle = normalizeOptionalText(input.appBundle)?.toLowerCase();
  const titleSubstring = normalizeOptionalText(input.titleSubstring)?.toLowerCase();
  const key = `${appBundle ?? ""}\0${titleSubstring ?? ""}`;
  const existing = exclusions.get(key);
  if (existing) return existing;
  const record: FollowsWindowExclusionRecord = {
    exclusion_id: `fwex_${stableId(key)}`,
    app_bundle: appBundle,
    title_substring: titleSubstring,
    created_at: input.now.toISOString(),
  };
  exclusions.set(key, record);
  return record;
}

export function claimTaskWindow(
  store: InMemoryStore,
  input: {
    taskId: string;
    windowId?: string;
    appBundle?: string;
    titlePrefix?: string;
    processRootPid?: number;
    source?: string;
    now: Date;
    ttlMs?: number;
  },
): TaskWindowClaimRecord {
  const claims = store.taskWindowClaims ?? new Map<string, TaskWindowClaimRecord>();
  store.taskWindowClaims = claims;
  const windowId = normalizeOptionalText(input.windowId);
  const appBundle = normalizeOptionalText(input.appBundle)?.toLowerCase();
  const titlePrefix = normalizeTitlePrefix(input.titlePrefix);
  const processRootPid = normalizeOptionalPositiveInteger(input.processRootPid);
  if (!windowId && !appBundle && !titlePrefix && processRootPid === undefined) {
    throw new Error("task window claim needs windowId, appBundle, titlePrefix, or processRootPid");
  }
  const key = taskWindowClaimKey(input.taskId, windowId, appBundle, titlePrefix, processRootPid);
  const timestamp = input.now.toISOString();
  const expiresAt = input.ttlMs && input.ttlMs > 0 ? new Date(input.now.getTime() + input.ttlMs).toISOString() : undefined;
  const record: TaskWindowClaimRecord = {
    claim_id: `twc_${stableId(key)}`,
    task_id: input.taskId,
    window_id: windowId,
    app_bundle: appBundle,
    title_prefix: titlePrefix,
    process_root_pid: processRootPid,
    source: normalizeOptionalText(input.source),
    created_at: timestamp,
    expires_at: expiresAt,
  };
  claims.set(record.claim_id, record);
  return record;
}

export function listTaskWindowClaims(
  store: InMemoryStore,
  input: { now: Date; taskId?: string },
): TaskWindowClaimRecord[] {
  const claims = store.taskWindowClaims;
  if (!claims) return [];
  const nowMs = input.now.getTime();
  return [...claims.values()]
    .filter((claim) => !input.taskId || claim.task_id === input.taskId)
    .filter((claim) => !claim.expires_at || Date.parse(claim.expires_at) >= nowMs)
    .sort((a, b) => a.claim_id.localeCompare(b.claim_id));
}

function isFollowsExcluded(
  window: { app_bundle?: string; title_prefix?: string },
  exclusions: FollowsWindowExclusionRecord[],
): boolean {
  const appBundle = window.app_bundle?.toLowerCase();
  const titlePrefix = window.title_prefix?.toLowerCase();
  return exclusions.some((exclusion) => {
    const appMatches = !exclusion.app_bundle || exclusion.app_bundle === appBundle;
    const titleMatches = !exclusion.title_substring || titlePrefix?.includes(exclusion.title_substring);
    return appMatches && titleMatches;
  });
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function pruneWindowWorkspaceObservations(
  store: InMemoryStore,
  olderThan: Date,
): number {
  const observations = store.windowWorkspaceObservations;
  if (!observations) return 0;
  const cutoff = olderThan.getTime();
  let removed = 0;
  for (const [key, record] of observations.entries()) {
    if (Date.parse(record.last_seen_at) < cutoff) {
      observations.delete(key);
      removed += 1;
    }
  }
  return removed;
}

function observationKey(windowId: string, workspaceId: string): string {
  return `${windowId} ${workspaceId}`;
}

function taskWindowClaimKey(
  taskId: string,
  windowId?: string,
  appBundle?: string,
  titlePrefix?: string,
  processRootPid?: number,
): string {
  return `${taskId} ${windowId ?? ""} ${appBundle ?? ""} ${titlePrefix ?? ""} ${processRootPid ?? ""}`;
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

  if (event.task_hint && eventHasTaskWindowResource(event)) {
    return "attach_to_task";
  }

  return "ask_human_now";
}

function eventHasTaskWindowResource(event: McpEvent): boolean {
  return event.resources.some((resource) => {
    if (!isRecord(resource)) return false;
    const kind = typeof resource.kind === "string" ? resource.kind : undefined;
    if (
      kind === "app_window"
      || kind === "aerospace_window"
      || kind === "window"
      || kind === "spawned_window"
    ) {
      return true;
    }
    return typeof resource.window_id === "string"
      || typeof resource.aerospace_window_id === "string"
      || typeof resource.app_bundle === "string"
      || typeof resource.bundle_id === "string";
  });
}

function routeConfidenceForEvent(event: McpEvent, action: RouteDecision["action"]): RouteDecision["confidence"] {
  if (action === "store_only" && event.type === "browser.context_captured") return "high";
  if (action === "attach_to_task" && eventHasTaskWindowResource(event)) return "high";
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

export function createPaperTrigger(
  store: InMemoryStore,
  input: PaperTriggerCreateInput,
  now: Date,
): PaperTriggerRecord {
  const triggers = store.paperTriggers ?? new Map<string, PaperTriggerRecord>();
  store.paperTriggers = triggers;
  const timestamp = now.toISOString();
  const triggerId = `trg_${stableId(`${input.task_id}_${input.name}_${timestamp}_${triggers.size}`)}`;
  const record: PaperTriggerRecord = {
    trigger_id: triggerId,
    task_id: input.task_id,
    name: input.name,
    match_event_type: input.match_event_type,
    match_source_id_pattern: input.match_source_id_pattern,
    match_body_substring: input.match_body_substring,
    enabled: input.enabled ?? true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  triggers.set(triggerId, record);
  return { ...record };
}

export function listPaperTriggers(
  store: InMemoryStore,
  filter?: { task_id?: string; only_enabled?: boolean },
): PaperTriggerRecord[] {
  const triggers = store.paperTriggers;
  if (!triggers) return [];
  return Array.from(triggers.values())
    .filter((record) => {
      if (filter?.task_id && record.task_id !== filter.task_id) return false;
      if (filter?.only_enabled && !record.enabled) return false;
      return true;
    })
    .map((record) => ({ ...record }))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function getPaperTrigger(store: InMemoryStore, triggerId: string): PaperTriggerRecord | undefined {
  const record = store.paperTriggers?.get(triggerId);
  return record ? { ...record } : undefined;
}

export function updatePaperTrigger(
  store: InMemoryStore,
  triggerId: string,
  patch: PaperTriggerPatch,
  now: Date,
): PaperTriggerRecord | undefined {
  const triggers = store.paperTriggers;
  if (!triggers) return undefined;
  const existing = triggers.get(triggerId);
  if (!existing) return undefined;
  const next: PaperTriggerRecord = {
    ...existing,
    name: patch.name ?? existing.name,
    match_event_type: patch.match_event_type ?? existing.match_event_type,
    match_source_id_pattern:
      patch.match_source_id_pattern === null
        ? undefined
        : patch.match_source_id_pattern ?? existing.match_source_id_pattern,
    match_body_substring:
      patch.match_body_substring === null
        ? undefined
        : patch.match_body_substring ?? existing.match_body_substring,
    enabled: patch.enabled ?? existing.enabled,
    updated_at: now.toISOString(),
  };
  triggers.set(triggerId, next);
  return { ...next };
}

export function deletePaperTrigger(store: InMemoryStore, triggerId: string): PaperTriggerRecord | undefined {
  const triggers = store.paperTriggers;
  if (!triggers) return undefined;
  const existing = triggers.get(triggerId);
  if (!existing) return undefined;
  triggers.delete(triggerId);
  // Also remove related firing dedupes.
  const firings = store.paperTriggerFirings;
  if (firings) {
    const prefix = `${triggerId}:`;
    for (const key of firings.keys()) {
      if (key.startsWith(prefix)) firings.delete(key);
    }
  }
  return { ...existing };
}

export function recordPaperTriggerFired(
  store: InMemoryStore,
  triggerId: string,
  at: Date,
): PaperTriggerRecord | undefined {
  const triggers = store.paperTriggers;
  if (!triggers) return undefined;
  const existing = triggers.get(triggerId);
  if (!existing) return undefined;
  const timestamp = at.toISOString();
  const next: PaperTriggerRecord = { ...existing, last_fired_at: timestamp, updated_at: timestamp };
  triggers.set(triggerId, next);
  return { ...next };
}

export function tryRegisterPaperTriggerFiring(
  store: InMemoryStore,
  triggerId: string,
  dedupeKey: string,
): boolean {
  const firings = store.paperTriggerFirings ?? new Map<string, true>();
  store.paperTriggerFirings = firings;
  const key = `${triggerId}:${dedupeKey}`;
  if (firings.has(key)) return false;
  firings.set(key, true);
  return true;
}
