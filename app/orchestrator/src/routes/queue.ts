import {
  queueStates,
  type Action,
  type QueueItemWithPacket,
  type QueueState,
} from "../contracts.js";
import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import { sendTaskFollowupWithActivity } from "../task_sessions/task_followup_audit.js";
import { bestTaskSessionForTask } from "../task_sessions/session_selection.js";
import { triggerTerminalKeystroke, type TerminalSendExecutor } from "../task_sessions/terminal_send.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import { parseWorkspaceSnapshot } from "../workspace/controller.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleQueueRoute(input: {
  method: string | undefined;
  pathname: string;
  url: URL;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  const { store, taskSessions, observability, terminalSendExecutor, terminalSendEnabled } = input.runtime;
  if (input.method === "GET" && input.pathname === "/queue") {
    const validation = validateQueueQuery(input.url);
    if (!validation.ok) return schemaError(validation.message);

    const items = await store.listQueue(validation.state, input.now);
    return ok(200, {
      items,
      count: items.length,
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/queue/next") {
    return ok(200, {
      item: await store.nextQueueItem(input.now) ?? null,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/queue/lease-next") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("lease request must be an object");

    const validation = parseQueueLeaseRequest(parsed.value, false);
    if (!validation.ok) return schemaError(validation.message);

    const manualMode = await store.getManualModeState();
    if (manualMode.active) {
      return error(409, "manual_mode_active", "queue is paused while manual mode is active", {
        manual_mode: manualMode,
      });
    }

    return ok(200, {
      item: await store.leaseNextQueueItem(validation.leaseOwner, input.now, validation.leaseMs, validation.excludeQueueItemId) ?? null,
      request_id: input.requestId,
    });
  }

  const lineageMatch = input.pathname.match(/^\/queue\/([^/]+)\/lineage$/);
  if (input.method === "GET" && lineageMatch) {
    const validation = validateQueueLineageQuery(input.url);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(lineageMatch[1] ?? "");
    const item = await findQueueItem(store, queueItemId);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);

    const [activity, taskMessages] = await Promise.all([
      observability.listActivity({ queue_item_id: queueItemId, limit: validation.limit }),
      store.listTaskMessages({ queue_item_id: queueItemId, limit: validation.limit }),
    ]);
    const relatedEventIds = relatedEventIdsForLineage(item, activity, taskMessages);
    const events = await Promise.all(
      relatedEventIds.map(async (eventId) => store.getEvent(eventId)),
    );

    return ok(200, {
      lineage: {
        queue_item: item,
        related_event_ids: relatedEventIds,
        events: events.filter((event) => event !== undefined),
        activity,
        task_messages: taskMessages,
        counts: {
          events: events.filter((event) => event !== undefined).length,
          activity: activity.length,
          task_messages: taskMessages.length,
        },
      },
      request_id: input.requestId,
    });
  }

  const renewLeaseMatch = input.pathname.match(/^\/queue\/([^/]+)\/lease\/renew$/);
  if (input.method === "POST" && renewLeaseMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("renew lease request must be an object");

    const validation = parseQueueLeaseRequest(parsed.value, true);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(renewLeaseMatch[1] ?? "");
    const item = await store.renewQueueLease(queueItemId, validation.leaseOwner, input.now, validation.leaseMs);
    if (!item) return error(409, "lease_not_renewed", `queue item ${queueItemId} lease was not renewed`);

    return ok(200, {
      ok: true,
      item,
      request_id: input.requestId,
    });
  }

  const doneMatch = input.pathname.match(/^\/queue\/([^/]+)\/done$/);
  if (input.method === "POST" && doneMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value) || parsed.value.action !== "done") {
      return schemaError("done request requires action=done");
    }

    const queueItemId = decodeURIComponent(doneMatch[1] ?? "");
    const actorId = typeof parsed.value.actor_id === "string" ? parsed.value.actor_id : "unknown";
    const existingItem = await findQueueItem(store, queueItemId);
    if (!existingItem) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    const workspaceSave = await saveTaskWorkspaceSnapshotFromQueueAction(input, existingItem, parsed.value, actorId);
    if (!workspaceSave.ok) return schemaError(workspaceSave.message);
    const item = await store.markQueueItemDone(queueItemId, actorId, input.now);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    await recordQueueDone(observability, item);

    return ok(200, {
      ok: true,
      item,
      decision: {
        id: `dec_${queueItemId}`,
        queue_item_id: queueItemId,
        review_packet_id: item.review_packet_id,
        action: "done",
        actor_id: actorId,
        decided_at: input.now.toISOString(),
      },
      request_id: input.requestId,
    });
  }

  const deferMatch = input.pathname.match(/^\/queue\/([^/]+)\/defer$/);
  if (input.method === "POST" && deferMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("defer request must be an object");
    const validation = validateQueueDeferRequest(parsed.value, input.now);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(deferMatch[1] ?? "");
    const existingItem = await findQueueItem(store, queueItemId);
    if (!existingItem) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    const workspaceSave = await saveTaskWorkspaceSnapshotFromQueueAction(input, existingItem, parsed.value, validation.actorId);
    if (!workspaceSave.ok) return schemaError(workspaceSave.message);
    const item = await store.deferQueueItem(queueItemId, validation.actorId, validation.dueAt, input.now);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    await observability.incrementCounter("queue_items_deferred_total");
    await observability.recordActivity({
      type: "queue_item_deferred",
      occurred_at: item.updated_at,
      actor: "human",
      task_id: item.task_id,
      queue_item_id: item.id,
      status: "ok",
      summary: `Queue item deferred: ${item.review_packet.title}`,
      details: {
        review_packet_id: item.review_packet_id,
        due_at: item.due_at,
      },
    });

    return ok(200, {
      ok: true,
      item,
      decision: {
        id: `dec_${queueItemId}_defer`,
        queue_item_id: queueItemId,
        review_packet_id: item.review_packet_id,
        action: "defer",
        actor_id: validation.actorId,
        due_at: item.due_at,
        decided_at: input.now.toISOString(),
      },
      request_id: input.requestId,
    });
  }

  const ignoreMatch = input.pathname.match(/^\/queue\/([^/]+)\/ignore$/);
  if (input.method === "POST" && ignoreMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("ignore request must be an object");
    const validation = validateQueueIgnoreRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(ignoreMatch[1] ?? "");
    const existingItem = await findQueueItem(store, queueItemId);
    if (!existingItem) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    const workspaceSave = await saveTaskWorkspaceSnapshotFromQueueAction(input, existingItem, parsed.value, validation.actorId);
    if (!workspaceSave.ok) return schemaError(workspaceSave.message);
    const item = await store.ignoreQueueItem(queueItemId, validation.actorId, input.now);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    await observability.incrementCounter("queue_items_ignored_total");
    await observability.recordActivity({
      type: "queue_item_ignored",
      occurred_at: item.updated_at,
      actor: "human",
      task_id: item.task_id,
      queue_item_id: item.id,
      status: "ok",
      summary: `Queue item ignored: ${item.review_packet.title}`,
      details: {
        review_packet_id: item.review_packet_id,
      },
    });

    return ok(200, {
      ok: true,
      item,
      decision: {
        id: `dec_${queueItemId}_ignore`,
        queue_item_id: queueItemId,
        review_packet_id: item.review_packet_id,
        action: "ignore",
        actor_id: validation.actorId,
        decided_at: input.now.toISOString(),
      },
      request_id: input.requestId,
    });
  }

  const recommendedActionMatch = input.pathname.match(/^\/queue\/([^/]+)\/actions\/recommended$/);
  if (input.method === "POST" && recommendedActionMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("recommended action request must be an object");
    const validation = validateQueueActionRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(recommendedActionMatch[1] ?? "");
    const item = await findQueueItem(store, queueItemId);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);

    const idempotencyKey = resolveQueueActionIdempotencyKey({
      bodyValue: parsed.value.idempotency_key,
      headerValue: input.idempotencyKey,
      queueItemId,
      actionId: item.review_packet.recommended_action.id,
    });

    const attempt = await store.recordQueueActionAttempt({
      idempotencyKey,
      queueItemId,
      now: input.now,
    });

    // Full retry: previous attempt already completed end-to-end. Return cached result.
    if (attempt.existing?.completed && attempt.existing.action_result) {
      const cachedItem = await findQueueItem(store, queueItemId);
      return ok(200, {
        ok: true,
        action_result: attempt.existing.action_result,
        item: cachedItem,
        idempotent_replay: true,
        request_id: input.requestId,
      });
    }

    const workspaceSave = await saveTaskWorkspaceSnapshotFromQueueAction(input, item, parsed.value, validation.actorId);
    if (!workspaceSave.ok) return schemaError(workspaceSave.message);

    const actionResult = await executeQueueAction({
      runtime: input.runtime,
      now: input.now,
      idempotencyKey,
      priorAttempt: attempt.existing,
    }, item, item.review_packet.recommended_action);
    if (!actionResult.ok) {
      return error(actionResult.status, actionResult.code, actionResult.message, actionResult.details);
    }

    const completed = await store.markQueueItemDone(queueItemId, validation.actorId, input.now);
    if (completed) {
      await recordQueueDone(observability, completed, {
        taskSessionId: stringFromRecord(actionResult.result, "task_session_id"),
        actionResult: actionResult.result,
      });
    }
    await store.markQueueActionCompleted({
      idempotencyKey,
      actionResult: actionResult.result,
      now: input.now,
    });
    return ok(200, {
      ok: true,
      action_result: actionResult.result,
      item: completed,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/queue") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    return schemaError("POST /queue request schema is not implemented in v0");
  }

  const priorityMatch = input.pathname.match(/^\/queue\/([^/]+)\/priority$/);
  if (input.method === "POST" && priorityMatch) {
    const queueItemId = decodeURIComponent(priorityMatch[1] ?? "");
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validation = validateQueuePriorityRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const updated = await store.bumpQueueItemPriority(queueItemId, {
      delta: validation.delta,
      score: validation.score,
      reason: validation.reason,
    }, input.now);
    if (!updated) return error(404, "not_found", `queue item ${queueItemId} was not found`);

    await observability.incrementCounter("queue_items_priority_bumped_total");
    await observability.recordActivity({
      type: "queue_item_priority_bumped",
      occurred_at: input.now.toISOString(),
      actor: "human",
      task_id: updated.task_id,
      queue_item_id: updated.id,
      status: "ok",
      summary: `Queue item priority updated for ${updated.review_packet.title}.`,
      details: sanitizeActivityDetails({
        review_packet_id: updated.review_packet_id,
        priority_score: updated.priority_score,
        delta: validation.delta,
        score: validation.score,
        reason: validation.reason ?? "manual_priority_bump",
        actor_id: validation.actorId,
      }),
    });

    return ok(200, {
      ok: true,
      item: updated,
      request_id: input.requestId,
    });
  }

  return undefined;
}

function validateQueuePriorityRequest(input: unknown): {
  ok: true;
  delta?: number;
  score?: number;
  reason?: string;
  actorId: string;
} | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "priority request must be an object" };
  const delta = input.delta;
  const score = input.score;
  if (delta === undefined && score === undefined) {
    return { ok: false, message: "priority request must include delta or score" };
  }
  if (delta !== undefined && (typeof delta !== "number" || !Number.isFinite(delta))) {
    return { ok: false, message: "priority delta must be a finite number" };
  }
  if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score) || score < 0)) {
    return { ok: false, message: "priority score must be a non-negative finite number" };
  }
  const reasonValue = input.reason;
  const reason = typeof reasonValue === "string" && reasonValue.trim() ? reasonValue.trim().slice(0, 80) : undefined;
  const actorValue = input.actor_id;
  const actorId = typeof actorValue === "string" && actorValue.trim() ? actorValue.trim() : "queue_priority";
  return {
    ok: true,
    delta: typeof delta === "number" ? delta : undefined,
    score: typeof score === "number" ? score : undefined,
    reason,
    actorId,
  };
}

