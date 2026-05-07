import { acceptItem, createCursorState } from "./cursor_store.js";
import { mapMcpPollItemToEvent } from "./fixture_parser.js";
import type { McpCursorState, McpEvent, McpPollResult, McpPollSourceConfig } from "./types.js";

export type McpToolRunner = {
  listTools?(config: McpPollSourceConfig): Promise<Array<Record<string, unknown>>>;
  callTool(config: McpPollSourceConfig, args: Record<string, unknown>): Promise<McpPollResult>;
};

export type McpPollerState = {
  cursor: McpCursorState;
  toolSafetyChecked: boolean;
};

export function createMcpPollerState(config: McpPollSourceConfig): McpPollerState {
  return {
    cursor: createCursorState(config),
    toolSafetyChecked: false,
  };
}

export async function pollMcpSource(params: {
  config: McpPollSourceConfig;
  runner: McpToolRunner;
  state: McpPollerState;
  receivedAt: string;
}): Promise<{ events: McpEvent[]; cursor?: string; duplicatesIgnored: number }> {
  await assertConfiguredPollToolIsReadOnly(params.config, params.runner, params.state);

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

async function assertConfiguredPollToolIsReadOnly(
  config: McpPollSourceConfig,
  runner: McpToolRunner,
  state: McpPollerState,
): Promise<void> {
  if (state.toolSafetyChecked) {
    return;
  }

  if (!runner.listTools) {
    state.toolSafetyChecked = true;
    return;
  }

  const tools = await runner.listTools(config);
  const tool = tools.find((candidate) => candidate.name === config.poll.tool);
  if (!tool) {
    throw new Error(`MCP poll tool ${config.poll.tool} is not advertised by source ${config.id}`);
  }

  const annotations = isRecord(tool.annotations) ? tool.annotations : {};
  if (annotations.readOnlyHint !== true) {
    throw new Error(`MCP poll tool ${config.poll.tool} for source ${config.id} must advertise annotations.readOnlyHint=true`);
  }

  state.toolSafetyChecked = true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
