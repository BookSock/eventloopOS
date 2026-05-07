import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CodexAppServerThreadClient } from "../task_sessions/codex_app_server_thread_client.js";
import { createCodexAppServerStdioConnection } from "../task_sessions/codex_app_server_stdio.js";
import { resolveTranscriptCommandConfigFromEnv } from "../voice/stt_presets.js";
import { captureWorkspacePlan } from "../workspace/aerospace.js";

type ExecResult = {
  stdout: string;
  stderr: string;
};

type ExecFunction = (command: string, args: string[]) => Promise<ExecResult>;

export type DoctorCheckName =
  | "orchestrator_health"
  | "aerospace_daemon"
  | "docker_daemon"
  | "codex_app_server"
  | "browser_e2e"
  | "mac_browser_restore_smoke"
  | "voice_transcript_command";

export type DoctorCheck = {
  name: DoctorCheckName;
  ok: boolean;
  detail: string;
  command?: string[];
  source_url?: string;
};

export type DoctorReport = {
  ok: boolean;
  generated_at: string;
  orchestrator_url: string;
  checks: DoctorCheck[];
};

export type DoctorOptions = {
  baseUrl: string;
  now?: () => Date;
  execFn?: ExecFunction;
  fetchFn?: typeof fetch;
  codexCheckFn?: () => Promise<DoctorCheck> | DoctorCheck;
  platform?: NodeJS.Platform;
  voiceTranscriptCommand?: string;
  voiceTranscriptArgs?: string[];
  voiceTranscriptCommandConfigured?: boolean;
  voiceTranscriptConfigError?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export function doctorOptionsFromEnv(env: NodeJS.ProcessEnv): DoctorOptions {
  const transcriptCommandConfig = resolveTranscriptCommandConfigFromEnv(env);
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    voiceTranscriptCommand: transcriptCommandConfig.command,
    voiceTranscriptArgs: transcriptCommandConfig.args,
    voiceTranscriptCommandConfigured: transcriptCommandConfig.configured,
    voiceTranscriptConfigError: transcriptCommandConfig.error,
  };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const execFn = options.execFn ?? execFilePromise;
  const fetchFn = options.fetchFn ?? fetch;
  const checks = await Promise.all([
    checkOrchestratorHealth(options.baseUrl, fetchFn),
    checkAerospaceDaemon(execFn),
    checkDockerDaemon(execFn),
    checkBrowserE2E(execFn),
    checkMacBrowserRestoreSmoke(execFn, options.platform ?? process.platform),
    checkVoiceTranscriptCommand(options, execFn),
    options.codexCheckFn ? options.codexCheckFn() : checkCodexAppServer(),
  ]);

  return {
    ok: checks.every((check) => check.ok),
    generated_at: generatedAt,
    orchestrator_url: options.baseUrl,
    checks,
  };
}

async function checkVoiceTranscriptCommand(options: DoctorOptions, execFn: ExecFunction): Promise<DoctorCheck> {
  if (options.voiceTranscriptConfigError) {
    return {
      name: "voice_transcript_command",
      ok: false,
      detail: options.voiceTranscriptConfigError,
      source_url: "https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/stream.cpp",
    };
  }

  if (!options.voiceTranscriptCommandConfigured && !options.voiceTranscriptCommand) {
    return {
      name: "voice_transcript_command",
      ok: true,
      detail: "optional voice transcript command is not configured",
      source_url: "https://nodejs.org/api/child_process.html#child_processspawncommand-args-options",
    };
  }

  if (!options.voiceTranscriptCommand) {
    return {
      name: "voice_transcript_command",
      ok: false,
      detail: "EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND is blank",
      source_url: "https://nodejs.org/api/child_process.html#child_processspawncommand-args-options",
    };
  }

  const command = [options.voiceTranscriptCommand, ...(options.voiceTranscriptArgs ?? []), "--help"];
  try {
    await execFn(command[0] ?? options.voiceTranscriptCommand, command.slice(1));

    return {
      name: "voice_transcript_command",
      ok: true,
      detail: "voice transcript command launched with --help",
      command,
      source_url: "https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/stream.cpp",
    };
  } catch (error) {
    return {
      name: "voice_transcript_command",
      ok: false,
      detail: classifyCommandFailure(error),
      command,
      source_url: "https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/stream.cpp",
    };
  }
}

export async function runDoctorCli(options: DoctorOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const report = await runDoctor(options);
  stdout.write(`${JSON.stringify(report)}\n`);

  return report.ok ? 0 : 1;
}

async function checkOrchestratorHealth(baseUrl: string, fetchFn: typeof fetch): Promise<DoctorCheck> {
  try {
    const response = await fetchFn(new URL("/health", baseUrl));
    const body = await response.json() as unknown;
    const ok = response.ok && isRecord(body) && body.ok === true;

    return {
      name: "orchestrator_health",
      ok,
      detail: ok ? "orchestrator health endpoint responded" : `unexpected health response: HTTP ${response.status}`,
      source_url: `${baseUrl.replace(/\/$/, "")}/health`,
    };
  } catch (error) {
    return {
      name: "orchestrator_health",
      ok: false,
      detail: errorDetail(error),
      source_url: `${baseUrl.replace(/\/$/, "")}/health`,
    };
  }
}

