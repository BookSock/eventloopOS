export type TranscriptCommandConfig = {
  command?: string;
  args: string[];
  configured: boolean;
  source: "explicit" | "preset" | "unconfigured";
  preset?: string;
  error?: string;
};

export function resolveTranscriptCommandConfigFromEnv(env: NodeJS.ProcessEnv): TranscriptCommandConfig {
  if (env.EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND !== undefined) {
    return {
      command: env.EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND,
      args: parseArgsJson(env.EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON),
      configured: true,
      source: "explicit",
    };
  }

  const preset = env.EVENTLOOPOS_VOICE_STT_PRESET?.trim();
  if (!preset) {
    return { args: [], configured: false, source: "unconfigured" };
  }

  if (preset !== "whisper_cpp_stream") {
    return {
      args: [],
      configured: true,
      source: "preset",
      preset,
      error: `unsupported EVENTLOOPOS_VOICE_STT_PRESET: ${preset}`,
    };
  }

  const model = env.EVENTLOOPOS_WHISPER_MODEL?.trim();
  if (!model) {
    return {
      args: [],
      configured: true,
      source: "preset",
      preset,
      error: "EVENTLOOPOS_WHISPER_MODEL is required for whisper_cpp_stream preset",
    };
  }

  const args = [
    "-m",
    model,
    "--step",
    env.EVENTLOOPOS_WHISPER_STEP_MS ?? "500",
    "--length",
    env.EVENTLOOPOS_WHISPER_LENGTH_MS ?? "5000",
    "--keep",
    env.EVENTLOOPOS_WHISPER_KEEP_MS ?? "200",
  ];
  appendOptionalArg(args, "-t", env.EVENTLOOPOS_WHISPER_THREADS);
  appendOptionalArg(args, "-c", env.EVENTLOOPOS_WHISPER_CAPTURE_ID);
  appendOptionalArg(args, "-l", env.EVENTLOOPOS_WHISPER_LANGUAGE);

  return {
    command: env.EVENTLOOPOS_WHISPER_CPP_STREAM_BIN ?? "whisper-stream",
    args,
    configured: true,
    source: "preset",
    preset,
  };
}

function appendOptionalArg(args: string[], flag: string, value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return;
  }
  args.push(flag, value);
}

function parseArgsJson(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON must be a JSON array of strings");
  }
  return parsed;
}
