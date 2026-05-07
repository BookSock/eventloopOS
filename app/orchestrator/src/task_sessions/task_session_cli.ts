import { pathToFileURL } from "node:url";

export type TaskSessionCliCommand = "list" | "bind";

export type TaskSessionCliOptions = {
  command: TaskSessionCliCommand;
  baseUrl: string;
  taskSessionId?: string;
  taskId?: string;
  taskHint?: string;
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
  };
}

export async function runTaskSessionCli(options: TaskSessionCliOptions): Promise<number> {
  if (options.command === "list") {
    return await listTaskSessions(options);
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
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function normalizeTaskId(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  if (/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) return trimmed;
  return `task_${stableId(trimmed)}`;
}

function parseArgs(argv: string[]): Partial<TaskSessionCliOptions> {
  const options: Partial<TaskSessionCliOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "list" || arg === "bind") {
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
      case "--task":
      case "--task-hint":
        options.taskHint = readArgValue(argv, ++index, arg);
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

function commandFromEnv(input: string | undefined): TaskSessionCliCommand | undefined {
  if (input === "list" || input === "bind") return input;
  return undefined;
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runTaskSessionCli(taskSessionCliOptionsFromEnvAndArgv(process.env, process.argv.slice(2)));
  process.exitCode = exitCode;
}
