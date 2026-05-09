import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpPollResult } from "../integrations/mcp_poll/types.js";

const execFile = promisify(nodeExecFile);

export type ScriptEventsExecFile = (
  command: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string; stderr: string }>;

export type ScriptEventsServerOptions = {
  env?: NodeJS.ProcessEnv;
  execFile?: ScriptEventsExecFile;
};

export type ScriptEventsOptions = {
  command: string;
  args: string[];
  cursorArg?: string;
  cursorEnv?: string;
  timeoutMs: number;
  maxBufferBytes: number;
  env: NodeJS.ProcessEnv;
};

export function createScriptEventsServer(options: ScriptEventsServerOptions = {}): McpServer {
  const env = options.env ?? process.env;
  const runner = options.execFile ?? execFile;
  const server = new McpServer({
    name: "eventloopos-script-events",
    version: "0.0.0",
  });

  server.registerTool(
    "poll_script",
    {
      title: "Poll script events",
      description: "Run a local read-only script and return eventloopOS MCP poll items from JSON stdout.",
      inputSchema: {
        cursor: z.string().optional(),
        script_command: z.string().optional(),
        script_args: z.array(z.string()).optional(),
        cursor_arg: z.string().optional(),
        cursor_env: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      const result = await pollScriptEvents(scriptOptionsFromEnvAndToolArgs(env, args), args.cursor, runner);
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

export function scriptOptionsFromEnvAndToolArgs(env: NodeJS.ProcessEnv, args: Record<string, unknown>): ScriptEventsOptions {
  const command = optionalString(args.script_command) ?? env.EVENTLOOPOS_SCRIPT_EVENTS_COMMAND?.trim();
  if (!command) {
    throw new Error("script_command or EVENTLOOPOS_SCRIPT_EVENTS_COMMAND must be set for script event polling");
  }

  return {
    command,
    args: Array.isArray(args.script_args)
      ? args.script_args.filter((value): value is string => typeof value === "string")
      : parseArgs(env.EVENTLOOPOS_SCRIPT_EVENTS_ARGS),
    cursorArg: optionalString(args.cursor_arg) ?? optionalEnv(env.EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ARG),
    cursorEnv: optionalString(args.cursor_env) ?? optionalEnv(env.EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ENV),
    timeoutMs: positiveInt(env.EVENTLOOPOS_SCRIPT_EVENTS_TIMEOUT_MS, 10_000),
    maxBufferBytes: positiveInt(env.EVENTLOOPOS_SCRIPT_EVENTS_MAX_BUFFER_BYTES, 1_000_000),
    env,
  };
}

export async function pollScriptEvents(
  options: ScriptEventsOptions,
  cursor: string | undefined,
  runner: ScriptEventsExecFile,
): Promise<McpPollResult> {
  const args = scriptArgsWithCursor(options, cursor);
  const env = {
    ...options.env,
    ...(options.cursorEnv && cursor ? { [options.cursorEnv]: cursor } : {}),
  };
  const { stdout } = await runner(options.command, args, {
    timeout: options.timeoutMs,
    maxBuffer: options.maxBufferBytes,
    env,
  });
  return parseScriptEventsOutput(stdout);
}

export function scriptOptionsFromEnv(env: NodeJS.ProcessEnv): ScriptEventsOptions {
  const command = env.EVENTLOOPOS_SCRIPT_EVENTS_COMMAND?.trim();
  if (!command) {
    throw new Error("EVENTLOOPOS_SCRIPT_EVENTS_COMMAND must be set for script event polling");
  }

  return {
    command,
    args: parseArgs(env.EVENTLOOPOS_SCRIPT_EVENTS_ARGS),
    cursorArg: optionalEnv(env.EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ARG),
    cursorEnv: optionalEnv(env.EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ENV),
    timeoutMs: positiveInt(env.EVENTLOOPOS_SCRIPT_EVENTS_TIMEOUT_MS, 10_000),
    maxBufferBytes: positiveInt(env.EVENTLOOPOS_SCRIPT_EVENTS_MAX_BUFFER_BYTES, 1_000_000),
    env,
  };
}

export function parseScriptEventsOutput(output: string): McpPollResult {
  const parsed = parseJsonFromNoisyOutput(output);
  if (Array.isArray(parsed)) {
    assertItems(parsed);
    return { items: parsed };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    throw new Error("script event output must be an array or an object with items array");
  }
  assertItems(parsed.items);
  if (parsed.nextCursor !== undefined && typeof parsed.nextCursor !== "string") {
    throw new Error("script event output nextCursor must be a string");
  }
  return parsed.nextCursor === undefined
    ? { items: parsed.items }
    : { items: parsed.items, nextCursor: parsed.nextCursor };
}

function parseJsonFromNoisyOutput(output: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    // Keep parsing below: local scripts and CLIs sometimes print update notices.
  }

  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (char === "{" || char === "[") starts.push(index);
    if (char === "}" || char === "]") ends.push(index);
  }

  for (const start of starts) {
    for (let endIndex = ends.length - 1; endIndex >= 0; endIndex -= 1) {
      const end = ends[endIndex];
      if (end <= start) continue;
      try {
        return JSON.parse(output.slice(start, end + 1)) as unknown;
      } catch {
        // Try next candidate.
      }
    }
  }

  throw new Error("script event output did not contain JSON array or object");
}

function scriptArgsWithCursor(options: ScriptEventsOptions, cursor: string | undefined): string[] {
  if (!options.cursorArg || !cursor) return options.args;
  return [...options.args, options.cursorArg, cursor];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertItems(items: unknown[]): asserts items is Record<string, unknown>[] {
  if (items.some((item) => !isRecord(item))) {
    throw new Error("script event output items must be objects");
  }
}

function parseArgs(input: string | undefined): string[] {
  if (!input?.trim()) return [];
  const parsed = JSON.parse(input) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("EVENTLOOPOS_SCRIPT_EVENTS_ARGS must be a JSON string array");
  }
  return parsed;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createScriptEventsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
