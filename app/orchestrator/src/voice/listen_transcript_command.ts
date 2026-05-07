import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { listenVoiceCommands, voiceListenOptionsFromEnv, type VoiceListenOptions, type VoiceTranscriptStream } from "./listen_voice_commands.js";

export type TranscriptCommandOptions = Omit<VoiceListenOptions, "stdin"> & {
  command?: string;
  args?: string[];
  spawnFn?: TranscriptCommandSpawn;
};

export type TranscriptCommandSpawn = (
  command: string,
  args: string[],
) => {
  stdout: VoiceTranscriptStream;
  stderr?: AsyncIterable<unknown>;
  exitCode: Promise<number | null>;
};

export function transcriptCommandOptionsFromEnv(env: NodeJS.ProcessEnv): TranscriptCommandOptions {
  return {
    ...voiceListenOptionsFromEnv(env),
    command: env.EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND,
    args: parseArgsJson(env.EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON),
  };
}

export async function listenTranscriptCommand(options: TranscriptCommandOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  if (!options.command) {
    stderr.write("EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND is required\n");
    return 1;
  }

  const child = (options.spawnFn ?? spawnTranscriptCommand)(options.command, options.args ?? []);
  const stderrPump = pumpStderr(child.stderr, stderr);
  const listenExit = await listenVoiceCommands({
    ...options,
    stdin: child.stdout,
  });
  const processExit = await child.exitCode;
  await stderrPump;

  if (listenExit !== 0) return listenExit;
  return processExit === 0 ? 0 : 1;
}

function parseArgsJson(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON must be a JSON array of strings");
  }
  return parsed;
}

function spawnTranscriptCommand(command: string, args: string[]) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!child.stdout) throw new Error("transcript command stdout unavailable");

  return {
    stdout: child.stdout,
    stderr: child.stderr ?? undefined,
    exitCode: new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    }),
  };
}

async function pumpStderr(
  stream: AsyncIterable<unknown> | undefined,
  stderr: Pick<NodeJS.WriteStream, "write">,
): Promise<void> {
  if (!stream) return;
  for await (const chunk of stream) {
    stderr.write(String(chunk));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const exitCode = await listenTranscriptCommand(transcriptCommandOptionsFromEnv(process.env));
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
