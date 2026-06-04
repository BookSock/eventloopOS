import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { GhosttyWindowResolver } from "./agents/codex/auto_bind.js";
import type { ListRolloutFiles } from "./agents/codex/foreground_resolver.js";
import type { RunOsascript } from "./agents/codex/ghostty_window_resolver.js";
import type { GatewayStore } from "./gateway_store.js";
import { routeNameForPath, sendObservedRouteResult } from "./http/route_observability.js";
import { createInMemoryObservability, type Observability } from "./observability.js";
import { handleAgentRunsRoute } from "./routes/agent_runs.js";
import { handleContextRestoreRoute } from "./routes/context_restore.js";
import { handleEventsRoute, routeEventThroughGateway } from "./routes/events.js";
import { handleFollowsWindowsRoute } from "./routes/follows_windows.js";
import { handleMcpSourcesRoute, type McpSourceRegistry } from "./routes/mcp_sources.js";
import { handleActivityRoute, handleMetricsRoute } from "./routes/observability.js";
import { handleOnboardingRoute } from "./routes/onboarding.js";
import { handleAgentsRoute } from "./routes/agents.js";
import { handleMasterRoute } from "./routes/master.js";
import { handleModesRoute } from "./routes/modes.js";
import { handleQueueRoute } from "./routes/queue.js";
import { handleReadingQueueRoute } from "./routes/reading_queue.js";
import { handleTaskSessionsRoute } from "./routes/task_sessions.js";
import { handleTaskWindowClaimsRoute } from "./routes/task_window_claims.js";
import { handleTasksRoute } from "./routes/tasks.js";
import { handleTriggersRoute } from "./routes/triggers.js";
import { handleWorkspaceRoute } from "./routes/workspace.js";
import { createRuntime, type Runtime } from "./runtime.js";
import type { TaskSessionController } from "./task_sessions/types.js";
import type { TerminalSendExecutor } from "./task_sessions/terminal_send.js";
import type { WorkspaceController } from "./workspace/controller.js";

export type GatewayServerOptions = {
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  mcpSources?: McpSourceRegistry;
  workspace?: WorkspaceController;
  workspaceExecuteEnabled?: boolean;
  observability?: Observability;
  terminalSendExecutor?: TerminalSendExecutor;
  terminalSendEnabled?: boolean;
  codexHome?: string;
  ghosttyResolver?: GhosttyWindowResolver;
  runOsascript?: RunOsascript;
  listRolloutFiles?: ListRolloutFiles;
  now?: () => Date;
};

type RequestContext = {
  requestId: string;
  idempotencyKey?: string;
  url: URL;
};

