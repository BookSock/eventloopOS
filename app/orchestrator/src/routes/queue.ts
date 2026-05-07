import {
  queueStates,
  type Action,
  type QueueItemWithPacket,
  type QueueState,
} from "../contracts.js";
import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { Observability } from "../observability.js";
import { sendTaskFollowupWithActivity } from "../task_sessions/task_followup_audit.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import { taskSessionMatchesTask } from "./task_sessions.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleQueueRoute(input: {
  method: string | undefined;
  pathname: string;
  url: URL;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  observability: Observability;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/queue") {
    const validation = validateQueueQuery(input.url);
    if (!validation.ok) return schemaError(validation.message);

    const items = await input.store.listQueue(validation.state, input.now);
    return ok(200, {
      items,
      count: items.length,
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/queue/next") {
    return ok(200, {
      item: await input.store.nextQueueItem(input.now) ?? null,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/queue/lease-next") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("lease request must be an object");

    const validation = parseQueueLeaseRequest(parsed.value, false);
    if (!validation.ok) return schemaError(validation.message);

    return ok(200, {
      item: await input.store.leaseNextQueueItem(validation.leaseOwner, input.now, validation.leaseMs) ?? null,
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
    const item = await input.store.renewQueueLease(queueItemId, validation.leaseOwner, input.now, validation.leaseMs);
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
    const item = await input.store.markQueueItemDone(queueItemId, actorId, input.now);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    await recordQueueDone(input.observability, item);

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
    const validation = validateQueueDeferRequest(parsed.value, input.now);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(deferMatch[1] ?? "");
    const item = await input.store.deferQueueItem(queueItemId, validation.actorId, validation.dueAt, input.now);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    await input.observability.incrementCounter("queue_items_deferred_total");
    await input.observability.recordActivity({
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
    const validation = validateQueueIgnoreRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(ignoreMatch[1] ?? "");
    const item = await input.store.ignoreQueueItem(queueItemId, validation.actorId, input.now);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);
    await input.observability.incrementCounter("queue_items_ignored_total");
    await input.observability.recordActivity({
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
    const validation = validateQueueActionRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const queueItemId = decodeURIComponent(recommendedActionMatch[1] ?? "");
    const item = await findQueueItem(input.store, queueItemId);
    if (!item) return error(404, "not_found", `queue item ${queueItemId} was not found`);

    const actionResult = await executeQueueAction(input, item, item.review_packet.recommended_action);
    if (!actionResult.ok) {
      return error(actionResult.status, actionResult.code, actionResult.message, actionResult.details);
    }

    const completed = await input.store.markQueueItemDone(queueItemId, validation.actorId, input.now);
    if (completed) {
      await recordQueueDone(input.observability, completed, {
        taskSessionId: stringFromRecord(actionResult.result, "task_session_id"),
        actionResult: actionResult.result,
      });
    }
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

  return undefined;
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
    details: {
      review_packet_id: item.review_packet_id,
      action_result: extra?.actionResult,
    },
  });
}

function validateQueueQuery(url: URL): { ok: true; state?: QueueState } | { ok: false; message: string } {
  const state = url.searchParams.get("state");
  if (!state) return { ok: true };
  if (!queueStates.includes(state as QueueState)) {
    return { ok: false, message: `state must be one of: ${queueStates.join(", ")}` };
  }
  return { ok: true, state: state as QueueState };
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
): { ok: true; leaseOwner: string; leaseMs: number } | { ok: false; message: string } {
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

  return { ok: true, leaseOwner, leaseMs };
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

async function findQueueItem(store: GatewayStore, queueItemId: string): Promise<QueueItemWithPacket | undefined> {
  return (await store.listQueue()).find((item) => item.id === queueItemId);
}

async function executeQueueAction(
  input: {
    store: GatewayStore;
    taskSessions?: TaskSessionController;
    observability: Observability;
    now: Date;
  },
  item: QueueItemWithPacket,
  action: Action,
): Promise<
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; details?: unknown }
> {
  if (action.type !== "resume_agent") {
    return {
      ok: false,
      status: 422,
      code: "unsupported_action",
      message: `recommended action ${action.type} is not executable yet`,
    };
  }

  if (!input.taskSessions?.listSessions) {
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

  const session = (await input.taskSessions.listSessions()).find((candidate) => taskSessionMatchesTask(candidate, taskId));
  if (!session || !isRecord(session) || typeof session.id !== "string") {
    return {
      ok: false,
      status: 409,
      code: "task_session_unmatched",
      message: `no task session is bound to ${taskId}`,
    };
  }

  const eventId = typeof action.payload.event_id === "string" ? action.payload.event_id : undefined;
  const eventResult = eventId ? await input.store.getEvent(eventId) : undefined;
  const taskMessage = await sendTaskFollowupWithActivity({
    taskSessions: input.taskSessions,
    observability: input.observability,
    taskMessageStore: input.store,
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

  return {
    ok: true,
    result: {
      type: "resume_agent",
      queue_item_id: item.id,
      review_packet_id: item.review_packet_id,
      task_id: taskId,
      task_session_id: session.id,
      task_message: taskMessage,
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
    lines.push(`Raw ref: ${event.raw_ref.uri}`);
  }
  const links = [
    ...packet.context.flatMap((resource) => resource.url ? [resource.url] : []),
    ...packet.evidence.flatMap((evidence) => evidence.url ? [evidence.url] : []),
  ];
  if (links.length > 0) lines.push(`Links: ${links.join(", ")}`);
  return lines.join("\n");
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
