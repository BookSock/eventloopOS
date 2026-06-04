import type {
  AgentRun,
  AgentRunQueueResult,
  ContextResource,
  QueueItemWithPacket,
  QueueState,
  ReviewPacket,
  WorkspaceSnapshot,
} from "./contracts.js";
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
  getAgentRun,
  getLatestTaskWorkspaceSnapshot,
  getStoredEvent,
  getStoredEventByIdempotencyKey,
  getContextRestoreRequest,
  bumpQueueItemPriority,
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
  recordWindowWorkspaceObservation,
  listFollowsWindows,
  addFollowsWindowExclusion,
  listFollowsWindowExclusions,
  claimTaskWindow,
  listTaskWindowClaims,
  pruneWindowWorkspaceObservations,
  saveTaskWorkspaceSnapshot,
  upsertAgentRun,
  reapExpiredLeases,
  reapDueDeferredItems,
  retryContextRestoreRequest,
  renewQueueLease,
  createPaperTrigger,
  listPaperTriggers,
  getPaperTrigger,
  updatePaperTrigger,
  deletePaperTrigger,
  recordPaperTriggerFired,
  tryRegisterPaperTriggerFiring,
  type InMemoryStore,
  type ContextEntry,
  type ContextQuery,
  type ContextRestoreRequestRecord,
  type RouteDecision,
  type StoredActionAttempt,
  type StoredEventResult,
  type TaskSessionTerminalRefRecord,
  type TaskWindowClaimRecord,
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
  type PaperTriggerRecord,
  type PaperTriggerCreateInput,
  type PaperTriggerPatch,
} from "./store.js";
import { eventToRecord } from "./db/postgres_queue_store.js";

