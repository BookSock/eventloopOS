import { randomUUID } from "node:crypto";
import { inspectCodexSession } from "../agents/codex/session_inspector.js";
import type { GatewayStore } from "../gateway_store.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import { sendTaskFollowupWithActivity } from "../task_sessions/task_followup_audit.js";
import { bestTaskSessionForTask } from "../task_sessions/session_selection.js";
import type { TaskRuntimeSession, TaskSessionController } from "../task_sessions/types.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

type FanOutMatch = {
  task_id: string;
  task_session_id?: string;
  matched_packet_id?: string;
  matched_packet_title?: string;
  idle_seconds?: number;
};

export async function handleMasterRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  const observability = input.runtime.observability;
  if (input.method !== "POST" || input.pathname !== "/master/fan-out") return undefined;

  const parsed = await input.readJsonBody();
  if (!parsed.ok) return schemaError(parsed.message);
  const validation = validateFanOutRequest(parsed.value);
  if (!validation.ok) return schemaError(validation.message);

  const matches = await resolveFanOutMatches(input, validation);
  if (matches.length === 0) {
    return ok(200, {
      ok: true,
      dry_run: validation.dryRun,
      matched_count: 0,
      delivered: [],
      skipped: [],
      missing_task_ids: validation.taskIds.filter((id) => !matches.some((match) => match.task_id === id)),
      request_id: input.requestId,
    });
  }

  if (validation.dryRun) {
    return ok(200, {
      ok: true,
      dry_run: true,
      matched_count: matches.length,
      preview: matches,
      request_id: input.requestId,
    });
  }

  if (!input.runtime.taskSessions) {
    return error(501, "task_sessions_unavailable", "task session controller is not configured");
  }

  const fanOutId = `master_fan_${randomUUID()}`;
  const delivered: Array<{ task_id: string; task_session_id: string; task_message: unknown }> = [];
  const skipped: Array<{ task_id: string; reason: string }> = [];

  for (const match of matches) {
    if (!match.task_session_id) {
      skipped.push({ task_id: match.task_id, reason: "no_bound_session" });
      continue;
    }
    try {
      const message = await sendTaskFollowupWithActivity({
        taskSessions: input.runtime.taskSessions,
        observability: input.runtime.observability,
        taskMessageStore: input.runtime.store,
      }, {
        task_session_id: match.task_session_id,
        text: buildFanOutFollowupText(validation.message, validation.target ?? validation.taskHintSubstring ?? "all"),
        event_ids: [],
        idempotency_key: `${validation.idempotencyKey}:${match.task_id}`,
      }, {
        origin: "master_fan_out",
        occurredAt: input.now.toISOString(),
        taskId: match.task_id,
      });
      const status = (message as { status?: string } | undefined)?.status;
      if (status === "blocked" || status === "failed") {
        skipped.push({ task_id: match.task_id, reason: `task_message_${status}` });
        continue;
      }
      delivered.push({ task_id: match.task_id, task_session_id: match.task_session_id, task_message: message });
    } catch (caught) {
      skipped.push({ task_id: match.task_id, reason: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  await input.runtime.observability.incrementCounter("master_fan_out_total");
  await input.runtime.observability.incrementCounter("master_fan_out_delivered_total", delivered.length || undefined);
  await input.runtime.observability.incrementCounter("master_fan_out_skipped_total", skipped.length || undefined);
  await input.runtime.observability.recordActivity({
    type: "master_fan_out",
    occurred_at: input.now.toISOString(),
    actor: "human",
    status: "ok",
    summary: `Master fan-out: ${delivered.length} delivered / ${skipped.length} skipped`,
    details: sanitizeActivityDetails({
      fan_out_id: fanOutId,
      message_preview: validation.message.slice(0, 80),
      target: validation.target,
      task_hint_substring: validation.taskHintSubstring,
      task_ids: validation.taskIds,
      delivered_task_ids: delivered.map((entry) => entry.task_id),
      skipped: skipped.map((entry) => ({ task_id: entry.task_id, reason: entry.reason })),
    }),
  });

  return ok(200, {
    ok: true,
    dry_run: false,
    fan_out_id: fanOutId,
    matched_count: matches.length,
    delivered_count: delivered.length,
    delivered,
    skipped,
    request_id: input.requestId,
  });
}

async function resolveFanOutMatches(
  input: {
    runtime: Runtime;
    now: Date;
  },
  validation: ValidatedFanOutRequest,
): Promise<FanOutMatch[]> {
  const sessions = input.runtime.taskSessions?.listSessions
    ? (await Promise.resolve(input.runtime.taskSessions.listSessions()).catch(() => [])) as TaskRuntimeSession[]
    : [];

  const queue = await input.runtime.store.listQueue(undefined, input.now);
  const taskCandidates = new Map<string, FanOutMatch>();

  const includeTask = (taskId: string, packetId?: string, packetTitle?: string) => {
    const existing = taskCandidates.get(taskId);
    if (existing) {
      if (!existing.matched_packet_id && packetId) {
        existing.matched_packet_id = packetId;
        existing.matched_packet_title = packetTitle;
      }
      return;
    }
    const session = bestTaskSessionForTask(sessions, taskId);
    const sessionId = isRecord(session) && typeof session.id === "string" ? session.id : undefined;
    taskCandidates.set(taskId, {
      task_id: taskId,
      task_session_id: sessionId,
      matched_packet_id: packetId,
      matched_packet_title: packetTitle,
    });
  };

  if (validation.taskIds.length > 0) {
    for (const taskId of validation.taskIds) includeTask(taskId);
  }

  if (validation.taskIdPattern) {
    const pattern = validation.taskIdPattern;
    for (const session of sessions) {
      const taskId = isRecord(session) && typeof session.task_id === "string" ? session.task_id : undefined;
      if (taskId && pattern.test(taskId)) includeTask(taskId);
    }
    for (const item of queue) {
      if (item.task_id && pattern.test(item.task_id)) {
        includeTask(item.task_id, item.id, item.review_packet.title);
      }
    }
  }

  if (validation.taskHintSubstring) {
    const needle = validation.taskHintSubstring.toLowerCase();
    for (const session of sessions) {
      const taskId = isRecord(session) && typeof session.task_id === "string" ? session.task_id : undefined;
      if (taskId && taskId.toLowerCase().includes(needle)) includeTask(taskId);
    }
    for (const item of queue) {
      const haystack = `${item.task_id ?? ""} ${item.review_packet.title}`.toLowerCase();
      if (item.task_id && haystack.includes(needle)) {
        includeTask(item.task_id, item.id, item.review_packet.title);
      }
    }
  }

  let candidates = [...taskCandidates.values()];

  if (validation.idleMinSeconds !== undefined) {
    const filtered: FanOutMatch[] = [];
    for (const candidate of candidates) {
      const session = sessions.find((entry) => isRecord(entry) && typeof entry.id === "string" && entry.id === candidate.task_session_id);
      const nativeThreadId = isRecord(session) && typeof session.native_thread_id === "string" ? session.native_thread_id : undefined;
      if (!nativeThreadId) continue;
      const inspection = await inspectCodexSession(nativeThreadId, { now: input.now });
      if (!inspection.exists || inspection.idle_seconds === undefined) continue;
      if (inspection.idle_seconds < validation.idleMinSeconds) continue;
      filtered.push({ ...candidate, idle_seconds: inspection.idle_seconds });
    }
    candidates = filtered;
  }

  return candidates.sort((a, b) => a.task_id.localeCompare(b.task_id));
}

type ValidatedFanOutRequest = {
  message: string;
  taskIds: string[];
  taskIdPattern?: RegExp;
  taskHintSubstring?: string;
  idleMinSeconds?: number;
  target?: string;
  dryRun: boolean;
  idempotencyKey: string;
};

function validateFanOutRequest(input: unknown): { ok: true } & ValidatedFanOutRequest | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "fan-out request must be an object" };
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return { ok: false, message: "message must be a non-empty string" };
  if (message.length > 4000) return { ok: false, message: "message must be 4000 characters or fewer" };

  const selector = isRecord(input.selector) ? input.selector : {};
  const taskIdsValue = selector.task_ids;
  const taskIds: string[] = [];
  if (Array.isArray(taskIdsValue)) {
    for (const value of taskIdsValue) {
      if (typeof value !== "string") {
        return { ok: false, message: "selector.task_ids must contain only strings" };
      }
      const trimmed = value.trim();
      if (trimmed) taskIds.push(trimmed);
    }
  }

  let taskIdPattern: RegExp | undefined;
  if (typeof selector.task_id_pattern === "string" && selector.task_id_pattern.trim()) {
    try {
      taskIdPattern = new RegExp(selector.task_id_pattern.trim(), "i");
    } catch (error) {
      return { ok: false, message: `selector.task_id_pattern is not a valid regex: ${(error as Error).message}` };
    }
  }

  const taskHintSubstring = typeof selector.task_hint_substring === "string" && selector.task_hint_substring.trim()
    ? selector.task_hint_substring.trim()
    : undefined;

  let idleMinSeconds: number | undefined;
  if (selector.idle_min_seconds !== undefined && selector.idle_min_seconds !== null) {
    if (typeof selector.idle_min_seconds !== "number" || !Number.isFinite(selector.idle_min_seconds) || selector.idle_min_seconds < 0) {
      return { ok: false, message: "selector.idle_min_seconds must be a non-negative finite number" };
    }
    idleMinSeconds = Math.floor(selector.idle_min_seconds);
  }

  if (taskIds.length === 0 && !taskIdPattern && !taskHintSubstring && idleMinSeconds === undefined) {
    return { ok: false, message: "selector must include task_ids, task_id_pattern, task_hint_substring, or idle_min_seconds" };
  }

  const dryRun = input.dry_run === true;
  const target = typeof input.target === "string" && input.target.trim() ? input.target.trim() : undefined;
  const idempotencyKeyValue = input.idempotency_key;
  const idempotencyKey = typeof idempotencyKeyValue === "string" && idempotencyKeyValue.trim()
    ? idempotencyKeyValue.trim()
    : `master_fan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return {
    ok: true,
    message,
    taskIds,
    taskIdPattern,
    taskHintSubstring,
    idleMinSeconds,
    target,
    dryRun,
    idempotencyKey,
  };
}

function buildFanOutFollowupText(message: string, target: string): string {
  return [
    "[eventloopOS broadcast]",
    `Target: ${target}`,
    "",
    message,
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}