export function createGatewayServer(options: GatewayServerOptions): Server {
  const observability = options.observability ?? createInMemoryObservability();
  const runtime = createRuntime({
    store: options.store,
    taskSessions: options.taskSessions,
    workspace: options.workspace,
    observability,
    mcpSources: options.mcpSources,
    workspaceExecuteEnabled: options.workspaceExecuteEnabled,
    terminalSendExecutor: options.terminalSendExecutor,
    terminalSendEnabled: options.terminalSendEnabled,
    codexHome: options.codexHome,
    ghosttyResolver: options.ghosttyResolver,
    runOsascript: options.runOsascript,
    listRolloutFiles: options.listRolloutFiles,
    now: options.now,
  });
  const now = runtime.now;
  const serverOptions = { ...options, observability };

  return createServer(async (request, response) => {
    const context = buildContext(request);
    const startedAt = performance.now();
    applyResponseHeaders(response, context);

    try {
      if (request.method === "GET" && context.url.pathname === "/health") {
        return sendObservedRouteResult(response, context, observability, "GET_health", {
          ok: true,
          status: 200,
          body: {
            ok: true,
            service: "eventloop-orchestrator",
            time: now().toISOString(),
            request_id: context.requestId,
          },
        }, startedAt);
      }

      if (request.method === "GET" && context.url.pathname === "/metrics") {
        return sendObservedRouteResult(response, context, observability, "GET_metrics", await handleMetricsRoute({
          observability,
          generatedAt: now().toISOString(),
          requestId: context.requestId,
        }), startedAt);
      }

      if (request.method === "GET" && context.url.pathname === "/activity") {
        return sendObservedRouteResult(response, context, observability, "GET_activity", await handleActivityRoute({
          observability,
          url: context.url,
          requestId: context.requestId,
        }), startedAt);
      }

      const queueRoute = await handleQueueRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (queueRoute) {
        return sendObservedRouteResult(response, context, observability, routeNameForPath(request.method, context.url.pathname) ?? "queue", queueRoute, startedAt);
      }

      const contextRestoreRoute = await handleContextRestoreRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (contextRestoreRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "contexts",
          contextRestoreRoute,
          startedAt,
        );
      }

      const workspaceRoute = await handleWorkspaceRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (workspaceRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "workspace",
          workspaceRoute,
          startedAt,
        );
      }

      const agentsRoute = await handleAgentsRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (agentsRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "agents",
          agentsRoute,
          startedAt,
        );
      }

      const followsWindowsRoute = await handleFollowsWindowsRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (followsWindowsRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "follows_windows",
          followsWindowsRoute,
          startedAt,
        );
      }

      const taskWindowClaimsRoute = await handleTaskWindowClaimsRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (taskWindowClaimsRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "task_window_claims",
          taskWindowClaimsRoute,
          startedAt,
        );
      }

      const masterRoute = await handleMasterRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (masterRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "master",
          masterRoute,
          startedAt,
        );
      }

      const modesRoute = await handleModesRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (modesRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "modes",
          modesRoute,
          startedAt,
        );
      }

      const readingQueueRoute = await handleReadingQueueRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (readingQueueRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "reading_queue",
          readingQueueRoute,
          startedAt,
        );
      }

      const onboardingRoute = await handleOnboardingRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (onboardingRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "onboarding",
          onboardingRoute,
          startedAt,
        );
      }

      const mcpSourcesRoute = await handleMcpSourcesRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        routeEvent: (event, routedAt) => routeEventThroughGateway(serverOptions, event, routedAt),
      });
      if (mcpSourcesRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "mcp_sources",
          mcpSourcesRoute,
          startedAt,
        );
      }

      const tasksRoute = await handleTasksRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (tasksRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "tasks",
          tasksRoute,
          startedAt,
        );
      }

      const taskSessionsRoute = await handleTaskSessionsRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (taskSessionsRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "task_sessions",
          taskSessionsRoute,
          startedAt,
        );
      }

      const agentRunsRoute = await handleAgentRunsRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (agentRunsRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "agent_runs",
          agentRunsRoute,
          startedAt,
        );
      }

      const triggersRoute = await handleTriggersRoute({
        method: request.method,
        pathname: context.url.pathname,
        url: context.url,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
      });
      if (triggersRoute) {
        return sendObservedRouteResult(
          response,
          context,
          observability,
          routeNameForPath(request.method, context.url.pathname) ?? "triggers",
          triggersRoute,
          startedAt,
        );
      }

      const eventsRoute = await handleEventsRoute({
        method: request.method,
        pathname: context.url.pathname,
        readJsonBody: () => readJsonBody(request),
        runtime,
        now: now(),
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      if (eventsRoute) {
        return sendObservedRouteResult(response, context, observability, routeNameForPath(request.method, context.url.pathname) ?? "events", eventsRoute, startedAt);
      }

      return sendObservedRouteResult(response, context, observability, "not_found", {
        ok: false,
        status: 404,
        code: "not_found",
        message: "route not found",
      }, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return sendObservedRouteResult(response, context, observability, routeNameForPath(request.method, context.url.pathname) ?? "internal_error", {
        ok: false,
        status: 500,
        code: "internal_error",
        message,
      }, startedAt);
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

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
