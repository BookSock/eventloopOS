import type { Observability } from "../observability.js";
import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { Runtime } from "../runtime.js";
import {
  taskMessageRecordToApiMessage,
  type DurableTaskMessageStatus,
  type TaskMessageHistoryQuery,
} from "../task_sessions/task_message_history.js";
import { recordTaskStartMessageWithActivity, sendTaskFollowupWithActivity } from "../task_sessions/task_followup_audit.js";
import { taskSessionMatchesTask } from "../task_sessions/session_selection.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import { parseWorkspaceSnapshot } from "../workspace/controller.js";
import type { WorkspaceSnapshot } from "../workspace/aerospace.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

const TASK_SESSION_RUNTIME_TIMEOUT_MS = 45_000;

export async function handleTaskSessionsRoute(input: {
  method: string | undefined;
  pathname: string;
  url: URL;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/task-messages") {
    return handleListTaskMessagesRoute({
      runtime: input.runtime,
      url: input.url,
      requestId: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/task-messages/reconcile-attempted") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    return handleReconcileAttemptedTaskMessagesRoute({
      runtime: input.runtime,
      body: parsed.value,
      occurredAt: input.now.toISOString(),
      requestId: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/task-sessions") {
    return handleListTaskSessionsRoute({
      runtime: input.runtime,
      requestId: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/task-sessions") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleStartTaskSessionRoute({
      runtime: input.runtime,
      body: parsed.value,
      idempotencyKey: input.idempotencyKey,
      now: input.now,
      requestId: input.requestId,
    });
  }

  const taskWorkspaceSnapshotMatch = input.pathname.match(/^\/tasks\/([^/]+)\/workspace-snapshot$/);
  if (input.method === "POST" && taskWorkspaceSnapshotMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleSaveTaskWorkspaceSnapshotRoute({
      runtime: input.runtime,
      taskId: decodeURIComponent(taskWorkspaceSnapshotMatch[1] ?? ""),
      body: parsed.value,
      now: input.now,
      requestId: input.requestId,
    });
  }

  const getTaskSessionMatch = input.pathname.match(/^\/task-sessions\/([^/]+)$/);
  if (input.method === "GET" && getTaskSessionMatch) {
    return handleGetTaskSessionRoute({
      runtime: input.runtime,
      taskSessionId: decodeURIComponent(getTaskSessionMatch[1] ?? ""),
      requestId: input.requestId,
    });
  }

  const taskFollowupMatch = input.pathname.match(/^\/task-sessions\/([^/]+)\/followup$/);
  if (input.method === "POST" && taskFollowupMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleTaskFollowupRoute({
      runtime: input.runtime,
      taskSessionId: decodeURIComponent(taskFollowupMatch[1] ?? ""),
      body: parsed.value,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now.toISOString(),
      requestId: input.requestId,
    });
  }

  const taskReplacementMatch = input.pathname.match(/^\/task-sessions\/([^/]+)\/replacement$/);
  if (input.method === "POST" && taskReplacementMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleTaskSessionReplacementRoute({
      runtime: input.runtime,
      taskSessionId: decodeURIComponent(taskReplacementMatch[1] ?? ""),
      body: parsed.value,
      idempotencyKey: input.idempotencyKey,
      now: input.now,
      requestId: input.requestId,
    });
  }

  const taskBindingMatch = input.pathname.match(/^\/task-sessions\/([^/]+)\/task-binding$/);
  if (input.method === "PUT" && taskBindingMatch) {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    return handleTaskBindingRoute({
      runtime: input.runtime,
      taskSessionId: decodeURIComponent(taskBindingMatch[1] ?? ""),
      body: parsed.value,
      requestId: input.requestId,
    });
  }

  return undefined;
}

async function handleSaveTaskWorkspaceSnapshotRoute(input: {
  runtime: Runtime;
  taskId: string;
  body: unknown;
  now: Date;
  requestId: string;
}): Promise<RouteResult> {
  const { store, observability } = input.runtime;
  const validation = validateTaskWorkspaceSnapshotRequest(input.body);
  if (!validation.ok) return schemaError(validation.message);
  const taskId = normalizeTaskId(input.taskId);
  if (!taskId) return schemaError("task id is required");

  const record = await store.saveTaskWorkspaceSnapshot({
    taskId,
    snapshot: validation.workspaceSnapshot,
    capturedAt: input.now,
    sourceQueueItemId: validation.sourceQueueItemId,
    actorId: validation.actorId,
  });

  await observability?.incrementCounter("task_workspace_snapshots_saved_total");
  await observability?.recordActivity({
    type: "task_workspace_snapshot_saved",
    occurred_at: record.updated_at,
    actor: "human",
    task_id: taskId,
    queue_item_id: validation.sourceQueueItemId,
    status: "ok",
    summary: `Task workspace saved: ${taskId}`,
    details: sanitizeActivityDetails({
      actor_id: validation.actorId,
      window_count: record.snapshot.windows.length,
      active_workspace: record.snapshot.activeWorkspace,
      focused_window_id: record.snapshot.focusedWindowId,
    }),
  });

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      workspace_snapshot: record,
      request_id: input.requestId,
    },
  };
}

