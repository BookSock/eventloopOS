import type { Runtime } from "../runtime.js";
import type { PaperTriggerCreateInput, PaperTriggerPatch, PaperTriggerRecord } from "../store.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleTriggersRoute(input: {
  method: string | undefined;
  pathname: string;
  url?: URL;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  const { store } = input.runtime;

  if (input.method === "POST" && input.pathname === "/triggers") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validated = validateCreateTriggerRequest(parsed.value);
    if (!validated.ok) return schemaError(validated.message);

    const taskExists = await store.getTask(validated.input.task_id);
    if (!taskExists) return notFound(`task ${validated.input.task_id} not found`);

    const conflict = await findTriggerConflict(store, validated.input);
    if (conflict) return triggerConflict(conflict);

    const trigger = await store.createPaperTrigger(validated.input, input.now);
    return ok(200, { ok: true, trigger, request_id: input.requestId });
  }

  if (input.method === "GET" && input.pathname === "/triggers") {
    const taskId = input.url?.searchParams.get("task_id")?.trim() || undefined;
    const onlyEnabledRaw = input.url?.searchParams.get("only_enabled");
    const onlyEnabled = onlyEnabledRaw === "1" || onlyEnabledRaw === "true";
    const triggers = await store.listPaperTriggers({
      task_id: taskId,
      only_enabled: onlyEnabled,
    });
    return ok(200, { triggers, request_id: input.requestId });
  }

  const idMatch = matchTriggerPath(input.pathname);
  if (!idMatch) return undefined;

  if (input.method === "GET") {
    const trigger = await store.getPaperTrigger(idMatch.triggerId);
    if (!trigger) return notFound(`trigger ${idMatch.triggerId} not found`);
    return ok(200, { trigger, request_id: input.requestId });
  }

  if (input.method === "PATCH") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validated = validatePatchTriggerRequest(parsed.value);
    if (!validated.ok) return schemaError(validated.message);

    const existing = await store.getPaperTrigger(idMatch.triggerId);
    if (!existing) return notFound(`trigger ${idMatch.triggerId} not found`);
    const effective = effectiveTriggerForPatch(existing, validated.patch);
    const conflict = await findTriggerConflict(store, effective, existing.trigger_id);
    if (conflict) return triggerConflict(conflict);

    const updated = await store.updatePaperTrigger(idMatch.triggerId, validated.patch, input.now);
    if (!updated) return notFound(`trigger ${idMatch.triggerId} not found`);
    return ok(200, { ok: true, trigger: updated, request_id: input.requestId });
  }

  if (input.method === "DELETE") {
    const removed = await store.deletePaperTrigger(idMatch.triggerId);
    if (!removed) return notFound(`trigger ${idMatch.triggerId} not found`);
    return ok(200, { ok: true, trigger: removed, request_id: input.requestId });
  }

  return undefined;
}

function validateCreateTriggerRequest(
  value: unknown,
): { ok: true; input: PaperTriggerCreateInput } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "create trigger request must be an object" };
  const taskId = value.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) {
    return { ok: false, message: "task_id must be a non-empty string" };
  }
  const name = value.name;
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, message: "name must be a non-empty string" };
  }
  const matchEventType = value.match_event_type;
  if (typeof matchEventType !== "string" || !matchEventType.trim()) {
    return { ok: false, message: "match_event_type must be a non-empty string" };
  }
  const sourcePattern = optionalString(value.match_source_id_pattern, "match_source_id_pattern");
  if (sourcePattern.kind === "error") return { ok: false, message: sourcePattern.message };
  const bodySubstring = optionalString(value.match_body_substring, "match_body_substring");
  if (bodySubstring.kind === "error") return { ok: false, message: bodySubstring.message };
  let enabled: boolean | undefined;
  if (value.enabled !== undefined && value.enabled !== null) {
    if (typeof value.enabled !== "boolean") {
      return { ok: false, message: "enabled must be a boolean" };
    }
    enabled = value.enabled;
  }
  return {
    ok: true,
    input: {
      task_id: taskId.trim(),
      name: name.trim(),
      match_event_type: matchEventType.trim(),
      match_source_id_pattern: sourcePattern.value,
      match_body_substring: bodySubstring.value,
      enabled,
    },
  };
}

