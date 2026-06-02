import { evaluateHook } from "../hooks/evaluator.js";
import type { Observability } from "../observability.js";
import {
  sanitizeTaskMessage,
  taskMessageRecordToApiMessage,
  type TaskMessageHistoryStore,
} from "./task_message_history.js";
import type { TaskFollowupPolicyMeta } from "./task_followup_policy.js";
import type { TaskFollowupInput, TaskRuntimeStart, TaskSessionController } from "./types.js";

export type TaskFollowupAuditOptions = {
  taskSessions?: TaskSessionController;
  observability?: Observability;
  taskMessageStore?: TaskMessageHistoryStore;
};

export type TaskFollowupAuditMeta = {
  origin: string;
  occurredAt: string;
  taskId?: string;
  queueItemId?: string;
  eventId?: string;
  sourceId?: string;
  policy?: TaskFollowupPolicyMeta;
};

export async function recordTaskStartMessageWithActivity(
  options: TaskFollowupAuditOptions,
  input: {
    started: TaskRuntimeStart;
    prompt: string;
    idempotency_key: string;
    task_id: string;
  },
  meta: Pick<TaskFollowupAuditMeta, "origin" | "occurredAt">,
): Promise<unknown | undefined> {
  const taskMessageStore = options.taskMessageStore;
  if (!taskMessageStore) return undefined;

  const existing = await taskMessageStore.getTaskMessageByIdempotencyKey(input.idempotency_key);
  if (existing) return taskMessageRecordToApiMessage(existing);

  const started = input.started;
  const message = isRecord(started.message) ? started.message : undefined;
  const session = isRecord(started.session) ? started.session : undefined;
  const taskSessionId =
    optionalString(message?.task_session_id)
    ?? optionalString(started.task_session_id)
    ?? optionalString(session?.id);
  if (!taskSessionId) return undefined;

  const status = message?.status === "blocked" || message?.status === "failed"
    ? message.status
    : started.ok === false
      ? "failed"
      : "sent";
  const error = status === "failed"
    ? optionalString(started.error) ?? optionalString(message?.error)
    : status === "blocked"
      ? optionalString(message?.blocked_reason) ?? optionalString(started.error)
      : undefined;
  const details = {
    origin: meta.origin,
    idempotency_key: input.idempotency_key,
    text_length: input.prompt.length,
    event_count: 0,
  };

  await taskMessageStore.recordTaskMessageAttempt({
    task_session_id: taskSessionId,
    text: input.prompt,
    event_ids: [],
    idempotency_key: input.idempotency_key,
    origin: meta.origin,
    occurred_at: meta.occurredAt,
    task_id: input.task_id,
  });
  await taskMessageStore.finalizeTaskMessage({
    idempotency_key: input.idempotency_key,
    status,
    occurred_at: meta.occurredAt,
    message: message ?? started,
    error,
  });

  const finalized = await taskMessageStore.getTaskMessageByIdempotencyKey(input.idempotency_key);
  await options.observability?.incrementCounter("task_starts_attempted_total");
  await options.observability?.incrementCounter(status === "sent" ? "task_starts_sent_total" : `task_starts_${status}_total`);
  await options.observability?.recordActivity({
    type: status === "sent" ? "task_start_sent" : `task_start_${status}`,
    occurred_at: meta.occurredAt,
    actor: "system",
    task_id: input.task_id,
    task_session_id: taskSessionId,
    status: status === "sent" ? "ok" : status,
    summary: `${status === "sent" ? "Task start sent" : `Task start ${status}`}: ${taskSessionId}`,
    details: {
      ...details,
      message: sanitizeTaskMessage(message ?? started),
      durable_id: finalized?.id,
    },
  });

  return finalized ? taskMessageRecordToApiMessage(finalized) : undefined;
}