export async function handleListTaskMessagesRoute(input: {
  runtime: Runtime;
  url: URL;
  requestId: string;
}): Promise<RouteResult> {
  const { store } = input.runtime;
  const validation = validateTaskMessageHistoryQuery(input.url.searchParams);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: "schema_error",
      message: validation.message,
    };
  }

  const records = await store.listTaskMessages(validation.query);
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

export async function handleReconcileAttemptedTaskMessagesRoute(input: {
  runtime: Runtime;
  body: unknown;
  occurredAt: string;
  requestId: string;
}): Promise<RouteResult> {
  const { store, observability } = input.runtime;
  const validation = validateReconcileAttemptedRequest(input.body);
  if (!validation.ok) return schemaError(validation.message);

  const attempted = await store.listTaskMessages({
    status: "attempted",
    limit: validation.limit,
  });
  const cutoff = new Date(input.occurredAt).getTime() - validation.olderThanMs;
  const stale = attempted.filter((message) => new Date(message.updated_at).getTime() <= cutoff);
  const reconciled = [];
  for (const message of stale) {
    const error = `stale attempted task message marked failed after ${validation.olderThanMs}ms; original text is not stored, inspect queue lineage and resend manually if needed`;
    const finalized = await store.finalizeTaskMessage({
      idempotency_key: message.idempotency_key,
      status: "failed",
      occurred_at: input.occurredAt,
      error,
    });
    if (!finalized) continue;
    reconciled.push(taskMessageRecordToApiMessage(finalized));
    await observability?.incrementCounter("task_followups_failed_total");
    await observability?.incrementCounter("task_followups_reconciled_failed_total");
    await observability?.recordActivity({
      type: "task_followup_failed",
      occurred_at: input.occurredAt,
      actor: "system",
      task_id: finalized.task_id,
      queue_item_id: finalized.queue_item_id,
      event_id: finalized.event_ids[0],
      task_session_id: finalized.task_session_id,
      source_id: finalized.source_id,
      status: "failed",
      summary: `Task followup reconciled failed: ${finalized.task_session_id}`,
      details: {
        origin: "task_message_reconcile",
        idempotency_key: finalized.idempotency_key,
        durable_id: finalized.id,
        text_hash: finalized.text_hash,
        text_length: finalized.text_length,
        error,
      },
    });
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      reconciled,
      count: reconciled.length,
      scanned: attempted.length,
      older_than_ms: validation.olderThanMs,
      request_id: input.requestId,
    },
  };
}