function validatePatchTriggerRequest(
  value: unknown,
): { ok: true; patch: PaperTriggerPatch } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "patch trigger request must be an object" };
  const patch: PaperTriggerPatch = {};

  if (value.name !== undefined) {
    if (typeof value.name !== "string" || !value.name.trim()) {
      return { ok: false, message: "name must be a non-empty string" };
    }
    patch.name = value.name.trim();
  }
  if (value.match_event_type !== undefined) {
    if (typeof value.match_event_type !== "string" || !value.match_event_type.trim()) {
      return { ok: false, message: "match_event_type must be a non-empty string" };
    }
    patch.match_event_type = value.match_event_type.trim();
  }
  if (value.match_source_id_pattern !== undefined) {
    if (value.match_source_id_pattern === null) {
      patch.match_source_id_pattern = null;
    } else if (typeof value.match_source_id_pattern !== "string") {
      return { ok: false, message: "match_source_id_pattern must be string or null" };
    } else {
      const trimmed = value.match_source_id_pattern.trim();
      patch.match_source_id_pattern = trimmed ? trimmed : null;
    }
  }
  if (value.match_body_substring !== undefined) {
    if (value.match_body_substring === null) {
      patch.match_body_substring = null;
    } else if (typeof value.match_body_substring !== "string") {
      return { ok: false, message: "match_body_substring must be string or null" };
    } else {
      const trimmed = value.match_body_substring.trim();
      patch.match_body_substring = trimmed ? trimmed : null;
    }
  }
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") return { ok: false, message: "enabled must be a boolean" };
    patch.enabled = value.enabled;
  }
  return { ok: true, patch };
}

type TriggerConflictCandidate = {
  task_id: string;
  match_event_type: string;
  match_source_id_pattern?: string;
  match_body_substring?: string;
  enabled?: boolean;
};

async function findTriggerConflict(
  store: Runtime["store"],
  candidate: TriggerConflictCandidate,
  ignoreTriggerId?: string,
): Promise<PaperTriggerRecord | undefined> {
  if (candidate.enabled === false) return undefined;
  const existing = await store.listPaperTriggers({ only_enabled: true });
  return existing.find((trigger) =>
    trigger.trigger_id !== ignoreTriggerId
    && trigger.task_id !== candidate.task_id
    && normalizeComparable(trigger.match_event_type) === normalizeComparable(candidate.match_event_type)
    && selectorsOverlap(trigger.match_source_id_pattern, candidate.match_source_id_pattern)
    && substringsOverlap(trigger.match_body_substring, candidate.match_body_substring),
  );
}

function effectiveTriggerForPatch(trigger: PaperTriggerRecord, patch: PaperTriggerPatch): TriggerConflictCandidate {
  return {
    task_id: trigger.task_id,
    match_event_type: patch.match_event_type ?? trigger.match_event_type,
    match_source_id_pattern: patch.match_source_id_pattern === undefined
      ? trigger.match_source_id_pattern
      : patch.match_source_id_pattern ?? undefined,
    match_body_substring: patch.match_body_substring === undefined
      ? trigger.match_body_substring
      : patch.match_body_substring ?? undefined,
    enabled: patch.enabled ?? trigger.enabled,
  };
}

function selectorsOverlap(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

function substringsOverlap(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  return !normalizedLeft
    || !normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function normalizeComparable(value?: string): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function optionalString(
  raw: unknown,
  field: string,
): { kind: "ok"; value: string | undefined } | { kind: "error"; message: string } {
  if (raw === undefined || raw === null) return { kind: "ok", value: undefined };
  if (typeof raw !== "string") return { kind: "error", message: `${field} must be a string` };
  const trimmed = raw.trim();
  return { kind: "ok", value: trimmed ? trimmed : undefined };
}

function matchTriggerPath(pathname: string): { triggerId: string } | undefined {
  if (!pathname.startsWith("/triggers/")) return undefined;
  const remainder = pathname.slice("/triggers/".length);
  if (!remainder || remainder.includes("/")) return undefined;
  return { triggerId: decodeURIComponent(remainder) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}

function notFound(message: string): RouteResult {
  return { ok: false, status: 404, code: "not_found", message };
}

function triggerConflict(trigger: PaperTriggerRecord): RouteResult {
  return {
    ok: false,
    status: 409,
    code: "trigger_conflict",
    message: `trigger overlaps existing trigger ${trigger.trigger_id} for ${trigger.task_id}`,
    details: {
      trigger_id: trigger.trigger_id,
      task_id: trigger.task_id,
      name: trigger.name,
      match_event_type: trigger.match_event_type,
      match_source_id_pattern: trigger.match_source_id_pattern,
      match_body_substring: trigger.match_body_substring,
    },
  };
}

export type { PaperTriggerRecord };
