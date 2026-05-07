import { pathToFileURL } from "node:url";

export type McpSourceCliCommand = "list" | "preview" | "route-once";

export type McpSourceCliOptions = {
  command: McpSourceCliCommand;
  baseUrl: string;
  sourceIds?: string[];
  includeText: boolean;
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

type JsonRecord = Record<string, unknown>;

export function mcpSourceCliOptionsFromEnvAndArgs(
  env: NodeJS.ProcessEnv,
  args: string[],
): McpSourceCliOptions {
  const [commandRaw, ...sourceIdsRaw] = args;
  const command = parseCommand(commandRaw);
  return {
    command,
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    sourceIds: parseSourceIds(sourceIdsRaw.length ? sourceIdsRaw.join(",") : env.EVENTLOOPOS_MCP_SOURCE_IDS),
    includeText: env.EVENTLOOPOS_MCP_PREVIEW_INCLUDE_TEXT === "1",
  };
}

export async function runMcpSourceCli(options: McpSourceCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    if (options.command === "list") {
      const body = await getJson(fetchFn, new URL("/mcp-sources", options.baseUrl));
      stdout.write(`${JSON.stringify(body)}\n`);
      return 0;
    }

    if (options.command === "route-once") {
      const payload = options.sourceIds?.length ? { source_ids: options.sourceIds } : {};
      const body = await postJson(fetchFn, new URL("/mcp-sources/poll-all-and-route", options.baseUrl), payload);
      stdout.write(`${JSON.stringify(body)}\n`);
      return readBoolean(body, "ok") === false ? 1 : 0;
    }

    const sourceIds = options.sourceIds?.length ? options.sourceIds : await listSourceIds(fetchFn, options.baseUrl);
    const previews = [];
    let failures = 0;
    for (const sourceId of sourceIds) {
      try {
        const body = await postJson(fetchFn, new URL(`/mcp-sources/${encodeURIComponent(sourceId)}/preview`, options.baseUrl), { items: [] });
        previews.push(options.includeText ? body : stripPreviewText(body));
      } catch (error) {
        failures += 1;
        previews.push({
          source_id: sourceId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    stdout.write(`${JSON.stringify({ ok: failures === 0, sources_seen: sourceIds.length, failures, previews })}\n`);
    return failures === 0 ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listSourceIds(fetchFn: typeof fetch, baseUrl: string): Promise<string[]> {
  const body = await getJson(fetchFn, new URL("/mcp-sources", baseUrl));
  const sources = Array.isArray(body.sources) ? body.sources : [];
  return sources.flatMap((source) => isRecord(source) && typeof source.id === "string" ? [source.id] : []);
}

async function getJson(fetchFn: typeof fetch, url: URL): Promise<JsonRecord> {
  const response = await fetchFn(url);
  return await readResponseJson(response);
}

async function postJson(fetchFn: typeof fetch, url: URL, payload: unknown): Promise<JsonRecord> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readResponseJson(response);
}

async function readResponseJson(response: Response): Promise<JsonRecord> {
  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(errorMessage(body) ?? `HTTP ${response.status}`);
  }
  if (!isRecord(body)) {
    throw new Error("orchestrator response must be an object");
  }
  return body;
}

function stripPreviewText(body: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(body, (_key, value) => {
    if (typeof value === "string" && (value.length > 180 || looksLikeContentField(_key))) {
      return "[redacted]";
    }
    return value;
  })) as JsonRecord;
}

function looksLikeContentField(key: string): boolean {
  return key === "title" || key === "summary" || key === "text" || key === "body";
}

function errorMessage(body: unknown): string | undefined {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message;
  }
  return undefined;
}

function parseCommand(input: string | undefined): McpSourceCliCommand {
  if (input === "preview" || input === "route-once") return input;
  return "list";
}

function parseSourceIds(input: string | undefined): string[] | undefined {
  if (!input) return undefined;
  const sourceIds = input.split(",").map((sourceId) => sourceId.trim()).filter(Boolean);
  return sourceIds.length ? sourceIds : undefined;
}

function readBoolean(input: JsonRecord, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runMcpSourceCli(mcpSourceCliOptionsFromEnvAndArgs(process.env, process.argv.slice(2)));
  process.exitCode = exitCode;
}
