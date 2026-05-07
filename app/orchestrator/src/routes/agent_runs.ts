import type { Action, AgentRun, EvidenceRef, RawRef } from "../contracts.js";
import type { GatewayStore } from "../gateway_store.js";
import type { Observability } from "../observability.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleAgentRunsRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  observability: Observability;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "POST" && input.pathname === "/agent-runs") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    if (!isRecord(parsed.value)) return schemaError("agent run must be an object");
    const id = readString(parsed.value, "id");
    if (!id.ok) return schemaError(id.message);

    const existing = await input.store.getAgentRun(id.value);
    const run = validateAgentRun(parsed.value, input.now.toISOString(), existing);
    if (!run.ok) return schemaError(run.message);

    const result = await input.store.upsertAgentRun(run.value, input.now);
    if (result.queue_item) {
      await input.observability.incrementCounter("agent_run_human_input_upserts_total");
      if (result.queue_item_created) {
        await input.observability.incrementCounter("agent_run_queue_items_created_total");
      }
      await input.observability.recordActivity({
        type: "agent_run_waiting",
        occurred_at: input.now.toISOString(),
        actor: "agent",
        status: "ok",
        summary: `Agent run needs human input: ${result.agent_run.id}`,
        task_id: result.agent_run.task_id,
        queue_item_id: result.queue_item.id,
        details: {
          agent_run_id: result.agent_run.id,
          review_packet_id: result.review_packet?.id,
          provider: result.agent_run.provider,
          status: result.agent_run.status,
        },
      });
    }

    return ok(200, {
      agent_run: result.agent_run,
      review_packet: result.review_packet,
      queue_item: result.queue_item,
      request_id: input.requestId,
    });
  }

  const getMatch = input.pathname.match(/^\/agent-runs\/([^/]+)$/);
  if (input.method === "GET" && getMatch) {
    const id = decodeURIComponent(getMatch[1] ?? "");
    const run = await input.store.getAgentRun(id);
    if (!run) return error(404, "not_found", `agent run ${id} was not found`);
    return ok(200, {
      agent_run: run,
      request_id: input.requestId,
    });
  }

  return undefined;
}

function validateAgentRun(input: unknown, fallbackUpdatedAt: string, existing?: AgentRun): { ok: true; value: AgentRun } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "agent run must be an object" };
  const id = readString(input, "id");
  if (!id.ok) return id;
  const provider = readEnum(input, "provider", ["codex", "claude", "openai", "manual", "fake"]);
  if (!provider.ok) return provider;
  const status = readEnum(input, "status", ["queued", "running", "blocked", "waiting_approval", "completed", "failed", "cancelled"]);
  if (!status.ok) return status;

  return {
    ok: true,
    value: {
      id: id.value,
      provider: provider.value,
      task_id: optionalString(input, "task_id"),
      thread_id: optionalString(input, "thread_id"),
      status: status.value,
      started_at: optionalString(input, "started_at"),
      updated_at: optionalString(input, "updated_at") ?? fallbackUpdatedAt,
      completed_at: optionalString(input, "completed_at"),
      blocked_reason: optionalString(input, "blocked_reason"),
      risk_tags: hasOwn(input, "risk_tags") ? stringArray(input.risk_tags) : existing?.risk_tags ?? [],
      evidence: hasOwn(input, "evidence") ? normalizeEvidence(input.evidence) : existing?.evidence ?? [],
      output_refs: hasOwn(input, "output_refs") ? normalizeRawRefs(input.output_refs) : existing?.output_refs ?? [],
      resume_actions: hasOwn(input, "resume_actions") ? normalizeActions(input.resume_actions) : existing?.resume_actions ?? [],
    },
  };
}

function readString(input: Record<string, unknown>, key: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${key} must be a non-empty string` };
  }
  return { ok: true, value };
}

function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
): { ok: true; value: T } | { ok: false; message: string } {
  const value = input[key];
  if (typeof value !== "string" || !values.includes(value as T)) {
    return { ok: false, message: `${key} must be one of ${values.join(", ")}` };
  }
  return { ok: true, value: value as T };
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function recordArray<T extends Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(isRecord) as T[] : [];
}

function normalizeEvidence(value: unknown): EvidenceRef[] {
  return recordArray(value)
    .map((item): EvidenceRef | undefined => {
      const id = readNonEmptyString(item.id);
      const kind = readNonEmptyString(item.kind);
      const title = readNonEmptyString(item.title);
      if (!id || !kind || !title) return undefined;
      return {
        id,
        kind,
        title,
        url: readOptionalStringValue(item.url),
        ref: readOptionalStringValue(item.ref),
        captured_at: readOptionalStringValue(item.captured_at),
      };
    })
    .filter((item): item is EvidenceRef => Boolean(item));
}

function normalizeRawRefs(value: unknown): RawRef[] {
  return recordArray(value)
    .map((item): RawRef | undefined => {
      const id = readNonEmptyString(item.id);
      const uri = readNonEmptyString(item.uri);
      if (!id || !uri) return undefined;
      return {
        id,
        uri,
        mime_type: readOptionalStringValue(item.mime_type),
        media_type: readOptionalStringValue(item.media_type),
      };
    })
    .filter((item): item is RawRef => Boolean(item));
}

function normalizeActions(value: unknown): Action[] {
  return recordArray(value)
    .map((item) => {
      const id = readNonEmptyString(item.id);
      const type = readActionType(item.type);
      const label = readNonEmptyString(item.label) ?? type;
      const sideEffect = readSideEffect(item.side_effect);
      if (!id || !type) return undefined;

      return {
        id,
        type,
        label,
        requires_confirmation: typeof item.requires_confirmation === "boolean"
          ? item.requires_confirmation
          : typeof item.requires_approval === "boolean" ? item.requires_approval : sideEffect !== "none",
        side_effect: sideEffect,
        payload: isRecord(item.payload) ? item.payload : {},
      };
    })
    .filter((item): item is Action => Boolean(item));
}

function readActionType(value: unknown): Action["type"] | undefined {
  const allowed: Action["type"][] = ["approve", "reject", "edit", "defer", "open_context", "resume_agent", "mark_done"];
  return typeof value === "string" && allowed.includes(value as Action["type"]) ? value as Action["type"] : undefined;
}

function readSideEffect(value: unknown): Action["side_effect"] {
  const allowed: Action["side_effect"][] = ["none", "local", "external", "production", "sensitive"];
  return typeof value === "string" && allowed.includes(value as Action["side_effect"]) ? value as Action["side_effect"] : "local";
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}
