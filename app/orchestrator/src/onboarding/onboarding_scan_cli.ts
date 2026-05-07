import { pathToFileURL } from "node:url";

export type OnboardingScanCliOptions = {
  baseUrl: string;
  format: "json" | "text";
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export function onboardingScanOptionsFromEnvAndArgv(
  env: NodeJS.ProcessEnv,
  argv: string[],
): OnboardingScanCliOptions {
  return {
    baseUrl: readFlag(argv, "--base-url") ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    format: readFlag(argv, "--format") === "text" ? "text" : "json",
  };
}

export async function runOnboardingScanCli(options: OnboardingScanCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const response = await fetchFn(new URL("/onboarding/scan", options.baseUrl));
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      stderr.write(`${JSON.stringify(body)}\n`);
      return 1;
    }
    stdout.write(options.format === "text" ? textSummary(body) : `${JSON.stringify(body)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function textSummary(body: Record<string, unknown>): string {
  const proposals = Array.isArray(body.proposals) ? body.proposals : [];
  const lines = [`Onboarding scan: ${proposals.length} proposed task groups`];
  for (const proposal of proposals) {
    if (!isRecord(proposal)) continue;
    const windows = Array.isArray(proposal.windows) ? proposal.windows.length : 0;
    const sessions = Array.isArray(proposal.task_sessions) ? proposal.task_sessions.length : 0;
    lines.push(`- ${proposal.task_id}: ${proposal.title} (${proposal.confidence}; ${windows} windows, ${sessions} sessions)`);
  }
  const warnings = Array.isArray(body.warnings) ? body.warnings.filter((warning): warning is string => typeof warning === "string") : [];
  for (const warning of warnings) {
    lines.push(`warning: ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runOnboardingScanCli(onboardingScanOptionsFromEnvAndArgv(process.env, process.argv.slice(2)));
  process.exitCode = exitCode;
}
