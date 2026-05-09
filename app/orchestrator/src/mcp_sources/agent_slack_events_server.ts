import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpPollResult } from "../integrations/mcp_poll/types.js";

const execFile = promisify(nodeExecFile);

export type AgentSlackExecFile = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export type AgentSlackServerOptions = {
  env?: NodeJS.ProcessEnv;
  execFile?: AgentSlackExecFile;
};

export type AgentSlackSearchOptions = {
  command: string;
  query: string;
  workspace?: string;
  channels: string[];
  user?: string;
  after?: string;
  before?: string;
  limit: number;
  maxContentChars: number;
  timeoutMs: number;
  maxBufferBytes: number;
};

export function createAgentSlackEventsServer(options: AgentSlackServerOptions = {}): McpServer {
  const env = options.env ?? process.env;
  const runner = options.execFile ?? execFile;
  const server = new McpServer({
    name: "eventloopos-agent-slack-events",
    version: "0.0.0",
  });

  server.registerTool(
    "search_messages",
    {
      title: "Search Slack messages",
      description: "Read Slack messages through local agent-slack CLI and return Slack-like eventloopOS poll items.",
      inputSchema: {
        cursor: z.string().optional(),
        command: z.string().optional(),
        query: z.string().optional(),
        workspace: z.string().optional(),
        channels: z.union([z.string(), z.array(z.string())]).optional(),
        user: z.string().optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        limit: z.number().int().positive().optional(),
        max_content_chars: z.number().int().positive().optional(),
        timeout_ms: z.number().int().positive().optional(),
        max_buffer_bytes: z.number().int().positive().optional(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      const result = await searchAgentSlackMessages(searchOptionsWithCursor(searchOptionsFromEnvAndToolArgs(env, args), args.cursor), runner);
      return {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  return server;
}

export async function searchAgentSlackMessages(
  options: AgentSlackSearchOptions,
  runner: AgentSlackExecFile,
): Promise<McpPollResult> {
  const { stdout } = await runner(options.command, agentSlackSearchArgs(options), {
    timeout: options.timeoutMs,
    maxBuffer: options.maxBufferBytes,
  });
  const parsed = parseAgentSlackJsonOutput(stdout);
  const rawMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const items = rawMessages.filter(isRecord).map((message) => agentSlackMessageToPollItem(message, options));

  return {
    items,
    nextCursor: latestTs(items),
  };
}

export function searchOptionsFromEnv(env: NodeJS.ProcessEnv): AgentSlackSearchOptions {
  const query = env.EVENTLOOPOS_AGENT_SLACK_QUERY?.trim();
  if (!query) {
    throw new Error("EVENTLOOPOS_AGENT_SLACK_QUERY must be set for agent-slack polling");
  }

  return {
    command: env.EVENTLOOPOS_AGENT_SLACK_COMMAND?.trim() || "agent-slack",
    query,
    workspace: optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_WORKSPACE),
    channels: splitList(env.EVENTLOOPOS_AGENT_SLACK_CHANNELS),
    user: optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_USER),
    after: optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_AFTER),
    before: optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_BEFORE),
    limit: positiveInt(env.EVENTLOOPOS_AGENT_SLACK_LIMIT, 20),
    maxContentChars: positiveInt(env.EVENTLOOPOS_AGENT_SLACK_MAX_CONTENT_CHARS, 1200),
    timeoutMs: positiveInt(env.EVENTLOOPOS_AGENT_SLACK_TIMEOUT_MS, 10_000),
    maxBufferBytes: positiveInt(env.EVENTLOOPOS_AGENT_SLACK_MAX_BUFFER_BYTES, 1_000_000),
  };
}

export function searchOptionsFromEnvAndToolArgs(
  env: NodeJS.ProcessEnv,
  args: Record<string, unknown> = {},
): AgentSlackSearchOptions {
  const query = optionalString(args.query) ?? env.EVENTLOOPOS_AGENT_SLACK_QUERY?.trim();
  if (!query) {
    throw new Error("agent-slack polling requires query in poll.args.query or EVENTLOOPOS_AGENT_SLACK_QUERY");
  }

  return {
    command: optionalString(args.command) ?? (env.EVENTLOOPOS_AGENT_SLACK_COMMAND?.trim() || "agent-slack"),
    query,
    workspace: optionalString(args.workspace) ?? optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_WORKSPACE),
    channels: channelsFromToolArg(args.channels) ?? splitList(env.EVENTLOOPOS_AGENT_SLACK_CHANNELS),
    user: optionalString(args.user) ?? optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_USER),
    after: optionalString(args.after) ?? optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_AFTER),
    before: optionalString(args.before) ?? optionalEnv(env.EVENTLOOPOS_AGENT_SLACK_BEFORE),
    limit: positiveIntFromUnknown(args.limit) ?? positiveInt(env.EVENTLOOPOS_AGENT_SLACK_LIMIT, 20),
    maxContentChars: positiveIntFromUnknown(args.max_content_chars) ?? positiveInt(env.EVENTLOOPOS_AGENT_SLACK_MAX_CONTENT_CHARS, 1200),
    timeoutMs: positiveIntFromUnknown(args.timeout_ms) ?? positiveInt(env.EVENTLOOPOS_AGENT_SLACK_TIMEOUT_MS, 10_000),
    maxBufferBytes: positiveIntFromUnknown(args.max_buffer_bytes) ?? positiveInt(env.EVENTLOOPOS_AGENT_SLACK_MAX_BUFFER_BYTES, 1_000_000),
  };
}

