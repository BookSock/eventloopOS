import { pathToFileURL } from "node:url";

export type PollOnceOptions = {
  baseUrl: string;
  sourceIds?: string[];
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export function pollOnceOptionsFromEnv(env: NodeJS.ProcessEnv): PollOnceOptions {
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    sourceIds: parseSourceIds(env.EVENTLOOPOS_MCP_SOURCE_IDS),
  };
}

export async function pollMcpSourcesOnce(options: PollOnceOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const payload = options.sourceIds?.length ? { source_ids: options.sourceIds } : {};
  const url = new URL("/mcp-sources/poll-all-and-route", options.baseUrl);

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseSourceIds(input: string | undefined): string[] | undefined {
  if (!input) return undefined;
  const sourceIds = input.split(",").map((sourceId) => sourceId.trim()).filter(Boolean);
  return sourceIds.length ? sourceIds : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await pollMcpSourcesOnce(pollOnceOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
