import { createHash } from "node:crypto";
import type { McpCursorState, McpPollItem, McpPollSourceConfig } from "./types.js";

export function createCursorState(config: McpPollSourceConfig): McpCursorState {
  return {
    cursor: config.cursor.initial,
    seen: new Set<string>(),
  };
}

export function getIdempotencyKey(config: McpPollSourceConfig, item: McpPollItem): string {
  if (config.cursor.strategy === "field") {
    const value = config.cursor.field ? readPath(item, config.cursor.field) : undefined;
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`cursor field ${config.cursor.field ?? "<missing>"} must resolve to string or number`);
    }
    return `${config.id}:${String(value)}`;
  }

  return `${config.id}:${stableHash(item)}`;
}

export function acceptItem(config: McpPollSourceConfig, state: McpCursorState, item: McpPollItem): boolean {
  const key = getIdempotencyKey(config, item);
  if (state.seen.has(key)) {
    return false;
  }

  state.seen.add(key);
  trimSeen(state, config.cursor.dedupeWindow);

  const nextCursor = config.cursor.field ? readPath(item, config.cursor.field) : undefined;
  if (typeof nextCursor === "string" || typeof nextCursor === "number") {
    state.cursor = String(nextCursor);
  }

  return true;
}

function trimSeen(state: McpCursorState, dedupeWindow: number): void {
  while (state.seen.size > dedupeWindow) {
    const first = state.seen.values().next().value as string | undefined;
    if (!first) return;
    state.seen.delete(first);
  }
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, input);
}

function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortRecord(input))).digest("hex");
}

function sortRecord(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sortRecord);
  }
  if (typeof input !== "object" || input === null) {
    return input;
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortRecord(value)]),
  );
}
