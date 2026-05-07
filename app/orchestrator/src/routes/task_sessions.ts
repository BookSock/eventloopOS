import type { Observability } from "../observability.js";
import type { GatewayStore } from "../gateway_store.js";
import {
  taskMessageRecordToApiMessage,
  type DurableTaskMessageStatus,
  type TaskMessageHistoryQuery,
} from "../task_sessions/task_message_history.js";
import { sendTaskFollowupWithActivity } from "../task_sessions/task_followup_audit.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleTaskSessionsRoute(input: {
  method: string | undefined;
  pathname: string;
  url: URL;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  observability?: Observability;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/task-messages") {
    return handleListTaskMessagesRoute({
      store: input.store,
      url: input.url,
      requestId: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/task-sessions") {
    return handleListTaskSessionsRoute({
      taskSessions: input.taskSessions,
      requestId: input.requestId,
    });
  }

  const getTaskSessionMatch = input.pathname.match(/^\/task-sessions\/([^/]+)$/);
  if (input.method === "GET" && getTaskSessionMatch) {
    return handleGetTaskSessionRoute({
      taskSessions: input.taskSessions,
      taskSessionId: decodeURIComponent(getTaskSessionMatch[1] ?? ""),
      requestId: input.requestId,
    });
  }

  const taskFollowupMatch = input.pathname.match(/^\/task-sessions\/([^/]+)\/followup$/);
  if (input.method === "POST" && taskFollowupMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleTaskFollowupRoute({
      taskSessions: input.taskSessions,
      observability: input.observability,
      store: input.store,
      taskSessionId: decodeURIComponent(taskFollowupMatch[1] ?? ""),
      body: parsed.value,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now.toISOString(),
      requestId: input.requestId,
    });
  }

  const taskBindingMatch = input.pathname.match(/^\/task-sessions\/([^/]+)\/task-binding$/);
  if (input.method === "PUT" && taskBindingMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleTaskBindingRoute({
      taskSessions: input.taskSessions,
      taskSessionId: decodeURIComponent(taskBindingMatch[1] ?? ""),
      body: parsed.value,
      requestId: input.requestId,
    });
  }

  return undefined;
}

export async function handleListTaskMessagesRoute(input: {
  store: GatewayStore;
  url: URL;
  requestId: string;
}): Promise<RouteResult> {
  const validation = validateTaskMessageHistoryQuery(input.url.searchParams);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: "schema_error",
      message: validation.message,
    };
  }

  const records = await input.store.listTaskMessages(validation.query);
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      messages: records.map(taskMessageRecordToApiMessage),
      count: records.length,
      request_id: input.requestId,
    },
  };
}

export async function handleListTaskSessionsRoute(input: {
  taskSessions?: TaskSessionController;
  requestId: string;
}): Promise<RouteResult> {
  if (!input.taskSessions?.listSessions) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session listing is not configured",
    };
  }

  const sessions = await input.taskSessions.listSessions();
  return {
    ok: true,
    status: 200,
    body: {
      sessions,
      count: Array.isArray(sessions) ? sessions.length : 0,
      request_id: input.requestId,
    },
  };
}

export async function handleGetTaskSessionRoute(input: {
  taskSessions?: TaskSessionController;
  taskSessionId: string;
  requestId: string;
}): Promise<RouteResult> {
  if (!input.taskSessions?.getSession) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session lookup is not configured",
    };
  }

  const session = await input.taskSessions.getSession(input.taskSessionId);
  if (!session) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: `task session ${input.taskSessionId} was not found`,
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      session,
      request_id: input.requestId,
    },
  };
}

export async function handleTaskFollowupRoute(input: {
  taskSessions?: TaskSessionController;
  observability?: Observability;
  store: GatewayStore;
  taskSessionId: string;
  body: unknown;
  idempotencyKey?: string;
  occurredAt: string;
  requestId: string;
}): Promise<RouteResult> {
  if (!input.taskSessions) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session controller is not configured",
    };
  }

  const validation = validateTaskFollowupRequest(input.body, input.idempotencyKey);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: "schema_error",
      message: validation.message,
    };
  }

  const message = await sendTaskFollowupWithActivity({
    taskSessions: input.taskSessions,
    observability: input.observability,
    taskMessageStore: input.store,
  }, {
    task_session_id: input.taskSessionId,
    text: validation.text,
    event_ids: validation.eventIds,
    idempotency_key: validation.idempotencyKey,
  }, {
    origin: "task_session_api",
    occurredAt: input.occurredAt,
    policy: {
      hook: "before_task_message",
      surface: "task_message",
      untrusted_source_text: validation.untrustedSourceText ?? validation.text,
      evidence: [],
      scope_kind: "agent_session",
      scope_id: input.taskSessionId,
    },
  });

  return {
    ok: true,
    status: 202,
    body: {
      ok: true,
      message,
      request_id: input.requestId,
    },
  };
}

