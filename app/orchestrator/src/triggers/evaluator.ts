import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { PaperTriggerRecord } from "../store.js";

export function findMatchingTriggers(
  event: McpEvent,
  triggers: PaperTriggerRecord[],
): PaperTriggerRecord[] {
  return triggers.filter((trigger) => triggerMatchesEvent(trigger, event));
}

export function triggerMatchesEvent(trigger: PaperTriggerRecord, event: McpEvent): boolean {
  if (!trigger.enabled) return false;
  if (trigger.match_event_type !== event.type) return false;
  if (trigger.match_source_id_pattern && !globMatch(trigger.match_source_id_pattern, event.source_id)) {
    return false;
  }
  if (trigger.match_body_substring && !bodyContainsCaseInsensitive(event, trigger.match_body_substring)) {
    return false;
  }
  return true;
}

export function bodyContainsCaseInsensitive(event: McpEvent, needle: string): boolean {
  const lowered = needle.toLowerCase();
  if (!lowered) return true;
  const haystack = `${event.title}\n${event.summary ?? ""}`.toLowerCase();
  return haystack.includes(lowered);
}

export function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*" || pattern === "") return true;
  if (!pattern.includes("*")) return pattern === value;
  const escaped = pattern
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function paperTriggerDedupeKey(event: McpEvent): string {
  if (event.idempotency_key) return event.idempotency_key;
  return `${event.source}:${event.id}`;
}

export function buildTriggerFiredEvent(input: {
  trigger: PaperTriggerRecord;
  sourceEvent: McpEvent;
  now: Date;
}): McpEvent {
  const { trigger, sourceEvent, now } = input;
  const stable = `${trigger.trigger_id}_${paperTriggerDedupeKey(sourceEvent)}`;
  const eventId = `evt_paper_trigger_${stableId(stable)}`;
  const idempotencyKey = `paper_trigger:${trigger.trigger_id}:${paperTriggerDedupeKey(sourceEvent)}`;
  const timestamp = now.toISOString();
  return {
    id: eventId,
    source: "paper_trigger",
    source_id: `paper_trigger:${trigger.trigger_id}`,
    idempotency_key: idempotencyKey,
    occurred_at: sourceEvent.occurred_at ?? timestamp,
    received_at: timestamp,
    actor: { id: "paper_trigger", type: "system" },
    task_hint: stripTaskPrefix(trigger.task_id),
    project_hint: sourceEvent.project_hint,
    type: "paper_trigger.fired",
    title: `Trigger fired: ${trigger.name}`,
    summary: `Trigger "${trigger.name}" matched event ${sourceEvent.type} from ${sourceEvent.source_id}.\n\nOriginal: ${sourceEvent.title}${sourceEvent.summary ? "\n" + sourceEvent.summary : ""}`,
    raw_ref: {
      id: `raw_paper_trigger_${stableId(stable)}`,
      uri: `paper-trigger://${trigger.trigger_id}/${paperTriggerDedupeKey(sourceEvent)}`,
      media_type: "application/json",
    },
    links: sourceEvent.links ?? [],
    resources: [
      {
        id: `ctx_paper_trigger_${stableId(stable)}`,
        kind: "paper_trigger_match",
        title: `Trigger ${trigger.name}`,
        source: "paper_trigger",
        captured_at: timestamp,
        restore_confidence: "medium",
        details: {
          trigger_id: trigger.trigger_id,
          task_id: trigger.task_id,
          source_event_id: sourceEvent.id,
          source_event_type: sourceEvent.type,
          source_event_source_id: sourceEvent.source_id,
        },
      },
      ...sourceEvent.resources,
    ],
  };
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function stripTaskPrefix(taskId: string): string {
  return taskId.startsWith("task_") ? taskId.slice("task_".length) : taskId;
}
