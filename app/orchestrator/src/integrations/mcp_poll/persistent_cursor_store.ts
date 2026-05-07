import type { McpCursorState } from "./types.js";

export type McpPollStateSnapshot = {
  source_id: string;
  cursor?: string;
  seen: string[];
  updated_at: string;
};

export type McpCursorStateStore = {
  getMcpPollState(sourceId: string): Promise<McpPollStateSnapshot | undefined>;
  saveMcpPollState(sourceId: string, state: McpCursorState, now: Date): Promise<McpPollStateSnapshot>;
};

export function hydrateCursorState(state: McpCursorState, snapshot: McpPollStateSnapshot | undefined): void {
  if (!snapshot) return;
  state.cursor = snapshot.cursor;
  state.seen = new Set(snapshot.seen);
}
