import { evaluateHook } from "../hooks/evaluator.js";
import type { Observability } from "../observability.js";
import {
  sanitizeTaskMessage,
  taskMessageRecordToApiMessage,
  type TaskMessageHistoryStore,
} from "./task_message_history.js";
import type { TaskFollowupPolicyMeta } from "./task_followup_policy.js";
import type { TaskFollowupInput, TaskSessionController } from "./types.js";

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
    await taskMessageStore?.finalizeTaskMessage({
      idempotency_key: input.idempotency_key,
      status: blocked ? "blocked" : "sent",
      occurred_at: meta.occurredAt,
      message,
      error: blocked && isRecord(message) && typeof message.error === "string" ? message.error : undefined,
    });
    await observability?.incrementCounter(blocked ? "task_followups_blocked_total" : "task_followups_sent_total");
    await observability?.recordActivity({
      type: blocked ? "task_followup_blocked" : "task_followup_sent",
      occurred_at: meta.occurredAt,
      actor: "system",
      task_id: meta.taskId,
      queue_item_id: meta.queueItemId,
      event_id: meta.eventId ?? input.event_ids[0],
      task_session_id: input.task_session_id,
      source_id: meta.sourceId,
      status: blocked ? "blocked" : "ok",
      summary: `${blocked ? "Task followup blocked" : "Task followup sent"}: ${input.task_session_id}`,
      details: {
        ...details,
        message: sanitizeTaskMessage(message),
      },
    });
    return message;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await taskMessageStore?.finalizeTaskMessage({
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
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
