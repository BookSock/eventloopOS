import type { ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { ApiErrorBody } from "../contracts.js";
import type { Observability } from "../observability.js";
import type { RouteResult } from "../routes/types.js";

export type RouteHttpContext = {
  requestId: string;
};

export async function sendObservedRouteResult(
  response: ServerResponse,
  context: RouteHttpContext,
  observability: Observability,
  routeName: string,
  result: RouteResult,
  startedAt: number,
): Promise<void> {
  const durationMs = Math.max(0, performance.now() - startedAt);
  response.setHeader("x-route-name", routeName);
  response.setHeader("x-route-duration-ms", durationMs.toFixed(3));
  await recordRouteMetrics(observability, routeName, result, durationMs).catch(() => undefined);
  return sendRouteResult(response, context, result);
}

export function routeNameForPath(method: string | undefined, pathname: string): string | undefined {
  const normalizedMethod = (method ?? "UNKNOWN").toUpperCase();
  const entries: Array<[RegExp, string]> = [
    [/^\/queue$/, "queue"],
    [/^\/queue\/next$/, "queue_next"],
    [/^\/queue\/lease-next$/, "queue_lease_next"],
    [/^\/queue\/[^/]+\/lease\/renew$/, "queue_lease_renew"],
    [/^\/queue\/[^/]+\/done$/, "queue_done"],
    [/^\/queue\/[^/]+\/defer$/, "queue_defer"],
    [/^\/queue\/[^/]+\/ignore$/, "queue_ignore"],
    [/^\/queue\/[^/]+\/lineage$/, "queue_lineage"],
    [/^\/queue\/[^/]+\/actions\/recommended$/, "queue_recommended_action"],
    [/^\/queue\/[^/]+\/priority$/, "queue_priority"],
    [/^\/contexts$/, "contexts"],
    [/^\/contexts\/restore-plan$/, "context_restore_plan"],
    [/^\/contexts\/restore-requests$/, "context_restore_requests"],
    [/^\/contexts\/restore-requests\/next$/, "context_restore_next"],
    [/^\/contexts\/restore-requests\/claim-next$/, "context_restore_claim_next"],
    [/^\/contexts\/restore-requests\/[^/]+$/, "context_restore_get"],
    [/^\/contexts\/restore-requests\/[^/]+\/done$/, "context_restore_done"],
    [/^\/contexts\/restore-requests\/[^/]+\/failed$/, "context_restore_failed"],
    [/^\/contexts\/restore-requests\/[^/]+\/retry$/, "context_restore_retry"],
    [/^\/workspace\/status$/, "workspace_status"],
    [/^\/workspace\/capture$/, "workspace_capture"],
    [/^\/workspace\/restore-plan$/, "workspace_restore_plan"],
    [/^\/workspace\/restore$/, "workspace_restore"],
    [/^\/onboarding\/scan$/, "onboarding_scan"],
    [/^\/onboarding\/approvals\/batch$/, "onboarding_approvals_batch"],
    [/^\/onboarding\/approvals$/, "onboarding_approvals"],
    [/^\/onboarding\/rejections$/, "onboarding_rejections"],
    [/^\/reading-queue$/, "reading_queue"],
    [/^\/reading-queue\/promote$/, "reading_queue_promote"],
    [/^\/reading-queue\/auto-promote$/, "reading_queue_auto_promote"],
    [/^\/mcp\/poll$/, "mcp_poll"],
    [/^\/mcp-sources$/, "mcp_sources"],
    [/^\/mcp-sources\/poll-all-and-route$/, "mcp_sources_poll_all_and_route"],
    [/^\/mcp-sources\/[^/]+$/, "mcp_source_get"],
    [/^\/mcp-sources\/[^/]+\/poll$/, "mcp_source_poll"],
    [/^\/mcp-sources\/[^/]+\/poll-and-route$/, "mcp_source_poll_and_route"],
    [/^\/task-sessions$/, "task_sessions"],
    [/^\/task-sessions\/[^/]+$/, "task_session_get"],
    [/^\/task-sessions\/[^/]+\/followup$/, "task_session_followup"],
    [/^\/task-sessions\/[^/]+\/task-binding$/, "task_session_binding"],
    [/^\/task-messages$/, "task_messages"],
    [/^\/task-messages\/reconcile-attempted$/, "task_messages_reconcile_attempted"],
    [/^\/agent-runs$/, "agent_runs"],
    [/^\/agent-runs\/[^/]+$/, "agent_run_get"],
    [/^\/events$/, "events"],
    [/^\/events\/[^/]+$/, "event_get"],
    [/^\/voice\/commands$/, "voice_commands"],
    [/^\/master\/fan-out$/, "master_fan_out"],
    [/^\/agents\/codex\/auto-bind$/, "agents_codex_auto_bind"],
    [/^\/agents\/codex\/inspect\/[^/]+$/, "agents_codex_inspect"],
    [/^\/agents\/claude\/inspect\/[^/]+$/, "agents_claude_inspect"],
    [/^\/review-packets\/[^/]+$/, "review_packet_get"],
  ];
  const route = entries.find(([pattern]) => pattern.test(pathname))?.[1];
  return route ? `${normalizedMethod}_${route}` : undefined;
}

async function recordRouteMetrics(
  observability: Observability,
  routeName: string,
  result: RouteResult,
  durationMs: number,
): Promise<void> {
  const routePart = safeMetricPart(routeName);
  const statusPart = String(result.status);
  const durationMsCounter = Math.max(0, Math.round(durationMs));
  await Promise.all([
    observability.incrementCounter("http_requests_total"),
    observability.incrementCounter(`http_requests_route_${routePart}_total`),
    observability.incrementCounter(`http_requests_status_${statusPart}_total`),
    observability.incrementCounter(`http_requests_route_${routePart}_status_${statusPart}_total`),
    observability.incrementCounter("http_request_duration_ms_total", durationMsCounter),
    observability.incrementCounter(`http_request_duration_ms_route_${routePart}_total`, durationMsCounter),
    ...(result.ok ? [] : [
      observability.incrementCounter("http_request_errors_total"),
      observability.incrementCounter(`http_request_errors_route_${routePart}_total`),
      observability.incrementCounter(`http_request_errors_code_${safeMetricPart(result.code)}_total`),
    ]),
  ]);
}

function sendRouteResult(response: ServerResponse, context: RouteHttpContext, result: RouteResult): void {
  if (result.ok) {
    return sendJson(response, result.status, result.body);
  }
  return sendError(response, result.status, context, result.code, result.message, result.details);
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  context: RouteHttpContext,
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

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function safeMetricPart(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