export async function sendTaskFollowupWithActivity(
  options: TaskFollowupAuditOptions,
  input: TaskFollowupInput,
  meta: TaskFollowupAuditMeta,
): Promise<unknown> {
  if (!options.taskSessions) {
    throw new Error("task session controller is not configured");
  }

  const { policy: inputPolicy, ...runtimeInput } = input;
  const policy = meta.policy ?? inputPolicy;
  const observability = options.observability;
  const taskMessageStore = options.taskMessageStore;
  const details = {
    origin: meta.origin,
    idempotency_key: input.idempotency_key,
    text_length: input.text.length,
    event_count: input.event_ids.length,
  };

  const existing = await taskMessageStore?.getTaskMessageByIdempotencyKey(input.idempotency_key);
  if (existing) {
    return taskMessageRecordToApiMessage(existing);
  }

  await taskMessageStore?.recordTaskMessageAttempt({
    task_session_id: input.task_session_id,
    text: input.text,
    event_ids: input.event_ids,
    idempotency_key: input.idempotency_key,
    origin: meta.origin,
    occurred_at: meta.occurredAt,
    task_id: meta.taskId,
    queue_item_id: meta.queueItemId,
    source_id: meta.sourceId,
  });

  await observability?.incrementCounter("task_followups_attempted_total");
  await observability?.recordActivity({
    type: "task_followup_attempted",
    occurred_at: meta.occurredAt,
    actor: "system",
    task_id: meta.taskId,
    queue_item_id: meta.queueItemId,
    event_id: meta.eventId ?? input.event_ids[0],
    task_session_id: input.task_session_id,
    source_id: meta.sourceId,
    status: "ok",
    summary: `Task followup attempted: ${input.task_session_id}`,
    details,
  });

  if (policy) {
    const decision = evaluateHook({
      ...policy,
      now: new Date(meta.occurredAt),
    });
    if (decision.decision !== "allow") {
      const message = {
        id: `task_msg_blocked_${stableId(input.idempotency_key)}`,
        task_session_id: input.task_session_id,
        mode: "followup",
        text: input.text,
        event_ids: input.event_ids,
        idempotency_key: input.idempotency_key,
        status: "blocked",
        blocked_reason: decision.reason ?? "task message blocked by policy",
        policy_decision: decision,
      };
      await taskMessageStore?.finalizeTaskMessage({
        idempotency_key: input.idempotency_key,
        status: "blocked",
        occurred_at: meta.occurredAt,
        message,
        error: decision.reason ?? "task message blocked by policy",
      });
      await observability?.incrementCounter("task_followups_blocked_total");
      await observability?.recordActivity({
        type: "task_followup_blocked",
        occurred_at: meta.occurredAt,
        actor: "system",
        task_id: meta.taskId,
        queue_item_id: meta.queueItemId,
        event_id: meta.eventId ?? input.event_ids[0],
        task_session_id: input.task_session_id,
        source_id: meta.sourceId,
        status: "blocked",
        summary: `Task followup blocked: ${input.task_session_id}`,
        details: {
          ...details,
          message: sanitizeTaskMessage(message),
        },
      });
      return message;
    }
  }

  try {
    const message = await options.taskSessions.sendFollowupMessage(runtimeInput);
    const blocked = isRecord(message) && message.status === "blocked";
    const failed = isRecord(message) && message.status === "failed";
    const status = failed ? "failed" : blocked ? "blocked" : "sent";
    const eventType = failed ? "task_followup_failed" : blocked ? "task_followup_blocked" : "task_followup_sent";
    const activityStatus = failed ? "failed" : blocked ? "blocked" : "ok";
    const finalized = await taskMessageStore?.finalizeTaskMessage({
      idempotency_key: input.idempotency_key,
      status,
      occurred_at: meta.occurredAt,
      message,
      error: (blocked || failed) && isRecord(message) && typeof message.error === "string" ? message.error : undefined,
    });
    await observability?.incrementCounter(
      failed ? "task_followups_failed_total" : blocked ? "task_followups_blocked_total" : "task_followups_sent_total",
    );
    await observability?.recordActivity({
      type: eventType,
      occurred_at: meta.occurredAt,
      actor: "system",
      task_id: meta.taskId,
      queue_item_id: meta.queueItemId,
      event_id: meta.eventId ?? input.event_ids[0],
      task_session_id: input.task_session_id,
      source_id: meta.sourceId,
      status: activityStatus,
      summary: `${failed ? "Task followup failed" : blocked ? "Task followup blocked" : "Task followup sent"}: ${input.task_session_id}`,
      details: {
        ...details,
        message: sanitizeTaskMessage(message),
      },
    });
    // Keep the API response useful for the current send while the durable audit
    // record stays redacted for history/lineage endpoints.
    if (isRecord(message) && typeof message.error === "string") {
      return {
        ...message,
        recovery_hint: recoveryHintForTaskMessageError(message.error),
      };
    }
    return message;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finalized = await taskMessageStore?.finalizeTaskMessage({
      idempotency_key: input.idempotency_key,
      status: "failed",
      occurred_at: meta.occurredAt,
      error: message,
    });
    await observability?.incrementCounter("task_followups_failed_total");
    await observability?.recordActivity({
      type: "task_followup_failed",
      occurred_at: meta.occurredAt,
      actor: "system",
      task_id: meta.taskId,
      queue_item_id: meta.queueItemId,
      event_id: meta.eventId ?? input.event_ids[0],
      task_session_id: input.task_session_id,
      source_id: meta.sourceId,
      status: "failed",
      summary: `Task followup failed: ${input.task_session_id}`,
      details: {
        ...details,
        error: message,
      },
    });
    if (finalized) return taskMessageRecordToApiMessage(finalized);
    return {
      id: `task_msg_failed_${stableId(input.idempotency_key)}`,
      task_session_id: input.task_session_id,
      mode: "followup",
      event_ids: input.event_ids,
      idempotency_key: input.idempotency_key,
      status: "failed",
      error: message,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function recoveryHintForTaskMessageError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const lowered = error.toLowerCase();
  if (lowered.includes("thread not found")
    || lowered.includes("native thread lost")
    || lowered.includes("native thread missing")
    || lowered.includes("stale")
    || lowered.includes("websocket is closed")) {
    return "Codex thread is stale. Replace or rebind the task session, then send the followup again.";
  }
  if (lowered.includes("codex app-server")
    || lowered.includes("app-server")
    || lowered.includes("stream is closed")
    || lowered.includes("connection refused")) {
    return "Codex app-server is unavailable. Restart dogfood stack or Codex app-server, then retry followup.";
  }
  if (lowered.includes("postgres")
    || lowered.includes("database_url")
    || lowered.includes("migration")) {
    return "Postgres is unavailable or schema is stale. Start the database or run migration repair before retrying.";
  }
  if (lowered.includes("ghostty")
    || lowered.includes("terminal cleanup")
    || lowered.includes("terminate running processes")) {
    return "Terminal cleanup needs attention. Close stuck Ghostty/Terminal prompts, then rerun cleanup.";
  }
  return undefined;
}
