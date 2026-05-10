import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { ContextEntry } from "../store.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

const READING_QUEUE_TASK_ID = "task_reading_queue";

export async function handleReadingQueueRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  const { store, observability } = input.runtime;
  if (input.method === "GET" && input.pathname === "/reading-queue") {
    const entries = await listUnboundBrowserContexts(store);
    return ok(200, {
      contexts: entries.map(toReadingContextSummary),
      count: entries.length,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/reading-queue/auto-promote") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validation = validateAutoPromoteRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const manualMode = await store.getManualModeState();
    if (manualMode.active) {
      await observability?.recordActivity({
        type: "reading_queue_auto_promoted",
        occurred_at: input.now.toISOString(),
        actor: "system",
        task_id: READING_QUEUE_TASK_ID,
        status: "ok",
        summary: "Auto-promote tick skipped: manual mode active.",
        details: sanitizeActivityDetails({
          paused: true,
          reason: "paused: manual mode",
          manual_mode_entered_at: manualMode.entered_at,
        }),
      });
      return ok(200, {
        ok: true,
        paused: true,
        reason: "manual_mode_active",
        manual_mode: manualMode,
        evaluated_count: 0,
        aged_count: 0,
        promoted_count: 0,
        promoted: [],
        request_id: input.requestId,
      });
    }

    const allUnbound = await listUnboundBrowserContexts(store);
    const ageThreshold = input.now.getTime() - validation.minAgeSeconds * 1000;
    const aged = allUnbound.filter((entry) => {
      const captured = Date.parse(entry.captured_at);
      return Number.isFinite(captured) && captured <= ageThreshold;
    });

    const promoted: Array<{ context_id: string; queue_item_id?: string; review_packet_id?: string; event_id: string; idempotent: boolean }> = [];
    for (const entry of aged) {
      const result = await promoteEntryToQueuePaper(input, entry, validation.actorId);
      promoted.push(result);
    }

    const newlyPromoted = promoted.filter((entry) => !entry.idempotent).length;
    await observability?.incrementCounter("reading_queue_auto_promotions_total", newlyPromoted || undefined);
    await observability?.recordActivity({
      type: "reading_queue_auto_promoted",
      occurred_at: input.now.toISOString(),
      actor: "system",
      task_id: READING_QUEUE_TASK_ID,
      status: "ok",
      summary: `Auto-promoted ${newlyPromoted} reading-queue tab${newlyPromoted === 1 ? "" : "s"} (age >= ${validation.minAgeSeconds}s).`,
      details: sanitizeActivityDetails({
        evaluated_count: allUnbound.length,
        aged_count: aged.length,
        promoted_count: newlyPromoted,
        idempotent_count: promoted.length - newlyPromoted,
        min_age_seconds: validation.minAgeSeconds,
      }),
    });

    return ok(200, {
      ok: true,
      evaluated_count: allUnbound.length,
      aged_count: aged.length,
      promoted_count: newlyPromoted,
      promoted,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/reading-queue/promote") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validation = validatePromoteRequest(parsed.value);
    if (!validation.ok) return schemaError(validation.message);

    const allUnbound = await listUnboundBrowserContexts(store);
    const target = validation.contextIds.length > 0
      ? allUnbound.filter((entry) => validation.contextIds.includes(contextEntryId(entry)))
      : allUnbound;

    const requestedMissing = validation.contextIds.length > 0
      ? validation.contextIds.filter((id) => !target.some((entry) => contextEntryId(entry) === id))
      : [];

    const promoted: Array<{ context_id: string; queue_item_id?: string; review_packet_id?: string; event_id: string; idempotent: boolean }> = [];
    for (const entry of target) {
      const result = await promoteEntryToQueuePaper(input, entry, validation.actorId);
      promoted.push(result);
    }

    await observability?.incrementCounter("reading_queue_promotions_total", promoted.length || undefined);
    await observability?.recordActivity({
      type: "reading_queue_promoted",
      occurred_at: input.now.toISOString(),
      actor: "human",
      task_id: READING_QUEUE_TASK_ID,
      status: "ok",
      summary: `Promoted ${promoted.length} reading-queue tab${promoted.length === 1 ? "" : "s"} to queue paper${promoted.length === 1 ? "" : "s"}.`,
      details: sanitizeActivityDetails({
        promoted_count: promoted.length,
        requested_count: validation.contextIds.length,
        missing_context_ids: requestedMissing,
      }),
    });

    return ok(200, {
      ok: true,
      promoted,
      promoted_count: promoted.length,
      missing_context_ids: requestedMissing,
      request_id: input.requestId,
    });
  }

  return undefined;
}

async function listUnboundBrowserContexts(store: GatewayStore): Promise<ContextEntry[]> {
  const entries = await store.listContextEntries({ limit: 200 });
  return entries.filter(isUnboundBrowserTabEntry);
}

function isUnboundBrowserTabEntry(entry: ContextEntry): boolean {
  if (entry.task_id) return false;
  const kind = readOptionalString(entry.resource.kind);
  if (kind && kind !== "browser_tab") return false;
  const url = readOptionalString(entry.resource.url);
  if (!url) return false;
  return true;
}

function contextEntryId(entry: ContextEntry): string {
  return readOptionalString(entry.resource.id) ?? entry.event_id;
}

function toReadingContextSummary(entry: ContextEntry) {
  return {
    id: contextEntryId(entry),
    title: readOptionalString(entry.resource.title) ?? entry.event_title,
    url: readOptionalString(entry.resource.url),
    captured_at: entry.captured_at,
    event_id: entry.event_id,
    source: entry.event_source,
  };
}

async function promoteEntryToQueuePaper(
  input: { runtime: Runtime; now: Date },
  entry: ContextEntry,
  actorId: string,
): Promise<{ context_id: string; queue_item_id?: string; review_packet_id?: string; event_id: string; idempotent: boolean }> {
  const { store } = input.runtime;
  const contextId = contextEntryId(entry);
  const slug = stableSlug(contextId);
  const eventId = `evt_reading_queue_${slug}`;
  const idempotencyKey = `reading_queue:${contextId}`;
  const nowIso = input.now.toISOString();
  const title = readOptionalString(entry.resource.title) ?? entry.event_title ?? "Reading queue tab";
  const url = readOptionalString(entry.resource.url);

  const event: McpEvent = {
    id: eventId,
    source: "reading-queue",
    source_id: `reading-queue:${contextId}`,
    idempotency_key: idempotencyKey,
    occurred_at: entry.captured_at ?? nowIso,
    received_at: nowIso,
    actor: { id: actorId, type: "human" },
    task_hint: "reading_queue",
    type: "manual.review_requested",
    title: `Read: ${title}`,
    summary: url ? `Captured tab promoted from reading queue: ${url}` : "Captured tab promoted from reading queue.",
    raw_ref: {
      id: `raw_${eventId}`,
      uri: url ?? `reading-queue://context/${contextId}`,
      media_type: "text/html",
    },
    links: url ? [{ label: "Open tab", url }] : [],
    resources: [{
      id: contextId,
      kind: "browser_tab",
      title,
      url,
      source: readOptionalString(entry.resource.source) ?? "chrome-extension",
      captured_at: entry.captured_at ?? nowIso,
      restore_confidence: restoreConfidence(entry.resource.restore_confidence),
      window_id: readOptionalString(entry.resource.window_id),
      tab_id: readOptionalString(entry.resource.tab_id),
    }],
  };

  const existing = await store.getEventByIdempotencyKey("reading-queue", idempotencyKey);
  const stored = await store.ingestEventAsReviewPacket(event, input.now);
  return {
    context_id: contextId,
    queue_item_id: stored.queue_item?.id,
    review_packet_id: stored.review_packet?.id,
    event_id: stored.event.id,
    idempotent: Boolean(existing),
  };
}

function validateAutoPromoteRequest(input: unknown): { ok: true; minAgeSeconds: number; actorId: string } | { ok: false; message: string } {
  const record = isRecord(input) ? input : {};
  let minAgeSeconds = 300;
  if (record.min_age_seconds !== undefined && record.min_age_seconds !== null) {
    if (typeof record.min_age_seconds !== "number" || !Number.isFinite(record.min_age_seconds) || record.min_age_seconds < 0) {
      return { ok: false, message: "min_age_seconds must be a non-negative number" };
    }
    minAgeSeconds = Math.floor(record.min_age_seconds);
  }
  return {
    ok: true,
    minAgeSeconds,
    actorId: readOptionalString(record.actor_id) ?? "reading-queue-autopromote",
  };
}

function validatePromoteRequest(input: unknown): { ok: true; contextIds: string[]; actorId: string } | { ok: false; message: string } {
  if (input === undefined || input === null) {
    return { ok: true, contextIds: [], actorId: "reading-queue" };
  }
  if (!isRecord(input)) return { ok: false, message: "reading-queue promote request must be an object" };
  const contextIds = parseStringList(input.context_ids ?? input.context_id, "context_ids");
  if (!contextIds.ok) return contextIds;
  return {
    ok: true,
    contextIds: contextIds.values,
    actorId: readOptionalString(input.actor_id) ?? "reading-queue",
  };
}

function parseStringList(input: unknown, field: string): { ok: true; values: string[] } | { ok: false; message: string } {
  if (input === undefined || input === null) return { ok: true, values: [] };
  const values = Array.isArray(input) ? input : [input];
  const parsed: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      return { ok: false, message: `${field} must contain non-empty strings` };
    }
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed) parsed.push(trimmed);
    }
  }
  return { ok: true, values: Array.from(new Set(parsed)) };
}

function restoreConfidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function stableSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "unknown";
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
