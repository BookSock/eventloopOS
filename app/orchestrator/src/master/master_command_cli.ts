import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { normalizeTaskId, slugifyTaskName } from "../task_sessions/task_session_cli.js";

export type MasterCommandCliOptions = {
  baseUrl: string;
  text?: string;
  taskHint?: string;
  newTask?: boolean;
  help?: boolean;
  cwd?: string;
  model?: string;
  idempotencyKey?: string;
  stdin?: StdinLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  fetchFn?: typeof fetch;
};

type StdinLike = {
  setEncoding(encoding: BufferEncoding): unknown;
  [Symbol.asyncIterator](): AsyncIterator<unknown, unknown, unknown>;
};

export function masterCommandOptionsFromEnvAndArgv(
  env: NodeJS.ProcessEnv,
  argv: string[],
): MasterCommandCliOptions {
  const args = parseArgs(argv);
  return {
    baseUrl: args.baseUrl ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    text: args.text ?? env.EVENTLOOPOS_MASTER_TEXT,
    taskHint: args.taskHint ?? env.EVENTLOOPOS_MASTER_TASK_HINT,
    newTask: args.newTask ?? env.EVENTLOOPOS_MASTER_NEW_TASK === "1",
    cwd: args.cwd ?? env.EVENTLOOPOS_MASTER_CWD,
    model: args.model ?? env.EVENTLOOPOS_MASTER_MODEL,
    idempotencyKey: args.idempotencyKey ?? env.EVENTLOOPOS_MASTER_IDEMPOTENCY_KEY,
  };
}

export async function runMasterCommandCli(options: MasterCommandCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  if (options.help) {
    stdout.write(masterCommandHelp());
    return 0;
  }
  const text = (options.text ?? await readStdin(options.stdin ?? process.stdin)).trim();
  if (!text) {
    stderr.write("text must be provided as a positional argument, with --text, EVENTLOOPOS_MASTER_TEXT, or stdin\n");
    stderr.write("try: pnpm run master:send -- \"tell the current task the launch date moved\"\n");
    return 1;
  }

  if (options.newTask) {
    return await startNewTask({ ...options, text, fetchFn, stdout, stderr });
  }
  return await routeMasterText({ ...options, text, fetchFn, stdout, stderr });
}

async function startNewTask(options: RequiredTransport & {
  text: string;
  taskHint?: string;
  cwd?: string;
  model?: string;
  idempotencyKey?: string;
}): Promise<number> {
  const taskId = normalizeTaskId(options.taskHint ?? titleFromText(options.text));
  if (!taskId) {
    options.stderr.write("task hint or text must produce a task id\n");
    return 1;
  }
  const idempotencyKey = options.idempotencyKey ?? `master_start_${stableHash([taskId, options.text])}`;
  try {
    const response = await options.fetchFn(new URL("/task-sessions", options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        task_id: taskId,
        prompt: masterPromptForNewTask(options.text, taskId),
        cwd: options.cwd,
        model: options.model,
        idempotency_key: idempotencyKey,
      }),
    });
    const body = await readResponseJson(response);
    options.stdout.write(`${JSON.stringify(body)}\n`);
    if (!response.ok) {
      options.stderr.write(`master start-new-task failed with HTTP ${response.status}\n`);
    }
    return response.ok ? 0 : 1;
  } catch (error) {
    options.stderr.write(`master start-new-task failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function routeMasterText(options: RequiredTransport & {
  text: string;
  taskHint?: string;
  idempotencyKey?: string;
}): Promise<number> {
  const idempotencyKey = options.idempotencyKey ?? `master_route_${stableHash([options.taskHint ?? "", options.text])}`;
  try {
    const response = await options.fetchFn(new URL("/voice/commands", options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        transcript: options.text,
        task_hint: options.taskHint,
        idempotency_key: idempotencyKey,
        source_id: idempotencyKey,
      }),
    });
    const body = await readResponseJson(response);
    options.stdout.write(`${JSON.stringify(body)}\n`);
    if (!response.ok) {
      options.stderr.write(`master route failed with HTTP ${response.status}\n`);
    }
    return response.ok ? 0 : 1;
  } catch (error) {
    options.stderr.write(`master route failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

type RequiredTransport = {
  baseUrl: string;
  fetchFn: typeof fetch;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
};

function masterPromptForNewTask(text: string, taskId: string): string {
  return [
    `[task:${slugifyTaskName(taskId.slice("task_".length).replaceAll("_", " "))}]`,
    "You are background task agent controlled by eventloopOS.",
    "Work async. Use tests/proofs where possible. If human judgment needed, create waiting_approval or blocked status through eventloopOS agent run CLI.",
    "",
    text,
  ].join("\n");
}

function titleFromText(text: string): string {
  return text.split(/\s+/).slice(0, 8).join(" ");
}

async function readStdin(stdin: StdinLike): Promise<string> {
  stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of stdin) {
    text += chunk;
  }
  return text;
}

function parseArgs(argv: string[]): Partial<MasterCommandCliOptions> {
  const options: Partial<MasterCommandCliOptions> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "start-new-task" || arg === "new-task") {
      options.newTask = true;
      continue;
    }
    if (arg === "route" || arg === "send") {
      continue;
    }
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--base-url":
        options.baseUrl = readArgValue(argv, ++index, arg);
        break;
      case "--text":
        options.text = readArgValue(argv, ++index, arg);
        break;
      case "--task":
      case "--task-hint":
        options.taskHint = readArgValue(argv, ++index, arg);
        break;
      case "--new-task":
        options.newTask = true;
        break;
      case "--cwd":
        options.cwd = readArgValue(argv, ++index, arg);
        break;
      case "--model":
        options.model = readArgValue(argv, ++index, arg);
        break;
      case "--idempotency-key":
        options.idempotencyKey = readArgValue(argv, ++index, arg);
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
      throw new Error("provide text either positionally or with --text, not both");
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

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
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

function masterCommandHelp(): string {
  return [
    "Usage:",
    "  pnpm run master:send -- \"message for current task or voice router\"",
    "  pnpm run master:send -- start-new-task --task \"blog feedback\" \"draft the post\"",
    "",
    "Default routes text through /voice/commands so current task followup behavior applies.",
    "Use start-new-task, new-task, or --new-task to create a task session directly.",
    "",
    "Options:",
    "  --task, --task-hint <hint>        Task hint for routing or task_id derivation",
    "  --new-task                       Start a new task session",
    "  --cwd <path>                     Working directory for new task session",
    "  --model <name>                   Model for new task session",
    "  --base-url <url>                 Orchestrator URL",
    "  --idempotency-key <key>          Stable retry key",
    "  --text <text>                    Text instead of positional argument",
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const exitCode = await runMasterCommandCli(masterCommandOptionsFromEnvAndArgv(process.env, process.argv.slice(2)));
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("run with --help for usage\n");
    process.exitCode = 1;
  }
}