export async function handleListTaskSessionsRoute(input: {
  runtime: Runtime;
  requestId: string;
}): Promise<RouteResult> {
  const { taskSessions } = input.runtime;
  if (!taskSessions?.listSessions) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session listing is not configured",
    };
  }

  let sessions: unknown[];
  try {
    sessions = await withTimeout(taskSessions.listSessions(), TASK_SESSION_RUNTIME_TIMEOUT_MS, "task session list timed out");
  } catch (error) {
    return taskSessionRuntimeFailure(error, input.requestId);
  }
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
  runtime: Runtime;
  taskSessionId: string;
  requestId: string;
}): Promise<RouteResult> {
  const { taskSessions } = input.runtime;
  if (!taskSessions?.getSession) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session lookup is not configured",
    };
  }

  let session: Awaited<ReturnType<NonNullable<TaskSessionController["getSession"]>>>;
  try {
    session = await withTimeout(taskSessions.getSession(input.taskSessionId), TASK_SESSION_RUNTIME_TIMEOUT_MS, "task session lookup timed out");
  } catch (error) {
    return taskSessionRuntimeFailure(error, input.requestId);
  }
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

export async function handleStartTaskSessionRoute(input: {
  runtime: Runtime;
  body: unknown;
  idempotencyKey?: string;
  now: Date;
  requestId: string;
}): Promise<RouteResult> {
  const { store, taskSessions, observability } = input.runtime;
  if (!taskSessions?.startTaskSession) {
    return {
      ok: false,
      status: 501,
      code: "task_start_unavailable",
      message: "task session start is not configured",
    };
  }

  const validation = validateTaskStartRequest(input.body, input.idempotencyKey);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: "schema_error",
      message: validation.message,
    };
  }

  const existingTaskMessage = await store.getTaskMessageByIdempotencyKey(validation.idempotencyKey);
  if (existingTaskMessage) {
    const message = taskMessageRecordToApiMessage(existingTaskMessage);
    return {
      ok: true,
      status: 202,
      body: {
        ok: true,
        started: {
          ok: existingTaskMessage.status === "sent",
          task_id: validation.taskId,
          task_session_id: existingTaskMessage.task_session_id,
          message,
          deduped: true,
          error: existingTaskMessage.error,
        },
        task_message: message,
        request_id: input.requestId,
      },
    };
  }

  const started = await withTimeout(taskSessions.startTaskSession({
      task_id: validation.taskId,
      prompt: validation.prompt,
      cwd: validation.cwd,
      model: validation.model,
      idempotency_key: validation.idempotencyKey,
    }),
    TASK_SESSION_RUNTIME_TIMEOUT_MS,
    "task session start timed out",
  ).catch((error) => ({
    ok: false,
    task_id: validation.taskId,
    error: error instanceof Error ? error.message : String(error),
  }));

  const taskMessage = await recordTaskStartMessageWithActivity({
    taskSessions,
    observability,
    taskMessageStore: store,
  }, {
    started,
    prompt: validation.prompt,
    idempotency_key: validation.idempotencyKey,
    task_id: validation.taskId,
  }, {
    origin: "task_session_start",
    occurredAt: input.now.toISOString(),
  });

  if (isRecord(started) && started.ok === false) {
    return {
      ok: false,
      status: 409,
      code: "task_start_failed",
      message: typeof started.error === "string" ? started.error : "task start failed",
      details: started,
    };
  }

  const taskRecord = await store.createTask({
    taskId: validation.taskId,
    primaryAnchor: {
      kind: "codex_thread",
      id: taskStartPrimaryAnchorId(started, validation.taskId),
    },
    capturedLayout: validation.workspaceSnapshot ?? emptyWorkspaceSnapshot(),
    now: input.now,
  });
  const workspaceRecord = validation.workspaceSnapshot
    ? await store.saveTaskWorkspaceSnapshot({
      taskId: validation.taskId,
      snapshot: validation.workspaceSnapshot,
      capturedAt: input.now,
      actorId: "master_command",
    })
    : undefined;
  const queuedPaper = validation.queuePaper
    ? await store.ingestEventAsReviewPacket(
      taskStartEvent({
        taskId: validation.taskId,
        prompt: validation.prompt,
        idempotencyKey: validation.idempotencyKey,
        now: input.now,
      }),
      input.now,
    )
    : undefined;

  if (queuedPaper?.queue_item) {
    await observability?.incrementCounter("master_task_start_queue_papers_total");
  }

  return {
    ok: true,
    status: 202,
    body: {
      ok: true,
      started,
      task_message: taskMessage,
      task: taskRecord.task,
      workspace_snapshot: workspaceRecord ?? taskRecord.layout,
      queue_item: queuedPaper?.queue_item,
      review_packet: queuedPaper?.review_packet,
      request_id: input.requestId,
    },
  };
}