export function searchOptionsWithCursor(options: AgentSlackSearchOptions, cursor: string | undefined): AgentSlackSearchOptions {
  if (!cursor || cursor === "0" || options.after) return options;
  return {
    ...options,
    after: dateForSlackCursor(cursor),
  };
}

export function agentSlackSearchArgs(options: AgentSlackSearchOptions): string[] {
  const args = [
    "search",
    "messages",
    options.query,
    "--limit",
    String(options.limit),
    "--max-content-chars",
    String(options.maxContentChars),
  ];
  if (options.workspace) args.push("--workspace", options.workspace);
  for (const channel of options.channels) {
    args.push("--channel", channel);
  }
  if (options.user) args.push("--user", options.user);
  if (options.after) args.push("--after", options.after);
  if (options.before) args.push("--before", options.before);
  return args;
}

function dateForSlackCursor(cursor: string): string {
  const numeric = Number(cursor);
  if (!Number.isFinite(numeric) || numeric <= 0) return cursor;
  return new Date(Math.trunc(numeric * 1000)).toISOString().slice(0, 10);
}

export function parseAgentSlackJsonOutput(output: string): Record<string, unknown> {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === "{") starts.push(index);
    if (output[index] === "}") ends.push(index);
  }

  for (const start of starts) {
    for (let endIndex = ends.length - 1; endIndex >= 0; endIndex -= 1) {
      const end = ends[endIndex];
      if (end <= start) continue;
      try {
        const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        // Try the next candidate because agent-slack can print update notices around JSON.
      }
    }
  }

  throw new Error("agent-slack output did not contain a JSON object");
}

export function agentSlackMessageToPollItem(
  message: Record<string, unknown>,
  options?: Partial<AgentSlackSearchOptions>,
): Record<string, unknown> {
  const text = firstString(message, ["text", "body", "content", "message", "snippet", "title"]) ?? "";
  const url = firstString(message, ["permalink", "url", "link"]);
  const channelId =
    firstString(message, ["channel_id", "channel", "channel_name", "conversation_id"])
    ?? channelIdFromUrl(url)
    ?? firstChannel(options?.channels)
    ?? "unknown_channel";
  const teamId =
    firstString(message, ["team_id", "team", "workspace_id", "workspace"])
    ?? workspaceFromUrl(url)
    ?? workspaceFromUrl(options?.workspace)
    ?? options?.workspace
    ?? "agent_slack_workspace";
  const ts = firstString(message, ["ts", "timestamp", "id"]) ?? tsFromUrl(url) ?? stableHash([teamId, channelId, text]);
  const author = isRecord(message.author) ? message.author : undefined;
  const userId =
    firstString(message, ["user_id", "user", "author_id", "author"])
    ?? (author ? firstString(author, ["user_id", "id", "name"]) : undefined)
    ?? options?.user
    ?? "unknown";
  const userName =
    firstString(message, ["user_name", "user", "author_name", "author"])
    ?? (author ? firstString(author, ["user_name", "name", "real_name", "user_id"]) : undefined)
    ?? userId;
  const occurredAt = occurredAtForMessage(message, ts);

  return {
    team_id: teamId,
    channel_id: channelId,
    ts,
    text,
    permalink: url ?? `slack://channel/${channelId}/${ts}`,
    user_id: userId,
    user_name: userName,
    thread_ts: firstString(message, ["thread_ts"]) ?? ts,
    title: firstString(message, ["title"]) ?? `Slack message from ${userName}`,
    resource_title: firstString(message, ["channel_name", "channel"]) ?? "Slack thread",
    occurred_at: occurredAt,
    raw: message,
  };
}

function firstChannel(channels: string[] | undefined): string | undefined {
  return channels?.find((channel) => channel.trim())?.trim();
}

function occurredAtForMessage(message: Record<string, unknown>, ts: string): string {
  const explicit = firstString(message, ["occurred_at", "datetime", "date", "time"]);
  if (explicit) return explicit;

  const numericTs = Number(ts);
  if (Number.isFinite(numericTs) && numericTs > 0) {
    return new Date(Math.trunc(numericTs * 1000)).toISOString();
  }

  return new Date(0).toISOString();
}

function latestTs(items: Record<string, unknown>[]): string | undefined {
  const values = items
    .map((item) => (typeof item.ts === "string" ? item.ts : undefined))
    .filter((value): value is string => Boolean(value))
    .sort(compareSlackTs);
  return values.at(-1);
}

function compareSlackTs(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function workspaceFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /^https?:\/\/([^./]+)\.slack\.com(?:\/|$)/.exec(url);
  return match?.[1];
}

function channelIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /\/archives\/([^/]+)/.exec(url);
  return match?.[1];
}

function tsFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /\/p(\d{10})(\d{6})/.exec(url);
  return match ? `${match[1]}.${match[2]}` : undefined;
}

function splitList(input: string | undefined): string[] {
  return input?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function channelsFromToolArg(input: unknown): string[] | undefined {
  if (typeof input === "string") return splitList(input);
  if (Array.isArray(input)) {
    return input.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
  }
  return undefined;
}

function optionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() ? input.trim() : undefined;
}

function optionalEnv(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value || undefined;
}

function positiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const value = Number(input);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveIntFromUnknown(input: unknown): number | undefined {
  const value = typeof input === "number" ? input : typeof input === "string" ? Number(input) : NaN;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createAgentSlackEventsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
