import { createHash } from "node:crypto";

export type DurableTaskMessageStatus = "attempted" | "sent" | "blocked" | "failed";

export type DurableTaskMessageRecord = {
  id: string;
  idempotency_key: string;
  task_session_id: string;
  task_id?: string;
  queue_item_id?: string;
  event_ids: string[];
  origin: string;
  source_id?: string;
  mode: "followup";
  status: DurableTaskMessageStatus;
  text_hash: string;
  text_length: number;
  provider?: string;
  native_thread_id?: string;
  native_turn_id?: string;
  native_session_id?: string;
  native_result_session_id?: string;
  error?: string;
  message: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  sent_at?: string;
};

export type DurableTaskMessageAttemptInput = {
  task_session_id: string;
  text: string;
  event_ids: string[];
  idempotency_key: string;
  origin: string;
  occurred_at: string;
  task_id?: string;
  queue_item_id?: string;
  source_id?: string;
};

export type DurableTaskMessageFinalInput = {
  idempotency_key: string;
  status: Exclude<DurableTaskMessageStatus, "attempted">;
  occurred_at: string;
  message?: unknown;
  error?: string;
};

export type TaskMessageHistoryQuery = {
  task_session_id?: string;
  task_id?: string;
  queue_item_id?: string;
  event_id?: string;
  idempotency_key?: string;
  status?: DurableTaskMessageStatus;
  limit?: number;
};

export type TaskMessageHistoryStore = {
  getTaskMessageByIdempotencyKey(idempotencyKey: string): Promise<DurableTaskMessageRecord | undefined>;
  listTaskMessages(query?: TaskMessageHistoryQuery): Promise<DurableTaskMessageRecord[]>;
  recordTaskMessageAttempt(input: DurableTaskMessageAttemptInput): Promise<DurableTaskMessageRecord>;
  finalizeTaskMessage(input: DurableTaskMessageFinalInput): Promise<DurableTaskMessageRecord | undefined>;
};

export function buildTaskMessageAttemptRecord(input: DurableTaskMessageAttemptInput): DurableTaskMessageRecord {
  return {
    id: `task_msg_${stableId(input.idempotency_key)}`,
    idempotency_key: input.idempotency_key,
    task_session_id: input.task_session_id,
    task_id: input.task_id,
    queue_item_id: input.queue_item_id,
    event_ids: input.event_ids,
    origin: input.origin,
    source_id: input.source_id,
    mode: "followup",
    status: "attempted",
    text_hash: hashText(input.text),
    text_length: input.text.length,
    message: {},
    created_at: input.occurred_at,
    updated_at: input.occurred_at,
  };
}

export function finalizeTaskMessageRecord(
  existing: DurableTaskMessageRecord,
  input: DurableTaskMessageFinalInput,
): DurableTaskMessageRecord {
  const message = sanitizeTaskMessage(input.message);
  return {
    ...existing,
    status: input.status,
    provider: providerFromMessage(message) ?? existing.provider,
    native_thread_id: optionalString(message.native_thread_id) ?? existing.native_thread_id,
    native_turn_id: optionalString(message.native_turn_id) ?? existing.native_turn_id,
    native_session_id: optionalString(message.native_session_id) ?? existing.native_session_id,
    native_result_session_id: optionalString(message.native_result_session_id) ?? existing.native_result_session_id,
    error: input.error ?? optionalString(message.error) ?? optionalString(message.blocked_reason) ?? existing.error,
    message,
    updated_at: input.occurred_at,
    sent_at: input.status === "sent" ? input.occurred_at : existing.sent_at,
  };
}

export function taskMessageRecordToApiMessage(record: DurableTaskMessageRecord): Record<string, unknown> {
  return {
    id: optionalString(record.message.id) ?? record.id,
    durable_id: record.id,
    task_session_id: record.task_session_id,
    task_id: record.task_id,
    queue_item_id: record.queue_item_id,
    origin: record.origin,
    source_id: record.source_id,
    mode: record.mode,
    event_ids: record.event_ids,
    idempotency_key: record.idempotency_key,
    status: record.status,
    sent_at: record.sent_at,
    text_hash: record.text_hash,
    text_length: record.text_length,
    provider: record.provider,
    native_thread_id: record.native_thread_id,
    native_turn_id: record.native_turn_id,
    native_session_id: record.native_session_id,
    native_result_session_id: record.native_result_session_id,
    error: record.error,
    created_at: record.created_at,
    updated_at: record.updated_at,
    durable: true,
  };
}

export function sanitizeTaskMessage(message: unknown): Record<string, unknown> {
  if (!isRecord(message)) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (key === "text") continue;
    if (value === undefined) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function providerFromMessage(message: Record<string, unknown>): string | undefined {
  const explicit = optionalString(message.provider);
  if (explicit) return explicit;
  const id = optionalString(message.id);
  if (id?.startsWith("codex_")) return "codex";
  if (id?.startsWith("claude_")) return "claude";
  if (id?.startsWith("composite_")) return "composite";
  return undefined;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
