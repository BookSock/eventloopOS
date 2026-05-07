import { pathToFileURL } from "node:url";
import { sendVoiceCommand } from "./send_voice_command.js";

export type VoiceListenOptions = {
  baseUrl: string;
  wakePhrase?: string;
  projectHint?: string;
  taskHint?: string;
  sourceId?: string;
  idempotencyPrefix?: string;
  stdin?: StdinLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  fetchFn?: typeof fetch;
};

type StdinLike = {
  setEncoding(encoding: BufferEncoding): unknown;
  [Symbol.asyncIterator](): AsyncIterator<unknown, unknown, unknown>;
};

export function voiceListenOptionsFromEnv(env: NodeJS.ProcessEnv): VoiceListenOptions {
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    wakePhrase: env.EVENTLOOPOS_VOICE_WAKE_PHRASE,
    projectHint: env.EVENTLOOPOS_VOICE_PROJECT_HINT,
    taskHint: env.EVENTLOOPOS_VOICE_TASK_HINT,
    sourceId: env.EVENTLOOPOS_VOICE_SOURCE_ID,
    idempotencyPrefix: env.EVENTLOOPOS_VOICE_IDEMPOTENCY_PREFIX,
  };
}

export async function listenVoiceCommands(options: VoiceListenOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdin = options.stdin ?? process.stdin;
  const wakePhrase = options.wakePhrase?.trim().toLowerCase();
  const idempotencyPrefix = options.idempotencyPrefix ?? "voice_listen";
  let processed = 0;
  let failures = 0;

  stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of stdin) {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const transcript = normalizeTranscript(line, wakePhrase);
      if (!transcript) continue;
      processed += 1;
      const exitCode = await sendVoiceCommand({
        baseUrl: options.baseUrl,
        transcript,
        projectHint: options.projectHint,
        taskHint: options.taskHint,
        sourceId: options.sourceId,
        idempotencyKey: `${idempotencyPrefix}_${processed}`,
        stdout,
        stderr,
        fetchFn: options.fetchFn,
      });
      if (exitCode !== 0) failures += 1;
    }
  }

  const trailingTranscript = normalizeTranscript(buffer, wakePhrase);
  if (trailingTranscript) {
    processed += 1;
    const exitCode = await sendVoiceCommand({
      baseUrl: options.baseUrl,
      transcript: trailingTranscript,
      projectHint: options.projectHint,
      taskHint: options.taskHint,
      sourceId: options.sourceId,
      idempotencyKey: `${idempotencyPrefix}_${processed}`,
      stdout,
      stderr,
      fetchFn: options.fetchFn,
    });
    if (exitCode !== 0) failures += 1;
  }

  return failures === 0 ? 0 : 1;
}

export function normalizeTranscript(line: string, wakePhrase?: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (!wakePhrase) return trimmed;

  const lower = trimmed.toLowerCase();
  const index = lower.indexOf(wakePhrase);
  if (index === -1) return undefined;

  const command = trimmed.slice(index + wakePhrase.length).replace(/^[:,\s-]+/, "").trim();
  return command || undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await listenVoiceCommands(voiceListenOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