export type GatewayStore = {
  listQueue(state?: QueueState, now?: Date): Promise<QueueItemWithPacket[]>;
  nextQueueItem(now: Date): Promise<QueueItemWithPacket | undefined>;
  leaseNextQueueItem(leaseOwner: string, now: Date, leaseMs: number, excludeQueueItemId?: string): Promise<QueueItemWithPacket | undefined>;
  renewQueueLease(queueItemId: string, leaseOwner: string, now: Date, leaseMs: number): Promise<QueueItemWithPacket | undefined>;
  markQueueItemDone(queueItemId: string, actorId: string, now: Date): Promise<QueueItemWithPacket | undefined>;
  deferQueueItem(queueItemId: string, actorId: string, dueAt: Date, now: Date): Promise<QueueItemWithPacket | undefined>;
  ignoreQueueItem(queueItemId: string, actorId: string, now: Date): Promise<QueueItemWithPacket | undefined>;
  bumpQueueItemPriority(queueItemId: string, input: { delta?: number; score?: number; reason?: string }, now: Date): Promise<QueueItemWithPacket | undefined>;
  getLatestTaskWorkspaceSnapshot(taskId: string): Promise<TaskWorkspaceSnapshotRecord | undefined>;
  saveTaskWorkspaceSnapshot(input: {
    taskId: string;
    snapshot: WorkspaceSnapshot;
    capturedAt: Date;
    sourceQueueItemId?: string;
    actorId?: string;
  }): Promise<TaskWorkspaceSnapshotRecord>;
  getReviewPacket(id: string): Promise<ReviewPacket | undefined>;
  getAgentRun(id: string): Promise<AgentRun | undefined>;
  upsertAgentRun(run: AgentRun, now: Date): Promise<AgentRunQueueResult>;
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
  getQueueActionAttempt(idempotencyKey: string): Promise<StoredActionAttempt | undefined>;
  recordQueueActionAttempt(input: {
    idempotencyKey: string;
    queueItemId: string;
    now: Date;
  }): Promise<{ existing?: StoredActionAttempt; record: StoredActionAttempt }>;
  markQueueActionTerminalSent(input: {
    idempotencyKey: string;
    terminalSendResult?: Record<string, unknown>;
    now: Date;
  }): Promise<StoredActionAttempt | undefined>;
  markQueueActionCompleted(input: {
    idempotencyKey: string;
    actionResult: Record<string, unknown>;
    now: Date;
  }): Promise<StoredActionAttempt | undefined>;
  getTaskSessionTerminalRef(taskSessionId: string): Promise<TaskSessionTerminalRefRecord | undefined>;
  setTaskSessionTerminalRef(taskSessionId: string, terminalRef: string, now: Date): Promise<TaskSessionTerminalRefRecord>;
  clearTaskSessionTerminalRef(taskSessionId: string): Promise<TaskSessionTerminalRefRecord | undefined>;
  recordOnboardingRejection(proposalKey: string, reason: string | undefined, now: Date): Promise<OnboardingRejectionRecord>;
  listOnboardingRejections(): Promise<OnboardingRejectionRecord[]>;
  clearOnboardingRejection(proposalKey: string): Promise<OnboardingRejectionRecord | undefined>;
  getOnboardingApprovalBatch(idempotencyKey: string): Promise<OnboardingApprovalBatchRecord | undefined>;
  recordOnboardingApprovalBatch(input: {
    idempotencyKey: string;
    results: Array<Record<string, unknown>>;
    now: Date;
  }): Promise<OnboardingApprovalBatchRecord>;
  getManualModeState(): Promise<ManualModeStateRecord>;
  setManualModeActive(active: boolean, reason: string | undefined, now: Date): Promise<ManualModeStateRecord>;
  createTask(input: {
    taskId?: string;
    primaryAnchor: { kind: TaskAnchorKind; id: string };
    capturedLayout: WorkspaceSnapshot;
    autoPaperIdleSeconds?: number;
    aerospaceWorkspaceId?: string;
    now: Date;
  }): Promise<{ task: TaskRecord; layout: TaskLayoutRecord; created: boolean }>;
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  getTaskByAnchor(kind: TaskAnchorKind, id: string): Promise<TaskRecord | undefined>;
  getTasksByWorkspaceId(workspaceId: string): Promise<TaskRecord[]>;
  listTasks(): Promise<TaskRecord[]>;
  getTaskLayout(taskId: string): Promise<TaskLayoutRecord | undefined>;
  updateTaskLayout(taskId: string, layout: WorkspaceSnapshot, now: Date): Promise<TaskRecord | undefined>;
  getCurrentTaskState(): Promise<CurrentTaskStateRecord>;
  setCurrentTaskId(taskId: string | null, now: Date): Promise<CurrentTaskStateRecord>;
  recordTaskPaperEmitted(taskId: string, now: Date): Promise<TaskRecord | undefined>;
  markTaskDormant(taskId: string, dormantAt: Date): Promise<TaskRecord | undefined>;
  wakeTask(taskId: string, now: Date): Promise<TaskRecord | undefined>;
  recordWindowWorkspaceObservation(input: {
    windowId: string;
    workspaceId: string;
    isTaskWorkspace: boolean;
    observedAt: Date;
    appBundle?: string;
    titlePrefix?: string;
  }): Promise<WindowWorkspaceObservationRecord>;
  listFollowsWindows(input: { now: Date; ttlMs: number; minWorkspaceCount?: number }): Promise<FollowsWindowRecord[]>;
  addFollowsWindowExclusion(input: { appBundle?: string; titleSubstring?: string; now: Date }): Promise<FollowsWindowExclusionRecord>;
  listFollowsWindowExclusions(): Promise<FollowsWindowExclusionRecord[]>;
  claimTaskWindow(input: {
    taskId: string;
    windowId?: string;
    appBundle?: string;
    titlePrefix?: string;
    processRootPid?: number;
    source?: string;
    now: Date;
    ttlMs?: number;
  }): Promise<TaskWindowClaimRecord>;
  listTaskWindowClaims(input: { now: Date; taskId?: string }): Promise<TaskWindowClaimRecord[]>;
  pruneWindowWorkspaceObservations(olderThan: Date): Promise<number>;
  createPaperTrigger(input: PaperTriggerCreateInput, now: Date): Promise<PaperTriggerRecord>;
  listPaperTriggers(filter?: { task_id?: string; only_enabled?: boolean }): Promise<PaperTriggerRecord[]>;
  getPaperTrigger(triggerId: string): Promise<PaperTriggerRecord | undefined>;
  updatePaperTrigger(triggerId: string, patch: PaperTriggerPatch, now: Date): Promise<PaperTriggerRecord | undefined>;
  deletePaperTrigger(triggerId: string): Promise<PaperTriggerRecord | undefined>;
  recordPaperTriggerFired(triggerId: string, at: Date): Promise<PaperTriggerRecord | undefined>;
  tryRegisterPaperTriggerFiring(triggerId: string, dedupeKey: string): Promise<boolean>;
};