async function checkAerospaceDaemon(execFn: ExecFunction): Promise<DoctorCheck> {
  const plan = captureWorkspacePlan();
  const command = [plan.command, ...plan.args];
  try {
    const result = await execFn(command[0] ?? "aerospace", command.slice(1));
    JSON.parse(result.stdout);

    return {
      name: "aerospace_daemon",
      ok: true,
      detail: "AeroSpace CLI returned window JSON",
      command,
      source_url: "https://nikitabobko.github.io/AeroSpace/commands.html#list-windows",
    };
  } catch (error) {
    return {
      name: "aerospace_daemon",
      ok: false,
      detail: classifyCommandFailure(error),
      command,
      source_url: "https://nikitabobko.github.io/AeroSpace/commands.html#list-windows",
    };
  }
}

async function checkDockerDaemon(execFn: ExecFunction): Promise<DoctorCheck> {
  const command = ["docker", "info", "--format", "{{.ServerVersion}}"];
  try {
    const result = await execFn(command[0] ?? "docker", command.slice(1));
    const version = result.stdout.trim();

    return {
      name: "docker_daemon",
      ok: Boolean(version),
      detail: version ? `Docker daemon responded: ${version}` : "Docker daemon returned empty ServerVersion",
      command,
      source_url: "https://docs.docker.com/reference/cli/docker/system/info/",
    };
  } catch (error) {
    return {
      name: "docker_daemon",
      ok: false,
      detail: classifyCommandFailure(error),
      command,
      source_url: "https://docs.docker.com/reference/cli/docker/system/info/",
    };
  }
}

async function checkBrowserE2E(execFn: ExecFunction): Promise<DoctorCheck> {
  const command = ["pnpm", "--filter", "@eventloopos/browser-extension", "exec", "playwright", "--version"];
  try {
    const result = await execFn(command[0] ?? "pnpm", command.slice(1));
    const version = result.stdout.trim();

    return {
      name: "browser_e2e",
      ok: Boolean(version),
      detail: version ? `Playwright available: ${version}` : "Playwright returned empty version",
      command,
      source_url: "https://playwright.dev/docs/chrome-extensions",
    };
  } catch (error) {
    return {
      name: "browser_e2e",
      ok: false,
      detail: classifyCommandFailure(error),
      command,
      source_url: "https://playwright.dev/docs/chrome-extensions",
    };
  }
}

async function checkMacBrowserRestoreSmoke(execFn: ExecFunction, platform: NodeJS.Platform): Promise<DoctorCheck> {
  const command = ["swift", "--version"];
  if (platform !== "darwin") {
    return {
      name: "mac_browser_restore_smoke",
      ok: false,
      detail: "Mac client + browser restore smoke requires macOS",
      command,
      source_url: "https://www.swift.org/getting-started/",
    };
  }

  try {
    const result = await execFn(command[0] ?? "swift", command.slice(1));
    const version = result.stdout.trim().split(/\r?\n/, 1)[0] ?? "";

    return {
      name: "mac_browser_restore_smoke",
      ok: Boolean(version),
      detail: version
        ? `Swift available for mac-browser restore smoke: ${version}`
        : "Swift returned empty version",
      command,
      source_url: "https://www.swift.org/getting-started/",
    };
  } catch (error) {
    return {
      name: "mac_browser_restore_smoke",
      ok: false,
      detail: classifyCommandFailure(error),
      command,
      source_url: "https://www.swift.org/getting-started/",
    };
  }
}

async function checkCodexAppServer(): Promise<DoctorCheck> {
  let connection: ReturnType<typeof createCodexAppServerStdioConnection> | undefined;
  try {
    connection = createCodexAppServerStdioConnection({ requestTimeoutMs: 5_000 });
    await connection.initialized;
    const threads = await new CodexAppServerThreadClient(connection.request, { threadListLimit: 1 }).listThreads();

    return {
      name: "codex_app_server",
      ok: true,
      detail: `Codex app-server responded; sampled ${threads.length} thread(s)`,
      command: ["codex", "app-server", "--listen", "stdio://"],
      source_url: "https://developers.openai.com/codex/app-server",
    };
  } catch (error) {
    return {
      name: "codex_app_server",
      ok: false,
      detail: errorDetail(error),
      command: ["codex", "app-server", "--listen", "stdio://"],
      source_url: "https://developers.openai.com/codex/app-server",
    };
  } finally {
    connection?.close();
  }
}

async function execFilePromise(command: string, args: string[]): Promise<ExecResult> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout: 5_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function classifyCommandFailure(error: unknown): string {
  if (isRecord(error) && error.code === "ENOENT") {
    return "binary missing";
  }
  if (isRecord(error) && typeof error.stderr === "string" && error.stderr.trim()) {
    return error.stderr.trim();
  }
  if (isRecord(error) && typeof error.message === "string") {
    const detail = error.message.replace(/^Command failed: .*\n/, "").trim();
    if (detail) {
      return detail;
    }
  }

  return errorDetail(error);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runDoctorCli(doctorOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
