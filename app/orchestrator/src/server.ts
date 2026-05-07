import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { ApiErrorBody } from "./contracts.js";
import type { GatewayStore } from "./gateway_store.js";
import type { McpEvent } from "./integrations/mcp_poll/types.js";
import { createInMemoryObservability, type Observability } from "./observability.js";
import { handleContextRestoreRoute } from "./routes/context_restore.js";
import { handleMcpSourcesRoute, validateMcpPollRequest, type McpSourceRegistry } from "./routes/mcp_sources.js";
import { handleActivityRoute, handleMetricsRoute } from "./routes/observability.js";
import { handleQueueRoute } from "./routes/queue.js";
import {
  handleGetTaskSessionRoute,
  handleListTaskSessionsRoute,
  handleTaskBindingRoute,
  handleTaskFollowupRoute,
} from "./routes/task_sessions.js";
import type { RouteResult } from "./routes/types.js";
import { handleWorkspaceRoute } from "./routes/workspace.js";
import { injectEventIntoTaskSessionIfPossible } from "./routing/task_session_injection.js";
import type { RouteDecision } from "./store.js";
import { sendTaskFollowupWithActivity } from "./task_sessions/task_followup_audit.js";
import type { TaskSessionController } from "./task_sessions/types.js";
import type { WorkspaceController } from "./workspace/controller.js";

export type GatewayServerOptions = {
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  mcpSources?: McpSourceRegistry;
  workspace?: WorkspaceController;
  workspaceExecuteEnabled?: boolean;
  observability?: Observability;
  now?: () => Date;
};

type RequestContext = {
  requestId: string;
  idempotencyKey?: string;
  url: URL;
};

