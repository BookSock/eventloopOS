import { acceptItem, createCursorState } from "./cursor_store.js";
import { mapMcpPollItemToEvent } from "./fixture_parser.js";
import type { McpCursorState, McpEvent, McpPollResult, McpPollSourceConfig } from "./types.js";

export type McpToolRunner = {
  callTool(config: McpPollSourceConfig, args: Record<string, unknown>): Promise<McpPollResult>;
};

export type McpPollerState = {
  cursor: McpCursorState;
};

export function createMcpPollerState(config: McpPollSourceConfig): McpPollerState {
  return {
    cursor: createCursorState(config),
  };
}

export async function pollMcpSource(params: {
  config: McpPollSourceConfig;
  runner: McpToolRunner;
  state: McpPollerState;
  receivedAt: string;
}): Promise<{ events: McpEvent[]; cursor?: string; duplicatesIgnored: number }> {
  const result = await params.runner.callTool(params.config, {
    ...params.config.poll.args,
    cursor: params.state.cursor.cursor,
  });

  let duplicatesIgnored = 0;
  const events: McpEvent[] = [];

  for (const item of result.items) {
    if (!acceptItem(params.config, params.state.cursor, item)) {
      duplicatesIgnored += 1;
      continue;
    }
    events.push(mapMcpPollItemToEvent(params.config, item, params.receivedAt));
  }

  if (result.nextCursor) {
    params.state.cursor.cursor = result.nextCursor;
  }

  return {
    events,
    cursor: params.state.cursor.cursor,
    duplicatesIgnored,
  };
}
