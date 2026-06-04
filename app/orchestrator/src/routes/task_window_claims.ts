import type { Runtime } from "../runtime.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleTaskWindowClaimsRoute(input: {
  method: string | undefined;
  pathname: string;
  url: URL;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/task-window-claims") {
    const taskId = readOptionalString(input.url.searchParams.get("task_id"));
    const claims = await input.runtime.store.listTaskWindowClaims({ now: input.now, taskId });
    return {
      ok: true,
      status: 200,
      body: { ok: true, claims, count: claims.length, request_id: input.requestId },
    };
  }

  if (input.method !== "POST" || input.pathname !== "/task-window-claims") {
    return undefined;
  }

  const parsed = await input.readJsonBody();
  if (!parsed.ok) return schemaError(parsed.message);
  if (!isRecord(parsed.value)) return schemaError("task-window claim request must be an object");

  const taskId = readOptionalString(parsed.value.task_id) ?? readOptionalString(parsed.value.taskId);
  if (!taskId) return schemaError("task_id is required");
  const task = await input.runtime.store.getTask(taskId);
  if (!task) return { ok: false, status: 404, code: "task_not_found", message: `task ${taskId} not found` };

  const windowId = readOptionalString(parsed.value.window_id) ?? readOptionalString(parsed.value.windowId);
  const appBundle = readOptionalString(parsed.value.app_bundle) ?? readOptionalString(parsed.value.appBundle);
  const titlePrefix = readOptionalString(parsed.value.title_prefix) ?? readOptionalString(parsed.value.titlePrefix);
  let processRootPid: number | undefined;
  try {
    processRootPid = readOptionalPositiveInteger(parsed.value.process_root_pid ?? parsed.value.processRootPid);
  } catch (error) {
    return schemaError(error instanceof Error ? error.message : String(error));
  }
  if (!windowId && !appBundle && !titlePrefix && processRootPid === undefined) {
    return schemaError("window_id, app_bundle, title_prefix, or process_root_pid is required");
  }
  let ttlMs: number | undefined;
  try {
    ttlMs = readOptionalPositiveInteger(parsed.value.ttl_ms ?? parsed.value.ttlMs);
  } catch (error) {
    return schemaError(error instanceof Error ? error.message : String(error));
  }
  const source = readOptionalString(parsed.value.source);
  const claim = await input.runtime.store.claimTaskWindow({
    taskId,
    windowId,
    appBundle,
    titlePrefix,
    processRootPid,
    source,
    now: input.now,
    ttlMs,
  });
  await input.runtime.observability.recordActivity({
    type: "task_window_claimed",
    occurred_at: input.now.toISOString(),
    actor: "agent",
    status: "ok",
    task_id: taskId,
    summary: `Task window claim added for ${taskId}`,
    details: {
      claim_id: claim.claim_id,
      window_id: claim.window_id,
      app_bundle: claim.app_bundle,
      title_prefix: claim.title_prefix,
      process_root_pid: claim.process_root_pid,
      source,
      expires_at: claim.expires_at,
    },
  });

  return {
    ok: true,
    status: 200,
    body: { ok: true, claim, request_id: input.requestId },
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected positive integer ttl_ms, got ${String(value)}`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}
