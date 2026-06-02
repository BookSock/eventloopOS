import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export type TaskSessionCliCommand = "list" | "bind" | "messages" | "followup" | "replace";

export type TaskSessionCliOptions = {
  command: TaskSessionCliCommand;
  baseUrl: string;
  taskSessionId?: string;
  taskId?: string;
  taskHint?: string;
  text?: string;
  queueItemId?: string;
  eventId?: string;
  eventIds?: string[];
  idempotencyKey?: string;
  status?: string;
  limit?: number;
  httpTimeoutMs?: number;
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export function taskSessionCliOptionsFromEnvAndArgv(
  env: NodeJS.ProcessEnv,
  argv: string[],
): TaskSessionCliOptions {
  const args = parseArgs(argv);
  return {
    command: args.command ?? commandFromEnv(env.EVENTLOOPOS_TASK_CLI_COMMAND) ?? "list",
    baseUrl: args.baseUrl ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    taskSessionId: args.taskSessionId ?? env.EVENTLOOPOS_TASK_SESSION_ID,
    taskId: args.taskId ?? env.EVENTLOOPOS_TASK_ID,
    taskHint: args.taskHint ?? env.EVENTLOOPOS_TASK_HINT,
    text: args.text ?? env.EVENTLOOPOS_TASK_MESSAGE_TEXT,
    queueItemId: args.queueItemId ?? env.EVENTLOOPOS_QUEUE_ITEM_ID,
    eventId: args.eventId ?? env.EVENTLOOPOS_EVENT_ID,
    eventIds: args.eventIds,
    idempotencyKey: args.idempotencyKey ?? env.EVENTLOOPOS_IDEMPOTENCY_KEY,
    status: args.status ?? env.EVENTLOOPOS_TASK_MESSAGE_STATUS,
    limit: args.limit ?? numberFromEnv(env.EVENTLOOPOS_TASK_MESSAGE_LIMIT),
    httpTimeoutMs: args.httpTimeoutMs ?? numberFromEnv(env.EVENTLOOPOS_TASK_SESSION_HTTP_TIMEOUT_MS) ?? 45_000,
  };
}

export async function runTaskSessionCli(options: TaskSessionCliOptions): Promise<number> {
  if (options.command === "list") {
    return await listTaskSessions(options);
  }
  if (options.command === "messages") {
    return await listTaskMessages(options);
  }
  if (options.command === "followup") {
    return await sendTaskFollowup(options);
  }
  if (options.command === "replace") {
    return await replaceTaskSession(options);
  }
  return await bindTaskSession(options);
}

async function listTaskSessions(options: TaskSessionCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const response = await fetchFn(new URL("/task-sessions", options.baseUrl), {
      method: "GET",
      headers: { "content-type": "application/json" },
      signal: abortSignalFor(options),
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listTaskMessages(options: TaskSessionCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const url = new URL("/task-messages", options.baseUrl);
    appendQuery(url, "task_session_id", options.taskSessionId);
    appendQuery(url, "task_id", options.taskId);
    appendQuery(url, "queue_item_id", options.queueItemId);
    appendQuery(url, "event_id", options.eventId);
    appendQuery(url, "idempotency_key", options.idempotencyKey);
    appendQuery(url, "status", options.status);
    if (options.limit !== undefined) {
      url.searchParams.set("limit", String(options.limit));
    }

    const response = await fetchFn(url, {
      method: "GET",
      headers: { "content-type": "application/json" },
      signal: abortSignalFor(options),
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function bindTaskSession(options: TaskSessionCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const taskSessionId = options.taskSessionId?.trim();
  const taskId = normalizeTaskId(options.taskId ?? options.taskHint);

  if (!taskSessionId) {
    stderr.write("task session id must be provided with --session or EVENTLOOPOS_TASK_SESSION_ID\n");
    return 1;
  }
  if (!taskId) {
    stderr.write("task id must be provided with --task-id, --task, EVENTLOOPOS_TASK_ID, or EVENTLOOPOS_TASK_HINT\n");
    return 1;
  }

  try {
    const response = await fetchFn(new URL(`/task-sessions/${encodeURIComponent(taskSessionId)}/task-binding`, options.baseUrl), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: taskId }),
      signal: abortSignalFor(options),
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function sendTaskFollowup(options: TaskSessionCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const taskSessionId = options.taskSessionId?.trim();
  const text = options.text?.trim();
  const eventIds = normalizedEventIds(options);

  if (!taskSessionId) {
    stderr.write("task session id must be provided with --session or EVENTLOOPOS_TASK_SESSION_ID\n");
    return 1;
  }
  if (!text) {
    stderr.write("followup text must be provided as a positional argument, with --text, or EVENTLOOPOS_TASK_MESSAGE_TEXT\n");
    return 1;
  }

  const idempotencyKey = options.idempotencyKey ?? `task_followup_${stableHash([taskSessionId, text, eventIds.join("\0")])}`;

  try {
    const response = await fetchFn(new URL(`/task-sessions/${encodeURIComponent(taskSessionId)}/followup`, options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        text,
        event_ids: eventIds,
        idempotency_key: idempotencyKey,
      }),
      signal: abortSignalFor(options),
    });
    const body = await readResponseJson(response);
    stdout.write(`${JSON.stringify(body)}\n`);
    if (!response.ok) {
      stderr.write(`task followup failed with HTTP ${response.status}\n`);
    }
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`task followup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function replaceTaskSession(options: TaskSessionCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const taskSessionId = options.taskSessionId?.trim();
  const prompt = options.text?.trim();

  if (!taskSessionId) {
    stderr.write("task session id must be provided with --session or EVENTLOOPOS_TASK_SESSION_ID\n");
    return 1;
  }
  if (!prompt) {
    stderr.write("replacement prompt must be provided as a positional argument, with --text, or EVENTLOOPOS_TASK_MESSAGE_TEXT\n");
    return 1;
  }

  const idempotencyKey = options.idempotencyKey ?? `task_replace_${stableHash([taskSessionId, prompt])}`;

  try {
    const response = await fetchFn(new URL(`/task-sessions/${encodeURIComponent(taskSessionId)}/replacement`, options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        prompt,
        idempotency_key: idempotencyKey,
      }),
      signal: abortSignalFor(options),
    });
    const body = await readResponseJson(response);
    stdout.write(`${JSON.stringify(body)}\n`);
    if (!response.ok) {
      stderr.write(`task replacement failed with HTTP ${response.status}\n`);
    }
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`task replacement failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function normalizeTaskId(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  if (/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) return trimmed;
  return `task_${stableId(trimmed)}`;
}

export function slugifyTaskName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseArgs(argv: string[]): Partial<TaskSessionCliOptions> {
  const options: Partial<TaskSessionCliOptions> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "list" || arg === "bind" || arg === "messages" || arg === "followup" || arg === "replace") {
      options.command = arg;
      continue;
    }
    switch (arg) {
      case "--base-url":
        options.baseUrl = readArgValue(argv, ++index, arg);
        break;
      case "--session":
      case "--task-session":
      case "--task-session-id":
        options.taskSessionId = readArgValue(argv, ++index, arg);
        break;
      case "--task-id":
        options.taskId = readArgValue(argv, ++index, arg);
        break;
      case "--queue-item":
      case "--queue-item-id":
        options.queueItemId = readArgValue(argv, ++index, arg);
        break;
      case "--event":
      case "--event-id":
        options.eventId = readArgValue(argv, ++index, arg);
        break;
      case "--events":
      case "--event-ids":
        options.eventIds = readArgValue(argv, ++index, arg).split(",").map((value) => value.trim()).filter(Boolean);
        break;
      case "--idempotency-key":
        options.idempotencyKey = readArgValue(argv, ++index, arg);
        break;
      case "--status":
        options.status = readArgValue(argv, ++index, arg);
        break;
      case "--limit":
        options.limit = parseLimit(readArgValue(argv, ++index, arg));
        break;
      case "--timeout-ms":
        options.httpTimeoutMs = Number(readArgValue(argv, ++index, arg));
        break;
      case "--task":
      case "--task-hint":
        options.taskHint = readArgValue(argv, ++index, arg);
        break;
      case "--text":
        options.text = readArgValue(argv, ++index, arg);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`unknown argument: ${arg}`);
        }
        positional.push(arg);
    }
  }
  if (positional.length > 0) {
    if (options.text) {
      throw new Error("provide followup text either positionally or with --text, not both");
    }
    options.text = positional.join(" ");
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

function commandFromEnv(input: string | undefined): TaskSessionCliCommand | undefined {
  if (input === "list" || input === "bind" || input === "messages" || input === "followup" || input === "replace") return input;
  return undefined;
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

function abortSignalFor(options: TaskSessionCliOptions): AbortSignal | undefined {
  const timeoutMs = options.httpTimeoutMs;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
  return AbortSignal.timeout(timeoutMs);
}

function appendQuery(url: URL, name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    url.searchParams.set(name, trimmed);
  }
}

function normalizedEventIds(options: TaskSessionCliOptions): string[] {
  return [
    ...(options.eventIds ?? []),
    ...(options.eventId ? [options.eventId] : []),
  ].map((value) => value.trim()).filter(Boolean);
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      status: response.status,
      body: text,
    };
  }
}

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runTaskSessionCli(taskSessionCliOptionsFromEnvAndArgv(process.env, process.argv.slice(2)));
  process.exitCode = exitCode;
}
