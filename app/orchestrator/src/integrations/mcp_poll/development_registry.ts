import { readFile } from "node:fs/promises";
import { parseMcpPollFixture } from "./fixture_parser.js";
import { validateMcpPollSourceConfig } from "./config_schema.js";
import { createMcpPollerState, pollMcpSource, type McpPollerState, type McpToolRunner } from "./poller.js";
import type { McpEvent, McpPollSourceConfig } from "./types.js";

export type McpSourceSummary = {
  id: string;
  server_name: string;
  poll_tool: string;
  cursor_strategy: "field" | "hash";
  cursor_field?: string;
  event_mapper: McpPollSourceConfig["eventMapper"];
  risk_policy: McpPollSourceConfig["riskPolicy"];
};

export type McpSourcePollOutput = {
  events: McpEvent[];
  cursor?: string;
  duplicates_ignored: number;
};

export class DevelopmentMcpSourceRegistry {
  private readonly configs = new Map<string, McpPollSourceConfig>();
  private readonly states = new Map<string, McpPollerState>();

  constructor(configs: McpPollSourceConfig[], private readonly runner?: McpToolRunner) {
    for (const config of configs) {
      this.configs.set(config.id, config);
      this.states.set(config.id, createMcpPollerState(config));
    }
  }

  listSources(): McpSourceSummary[] {
    return Array.from(this.configs.values())
      .map(summarizeMcpSource)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  getSource(sourceId: string): McpSourceSummary | undefined {
    const config = this.configs.get(sourceId);
    return config ? summarizeMcpSource(config) : undefined;
  }

  async pollSource(sourceId: string, input: unknown, receivedAt: string): Promise<McpSourcePollOutput | undefined> {
    const config = this.configs.get(sourceId);
    const state = this.states.get(sourceId);
    if (!config || !state) return undefined;

    const runner = this.runner ?? createFixtureRunner(input);
    const result = await pollMcpSource({
      config,
      state,
      runner,
      receivedAt,
    });

    return {
      events: result.events,
      cursor: result.cursor,
      duplicates_ignored: result.duplicatesIgnored,
    };
  }
}

export function createSeededDevelopmentMcpSourceRegistry(): DevelopmentMcpSourceRegistry {
  return new DevelopmentMcpSourceRegistry([slackSourceConfig(), githubSourceConfig(), genericSourceConfig()]);
}

export async function readMcpSourceConfigs(path: string): Promise<McpPollSourceConfig[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const rawConfigs = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.sources) ? parsed.sources : undefined;
  if (!rawConfigs) {
    throw new Error("MCP source config file must be an array or an object with sources array");
  }

  return rawConfigs.map((rawConfig, index) => {
    const result = validateMcpPollSourceConfig(rawConfig);
    if (!result.ok) {
      throw new Error(`MCP source config ${index}: ${result.issues.join(", ")}`);
    }
    return result.value;
  });
}

function createFixtureRunner(input: unknown): McpToolRunner {
  const fixture = parseMcpPollFixture(input);
  return {
    callTool: async () => fixture,
  };
}

function summarizeMcpSource(config: McpPollSourceConfig): McpSourceSummary {
  return {
    id: config.id,
    server_name: config.server.name,
    poll_tool: config.poll.tool,
    cursor_strategy: config.cursor.strategy,
    cursor_field: config.cursor.field,
    event_mapper: config.eventMapper,
    risk_policy: config.riskPolicy,
  };
}

function slackSourceConfig(): McpPollSourceConfig {
  return {
    id: "slack_dm_source",
    server: {
      name: "fake-slack-mcp",
      command: "fake-slack-mcp",
      args: ["--stdio"],
      envAllowlist: ["SLACK_MCP_TOKEN"],
      stderrLogPath: "var/log/mcp/slack_dm_source.stderr.log",
    },
    poll: {
      tool: "search_messages",
      args: {
        query: "is:dm OR mentions:me",
      },
      timeoutMs: 5_000,
    },
    cursor: {
      strategy: "field",
      field: "ts",
      initial: "0",
      dedupeWindow: 100,
    },
    eventMapper: "slack_message_to_event",
    riskPolicy: {
      readOnly: true,
      allowWriteTools: false,
      maxRiskLevel: "low",
      untrustedTextFields: ["text"],
    },
  };
}

function githubSourceConfig(): McpPollSourceConfig {
  return {
    id: "github_update_source",
    server: {
      name: "fake-github-mcp",
      command: "fake-github-mcp",
      args: ["--stdio"],
      envAllowlist: ["GITHUB_TOKEN"],
      stderrLogPath: "var/log/mcp/github_update_source.stderr.log",
    },
    poll: {
      tool: "list_notifications",
      args: {
        participating: true,
      },
      timeoutMs: 5_000,
    },
    cursor: {
      strategy: "field",
      field: "id",
      initial: "0",
      dedupeWindow: 100,
    },
    eventMapper: "github_update_to_event",
    riskPolicy: {
      readOnly: true,
      allowWriteTools: false,
      maxRiskLevel: "low",
      untrustedTextFields: ["body"],
    },
  };
}

function genericSourceConfig(): McpPollSourceConfig {
  return {
    id: "generic_mcp_source",
    server: {
      name: "fake-local-events-mcp",
      command: "fake-local-events-mcp",
      args: ["--stdio"],
      envAllowlist: [],
      stderrLogPath: "var/log/mcp/generic_mcp_source.stderr.log",
    },
    poll: {
      tool: "list_events",
      args: {},
      timeoutMs: 5_000,
    },
    cursor: {
      strategy: "hash",
      dedupeWindow: 100,
    },
    eventMapper: "generic_item_to_event",
    riskPolicy: {
      readOnly: true,
      allowWriteTools: false,
      maxRiskLevel: "low",
      untrustedTextFields: ["title", "summary", "text"],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
