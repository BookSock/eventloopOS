import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleModesRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  const { store, observability } = input.runtime;

  if (input.method === "GET" && input.pathname === "/modes/manual") {
    const state = await store.getManualModeState();
    return ok(200, {
      manual_mode: state,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/modes/manual") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validation = validateManualModeRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const previous = await store.getManualModeState();
    const next = await store.setManualModeActive(validation.active, validation.reason, input.now);
    const transitioned = previous.active !== next.active;

    if (transitioned) {
      await observability.recordActivity({
        type: next.active ? "manual_mode_entered" : "manual_mode_exited",
        occurred_at: next.updated_at,
        actor: "human",
        status: "ok",
        summary: next.active
          ? `Manual mode entered${next.reason ? `: ${next.reason}` : ""}`
          : "Manual mode exited",
        details: sanitizeActivityDetails({
          active: next.active,
          entered_at: next.entered_at,
          reason: next.reason,
        }),
      });
    }

    return ok(200, {
      ok: true,
      manual_mode: next,
      transitioned,
      request_id: input.requestId,
    });
  }

  return undefined;
}

function validateManualModeRequest(input: unknown): { ok: true; active: boolean; reason?: string } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "manual mode request must be an object" };
  if (typeof input.active !== "boolean") return { ok: false, message: "active must be boolean" };
  const reasonRaw = input.reason;
  const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim().slice(0, 200) : undefined;
  return { ok: true, active: input.active, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}
