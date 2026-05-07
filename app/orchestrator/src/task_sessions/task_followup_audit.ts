import type { Observability } from "../observability.js";
import type { TaskFollowupInput, TaskSessionController } from "./types.js";

export type TaskFollowupAuditOptions = {
  taskSessions?: TaskSessionController;
  observability?: Observability;
};

export type TaskFollowupAuditMeta = {
  origin: string;
  occurredAt: string;
  taskId?: string;
  queueItemId?: string;
  eventId?: string;
  sourceId?: string;
};

export async function sendTaskFollowupWithActivity(
  options: TaskFollowupAuditOptions,
  input: TaskFollowupInput,
  meta: TaskFollowupAuditMeta,
): Promise<unknown> {
  if (!options.taskSessions) {
    throw new Error("task session controller is not configured");
  }

  const observability = options.observability;
  const details = {
    origin: meta.origin,
    idempotency_key: input.idempotency_key,
    text_length: input.text.length,
    event_count: input.event_ids.length,
  };

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

  try {
    const message = await options.taskSessions.sendFollowupMessage(input);
    const blocked = isRecord(message) && message.status === "blocked";
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
        message,
      },
    });
    return message;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