export async function handleTaskBindingRoute(input: {
  taskSessions?: TaskSessionController;
  taskSessionId: string;
  body: unknown;
  requestId: string;
}): Promise<RouteResult> {
  if (!input.taskSessions?.bindTaskSession) {
    return {
      ok: false,
      status: 501,
      code: "task_binding_unavailable",
      message: "task session binding is not configured",
    };
  }

  const validation = validateTaskBindingRequest(input.body);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: "schema_error",
      message: validation.message,
    };
  }

  const binding = await input.taskSessions.bindTaskSession({
    task_session_id: input.taskSessionId,
    task_id: validation.taskId,
  });

  if (isRecord(binding) && binding.ok === false) {
    return {
      ok: false,
      status: typeof binding.error === "string" && binding.error.includes("was not found") ? 404 : 409,
      code: "task_binding_failed",
      message: typeof binding.error === "string" ? binding.error : "task session binding failed",
      details: binding,
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      binding,
      request_id: input.requestId,
    },
  };
}

export function taskSessionMatchesTask(candidate: unknown, taskId: string): candidate is { id: string; task_id: string } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0 && record.task_id === taskId;
}

function schemaError(message: string): RouteResult {
  return {
    ok: false,
    status: 400,
    code: "schema_error",
    message,
  };
}

function validateTaskMessageHistoryQuery(searchParams: URLSearchParams): {
  ok: true;
  query: TaskMessageHistoryQuery;
} | { ok: false; message: string } {
  const status = nonEmptyParam(searchParams, "status");
  let statusValue: DurableTaskMessageStatus | undefined;
  if (status) {
    if (!isTaskMessageStatus(status)) {
      return { ok: false, message: "status must be attempted, sent, blocked, or failed" };
    }
    statusValue = status;
  }

  const limitText = nonEmptyParam(searchParams, "limit");
  const parsedLimit = limitText ? Number(limitText) : undefined;
  if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    return { ok: false, message: "limit must be a positive number" };
  }
  const limit = parsedLimit === undefined ? undefined : Math.floor(parsedLimit);

  return {
    ok: true,
    query: {
      task_session_id: nonEmptyParam(searchParams, "task_session_id") ?? nonEmptyParam(searchParams, "session"),
      task_id: nonEmptyParam(searchParams, "task_id"),
      queue_item_id: nonEmptyParam(searchParams, "queue_item_id"),
      event_id: nonEmptyParam(searchParams, "event_id"),
      idempotency_key: nonEmptyParam(searchParams, "idempotency_key"),
      status: statusValue,
      limit,
    },
  };
}

function isTaskMessageStatus(input: string): input is DurableTaskMessageStatus {
  return input === "attempted" || input === "sent" || input === "blocked" || input === "failed";
}

function nonEmptyParam(searchParams: URLSearchParams, name: string): string | undefined {
  const value = searchParams.get(name)?.trim();
  return value || undefined;
}

function validateTaskFollowupRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
): {
  ok: true;
  text: string;
  eventIds: string[];
  idempotencyKey: string;
  untrustedSourceText?: string;
} | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task followup request must be an object" };
  }

  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    return { ok: false, message: "text must be a non-empty string" };
  }

  const eventIds = Array.isArray(input.event_ids) ? input.event_ids : [];
  if (!eventIds.every((eventId) => typeof eventId === "string" && eventId.length > 0)) {
    return { ok: false, message: "event_ids must be an array of non-empty strings" };
  }

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey;
  if (!idempotencyKey) {
    return { ok: false, message: "idempotency_key or Idempotency-Key header is required" };
  }

  return {
    ok: true,
    text,
    eventIds,
    idempotencyKey,
    untrustedSourceText: typeof input.untrusted_source_text === "string" && input.untrusted_source_text
      ? input.untrusted_source_text
      : undefined,
  };
}

function validateTaskBindingRequest(input: unknown): { ok: true; taskId: string } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task binding request must be an object" };
  }

  const taskId = typeof input.task_id === "string" ? input.task_id.trim() : "";
  if (!taskId) {
    return { ok: false, message: "task_id must be a non-empty string" };
  }
  if (taskId.length > 200) {
    return { ok: false, message: "task_id must be 200 characters or fewer" };
  }
  if (!/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(taskId)) {
    return { ok: false, message: "task_id must start with task_ and contain only letters, numbers, underscores, or hyphens" };
  }

  return {
    ok: true,
    taskId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
