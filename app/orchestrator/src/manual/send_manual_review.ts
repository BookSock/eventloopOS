import { pathToFileURL } from "node:url";
import type { McpEvent } from "../integrations/mcp_poll/types.js";

export type ManualReviewClientOptions = {
  baseUrl: string;
  title?: string;
  summary?: string;
  projectHint?: string;
  taskHint?: string;
  url?: string;
  urlLabel?: string;
  idempotencyKey?: string;
  sourceId?: string;
  occurredAt?: string;
  receivedAt?: string;
  stdin?: StdinLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

type StdinLike = {
  isTTY?: boolean;
  setEncoding(encoding: BufferEncoding): unknown;
  [Symbol.asyncIterator](): AsyncIterator<unknown, unknown, unknown>;
};

export function manualReviewOptionsFromEnvAndArgv(
  env: NodeJS.ProcessEnv,
  argv: string[],
): ManualReviewClientOptions {
  const args = parseArgs(argv);
  return {
    baseUrl: args.baseUrl ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    title: args.title ?? env.EVENTLOOPOS_MANUAL_TITLE,
    summary: args.summary ?? env.EVENTLOOPOS_MANUAL_SUMMARY,
    projectHint: args.projectHint ?? env.EVENTLOOPOS_MANUAL_PROJECT_HINT,
    taskHint: args.taskHint ?? env.EVENTLOOPOS_MANUAL_TASK_HINT,
    url: args.url ?? env.EVENTLOOPOS_MANUAL_URL,
    urlLabel: args.urlLabel ?? env.EVENTLOOPOS_MANUAL_URL_LABEL,
    idempotencyKey: args.idempotencyKey ?? env.EVENTLOOPOS_MANUAL_IDEMPOTENCY_KEY,
    sourceId: args.sourceId ?? env.EVENTLOOPOS_MANUAL_SOURCE_ID,
    occurredAt: args.occurredAt ?? env.EVENTLOOPOS_MANUAL_OCCURRED_AT,
  };
}

export async function sendManualReview(options: ManualReviewClientOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const title = options.title?.trim();
  const summary = (options.summary ?? await readOptionalStdin(options.stdin ?? process.stdin)).trim();
  const receivedAt = options.receivedAt ?? (options.now ?? (() => new Date()))().toISOString();

  if (!title) {
    stderr.write("title must be provided with --title or EVENTLOOPOS_MANUAL_TITLE\n");
    return 1;
  }
  if (!summary) {
    stderr.write("summary must be provided with --summary, EVENTLOOPOS_MANUAL_SUMMARY, or stdin\n");
    return 1;
  }

  const event = buildManualReviewEvent({
    title,
    summary,
    receivedAt,
    occurredAt: options.occurredAt,
    projectHint: options.projectHint,
    taskHint: options.taskHint,
    url: options.url,
    urlLabel: options.urlLabel,
    idempotencyKey: options.idempotencyKey,
    sourceId: options.sourceId,
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  try {
    const response = await fetchFn(new URL("/events", options.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ event }),
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function buildManualReviewEvent(input: {
  title: string;
  summary: string;
  receivedAt: string;
  occurredAt?: string;
  projectHint?: string;
  taskHint?: string;
  url?: string;
  urlLabel?: string;
  idempotencyKey?: string;
  sourceId?: string;
}): McpEvent {
  const base = `${input.title}\n${input.summary}\n${input.url ?? ""}`;
  const idempotencyKey = input.idempotencyKey ?? `manual:${stableId(base)}`;
  const sourceId = input.sourceId ?? idempotencyKey;
  const stableSourceId = stableId(sourceId);
  const occurredAt = input.occurredAt ?? input.receivedAt;
  const trimmedUrl = input.url?.trim();
  const links = trimmedUrl ? [{ label: input.urlLabel?.trim() || "Context", url: trimmedUrl }] : [];

  return {
    id: `evt_manual_${stableSourceId}`,
    source: "manual",
    source_id: sourceId,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt,
    received_at: input.receivedAt,
    actor: {
      id: "user_manual",
      type: "human",
    },
    project_hint: cleanOptional(input.projectHint),
    task_hint: cleanOptional(input.taskHint),
    type: "manual.review_requested",
    title: input.title,
    summary: input.summary,
    raw_ref: {
      id: `raw_manual_${stableSourceId}`,
      uri: `manual://reviews/${stableSourceId}`,
      media_type: "text/plain",
    },
    links,
    resources: [
      {
        id: `ctx_manual_${stableSourceId}`,
        kind: "manual_note",
        title: input.title,
        url: trimmedUrl,
        source: "manual",
        captured_at: input.receivedAt,
        restore_confidence: trimmedUrl ? "medium" : "low",
        details: {
          summary: input.summary,
        },
      },
    ],
  };
}

function parseArgs(argv: string[]): Partial<ManualReviewClientOptions> {
  const options: Partial<ManualReviewClientOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    switch (arg) {
      case "--base-url":
        options.baseUrl = readArgValue(argv, ++index, arg);
        break;
      case "--title":
        options.title = readArgValue(argv, ++index, arg);
        break;
      case "--summary":
        options.summary = readArgValue(argv, ++index, arg);
        break;
      case "--project":
      case "--project-hint":
        options.projectHint = readArgValue(argv, ++index, arg);
        break;
      case "--task":
      case "--task-hint":
        options.taskHint = readArgValue(argv, ++index, arg);
        break;
      case "--url":
        options.url = readArgValue(argv, ++index, arg);
        break;
      case "--url-label":
        options.urlLabel = readArgValue(argv, ++index, arg);
        break;
      case "--idempotency-key":
        options.idempotencyKey = readArgValue(argv, ++index, arg);
        break;
      case "--source-id":
        options.sourceId = readArgValue(argv, ++index, arg);
        break;
      case "--occurred-at":
        options.occurredAt = readArgValue(argv, ++index, arg);
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

async function readOptionalStdin(stdin: StdinLike): Promise<string> {
  if (stdin.isTTY) return "";
  stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of stdin) {
    text += chunk;
  }
  return text;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const exitCode = await sendManualReview(manualReviewOptionsFromEnvAndArgv(process.env, process.argv.slice(2)));
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
