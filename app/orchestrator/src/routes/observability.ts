import type { Observability } from "../observability.js";

export type RouteResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

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

  const events = await input.observability.listActivity(validation.limit);
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

export function validateActivityQuery(url: URL): { ok: true; limit?: number } | { ok: false; message: string } {
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 500)) {
    return { ok: false, message: "limit must be an integer between 1 and 500" };
  }
  return { ok: true, limit };
}
