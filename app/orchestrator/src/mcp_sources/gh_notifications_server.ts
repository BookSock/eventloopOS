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

export type GhExecFile = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export type GhNotificationsServerOptions = {
  env?: NodeJS.ProcessEnv;
  execFile?: GhExecFile;
};

export type GhNotificationsOptions = {
  command: string;
  repo?: string;
  participating: boolean;
  all: boolean;
  since?: string;
  before?: string;
  limit: number;
  timeoutMs: number;
  maxBufferBytes: number;
};

export function createGhNotificationsServer(options: GhNotificationsServerOptions = {}): McpServer {
  const env = options.env ?? process.env;
  const runner = options.execFile ?? execFile;
  const server = new McpServer({
    name: "eventloopos-gh-notifications",
    version: "0.0.0",
  });

  server.registerTool(
    "list_notifications",
    {
      title: "List GitHub notifications",
      description: "Read GitHub notifications through local gh CLI and return eventloopOS GitHub poll items.",
      inputSchema: {
        cursor: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      const result = await listGhNotifications(notificationsOptionsWithCursor(notificationsOptionsFromEnv(env), args.cursor), runner);
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

export async function listGhNotifications(
  options: GhNotificationsOptions,
  runner: GhExecFile,
): Promise<McpPollResult> {
  const { stdout } = await runner(options.command, ghNotificationsArgs(options), {
    timeout: options.timeoutMs,
    maxBuffer: options.maxBufferBytes,
  });
  const notifications = parseGhNotificationsOutput(stdout);
  const items = notifications.map((notification) => ghNotificationToPollItem(notification));

  return {
    items,
    nextCursor: latestUpdatedAt(items),
  };
}

export function notificationsOptionsFromEnv(env: NodeJS.ProcessEnv): GhNotificationsOptions {
  return {
    command: env.EVENTLOOPOS_GH_COMMAND?.trim() || "gh",
    repo: optionalEnv(env.EVENTLOOPOS_GH_REPO),
    participating: envBoolean(env.EVENTLOOPOS_GH_PARTICIPATING, true),
    all: envBoolean(env.EVENTLOOPOS_GH_ALL, false),
    since: optionalEnv(env.EVENTLOOPOS_GH_SINCE),
    before: optionalEnv(env.EVENTLOOPOS_GH_BEFORE),
    limit: clampPositiveInt(env.EVENTLOOPOS_GH_LIMIT, 20, 50),
    timeoutMs: positiveInt(env.EVENTLOOPOS_GH_TIMEOUT_MS, 10_000),
    maxBufferBytes: positiveInt(env.EVENTLOOPOS_GH_MAX_BUFFER_BYTES, 1_000_000),
  };
}

export function notificationsOptionsWithCursor(
  options: GhNotificationsOptions,
  cursor: string | undefined,
): GhNotificationsOptions {
  if (!cursor || cursor === "0" || options.since) return options;
  return {
    ...options,
    since: cursor,
  };
}

export function ghNotificationsArgs(options: GhNotificationsOptions): string[] {
  const endpoint = options.repo ? `repos/${options.repo}/notifications` : "notifications";
  const args = [
    "api",
    "-X",
    "GET",
    endpoint,
    "-f",
    `per_page=${options.limit}`,
    "-f",
    `participating=${String(options.participating)}`,
    "-f",
    `all=${String(options.all)}`,
  ];
  if (options.since) args.push("-f", `since=${options.since}`);
  if (options.before) args.push("-f", `before=${options.before}`);
  return args;
}

export function parseGhNotificationsOutput(output: string): Record<string, unknown>[] {
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error("gh notifications output must be a JSON array of objects");
  }
  return parsed;
}

export function ghNotificationToPollItem(notification: Record<string, unknown>): Record<string, unknown> {
  const id = firstString(notification, ["id"]) ?? stableHash([JSON.stringify(notification)]);
  const repository = recordAt(notification, "repository");
  const subject = recordAt(notification, "subject");
  const repo = firstString(repository, ["full_name"]) ?? "unknown/repo";
  const subjectTitle = firstString(subject, ["title"]) ?? `GitHub notification ${id}`;
  const subjectType = firstString(subject, ["type"]) ?? "Notification";
  const reason = firstString(notification, ["reason"]) ?? "unknown";
  const updatedAt = firstString(notification, ["updated_at"]) ?? new Date(0).toISOString();
  const url = githubNotificationWebUrl(notification) ?? firstString(repository, ["html_url"]) ?? `https://github.com/${repo}`;

  return {
    id,
    repo,
    type: `github.notification.${safeType(subjectType)}`,
    title: subjectTitle,
    body: githubNotificationBody(notification, subjectType, reason),
    actor: "github",
    occurred_at: updatedAt,
    updated_at: updatedAt,
    url,
    raw: notification,
  };
}

export function githubNotificationWebUrl(notification: Record<string, unknown>): string | undefined {
  const repository = recordAt(notification, "repository");
  const subject = recordAt(notification, "subject");
  const repo = firstString(repository, ["full_name"]);
  const subjectWebUrl = githubApiUrlToWebUrl(firstString(subject, ["url"]), repo);
  const latestCommentWebUrl = githubApiUrlToWebUrl(firstString(subject, ["latest_comment_url"]), repo, subjectWebUrl);
  return latestCommentWebUrl ?? subjectWebUrl ?? firstString(repository, ["html_url"]);
}

export function githubApiUrlToWebUrl(
  apiUrl: string | undefined,
  fallbackRepo?: string,
  baseSubjectWebUrl?: string,
): string | undefined {
  if (!apiUrl) return undefined;
  if (apiUrl.startsWith("https://github.com/")) return apiUrl;

  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(apiUrl);
  if (!match) return undefined;

  const repo = `${match[1]}/${match[2]}`;
  const path = match[3];
  const issueComment = /^issues\/comments\/(\d+)$/.exec(path);
  if (issueComment && baseSubjectWebUrl) return `${baseSubjectWebUrl}#issuecomment-${issueComment[1]}`;
  if (issueComment && fallbackRepo) return `https://github.com/${fallbackRepo}/issues#issuecomment-${issueComment[1]}`;

  const issue = /^issues\/(\d+)$/.exec(path);
  if (issue) return `https://github.com/${repo}/issues/${issue[1]}`;

  const pull = /^pulls\/(\d+)$/.exec(path);
  if (pull) return `https://github.com/${repo}/pull/${pull[1]}`;

  const commit = /^commits\/([A-Fa-f0-9]+)$/.exec(path);
  if (commit) return `https://github.com/${repo}/commit/${commit[1]}`;

  const discussion = /^discussions\/(\d+)$/.exec(path);
  if (discussion) return `https://github.com/${repo}/discussions/${discussion[1]}`;

  return `https://github.com/${repo}`;
}

function githubNotificationBody(notification: Record<string, unknown>, subjectType: string, reason: string): string {
  const unread = notification.unread === true ? "true" : "false";
  const lastReadAt = firstString(notification, ["last_read_at"]);
  return [
    `reason=${reason}`,
    `subject_type=${subjectType}`,
    `unread=${unread}`,
    lastReadAt ? `last_read_at=${lastReadAt}` : undefined,
  ].filter(Boolean).join("; ");
}

function latestUpdatedAt(items: Record<string, unknown>[]): string | undefined {
  return items
    .map((item) => (typeof item.updated_at === "string" ? item.updated_at : undefined))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

function recordAt(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  return isRecord(value) ? value : {};
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function optionalEnv(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value || undefined;
}

function envBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function positiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const value = Number(input);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clampPositiveInt(input: string | undefined, fallback: number, max: number): number {
  return Math.min(positiveInt(input, fallback), max);
}

function safeType(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "notification";
}

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createGhNotificationsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
