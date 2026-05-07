import { pathToFileURL } from "node:url";

export type QueueLineageCliOptions = {
  baseUrl: string;
  queueItemId?: string;
  limit?: number;
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export function queueLineageCliOptionsFromEnvAndArgv(
  env: NodeJS.ProcessEnv,
  argv: string[],
): QueueLineageCliOptions {
  const args = parseArgs(argv);
  return {
    baseUrl: args.baseUrl ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    queueItemId: args.queueItemId ?? env.EVENTLOOPOS_QUEUE_ITEM_ID,
    limit: args.limit ?? numberFromEnv(env.EVENTLOOPOS_QUEUE_LINEAGE_LIMIT),
  };
}

export async function runQueueLineageCli(options: QueueLineageCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const queueItemId = options.queueItemId?.trim();

  if (!queueItemId) {
    stderr.write("queue item id must be provided with --queue-item-id or EVENTLOOPOS_QUEUE_ITEM_ID\n");
    return 1;
  }

  try {
    const url = new URL(`/queue/${encodeURIComponent(queueItemId)}/lineage`, options.baseUrl);
    if (options.limit !== undefined) {
      url.searchParams.set("limit", String(options.limit));
    }
    const response = await fetchFn(url, {
      method: "GET",
      headers: { "content-type": "application/json" },
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseArgs(argv: string[]): Partial<QueueLineageCliOptions> {
  const options: Partial<QueueLineageCliOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    switch (arg) {
      case "--base-url":
        options.baseUrl = readArgValue(argv, ++index, arg);
        break;
      case "--queue-item":
      case "--queue-item-id":
        options.queueItemId = readArgValue(argv, ++index, arg);
        break;
      case "--limit":
        options.limit = parseLimit(readArgValue(argv, ++index, arg));
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function readArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseLimit(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("--limit requires a positive number");
  }
  return Math.floor(value);
}

function numberFromEnv(input: string | undefined): number | undefined {
  if (!input) return undefined;
  return parseLimit(input);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runQueueLineageCli(queueLineageCliOptionsFromEnvAndArgv(process.env, process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
