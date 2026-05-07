import { sanitizeTaskMessage } from "../task_sessions/task_message_history.js";

export function sanitizeActivityDetails(details: Record<string, unknown>): Record<string, unknown> {
  return sanitizeActivityValue(details) as Record<string, unknown>;
}

function sanitizeActivityValue(value: unknown, key?: string): unknown {
  if (key === "task_message") return sanitizeTaskMessage(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeActivityValue(entry));
  if (!isRecord(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === "text") continue;
    if (childValue === undefined) continue;
    sanitized[childKey] = sanitizeActivityValue(childValue, childKey);
  }
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
