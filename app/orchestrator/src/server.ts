import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { ApiErrorBody } from "./contracts.js";
import type { GatewayStore } from "./gateway_store.js";
import { createInMemoryObservability, type Observability } from "./observability.js";
import { handleContextRestoreRoute } from "./routes/context_restore.js";
import { handleEventsRoute, routeEventThroughGateway } from "./routes/events.js";
import { handleMcpSourcesRoute, type McpSourceRegistry } from "./routes/mcp_sources.js";
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

      const contextRestoreRoute = await handleContextRestoreRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
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

      const eventsRoute = await handleEventsRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        store: options.store,
        taskSessions: options.taskSessions,
        observability,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (eventsRoute) {
        return sendRouteResult(response, context, eventsRoute);
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
