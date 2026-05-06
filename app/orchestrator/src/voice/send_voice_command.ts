import { pathToFileURL } from "node:url";

export type VoiceCommandClientOptions = {
  baseUrl: string;
  transcript?: string;
  projectHint?: string;
  taskHint?: string;
  idempotencyKey?: string;
  sourceId?: string;
  occurredAt?: string;
  stdin?: StdinLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  fetchFn?: typeof fetch;
};

type StdinLike = {
  setEncoding(encoding: BufferEncoding): unknown;
  [Symbol.asyncIterator](): AsyncIterator<unknown, unknown, unknown>;
};

export function voiceCommandOptionsFromEnv(env: NodeJS.ProcessEnv): VoiceCommandClientOptions {
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    transcript: env.EVENTLOOPOS_VOICE_TRANSCRIPT,
    projectHint: env.EVENTLOOPOS_VOICE_PROJECT_HINT,
    taskHint: env.EVENTLOOPOS_VOICE_TASK_HINT,
    idempotencyKey: env.EVENTLOOPOS_VOICE_IDEMPOTENCY_KEY,
    sourceId: env.EVENTLOOPOS_VOICE_SOURCE_ID,
    occurredAt: env.EVENTLOOPOS_VOICE_OCCURRED_AT,
  };
}

export async function sendVoiceCommand(options: VoiceCommandClientOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const transcript = (options.transcript ?? await readStdin(options.stdin ?? process.stdin)).trim();

  if (!transcript) {
    stderr.write("transcript must be provided by EVENTLOOPOS_VOICE_TRANSCRIPT or stdin\n");
    return 1;
  }

  const payload = compactRecord({
    transcript,
    project_hint: options.projectHint,
    task_hint: options.taskHint,
    idempotency_key: options.idempotencyKey,
    source_id: options.sourceId,
    occurred_at: options.occurredAt,
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  try {
    const response = await fetchFn(new URL("/voice/commands", options.baseUrl), {
      method: "POST",
      headers,
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

async function readStdin(stdin: StdinLike): Promise<string> {
  stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of stdin) {
    text += chunk;
  }
  return text;
}

function compactRecord(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await sendVoiceCommand(voiceCommandOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