async function recordQueueDone(
  observability: Observability,
  item: QueueItemWithPacket,
  extra?: { taskSessionId?: string; actionResult?: Record<string, unknown> },
): Promise<void> {
  await observability.incrementCounter("queue_items_done_total");
  await observability.recordActivity({
    type: "queue_item_done",
    occurred_at: item.updated_at,
    actor: "human",
    task_id: item.task_id,
    queue_item_id: item.id,
    task_session_id: extra?.taskSessionId,
    status: "ok",
    summary: `Queue item done: ${item.review_packet.title}`,
    details: sanitizeActivityDetails({
      review_packet_id: item.review_packet_id,
      action_result: extra?.actionResult,
    }),
  });
}

async function saveTaskWorkspaceSnapshotFromQueueAction(
  input: {
    runtime: Runtime;
    now: Date;
  },
  item: QueueItemWithPacket,
  body: Record<string, unknown>,
  actorId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { store, observability } = input.runtime;
  const parsed = parseOptionalWorkspaceSnapshotBody(body);
  if (!parsed.ok) return parsed;
  if (!parsed.snapshot) return { ok: true };
  if (!item.task_id) return { ok: true };

  const record = await store.saveTaskWorkspaceSnapshot({
    taskId: item.task_id,
    snapshot: parsed.snapshot,
    capturedAt: input.now,
    sourceQueueItemId: item.id,
    actorId,
  });
  await observability.incrementCounter("task_workspace_snapshots_saved_total");
  await observability.recordActivity({
    type: "task_workspace_snapshot_saved",
    occurred_at: record.updated_at,
    actor: "human",
    task_id: item.task_id,
    queue_item_id: item.id,
    status: "ok",
    summary: `Task workspace saved: ${item.task_id}`,
    details: sanitizeActivityDetails({
      review_packet_id: item.review_packet_id,
      window_count: record.snapshot.windows.length,
      active_workspace: record.snapshot.activeWorkspace,
      focused_window_id: record.snapshot.focusedWindowId,
    }),
  });
  return { ok: true };
}