export function createInMemoryGatewayStore(store: InMemoryStore): GatewayStore {
  const workspaceRestoreReceipts = store.workspaceRestoreReceipts ?? new Map<string, WorkspaceRestoreReceiptRecord>();
  const mcpPollStates = store.mcpPollStates ?? new Map<string, McpPollStateSnapshot>();
  const taskMessagesByIdempotencyKey = store.taskMessagesByIdempotencyKey ?? new Map<string, DurableTaskMessageRecord>();
  const taskWorkspaceSnapshots = store.taskWorkspaceSnapshots ?? new Map<string, TaskWorkspaceSnapshotRecord>();
  const queueActionAttempts = store.queueActionAttempts ?? new Map<string, StoredActionAttempt>();
  const taskSessionTerminalRefs = store.taskSessionTerminalRefs ?? new Map<string, TaskSessionTerminalRefRecord>();
  const onboardingRejections = store.onboardingRejections ?? new Map<string, OnboardingRejectionRecord>();
  const onboardingApprovalBatches = store.onboardingApprovalBatches ?? new Map<string, OnboardingApprovalBatchRecord>();
  const manualModeState = store.manualModeState ?? { value: { active: false, updated_at: new Date(0).toISOString() } as ManualModeStateRecord };
  const tasks = store.tasks ?? new Map<string, TaskRecord>();
  const taskLayouts = store.taskLayouts ?? new Map<string, TaskLayoutRecord>();
  const currentTaskState = store.currentTaskState ?? {
    value: { current_task_id: null, updated_at: new Date(0).toISOString() } as CurrentTaskStateRecord,
  };
  const followsWindowExclusions = store.followsWindowExclusions ?? new Map<string, FollowsWindowExclusionRecord>();
  store.workspaceRestoreReceipts = workspaceRestoreReceipts;
  store.mcpPollStates = mcpPollStates;
  store.taskMessagesByIdempotencyKey = taskMessagesByIdempotencyKey;
  store.taskWorkspaceSnapshots = taskWorkspaceSnapshots;
  store.queueActionAttempts = queueActionAttempts;
  store.taskSessionTerminalRefs = taskSessionTerminalRefs;
  store.onboardingRejections = onboardingRejections;
  store.onboardingApprovalBatches = onboardingApprovalBatches;
  store.manualModeState = manualModeState;
  store.tasks = tasks;
  store.taskLayouts = taskLayouts;
  store.currentTaskState = currentTaskState;
  store.followsWindowExclusions = followsWindowExclusions;

  const snapshotForTask = async (taskId: string) => getLatestTaskWorkspaceSnapshot(store, taskId);
  const contextEntriesForTask = async (taskId: string) => listContextEntries(store, { task_id: taskId, limit: 8 });
  const enrichItem = async (item: QueueItemWithPacket | undefined): Promise<QueueItemWithPacket | undefined> =>
    await enrichQueueItemWithTaskWorkspaceSnapshot(item, snapshotForTask, contextEntriesForTask);
  const enrichItems = async (items: QueueItemWithPacket[]): Promise<QueueItemWithPacket[]> =>
    Promise.all(items.map(enrichItem)).then((enriched) => enriched.filter((item): item is QueueItemWithPacket => item !== undefined));

  return {
    async listQueue(state, now) {
      if (now) reapDueDeferredItems(store, now);
      return enrichItems(listQueue(store, state));
    },
    async nextQueueItem(now) {
      reapExpiredLeases(store, now);
      return enrichItem(nextQueueItem(store, now));
    },
    async leaseNextQueueItem(leaseOwner, now, leaseMs, excludeQueueItemId) {
      return enrichItem(leaseNextQueueItem(store, leaseOwner, now, leaseMs, excludeQueueItemId));
    },
    async renewQueueLease(queueItemId, leaseOwner, now, leaseMs) {
      return enrichItem(renewQueueLease(store, queueItemId, leaseOwner, now, leaseMs));
    },
    async markQueueItemDone(queueItemId, _actorId, now) {
      return enrichItem(markQueueItemDone(store, queueItemId, now));
    },
    async deferQueueItem(queueItemId, _actorId, dueAt, now) {
      return enrichItem(deferQueueItem(store, queueItemId, dueAt, now));
    },
    async ignoreQueueItem(queueItemId, _actorId, now) {
      return enrichItem(ignoreQueueItem(store, queueItemId, now));
    },
    async bumpQueueItemPriority(queueItemId, input, now) {
      return enrichItem(bumpQueueItemPriority(store, queueItemId, input, now));
    },
    async getLatestTaskWorkspaceSnapshot(taskId) {
      return getLatestTaskWorkspaceSnapshot(store, taskId);
    },
    async saveTaskWorkspaceSnapshot(input) {
      return saveTaskWorkspaceSnapshot(store, input);
    },
    async getReviewPacket(id) {
      return getReviewPacket(store, id);
    },
    async getAgentRun(id) {
      return getAgentRun(store, id);
    },
    async upsertAgentRun(run, now) {
      return upsertAgentRun(store, run, now);
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
      return enrichStoredEventResult(
        ingestEventAsReviewPacket(store, event, now),
        snapshotForTask,
        contextEntriesForTask,
      );
    },
    async recordEventRoute(event, routeDecision) {
      return enrichStoredEventResult(
        recordEventRoute(store, event, routeDecision),
        snapshotForTask,
        contextEntriesForTask,
      );
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
    async getQueueActionAttempt(idempotencyKey) {
      return queueActionAttempts.get(idempotencyKey);
    },
    async recordQueueActionAttempt(input) {
      const existing = queueActionAttempts.get(input.idempotencyKey);
      if (existing) {
        return { existing, record: existing };
      }
      const timestamp = input.now.toISOString();
      const record: StoredActionAttempt = {
        idempotency_key: input.idempotencyKey,
        queue_item_id: input.queueItemId,
        terminal_send_ok: false,
        completed: false,
        created_at: timestamp,
        updated_at: timestamp,
      };
      queueActionAttempts.set(record.idempotency_key, record);
      return { record };
    },
    async markQueueActionTerminalSent(input) {
      const existing = queueActionAttempts.get(input.idempotencyKey);
      if (!existing) return undefined;
      const updated: StoredActionAttempt = {
        ...existing,
        terminal_send_ok: true,
        terminal_send_result: input.terminalSendResult,
        updated_at: input.now.toISOString(),
      };
      queueActionAttempts.set(updated.idempotency_key, updated);
      return updated;
    },
    async markQueueActionCompleted(input) {
      const existing = queueActionAttempts.get(input.idempotencyKey);
      if (!existing) return undefined;
      const updated: StoredActionAttempt = {
        ...existing,
        completed: true,
        action_result: input.actionResult,
        updated_at: input.now.toISOString(),
      };
      queueActionAttempts.set(updated.idempotency_key, updated);
      return updated;
    },
    async getTaskSessionTerminalRef(taskSessionId) {
      return taskSessionTerminalRefs.get(taskSessionId);
    },
    async setTaskSessionTerminalRef(taskSessionId, terminalRef, now) {
      const existing = taskSessionTerminalRefs.get(taskSessionId);
      const timestamp = now.toISOString();
      const record: TaskSessionTerminalRefRecord = {
        task_session_id: taskSessionId,
        terminal_ref: terminalRef,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      };
      taskSessionTerminalRefs.set(taskSessionId, record);
      return record;
    },
    async clearTaskSessionTerminalRef(taskSessionId) {
      const existing = taskSessionTerminalRefs.get(taskSessionId);
      if (!existing) return undefined;
      taskSessionTerminalRefs.delete(taskSessionId);
      return existing;
    },
    async recordOnboardingRejection(proposalKey, reason, now) {
      const record: OnboardingRejectionRecord = {
        proposal_key: proposalKey,
        reason,
        rejected_at: now.toISOString(),
      };
      onboardingRejections.set(proposalKey, record);
      return record;
    },
    async listOnboardingRejections() {
      return Array.from(onboardingRejections.values());
    },
    async clearOnboardingRejection(proposalKey) {
      const existing = onboardingRejections.get(proposalKey);
      if (!existing) return undefined;
      onboardingRejections.delete(proposalKey);
      return existing;
    },
    async getOnboardingApprovalBatch(idempotencyKey) {
      return onboardingApprovalBatches.get(idempotencyKey);
    },
    async recordOnboardingApprovalBatch(input) {
      const existing = onboardingApprovalBatches.get(input.idempotencyKey);
      if (existing) return existing;
      const record: OnboardingApprovalBatchRecord = {
        idempotency_key: input.idempotencyKey,
        results: input.results,
        created_at: input.now.toISOString(),
      };
      onboardingApprovalBatches.set(record.idempotency_key, record);
      return record;
    },
    async getManualModeState() {
      return { ...manualModeState.value };
    },
    async setManualModeActive(active, reason, now) {
      const previous = manualModeState.value;
      const timestamp = now.toISOString();
      if (active) {
        manualModeState.value = {
          active: true,
          entered_at: previous.active && previous.entered_at ? previous.entered_at : timestamp,
          reason: reason ?? previous.reason,
          updated_at: timestamp,
        };
      } else {
        manualModeState.value = {
          active: false,
          updated_at: timestamp,
        };
      }
      return { ...manualModeState.value };
    },
    async createTask(input) {
      const anchorKey = `${input.primaryAnchor.kind}:${input.primaryAnchor.id}`;
      const existing =
        (input.taskId ? tasks.get(input.taskId) : undefined) ??
        Array.from(tasks.values()).find(
          (record) => `${record.primary_anchor_kind}:${record.primary_anchor_id}` === anchorKey,
        );
      if (existing) {
        const timestamp = input.now.toISOString();
        let updatedExisting = existing;
        if (
          (input.aerospaceWorkspaceId !== undefined &&
            input.aerospaceWorkspaceId !== existing.aerospace_workspace_id) ||
          existing.dormant_at
        ) {
          updatedExisting = {
            ...existing,
            aerospace_workspace_id: input.aerospaceWorkspaceId ?? existing.aerospace_workspace_id,
            dormant_at: undefined,
            updated_at: timestamp,
          };
          tasks.set(existing.task_id, updatedExisting);
        }
        const layout = taskLayouts.get(updatedExisting.task_id);
        return {
          task: { ...updatedExisting },
          layout: layout ?? {
            task_id: updatedExisting.task_id,
            layout: input.capturedLayout,
            updated_at: updatedExisting.updated_at,
          },
          created: false,
        };
      }
      const timestamp = input.now.toISOString();
      const taskId = input.taskId ?? `task_${stableId(`${input.primaryAnchor.kind}_${input.primaryAnchor.id}_${timestamp}`)}`;
      const record: TaskRecord = {
        task_id: taskId,
        primary_anchor_kind: input.primaryAnchor.kind,
        primary_anchor_id: input.primaryAnchor.id,
        aerospace_workspace_id: input.aerospaceWorkspaceId,
        created_at: timestamp,
        updated_at: timestamp,
        auto_paper_idle_seconds:
          typeof input.autoPaperIdleSeconds === "number" && Number.isFinite(input.autoPaperIdleSeconds)
            ? Math.max(1, Math.floor(input.autoPaperIdleSeconds))
            : 60,
      };
      tasks.set(record.task_id, record);
      const layout: TaskLayoutRecord = {
        task_id: record.task_id,
        layout: input.capturedLayout,
        updated_at: timestamp,
      };
      taskLayouts.set(record.task_id, layout);
      return { task: { ...record }, layout: { ...layout }, created: true };
    },
    async getTask(taskId) {
      const record = tasks.get(taskId);
      return record ? { ...record } : undefined;
    },
    async getTaskByAnchor(kind, id) {
      const record = Array.from(tasks.values()).find(
        (entry) => entry.primary_anchor_kind === kind && entry.primary_anchor_id === id,
      );
      return record ? { ...record } : undefined;
    },
    async getTasksByWorkspaceId(workspaceId) {
      return Array.from(tasks.values())
        .filter((entry) => entry.aerospace_workspace_id === workspaceId)
        .map((entry) => ({ ...entry }))
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
    },
    async listTasks() {
      return Array.from(tasks.values())
        .map((record) => ({ ...record }))
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
    },
    async getTaskLayout(taskId) {
      const layout = taskLayouts.get(taskId);
      return layout ? { ...layout } : undefined;
    },
    async updateTaskLayout(taskId, layout, now) {
      const existing = tasks.get(taskId);
      if (!existing) return undefined;
      const timestamp = now.toISOString();
      taskLayouts.set(taskId, { task_id: taskId, layout, updated_at: timestamp });
      const updated: TaskRecord = { ...existing, updated_at: timestamp };
      tasks.set(taskId, updated);
      return { ...updated };
    },
    async getCurrentTaskState() {
      return { ...currentTaskState.value };
    },
    async setCurrentTaskId(taskId, now) {
      const previous = currentTaskState.value;
      const timestamp = now.toISOString();
      if (taskId === null) {
        currentTaskState.value = { current_task_id: null, updated_at: timestamp };
        return { ...currentTaskState.value };
      }
      const enteredAt = previous.current_task_id === taskId && previous.entered_at ? previous.entered_at : timestamp;
      currentTaskState.value = { current_task_id: taskId, entered_at: enteredAt, updated_at: timestamp };
      return { ...currentTaskState.value };
    },
    async recordTaskPaperEmitted(taskId, now) {
      const existing = tasks.get(taskId);
      if (!existing) return undefined;
      const timestamp = now.toISOString();
      const updated: TaskRecord = {
        ...existing,
        last_paper_emitted_at: timestamp,
        updated_at: timestamp,
      };
      tasks.set(taskId, updated);
      return { ...updated };
    },
    async markTaskDormant(taskId, dormantAt) {
      const existing = tasks.get(taskId);
      if (!existing) return undefined;
      const timestamp = dormantAt.toISOString();
      const updated: TaskRecord = {
        ...existing,
        dormant_at: timestamp,
        updated_at: timestamp,
      };
      tasks.set(taskId, updated);
      return { ...updated };
    },
    async wakeTask(taskId, now) {
      const existing = tasks.get(taskId);
      if (!existing) return undefined;
      const updated: TaskRecord = {
        ...existing,
        dormant_at: undefined,
        updated_at: now.toISOString(),
      };
      tasks.set(taskId, updated);
      return { ...updated };
    },
    async recordWindowWorkspaceObservation(input) {
      return recordWindowWorkspaceObservation(store, input);
    },
    async listFollowsWindows(input) {
      return listFollowsWindows(store, input);
    },
    async addFollowsWindowExclusion(input) {
      return addFollowsWindowExclusion(store, input);
    },
    async listFollowsWindowExclusions() {
      return listFollowsWindowExclusions(store);
    },
    async claimTaskWindow(input) {
      return claimTaskWindow(store, input);
    },
    async listTaskWindowClaims(input) {
      return listTaskWindowClaims(store, input);
    },
    async pruneWindowWorkspaceObservations(olderThan) {
      return pruneWindowWorkspaceObservations(store, olderThan);
    },
    async createPaperTrigger(input, now) {
      return createPaperTrigger(store, input, now);
    },
    async listPaperTriggers(filter) {
      return listPaperTriggers(store, filter);
    },
    async getPaperTrigger(triggerId) {
      return getPaperTrigger(store, triggerId);
    },
    async updatePaperTrigger(triggerId, patch, now) {
      return updatePaperTrigger(store, triggerId, patch, now);
    },
    async deletePaperTrigger(triggerId) {
      return deletePaperTrigger(store, triggerId);
    },
    async recordPaperTriggerFired(triggerId, at) {
      return recordPaperTriggerFired(store, triggerId, at);
    },
    async tryRegisterPaperTriggerFiring(triggerId, dedupeKey) {
      return tryRegisterPaperTriggerFiring(store, triggerId, dedupeKey);
    },
  };
}

export function createPostgresGatewayStore(store: PostgresQueueStore): GatewayStore {
  const snapshotForTask = (taskId: string) => store.getLatestTaskWorkspaceSnapshot(taskId);
  const contextEntriesForTask = (taskId: string) => store.listContextEntries({ task_id: taskId, limit: 8 });
  const enrichItem = async (item: QueueItemWithPacket | undefined): Promise<QueueItemWithPacket | undefined> =>
    await enrichQueueItemWithTaskWorkspaceSnapshot(item, snapshotForTask, contextEntriesForTask);
  const enrichItems = async (items: QueueItemWithPacket[]): Promise<QueueItemWithPacket[]> =>
    Promise.all(items.map(enrichItem)).then((enriched) => enriched.filter((item): item is QueueItemWithPacket => item !== undefined));

  return {
    async listQueue(state, now) {
      if (now) await store.reapDueDeferredItems(now);
      return enrichItems(await store.listQueue(state));
    },
    async nextQueueItem(now) {
      await store.reapStaleLeases(now);
      const items = await store.listQueue("ready");
      return enrichItem(items.find((item) => isQueueItemDue(item, now)));
    },
    async leaseNextQueueItem(leaseOwner, _now, leaseMs, excludeQueueItemId) {
      return enrichItem(await store.leaseNext(leaseOwner, leaseMs, excludeQueueItemId));
    },
    async renewQueueLease(queueItemId, leaseOwner, _now, leaseMs) {
      return enrichItem(await store.renewLease(queueItemId, leaseOwner, leaseMs));
    },
    async markQueueItemDone(queueItemId, actorId) {
      return enrichItem(await store.markDone(queueItemId, actorId));
    },
    async deferQueueItem(queueItemId, actorId, dueAt) {
      return enrichItem(await store.deferQueueItem(queueItemId, actorId, dueAt));
    },
    async ignoreQueueItem(queueItemId, actorId) {
      return enrichItem(await store.ignoreQueueItem(queueItemId, actorId));
    },
    async bumpQueueItemPriority(queueItemId, input) {
      return enrichItem(await store.bumpPriority(queueItemId, input));
    },
    async getLatestTaskWorkspaceSnapshot(taskId) {
      return store.getLatestTaskWorkspaceSnapshot(taskId);
    },
    async saveTaskWorkspaceSnapshot(input) {
      return store.saveTaskWorkspaceSnapshot(input);
    },
    async getReviewPacket(id) {
      return store.getReviewPacket(id);
    },
    async getAgentRun(id) {
      return store.getAgentRun(id);
    },
    async upsertAgentRun(run, now) {
      return store.upsertAgentRun(run, now);
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
        if (existing) return enrichStoredEventResult(existing, snapshotForTask, contextEntriesForTask);
      }
      return enrichStoredEventResult({
        event,
        route_decision: result.route_decision,
        review_packet: result.item?.review_packet,
        queue_item: result.item,
      }, snapshotForTask, contextEntriesForTask);
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
    async getQueueActionAttempt(idempotencyKey) {
      return store.getQueueActionAttempt(idempotencyKey);
    },
    async recordQueueActionAttempt(input) {
      return store.recordQueueActionAttempt(input);
    },
    async markQueueActionTerminalSent(input) {
      return store.markQueueActionTerminalSent(input);
    },
    async markQueueActionCompleted(input) {
      return store.markQueueActionCompleted(input);
    },
    async getTaskSessionTerminalRef(taskSessionId) {
      return store.getTaskSessionTerminalRef(taskSessionId);
    },
    async setTaskSessionTerminalRef(taskSessionId, terminalRef, now) {
      return store.setTaskSessionTerminalRef(taskSessionId, terminalRef, now);
    },
    async clearTaskSessionTerminalRef(taskSessionId) {
      return store.clearTaskSessionTerminalRef(taskSessionId);
    },
    async recordOnboardingRejection(proposalKey, reason, now) {
      return store.recordOnboardingRejection(proposalKey, reason, now);
    },
    async listOnboardingRejections() {
      return store.listOnboardingRejections();
    },
    async clearOnboardingRejection(proposalKey) {
      return store.clearOnboardingRejection(proposalKey);
    },
    async getOnboardingApprovalBatch(idempotencyKey) {
      return store.getOnboardingApprovalBatch(idempotencyKey);
    },
    async recordOnboardingApprovalBatch(input) {
      return store.recordOnboardingApprovalBatch(input);
    },
    async getManualModeState() {
      return store.getManualModeState();
    },
    async setManualModeActive(active, reason, now) {
      return store.setManualModeActive(active, reason, now);
    },
    async createTask(input) {
      return store.createTask(input);
    },
    async getTask(taskId) {
      return store.getTask(taskId);
    },
    async getTaskByAnchor(kind, id) {
      return store.getTaskByAnchor(kind, id);
    },
    async getTasksByWorkspaceId(workspaceId) {
      return store.getTasksByWorkspaceId(workspaceId);
    },
    async listTasks() {
      return store.listTasks();
    },
    async getTaskLayout(taskId) {
      return store.getTaskLayout(taskId);
    },
    async updateTaskLayout(taskId, layout, now) {
      return store.updateTaskLayout(taskId, layout, now);
    },
    async getCurrentTaskState() {
      return store.getCurrentTaskState();
    },
    async setCurrentTaskId(taskId, now) {
      return store.setCurrentTaskId(taskId, now);
    },
    async recordTaskPaperEmitted(taskId, now) {
      return store.recordTaskPaperEmitted(taskId, now);
    },
    async markTaskDormant(taskId, dormantAt) {
      return store.markTaskDormant(taskId, dormantAt);
    },
    async wakeTask(taskId, now) {
      return store.wakeTask(taskId, now);
    },
    async recordWindowWorkspaceObservation(input) {
      return store.recordWindowWorkspaceObservation(input);
    },
    async listFollowsWindows(input) {
      return store.listFollowsWindows(input);
    },
    async addFollowsWindowExclusion(input) {
      return store.addFollowsWindowExclusion(input);
    },
    async listFollowsWindowExclusions() {
      return store.listFollowsWindowExclusions();
    },
    async claimTaskWindow(input) {
      return store.claimTaskWindow(input);
    },
    async listTaskWindowClaims(input) {
      return store.listTaskWindowClaims(input);
    },
    async pruneWindowWorkspaceObservations(olderThan) {
      return store.pruneWindowWorkspaceObservations(olderThan);
    },
    async createPaperTrigger(input, now) {
      return store.createPaperTrigger(input, now);
    },
    async listPaperTriggers(filter) {
      return store.listPaperTriggers(filter);
    },
    async getPaperTrigger(triggerId) {
      return store.getPaperTrigger(triggerId);
    },
    async updatePaperTrigger(triggerId, patch, now) {
      return store.updatePaperTrigger(triggerId, patch, now);
    },
    async deletePaperTrigger(triggerId) {
      return store.deletePaperTrigger(triggerId);
    },
    async recordPaperTriggerFired(triggerId, at) {
      return store.recordPaperTriggerFired(triggerId, at);
    },
    async tryRegisterPaperTriggerFiring(triggerId, dedupeKey) {
      return store.tryRegisterPaperTriggerFiring(triggerId, dedupeKey);
    },
  };
}

async function enrichStoredEventResult(
  result: StoredEventResult,
  snapshotForTask: (taskId: string) => Promise<TaskWorkspaceSnapshotRecord | undefined>,
  contextEntriesForTask?: (taskId: string) => Promise<ContextEntry[]>,
): Promise<StoredEventResult> {
  if (!result.queue_item) return result;
  const queueItem = await enrichQueueItemWithTaskWorkspaceSnapshot(result.queue_item, snapshotForTask, contextEntriesForTask);
  return {
    ...result,
    review_packet: queueItem?.review_packet ?? result.review_packet,
    queue_item: queueItem ?? result.queue_item,
  };
}

async function enrichQueueItemWithTaskWorkspaceSnapshot(
  item: QueueItemWithPacket | undefined,
  snapshotForTask: (taskId: string) => Promise<TaskWorkspaceSnapshotRecord | undefined>,
  contextEntriesForTask?: (taskId: string) => Promise<ContextEntry[]>,
): Promise<QueueItemWithPacket | undefined> {
  if (!item?.task_id) return item;
  const additions: ContextResource[] = [];

  if (!packetHasWorkspaceSnapshot(item.review_packet)) {
    const snapshotRecord = await snapshotForTask(item.task_id);
    if (snapshotRecord) {
      additions.push({
        id: `ctx_task_workspace_${stableId(snapshotRecord.task_id)}`,
        kind: "workspace_snapshot",
        title: `Last workspace for ${snapshotRecord.task_id}`,
        source: "task_workspace_memory",
        captured_at: snapshotRecord.captured_at,
        restore_confidence: "high",
        snapshot: snapshotRecord.snapshot,
        details: {
          task_id: snapshotRecord.task_id,
          source_queue_item_id: snapshotRecord.source_queue_item_id,
          updated_at: snapshotRecord.updated_at,
        },
      });
    }
  }

  if (contextEntriesForTask) {
    const existingContextIds = new Set(item.review_packet.context.map((resource) => resource.id));
    const browserResources = (await contextEntriesForTask(item.task_id))
      .map(taskBrowserResourceFromContextEntry)
      .filter((resource): resource is ContextResource => resource !== undefined)
      .filter((resource) => !existingContextIds.has(resource.id))
      .slice(0, 5);
    additions.push(...browserResources);
  }

  if (additions.length === 0) return item;
  const seen = new Set(item.review_packet.context.map((resource) => resource.id));
  const uniqueAdditions = additions.filter((resource) => {
    if (seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  });
  if (uniqueAdditions.length === 0) return item;

  return {
    ...item,
    review_packet: {
      ...item.review_packet,
      context: [...item.review_packet.context, ...uniqueAdditions],
    },
  };
}

function taskBrowserResourceFromContextEntry(entry: ContextEntry): ContextResource | undefined {
  const resource = entry.resource;
  if (resource.kind !== "browser_tab") return undefined;
  const id = typeof resource.id === "string" && resource.id ? resource.id : `ctx_browser_${stableId(entry.event_id)}`;
  const title = typeof resource.title === "string" && resource.title ? resource.title : entry.event_title;
  const restoreConfidence = resource.restore_confidence;
  return {
    ...resource,
    id,
    kind: "browser_tab",
    title,
    source: typeof resource.source === "string" ? resource.source : entry.event_source,
    captured_at: typeof resource.captured_at === "string" ? resource.captured_at : entry.captured_at,
    restore_confidence:
      restoreConfidence === "high" || restoreConfidence === "medium" || restoreConfidence === "low"
        ? restoreConfidence
        : "medium",
    details: {
      ...(isRecord(resource.details) ? resource.details : {}),
      task_id: entry.task_id,
      context_event_id: entry.event_id,
      context_event_source: entry.event_source,
      match_reasons: entry.match_reasons,
    },
  } as ContextResource;
}

function packetHasWorkspaceSnapshot(packet: ReviewPacket): boolean {
  return packet.context.some((resource) => resource.kind === "workspace_snapshot" && resource.snapshot);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
