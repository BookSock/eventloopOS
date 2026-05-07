export function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

export function eventIdempotencyKey(source: string, idempotencyKey: string): string {
  return `${source}:${idempotencyKey}`;
}

export function taskIdForHint(taskHint: string | undefined): string | undefined {
  return taskHint ? `task_${stableId(taskHint)}` : undefined;
}