function taskStartPrimaryAnchorId(started: unknown, fallbackTaskId: string): string {
  if (isRecord(started)) {
    if (typeof started.native_thread_id === "string" && started.native_thread_id.trim()) {
      return started.native_thread_id.trim();
    }
    if (typeof started.task_session_id === "string" && started.task_session_id.trim()) {
      return started.task_session_id.trim();
    }
  }
  return fallbackTaskId;
}

function emptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    backend: "aerospace",
    windows: [],
  };
}

export async function handleTaskSessionReplacementRoute(input: {
  runtime: Runtime;
  taskSessionId: string;
  body: unknown;
  idempotencyKey?: string;
  now: Date;
  requestId: string;
}): Promise<RouteResult> {
  const { taskSessions } = input.runtime;
  if (!taskSessions?.getSession || !taskSessions.startTaskSession) {
    return {
      ok: false,
      status: 501,
      code: "task_replacement_unavailable",
      message: "task session replacement is not configured",
    };
  }

  const validation = validateTaskReplacementRequest(input.body, input.idempotencyKey);
  if (!validation.ok) return schemaError(validation.message);

  let replacedSession: Awaited<ReturnType<NonNullable<TaskSessionController["getSession"]>>>;
  try {
    replacedSession = await withTimeout(taskSessions.getSession(input.taskSessionId), TASK_SESSION_RUNTIME_TIMEOUT_MS, "task session lookup timed out");
  } catch (error) {
    return taskSessionRuntimeFailure(error, input.requestId);
  }
  if (!replacedSession) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: `task session ${input.taskSessionId} was not found`,
    };
  }
  const taskId = isRecord(replacedSession) && typeof replacedSession.task_id === "string" ? replacedSession.task_id : "";
  if (!taskId) {
    return {
      ok: false,
      status: 409,
      code: "task_session_unbound",
      message: `task session ${input.taskSessionId} is not bound to a task`,
    };
  }

  const replacement = await handleStartTaskSessionRoute({
    runtime: input.runtime,
    body: {
      task_id: taskId,
      prompt: validation.prompt,
      cwd: validation.cwd ?? (isRecord(replacedSession) && typeof replacedSession.cwd === "string" ? replacedSession.cwd : undefined),
      model: validation.model,
      idempotency_key: validation.idempotencyKey,
    },
    idempotencyKey: validation.idempotencyKey,
    now: input.now,
    requestId: input.requestId,
  });
  if (!replacement.ok) return replacement;

  return {
    ok: true,
    status: replacement.status,
    body: {
      ...replacement.body,
      replaced_session: replacedSession,
      replacement_for_task_session_id: input.taskSessionId,
    },
  };
}