function parseOptionalWorkspaceSnapshotBody(
  body: Record<string, unknown>,
): { ok: true; snapshot?: ReturnType<typeof parseWorkspaceSnapshot> } | { ok: false; message: string } {
  const raw = body.workspace_snapshot ?? body.workspaceSnapshot;
  if (raw === undefined || raw === null) return { ok: true };
  try {
    return { ok: true, snapshot: parseWorkspaceSnapshot(raw) };
  } catch (error) {
    return {
      ok: false,
      message: `workspace_snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateQueueQuery(url: URL): { ok: true; state?: QueueState } | { ok: false; message: string } {
  const state = url.searchParams.get("state");
  if (!state) return { ok: true };
  if (!queueStates.includes(state as QueueState)) {
    return { ok: false, message: `state must be one of: ${queueStates.join(", ")}` };
  }
  return { ok: true, state: state as QueueState };
}

function validateQueueLineageQuery(url: URL): { ok: true; limit: number } | { ok: false; message: string } {
  const limitRaw = url.searchParams.get("limit");
  if (!limitRaw) return { ok: true, limit: 100 };
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    return { ok: false, message: "limit must be an integer between 1 and 500" };
  }
  return { ok: true, limit };
}

function validateQueueDeferRequest(input: unknown, now: Date): { ok: true; actorId: string; dueAt: Date } | { ok: false; message: string } {
  if (!isRecord(input) || input.action !== "defer") {
    return { ok: false, message: "defer request requires action=defer" };
  }
  const dueAtRaw = typeof input.due_at === "string" ? input.due_at : "";
  if (!dueAtRaw) return { ok: false, message: "due_at is required" };
  const dueAt = new Date(dueAtRaw);
  if (Number.isNaN(dueAt.getTime())) return { ok: false, message: "due_at must be a valid ISO timestamp" };
  if (dueAt.getTime() <= now.getTime()) return { ok: false, message: "due_at must be in the future" };
  return {
    ok: true,
    actorId: typeof input.actor_id === "string" ? input.actor_id : "unknown",
    dueAt,
  };
}

function parseQueueLeaseRequest(
  input: Record<string, unknown>,
  requireOwner: boolean,
): { ok: true; leaseOwner: string; leaseMs: number; excludeQueueItemId?: string } | { ok: false; message: string } {
  const leaseOwner = typeof input.lease_owner === "string" && input.lease_owner
    ? input.lease_owner
    : requireOwner ? "" : "unknown";
  if (requireOwner && !leaseOwner) {
    return { ok: false, message: "lease_owner is required" };
  }

  const leaseMs = typeof input.lease_ms === "number" && Number.isInteger(input.lease_ms)
    ? input.lease_ms
    : 60_000;
  if (leaseMs <= 0 || leaseMs > 30 * 60_000) {
    return { ok: false, message: "lease_ms must be between 1 and 1800000" };
  }
  const excludeQueueItemId = typeof input.exclude_queue_item_id === "string" && input.exclude_queue_item_id.trim()
    ? input.exclude_queue_item_id.trim()
    : undefined;

  return { ok: true, leaseOwner, leaseMs, excludeQueueItemId };
}

function validateQueueIgnoreRequest(input: unknown): { ok: true; actorId: string } | { ok: false; message: string } {
  if (!isRecord(input) || input.action !== "ignore") {
    return { ok: false, message: "ignore request requires action=ignore" };
  }
  return {
    ok: true,
    actorId: typeof input.actor_id === "string" ? input.actor_id : "unknown",
  };
}

function validateQueueActionRequest(input: unknown): { ok: true; actorId: string } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "queue action request must be an object" };
  return {
    ok: true,
    actorId: typeof input.actor_id === "string" && input.actor_id ? input.actor_id : "unknown",
  };
}

function resolveQueueActionIdempotencyKey(input: {
  bodyValue: unknown;
  headerValue?: string;
  queueItemId: string;
  actionId: string;
}): string {
  if (typeof input.bodyValue === "string" && input.bodyValue.trim()) {
    return input.bodyValue.trim();
  }
  if (typeof input.headerValue === "string" && input.headerValue.trim()) {
    return input.headerValue.trim();
  }
  return `queue_action_${input.queueItemId}_${input.actionId}`;
}

async function findQueueItem(store: GatewayStore, queueItemId: string): Promise<QueueItemWithPacket | undefined> {
  const visible = (await store.listQueue()).find((item) => item.id === queueItemId);
  if (visible) return visible;
  for (const state of queueStates) {
    const item = (await store.listQueue(state)).find((candidate) => candidate.id === queueItemId);
    if (item) return item;
  }
  return undefined;
}

function relatedEventIdsForLineage(
  item: QueueItemWithPacket,
  activity: Array<{ event_id?: string }>,
  taskMessages: Array<{ event_ids: string[] }>,
): string[] {
  const ids = new Set<string>();
  const actionEventId = item.review_packet.recommended_action.payload.event_id;
  if (typeof actionEventId === "string" && actionEventId) ids.add(actionEventId);
  for (const event of activity) {
    if (event.event_id) ids.add(event.event_id);
  }
  for (const message of taskMessages) {
    for (const eventId of message.event_ids) {
      if (eventId) ids.add(eventId);
    }
  }
  return [...ids].sort();
}

async function executeQueueAction(
  input: {
    runtime: Runtime;
    now: Date;
    idempotencyKey?: string;
    priorAttempt?: { terminal_send_ok: boolean; terminal_send_result?: Record<string, unknown> };
  },
  item: QueueItemWithPacket,
  action: Action,
): Promise<
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; details?: unknown }
> {
  const { store, taskSessions, observability, terminalSendExecutor, terminalSendEnabled } = input.runtime;
  if (action.type === "mark_done") {
    return {
      ok: true,
      result: {
        type: "mark_done",
        queue_item_id: item.id,
        review_packet_id: item.review_packet_id,
        task_id: item.task_id,
        executed_at: input.now.toISOString(),
      },
    };
  }
  if (action.type !== "resume_agent") {
    return {
      ok: false,
      status: 422,
      code: "unsupported_action",
      message: `recommended action ${action.type} is not executable yet`,
    };
  }

  if (!taskSessions?.listSessions) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session listing is not configured",
    };
  }

  const taskId = item.task_id ?? (typeof action.payload.task_id === "string" ? action.payload.task_id : undefined);
  if (!taskId) {
    return {
      ok: false,
      status: 409,
      code: "task_session_unmatched",
      message: `queue item ${item.id} has no task id`,
    };
  }

  const session = bestTaskSessionForTask(await taskSessions.listSessions(), taskId);
  if (!session || !isRecord(session) || typeof session.id !== "string") {
    return {
      ok: false,
      status: 409,
      code: "task_session_unmatched",
      message: `no task session is bound to ${taskId}`,
    };
  }

  const eventId = typeof action.payload.event_id === "string" ? action.payload.event_id : undefined;
  const eventResult = eventId ? await store.getEvent(eventId) : undefined;
  const taskMessage = await sendTaskFollowupWithActivity({
    taskSessions: taskSessions,
    observability: observability,
    taskMessageStore: store,
  }, {
    task_session_id: session.id,
    text: taskActionFollowupText(item, eventResult?.event),
    event_ids: eventId ? [eventId] : [],
    idempotency_key: `queue_action_${item.id}_${action.id}`,
  }, {
    origin: "queue_action",
    occurredAt: input.now.toISOString(),
    queueItemId: item.id,
    taskId,
    eventId,
  });

  if (isRecord(taskMessage) && taskMessage.status === "blocked") {
    return {
      ok: false,
      status: 409,
      code: "task_message_blocked",
      message: `task session ${session.id} did not accept followup`,
      details: taskMessage,
    };
  }

  const terminalRef = isRecord(session) && typeof session.terminal_ref === "string" ? session.terminal_ref : undefined;
  let terminalSendResult: Awaited<ReturnType<typeof triggerTerminalKeystroke>> | undefined;
  let terminalSendReplayed = false;
  if (terminalRef) {
    if (input.priorAttempt?.terminal_send_ok && input.priorAttempt.terminal_send_result) {
      // Idempotent retry: terminal keystroke already succeeded. Reuse cached result.
      terminalSendResult = input.priorAttempt.terminal_send_result as Awaited<ReturnType<typeof triggerTerminalKeystroke>>;
      terminalSendReplayed = true;
    } else {
      terminalSendResult = await triggerTerminalKeystroke({
        terminalRef,
        text: taskActionFollowupText(item, eventResult?.event),
        submit: true,
        enabled: terminalSendEnabled !== false,
        executor: terminalSendExecutor,
      });
      if (terminalSendResult.ok && input.idempotencyKey) {
        await store.markQueueActionTerminalSent({
          idempotencyKey: input.idempotencyKey,
          terminalSendResult: terminalSendResult as unknown as Record<string, unknown>,
          now: input.now,
        });
      }
    }
  }

  if (terminalSendResult && !terminalSendReplayed) {
    await observability.recordActivity({
      type: "terminal_keystroke_attempted",
      occurred_at: input.now.toISOString(),
      actor: "system",
      task_id: taskId,
      queue_item_id: item.id,
      task_session_id: session.id,
      status: terminalSendResult.ok ? "ok" : "failed",
      summary: terminalSendResult.ok
        ? `Sent ${terminalSendResult.commandCount} keystroke command(s) to ${terminalRef}.`
        : `Skipped terminal keystroke (${terminalSendResult.reason}).`,
      details: sanitizeActivityDetails({
        terminal_ref: terminalRef,
        result: terminalSendResult,
      }),
    });
    if (terminalSendResult.ok) {
      await observability.incrementCounter("terminal_keystrokes_total");
    } else if (terminalSendResult.reason !== "disabled" && terminalSendResult.reason !== "no_executor") {
      await observability.incrementCounter("terminal_keystrokes_failed_total");
    }
  }

  return {
    ok: true,
    result: {
      type: "resume_agent",
      queue_item_id: item.id,
      review_packet_id: item.review_packet_id,
      task_id: taskId,
      task_session_id: session.id,
      task_message: taskMessage,
      terminal_send: terminalSendResult,
      executed_at: input.now.toISOString(),
    },
  };
}

function taskActionFollowupText(item: QueueItemWithPacket, event: McpEvent | undefined): string {
  const packet = item.review_packet;
  const lines = [
    "Human approved this queue item. Continue work with this context.",
    `Queue item: ${item.id}`,
    `Packet: ${packet.title}`,
    `Summary: ${packet.summary}`,
  ];
  if (packet.decision_needed) lines.push(`Decision: ${packet.decision_needed}`);
  if (event) {
    lines.push(`Source event: ${event.source} ${event.id}`);
    if (event.title && event.title !== packet.title) lines.push(`Source title: ${event.title}`);
    if (event.summary && event.summary !== packet.summary) lines.push(`Source body: ${event.summary}`);
    lines.push(`Raw ref: ${event.raw_ref.uri}`);
  }
  const quotes: string[] = [];
  for (const resource of packet.context) {
    const value = stringFromRecord(resource as unknown as Record<string, unknown>, "text_quote");
    if (value) quotes.push(`${resource.title ?? resource.kind}: "${truncate(value, 240)}"`);
  }
  if (quotes.length > 0) lines.push(`Quoted context:\n- ${quotes.join("\n- ")}`);
  const links = [
    ...packet.context.flatMap((resource) => resource.url ? [resource.url] : []),
    ...packet.evidence.flatMap((evidence) => evidence.url ? [evidence.url] : []),
  ];
  if (links.length > 0) lines.push(`Links: ${links.join(", ")}`);
  return lines.join("\n");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function stringFromRecord(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
}

function error(status: number, code: string, message: string, details?: unknown): RouteResult {
  return { ok: false, status, code, message, details };
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
