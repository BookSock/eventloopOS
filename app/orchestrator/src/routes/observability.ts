import type { ActivityQuery, ActivityStatus, Observability } from "../observability.js";
import type { RouteResult } from "./types.js";

export async function handleMetricsRoute(input: {
  observability: Observability;
  generatedAt: string;
  requestId: string;
}): Promise<RouteResult> {
  return {
    ok: true,
    status: 200,
    body: {
      metrics: await input.observability.snapshot(),
      generated_at: input.generatedAt,
      request_id: input.requestId,
    },
  };
}

export async function handleActivityRoute(input: {
  observability: Observability;
  url: URL;
  requestId: string;
}): Promise<RouteResult> {
  const validation = validateActivityQuery(input.url);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: "schema_error",
      message: validation.message,
    };
  }

  const events = await input.observability.listActivity(validation.query);
  return {
    ok: true,
    status: 200,
    body: {
      events,
      count: events.length,
      request_id: input.requestId,
    },
  };
}

export function validateActivityQuery(url: URL): { ok: true; query: ActivityQuery } | { ok: false; message: string } {
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 500)) {
    return { ok: false, message: "limit must be an integer between 1 and 500" };
  }

  const taskId = optionalNonEmptyParam(url, "task_id");
  if (!taskId.ok) return taskId;
  const taskSessionId = optionalNonEmptyParam(url, "task_session_id");
  if (!taskSessionId.ok) return taskSessionId;
  const status = url.searchParams.get("status") ?? undefined;
  if (status !== undefined && !["ok", "failed", "blocked"].includes(status)) {
    return { ok: false, message: "status must be ok, failed, or blocked" };
  }
  const since = url.searchParams.get("since") ?? undefined;
  if (since !== undefined && Number.isNaN(new Date(since).getTime())) {
    return { ok: false, message: "since must be a valid ISO timestamp" };
  }

  return {
    ok: true,
    query: {
      limit,
      task_id: taskId.value,
      task_session_id: taskSessionId.value,
      status: status as ActivityStatus | undefined,
      since,
    },
  };
}

function optionalNonEmptyParam(url: URL, name: string): { ok: true; value?: string } | { ok: false; message: string } {
  const value = url.searchParams.get(name) ?? undefined;
  if (value !== undefined && !value.trim()) {
    return { ok: false, message: `${name} must be non-empty when provided` };
  }
  return { ok: true, value };
}