export async function handleTaskFollowupRoute(input: {
  runtime: Runtime;
  taskSessionId: string;
  body: unknown;
  idempotencyKey?: string;
  occurredAt: string;
  requestId: string;
}): Promise<RouteResult> {
  const { taskSessions, observability, store } = input.runtime;
  if (!taskSessions) {
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

  let session: Awaited<ReturnType<NonNullable<TaskSessionController["getSession"]>>> | undefined;
  if (taskSessions.getSession) {
    try {
      session = await withTimeout(taskSessions.getSession(input.taskSessionId), TASK_SESSION_RUNTIME_TIMEOUT_MS, "task session lookup timed out");
    } catch (error) {
      session = undefined;
    }
  }
  const taskId = isRecord(session) && typeof session.task_id === "string" ? session.task_id : undefined;
  let message: Awaited<ReturnType<typeof sendTaskFollowupWithActivity>>;
  try {
    message = await withTimeout(sendTaskFollowupWithActivity({
      taskSessions: taskSessions,
      observability: observability,
      taskMessageStore: store,
    }, {
      task_session_id: input.taskSessionId,
      text: validation.text,
      event_ids: validation.eventIds,
      idempotency_key: validation.idempotencyKey,
    }, {
      origin: "task_session_api",
      occurredAt: input.occurredAt,
      taskId,
      policy: {
        hook: "before_task_message",
        surface: "task_message",
        untrusted_source_text: validation.untrustedSourceText ?? validation.text,
        evidence: [],
        scope_kind: "agent_session",
        scope_id: input.taskSessionId,
      },
    }), TASK_SESSION_RUNTIME_TIMEOUT_MS, "task followup timed out");
  } catch (error) {
    return taskSessionRuntimeFailure(error, input.requestId);
  }

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
  runtime: Runtime;
  taskSessionId: string;
  body: unknown;
  requestId: string;
}): Promise<RouteResult> {
  const { taskSessions } = input.runtime;
  if (!taskSessions?.bindTaskSession) {
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

  const binding = await taskSessions.bindTaskSession({
    task_session_id: input.taskSessionId,
    task_id: validation.taskId,
    ...(validation.terminalRef ? { terminal_ref: validation.terminalRef } : {}),
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

export { taskSessionMatchesTask };

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

function validateReconcileAttemptedRequest(input: unknown): {
  ok: true;
  olderThanMs: number;
  limit: number;
} | { ok: false; message: string } {
  if (!isRecord(input) || input.action !== "mark_failed") {
    return { ok: false, message: "reconcile attempted request requires action=mark_failed" };
  }
  const olderThanMs = typeof input.older_than_ms === "number" ? input.older_than_ms : 30 * 60 * 1000;
  if (!Number.isInteger(olderThanMs) || olderThanMs <= 0) {
    return { ok: false, message: "older_than_ms must be a positive integer" };
  }
  const limit = typeof input.limit === "number" ? input.limit : 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    return { ok: false, message: "limit must be an integer between 1 and 500" };
  }
  return { ok: true, olderThanMs, limit };
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

function validateTaskReplacementRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
): {
  ok: true;
  prompt: string;
  cwd?: string;
  model?: string;
  idempotencyKey: string;
} | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task replacement request must be an object" };
  }

  const prompt = typeof input.prompt === "string" && input.prompt.trim()
    ? input.prompt.trim()
    : typeof input.text === "string" && input.text.trim()
      ? input.text.trim()
      : "";
  if (!prompt) return { ok: false, message: "prompt or text must be a non-empty string" };

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey;
  if (!idempotencyKey) return { ok: false, message: "idempotency_key or Idempotency-Key header is required" };

  return {
    ok: true,
    prompt,
    cwd: typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined,
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined,
    idempotencyKey,
  };
}

function validateTaskStartRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
): {
  ok: true;
  taskId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  queuePaper: boolean;
  workspaceSnapshot?: WorkspaceSnapshot;
  idempotencyKey: string;
} | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task start request must be an object" };
  }

  const taskId = typeof input.task_id === "string" ? input.task_id.trim() : "";
  if (!taskId) return { ok: false, message: "task_id must be a non-empty string" };
  if (!/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(taskId)) {
    return { ok: false, message: "task_id must start with task_ and contain only letters, numbers, underscores, or hyphens" };
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, message: "prompt must be a non-empty string" };

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey;
  if (!idempotencyKey) return { ok: false, message: "idempotency_key or Idempotency-Key header is required" };

  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined;
  const queuePaper = input.queue_paper === true;
  let workspaceSnapshot: WorkspaceSnapshot | undefined;
  if (input.workspace_snapshot !== undefined && input.workspace_snapshot !== null) {
    try {
      workspaceSnapshot = parseWorkspaceSnapshot(input.workspace_snapshot);
    } catch (error) {
      return {
        ok: false,
        message: `workspace_snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    ok: true,
    taskId,
    prompt,
    cwd,
    model,
    queuePaper,
    workspaceSnapshot,
    idempotencyKey,
  };
}

function taskStartEvent(input: {
  taskId: string;
  prompt: string;
  idempotencyKey: string;
  now: Date;
}): McpEvent {
  const nowIso = input.now.toISOString();
  const eventSlug = stableSlug(`${input.taskId}_${input.idempotencyKey}`);
  const title = input.taskId.replace(/^task_/, "").replaceAll("_", " ");
  return {
    id: `evt_master_task_start_${eventSlug}`,
    source: "master",
    source_id: `master:start:${input.idempotencyKey}`,
    idempotency_key: `master:start:paper:${input.idempotencyKey}`,
    occurred_at: nowIso,
    received_at: nowIso,
    actor: { id: "master_command", type: "human" },
    task_hint: input.taskId.replace(/^task_/, ""),
    type: "manual.review_requested",
    title: `Start ${title}`,
    summary: input.prompt,
    raw_ref: {
      id: `raw_master_task_start_${eventSlug}`,
      uri: `master://task-start/${input.taskId}`,
      media_type: "text/plain",
    },
    links: [],
    resources: [{
      id: `ctx_master_task_start_${eventSlug}`,
      kind: "manual_note",
      title: `Master command for ${title}`,
      source: "master",
      captured_at: nowIso,
      restore_confidence: "medium",
      details: {
        task_id: input.taskId,
      },
    }],
  };
}

function stableSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "unknown";
}

function normalizeTaskId(value: string): string | undefined {
  const taskId = value.trim();
  if (!taskId || taskId.length > 200) return undefined;
  if (!/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(taskId)) return undefined;
  return taskId;
}

function validateTaskWorkspaceSnapshotRequest(input: unknown): {
  ok: true;
  workspaceSnapshot: WorkspaceSnapshot;
  actorId: string;
  sourceQueueItemId?: string;
} | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task workspace snapshot request must be an object" };
  }

  const rawSnapshot = input.workspace_snapshot ?? input.workspaceSnapshot;
  if (rawSnapshot === undefined || rawSnapshot === null) {
    return { ok: false, message: "workspace_snapshot is required" };
  }

  let workspaceSnapshot: WorkspaceSnapshot;
  try {
    workspaceSnapshot = parseWorkspaceSnapshot(rawSnapshot);
  } catch (error) {
    return {
      ok: false,
      message: `workspace_snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    ok: true,
    workspaceSnapshot,
    actorId: typeof input.actor_id === "string" && input.actor_id ? input.actor_id : "unknown",
    sourceQueueItemId: typeof input.source_queue_item_id === "string" && input.source_queue_item_id ? input.source_queue_item_id : undefined,
  };
}

function validateTaskBindingRequest(input: unknown): { ok: true; taskId: string; terminalRef?: string } | { ok: false; message: string } {
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

  let terminalRef: string | undefined;
  if (input.terminal_ref !== undefined && input.terminal_ref !== null) {
    if (typeof input.terminal_ref !== "string") {
      return { ok: false, message: "terminal_ref must be a string" };
    }
    const trimmed = input.terminal_ref.trim();
    if (trimmed.length === 0) {
      return { ok: false, message: "terminal_ref must be non-empty when provided" };
    }
    if (trimmed.length > 200) {
      return { ok: false, message: "terminal_ref must be 200 characters or fewer" };
    }
    if (!/^(ghostty|tmux|kitty|wezterm):/i.test(trimmed)) {
      return { ok: false, message: "terminal_ref must start with ghostty:, tmux:, kitty:, or wezterm:" };
    }
    terminalRef = trimmed;
  }

  return {
    ok: true,
    taskId,
    terminalRef,
  };
}

async function withTimeout<T>(promise: Promise<T> | T, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function taskSessionRuntimeFailure(error: unknown, requestId: string): RouteResult {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = /timed out/i.test(message);
  return {
    ok: false,
    status: timedOut ? 504 : 500,
    code: timedOut ? "task_session_runtime_timeout" : "task_session_runtime_error",
    message,
    details: {
      request_id: requestId,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