export function createGatewayServer(options: GatewayServerOptions): Server {
  const now = options.now ?? (() => new Date());
  const observability = options.observability ?? createInMemoryObservability();
  const serverOptions = { ...options, observability };

  return createServer(async (request, response) => {
    const context = buildContext(request);
    applyResponseHeaders(response, context);

    try {
      if (request.method === "GET" && context.url.pathname === "/health") {
        return sendJson(response, 200, {
          ok: true,
          service: "eventloop-orchestrator",
          time: now().toISOString(),
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname === "/metrics") {
        return sendRouteResult(response, context, await handleMetricsRoute({
          observability,
          generatedAt: now().toISOString(),
          requestId: context.requestId,
        }));
      }

      if (request.method === "GET" && context.url.pathname === "/activity") {
        return sendRouteResult(response, context, await handleActivityRoute({
          observability,
          url: context.url,
          requestId: context.requestId,
        }));
      }

      const queueRoute = await handleQueueRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        store: options.store,
        taskSessions: options.taskSessions,
        observability,
        now: now(),
        requestId: context.requestId,
      });
      if (queueRoute) {
        return sendRouteResult(response, context, queueRoute);
      }

      if (request.method === "GET" && context.url.pathname === "/contexts") {
        const validation = validateContextQuery(context.url);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }

        const entries = await options.store.listContextEntries(validation.query);
        return sendJson(response, 200, {
          entries,
          count: entries.length,
          request_id: context.requestId,
        });
      }

      const contextRestoreRoute = await handleContextRestoreRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        store: options.store,
        observability,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (contextRestoreRoute) {
        return sendRouteResult(response, context, contextRestoreRoute);
      }

      const workspaceRoute = await handleWorkspaceRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        store: options.store,
        workspace: options.workspace,
        workspaceExecuteEnabled: options.workspaceExecuteEnabled,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (workspaceRoute) {
        return sendRouteResult(response, context, workspaceRoute);
      }

      const mcpSourcesRoute = await handleMcpSourcesRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        mcpSources: options.mcpSources,
        observability,
        now: now(),
        requestId: context.requestId,
        routeEvent: (event, routedAt) => routeEventThroughGateway(serverOptions, event, routedAt),
      });
      if (mcpSourcesRoute) {
        return sendRouteResult(response, context, mcpSourcesRoute);
      }

      if (request.method === "GET" && context.url.pathname === "/task-sessions") {
        return sendRouteResult(response, context, await handleListTaskSessionsRoute({
          taskSessions: options.taskSessions,
          requestId: context.requestId,
        }));
      }

      const getTaskSessionMatch = context.url.pathname.match(/^\/task-sessions\/([^/]+)$/);
      if (request.method === "GET" && getTaskSessionMatch) {
        const taskSessionId = decodeURIComponent(getTaskSessionMatch[1] ?? "");
        return sendRouteResult(response, context, await handleGetTaskSessionRoute({
          taskSessions: options.taskSessions,
          taskSessionId,
          requestId: context.requestId,
        }));
      }

      const taskFollowupMatch = context.url.pathname.match(/^\/task-sessions\/([^/]+)\/followup$/);
      if (request.method === "POST" && taskFollowupMatch) {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const taskSessionId = decodeURIComponent(taskFollowupMatch[1] ?? "");
        return sendRouteResult(response, context, await handleTaskFollowupRoute({
          taskSessions: options.taskSessions,
          observability,
          taskSessionId,
          body: parsed.value,
          idempotencyKey: context.idempotencyKey,
          occurredAt: now().toISOString(),
          requestId: context.requestId,
        }));
      }

      const taskBindingMatch = context.url.pathname.match(/^\/task-sessions\/([^/]+)\/task-binding$/);
      if (request.method === "PUT" && taskBindingMatch) {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const taskSessionId = decodeURIComponent(taskBindingMatch[1] ?? "");
        return sendRouteResult(response, context, await handleTaskBindingRoute({
          taskSessions: options.taskSessions,
          taskSessionId,
          body: parsed.value,
          requestId: context.requestId,
        }));
      }

      if (request.method === "POST" && context.url.pathname === "/mcp/poll") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const pollValidation = validateMcpPollRequest(parsed.value, now().toISOString());
        if (!pollValidation.ok) {
          return sendSchemaError(response, context, pollValidation.message);
        }

        return sendJson(response, 200, {
          source_id: pollValidation.sourceId,
          events: pollValidation.events,
          duplicates_ignored: 0,
          cursor: pollValidation.cursor,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/events") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const eventValidation = validateEventRequest(parsed.value);
        if (!eventValidation.ok) {
          return sendSchemaError(response, context, eventValidation.message);
        }

        const routed = await routeEventThroughGateway(serverOptions, eventValidation.event, now());

        return sendJson(response, 202, {
          ok: true,
          ...routed,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/voice/commands") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const voiceValidation = validateVoiceCommandRequest(parsed.value, context.idempotencyKey, now().toISOString());
        if (!voiceValidation.ok) {
          return sendSchemaError(response, context, voiceValidation.message);
        }

        const routed = await routeEventThroughGateway(serverOptions, voiceValidation.event, now());

        return sendJson(response, 202, {
          ok: true,
          ...routed,
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname.startsWith("/events/")) {
        const id = decodeURIComponent(context.url.pathname.slice("/events/".length));

        if (!id) {
          return sendSchemaError(response, context, "event id is required");
        }

        const result = await options.store.getEvent(id);
        if (!result) {
          return sendError(response, 404, context, "not_found", `event ${id} was not found`);
        }

        return sendJson(response, 200, {
          event: result.event,
          route_decision: result.route_decision,
          review_packet: result.review_packet,
          queue_item: result.queue_item,
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname.startsWith("/review-packets/")) {
        const id = decodeURIComponent(context.url.pathname.slice("/review-packets/".length));

        if (!id) {
          return sendSchemaError(response, context, "review packet id is required");
        }

        const packet = await options.store.getReviewPacket(id);
        if (!packet) {
          return sendError(response, 404, context, "not_found", `review packet ${id} was not found`);
        }

        return sendJson(response, 200, {
          packet,
          request_id: context.requestId,
        });
      }

      return sendError(response, 404, context, "not_found", "route not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return sendError(response, 500, context, "internal_error", message);
    }
  });
}

function buildContext(request: IncomingMessage): RequestContext {
  const requestId = headerString(request.headers["x-request-id"]) ?? `req_${randomUUID()}`;
  const idempotencyKey = headerString(request.headers["idempotency-key"]);
  const host = request.headers.host ?? "127.0.0.1";

  return {
    requestId,
    idempotencyKey,
    url: new URL(request.url ?? "/", `http://${host}`),
  };
}

function applyResponseHeaders(response: ServerResponse, context: RequestContext): void {
  response.setHeader("x-request-id", context.requestId);
  if (context.idempotencyKey) {
    response.setHeader("idempotency-key", context.idempotencyKey);
  }
}

function validateContextQuery(
  url: URL,
): { ok: true; query: { source?: string; task_id?: string; q?: string; limit?: number } } | { ok: false; message: string } {
  const source = url.searchParams.get("source") ?? undefined;
  const taskId = url.searchParams.get("task_id") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (source !== undefined && !source) {
    return { ok: false, message: "source must be non-empty when provided" };
  }
  if (taskId !== undefined && !taskId) {
    return { ok: false, message: "task_id must be non-empty when provided" };
  }
  if (q !== undefined && !q.trim()) {
    return { ok: false, message: "q must be non-empty when provided" };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 500)) {
    return { ok: false, message: "limit must be an integer between 1 and 500" };
  }

  return {
    ok: true,
    query: {
      source,
      task_id: taskId,
      q: q?.trim(),
      limit,
    },
  };
}

function validateEventRequest(input: unknown): { ok: true; event: McpEvent } | { ok: false; message: string } {
  const event = isRecord(input) && isRecord(input.event) ? input.event : input;
  if (!isRecord(event)) {
    return { ok: false, message: "event request must be an object or { event }" };
  }

  const requiredStrings = [
    "id",
    "source",
    "source_id",
    "idempotency_key",
    "occurred_at",
    "received_at",
    "type",
    "title",
  ];
  for (const field of requiredStrings) {
    if (typeof event[field] !== "string" || !event[field]) {
      return { ok: false, message: `event.${field} must be a non-empty string` };
    }
  }

  if (!isRecord(event.raw_ref)) {
    return { ok: false, message: "event.raw_ref must be an object" };
  }
  if (!Array.isArray(event.links)) {
    return { ok: false, message: "event.links must be an array" };
  }
  if (!Array.isArray(event.resources)) {
    return { ok: false, message: "event.resources must be an array" };
  }

  return { ok: true, event: event as McpEvent };
}

async function routeEventThroughGateway(
  options: GatewayServerOptions,
  event: McpEvent,
  now: Date,
): Promise<{
  event: McpEvent;
  route_decision: RouteDecision;
  review_packet?: unknown;
  queue_item?: unknown;
  task_message?: unknown;
}> {
  const existing = await options.store.getEventByIdempotencyKey(event.source, event.idempotency_key);
  if (existing) {
    return {
      event: existing.event,
      route_decision: existing.route_decision,
      review_packet: existing.review_packet,
      queue_item: existing.queue_item,
    };
  }

  let injected: Awaited<ReturnType<typeof injectEventIntoTaskSessionIfPossible>>;
  let taskMessageError: string | undefined;
  try {
    injected = await injectEventIntoTaskSessionIfPossible(
      event,
      options.taskSessions,
      options.store,
      now,
      (input) => sendTaskFollowupWithActivity(options, input, {
        origin: "event_route",
        occurredAt: now.toISOString(),
        eventId: event.id,
        sourceId: event.source_id,
      }),
    );
  } catch (error) {
    taskMessageError = error instanceof Error ? error.message : String(error);
  }
  if (injected) {
    if (isRecord(injected.taskMessage) && injected.taskMessage.status === "blocked") {
      taskMessageError = "task followup blocked";
    } else {
      const result = await options.store.recordEventRoute(event, injected.routeDecision, now);
      await recordRoutedEventActivity(options, event, result.route_decision, {
        taskMessage: injected.taskMessage,
        queueItemId: undefined,
      });
      return {
        event,
        route_decision: result.route_decision,
        task_message: injected.taskMessage,
      };
    }
  }

  const result = await options.store.ingestEventAsReviewPacket(event, now);
  await recordRoutedEventActivity(options, event, result.route_decision, {
    queueItemId: result.queue_item?.id,
    taskMessage: injected?.taskMessage,
    taskMessageError,
  });
  return {
    event,
    route_decision: result.route_decision,
    review_packet: result.review_packet,
    queue_item: result.queue_item,
  };
}

async function recordRoutedEventActivity(
  options: GatewayServerOptions,
  event: McpEvent,
  routeDecision: RouteDecision,
  input: { taskMessage?: unknown; queueItemId?: string | undefined; taskMessageError?: string | undefined },
): Promise<void> {
  const observability = options.observability;
  if (!observability) return;

  await observability.incrementCounter("events_ingested_total");
  if (routeDecision.action === "inject_into_agent_thread") {
    await observability.incrementCounter("events_routed_to_task_session_total");
  }
  if (input.queueItemId) {
    await observability.incrementCounter("queue_items_created_total");
  }
  await observability.recordActivity({
    type: "event_routed",
    occurred_at: routeDecision.created_at,
    actor: "system",
    task_id: routeDecision.target_task_id,
    queue_item_id: input.queueItemId,
    event_id: event.id,
    task_session_id: routeDecision.target_task_session_id,
    source_id: event.source_id,
    status: "ok",
    summary: `Event routed: ${event.title}`,
    details: {
      source: event.source,
      type: event.type,
      route_action: routeDecision.action,
      confidence: routeDecision.confidence,
      task_message: input.taskMessage,
      task_message_error: input.taskMessageError,
    },
  });
}

function validateVoiceCommandRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
  receivedAt: string,
): { ok: true; event: McpEvent } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "voice command request must be an object" };
  }

  const transcript = typeof input.transcript === "string" ? input.transcript.trim() : "";
  if (!transcript) {
    return { ok: false, message: "transcript must be a non-empty string" };
  }

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey ?? `voice:${stableId(transcript)}`;
  const sourceId = typeof input.source_id === "string" && input.source_id
    ? input.source_id
    : idempotencyKey;
  const occurredAt = typeof input.occurred_at === "string" && input.occurred_at
    ? input.occurred_at
    : receivedAt;
  const projectHint = readOptionalString(input, "project_hint");
  const taskHint = readOptionalString(input, "task_hint");
  const stableVoiceId = stableId(sourceId);

  return {
    ok: true,
    event: {
      id: `evt_voice_${stableVoiceId}`,
      source: "voice",
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt,
      received_at: receivedAt,
      actor: {
        id: "user_voice",
        type: "human",
      },
      project_hint: projectHint,
      task_hint: taskHint,
      type: "voice.command",
      title: "Voice command",
      summary: transcript,
      raw_ref: {
        id: `raw_voice_${stableVoiceId}`,
        uri: `voice://commands/${stableVoiceId}`,
        media_type: "text/plain",
      },
      links: [],
      resources: [
        {
          id: `ctx_voice_${stableVoiceId}`,
          kind: "voice_command",
          title: "Voice command transcript",
          source: "voice",
          captured_at: receivedAt,
          restore_confidence: "low",
          details: {
            transcript,
          },
        },
      ],
    },
  };
}

function taskIdForHint(taskHint: string | undefined): string | undefined {
  return taskHint ? `task_${stableId(taskHint)}` : undefined;
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value ? value : undefined;
}

function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

async function readJsonBody(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const contentType = request.headers["content-type"];
  if (contentType && !String(contentType).includes("application/json")) {
    return { ok: false, message: "content-type must be application/json" };
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }

  if (!body.trim()) {
    return { ok: false, message: "request body must be JSON" };
  }

  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, message: "request body must be valid JSON" };
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendSchemaError(response: ServerResponse, context: RequestContext, message: string): void {
  sendError(response, 400, context, "schema_error", message);
}

function sendRouteResult(response: ServerResponse, context: RequestContext, result: RouteResult): void {
  if (result.ok) {
    return sendJson(response, result.status, result.body);
  }
  return sendError(response, result.status, context, result.code, result.message, result.details);
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  context: RequestContext,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      details,
    },
    request_id: context.requestId,
  };

  sendJson(response, statusCode, body);
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
