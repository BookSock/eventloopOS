import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpPollResult } from "../integrations/mcp_poll/types.js";

const DEFAULT_EVENTS_PATH = "var/local-events.json";

export function createLocalEventsServer(options: { eventsPath?: string } = {}): McpServer {
  const server = new McpServer({
    name: "eventloopos-local-events",
    version: "0.0.0",
  });
  const eventsPath = options.eventsPath ?? resolveLocalEventsPath(process.env.EVENTLOOPOS_LOCAL_EVENTS_PATH);

  server.registerTool(
    "list_events",
    {
      title: "List local events",
      description: "Read event-ish items from a local JSON file for eventloopOS MCP polling.",
      annotations: {
        readOnlyHint: true,
      },
    },
    async (): Promise<CallToolResult> => {
      const result = await readLocalEventsFile(eventsPath);
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

export async function readLocalEventsFile(path: string): Promise<McpPollResult> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const result = parseLocalEventsFile(parsed);

  return {
    items: result.items,
    nextCursor: result.nextCursor,
  };
}

export function parseLocalEventsFile(input: unknown): McpPollResult {
  const rawItems = Array.isArray(input) ? input : isRecord(input) && Array.isArray(input.items) ? input.items : undefined;
  const nextCursor = isRecord(input) && typeof input.nextCursor === "string" ? input.nextCursor : undefined;
  if (!rawItems || rawItems.some((item) => !isRecord(item))) {
    throw new Error("local events file must be an array of objects or an object with items array");
  }
  if (isRecord(input) && input.nextCursor !== undefined && typeof input.nextCursor !== "string") {
    throw new Error("local events file nextCursor must be a string");
  }

  return {
    items: rawItems.map((item) => ({ ...item })),
    nextCursor,
  };
}

export function resolveLocalEventsPath(rawPath: string | undefined): string {
  const configuredPath = rawPath?.trim() || DEFAULT_EVENTS_PATH;
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolveExistingRelativePath(configuredPath) ?? resolve(process.cwd(), configuredPath);
}

function resolveExistingRelativePath(relativePath: string): string | undefined {
  const candidates = [
    resolve(process.cwd(), relativePath),
    resolve(process.cwd(), "../..", relativePath),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createLocalEventsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
