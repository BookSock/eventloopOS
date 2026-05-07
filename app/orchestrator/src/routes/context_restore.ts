import { randomUUID } from "node:crypto";
import type { GatewayStore } from "../gateway_store.js";
import type { Observability } from "../observability.js";
import type { ContextRestoreRequestRecord } from "../store.js";
import type { RouteResult } from "./types.js";

export type JsonBodyReader = () => Promise<{ ok: true; value: unknown } | { ok: false; message: string }>;

export async function handleContextRestoreRoute(input: {
  method: string | undefined;
  pathname: string;
  url: URL;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  observability: Observability;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/contexts") {
    const validation = validateContextQuery(input.url);
    if (!validation.ok) return schemaError(validation.message);

    const entries = await input.store.listContextEntries(validation.query);
    return ok(200, {
      entries,
      count: entries.length,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/contexts/restore-plan") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validation = validateContextRestorePlanRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);
    const plan = buildContextRestorePlan(validation.resource);
    if (!plan) return error(422, "context_restore_unsupported", "context resource is not restorable");

    return ok(200, {
      restore_plan: plan,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/contexts/restore-requests") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validation = validateContextRestorePlanRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);
    const plan = buildContextRestorePlan(validation.resource);
    if (!plan) return error(422, "context_restore_unsupported", "context resource is not restorable");
    if (plan.kind !== "browser_extension_message") {
      return error(
        422,
        "context_restore_not_browser_extension",
        "context restore request polling only supports browser extension messages",
      );
    }

    const created = await input.store.createContextRestoreRequest({
      id: `ctx_restore_${randomUUID()}`,
      idempotency_key: input.idempotencyKey,
      resource: validation.resource,
      restore_plan: plan,
    }, input.now);
    const restoreInfo = restoreResourceInfo(created.record.resource);
    await input.observability.incrementCounter("restore_requests_created_total", created.inserted ? 1 : 0);
    if (created.inserted) {
      await input.observability.incrementCounter(`restore_requests_created_provider_${restoreInfo.counterProvider}`);
      await input.observability.recordActivity({
        type: "context_restore_requested",
        occurred_at: created.record.created_at,
        actor: "system",
        status: "ok",
        summary: `Restore requested for ${String(validation.resource.title ?? validation.resource.kind)}`,
        details: {
          restore_request_id: created.record.id,
          resource_kind: validation.resource.kind,
          resource_provider: restoreInfo.provider,
          confidence_reason: restoreInfo.confidenceReason,
        },
      });
    }

    return ok(created.inserted ? 202 : 200, {
      restore_request: presentContextRestoreRequest(created.record),
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/contexts/restore-requests/next") {
    const nextRequest = await input.store.peekNextContextRestoreRequest(input.now);
    return ok(200, {
      restore_request: nextRequest ? presentContextRestoreRequest(nextRequest) : null,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/contexts/restore-requests/claim-next") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const claimRequest = parseContextRestoreClaimRequest(parsed.value);
    if (!claimRequest.ok) return schemaError(claimRequest.message);
    const nextRequest = await input.store.claimNextContextRestoreRequest(
      claimRequest.leaseOwner,
      input.now,
      claimRequest.leaseMs,
    );
    return ok(200, {
      restore_request: nextRequest ? presentContextRestoreRequest(nextRequest) : null,
      request_id: input.requestId,
    });
  }

  const restoreGetMatch = input.pathname.match(/^\/contexts\/restore-requests\/([^/]+)$/);
  if (input.method === "GET" && restoreGetMatch) {
    const restoreRequestId = decodeURIComponent(restoreGetMatch[1] ?? "");
    const record = await input.store.getContextRestoreRequest(restoreRequestId);
    if (!record) return error(404, "not_found", `context restore request ${restoreRequestId} was not found`);
    return ok(200, {
      restore_request: presentContextRestoreRequest(record),
      request_id: input.requestId,
    });
  }

  const restoreDoneMatch = input.pathname.match(/^\/contexts\/restore-requests\/([^/]+)\/done$/);
  if (input.method === "POST" && restoreDoneMatch) {
    return markRestoreFinished({
      ...input,
      restoreRequestId: decodeURIComponent(restoreDoneMatch[1] ?? ""),
      status: "done",
    });
  }

  const restoreFailedMatch = input.pathname.match(/^\/contexts\/restore-requests\/([^/]+)\/failed$/);
  if (input.method === "POST" && restoreFailedMatch) {
    return markRestoreFinished({
      ...input,
      restoreRequestId: decodeURIComponent(restoreFailedMatch[1] ?? ""),
      status: "failed",
    });
  }

  const restoreRetryMatch = input.pathname.match(/^\/contexts\/restore-requests\/([^/]+)\/retry$/);
  if (input.method === "POST" && restoreRetryMatch) {
    const restoreRequestId = decodeURIComponent(restoreRetryMatch[1] ?? "");
    const record = await input.store.retryContextRestoreRequest(restoreRequestId, input.now);
    if (!record) return error(404, "not_found", `context restore request ${restoreRequestId} was not found`);
    const restoreInfo = restoreResourceInfo(record.resource);
    await input.observability.incrementCounter("restore_requests_retried_total");
    await input.observability.incrementCounter(`restore_requests_retried_provider_${restoreInfo.counterProvider}`);
    await input.observability.recordActivity({
      type: "context_restore_retried",
      occurred_at: record.updated_at,
      actor: "human",
      status: "ok",
      summary: `Restore retried for ${String(record.resource.title ?? record.resource.kind)}`,
      details: {
        restore_request_id: record.id,
        resource_provider: restoreInfo.provider,
        confidence_reason: restoreInfo.confidenceReason,
      },
    });

    return ok(200, {
      restore_request: presentContextRestoreRequest(record),
      request_id: input.requestId,
    });
  }

  return undefined;
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

async function markRestoreFinished(input: {
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  observability: Observability;
  now: Date;
  requestId: string;
  restoreRequestId: string;
  status: "done" | "failed";
}): Promise<RouteResult> {
  const parsed = await input.readJsonBody();
  if (!parsed.ok) return schemaError(parsed.message);
  const result = isRecord(parsed.value) && "result" in parsed.value ? parsed.value.result : parsed.value;
  const record = input.status === "done"
    ? await input.store.markContextRestoreRequestDone(input.restoreRequestId, result, input.now)
    : await input.store.markContextRestoreRequestFailed(input.restoreRequestId, result, input.now);
  if (!record) return error(404, "not_found", `context restore request ${input.restoreRequestId} was not found`);

  const restoreInfo = restoreResourceInfo(record.resource);
  await input.observability.incrementCounter(input.status === "done" ? "restore_requests_done_total" : "restore_requests_failed_total");
  await input.observability.incrementCounter(`restore_requests_${input.status}_provider_${restoreInfo.counterProvider}`);
  await input.observability.recordActivity({
    type: input.status === "done" ? "context_restore_done" : "context_restore_failed",
    occurred_at: record.updated_at,
    actor: "system",
    status: input.status === "done" ? "ok" : "failed",
    summary: `Restore ${input.status === "done" ? "completed" : "failed"} for ${String(record.resource.title ?? record.resource.kind)}`,
    details: {
      restore_request_id: record.id,
      resource_provider: restoreInfo.provider,
      confidence_reason: restoreInfo.confidenceReason,
      result: record.result,
    },
  });

  return ok(200, {
    restore_request: presentContextRestoreRequest(record),
    request_id: input.requestId,
  });
}

export function validateContextRestorePlanRequest(
  input: unknown,
): { ok: true; resource: Record<string, unknown> } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "context restore-plan request must be an object" };
  }
  const resource = isRecord(input.resource) ? input.resource : input;
  if (!isRecord(resource)) {
    return { ok: false, message: "resource must be an object" };
  }
  if (typeof resource.kind !== "string" || !resource.kind) {
    return { ok: false, message: "resource.kind must be a non-empty string" };
  }
  return { ok: true, resource };
}

export function buildContextRestorePlan(resource: Record<string, unknown>): Record<string, unknown> | undefined {
  const url = typeof resource.url === "string" && resource.url ? resource.url : undefined;
  if (resource.kind === "browser_tab" && url) {
    return {
      kind: "browser_extension_message",
      side_effect: "local",
      execute_supported: false,
      target: "eventloopOS browser extension runtime",
      message: {
        type: "eventloop.restore",
        resource,
      },
    };
  }

  if (url) {
    return {
      kind: "open_url",
      side_effect: "local",
      execute_supported: false,
      url,
    };
  }

  const path = typeof resource.path === "string" && resource.path ? resource.path : undefined;
  if (resource.kind === "file" && path) {
    return {
      kind: "open_file",
      side_effect: "local",
      execute_supported: false,
      path,
      line: resource.line,
      column: resource.column,
    };
  }

  return undefined;
}

function parseContextRestoreClaimRequest(
  input: unknown,
): { ok: true; leaseOwner: string; leaseMs: number } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "context restore claim request must be an object" };
  }
  const leaseOwner = typeof input.lease_owner === "string" ? input.lease_owner.trim() : "";
  if (!leaseOwner) {
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

function presentContextRestoreRequest(record: ContextRestoreRequestRecord): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    idempotency_key: record.idempotency_key,
    resource: record.resource,
    restore_plan: record.restore_plan,
    result: record.result,
    lease_owner: record.lease_owner,
    lease_expires_at: record.lease_expires_at,
  };
}

function restoreResourceInfo(resource: Record<string, unknown>): {
  provider: string;
  counterProvider: string;
  confidenceReason?: string;
} {
  const details = isRecord(resource.details) ? resource.details : {};
  const provider = stringFromRecord(details, "provider")
    ?? stringFromRecord(resource, "source")
    ?? stringFromRecord(resource, "kind")
    ?? "unknown";
  return {
    provider,
    counterProvider: stableId(provider),
    confidenceReason: stringFromRecord(details, "confidence_reason"),
  };
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}

function stringFromRecord(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
