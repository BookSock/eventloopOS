import { pathToFileURL } from "node:url";

export type OnboardingScanCliOptions = {
  baseUrl: string;
  command: "apply" | "scan";
  format: "agent" | "json" | "text";
  taskId?: string;
  taskHint?: string;
  proposalId?: string;
  windowIds: number[];
  taskSessionIds: string[];
  queuePaper: boolean;
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

export function onboardingScanOptionsFromEnvAndArgv(
  env: NodeJS.ProcessEnv,
  argv: string[],
): OnboardingScanCliOptions {
  const command = argv.includes("apply") ? "apply" : "scan";
  return {
    baseUrl: readFlag(argv, "--base-url") ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    command,
    format: parseFormat(readFlag(argv, "--format")),
    taskId: readFlag(argv, "--task-id"),
    taskHint: readFlag(argv, "--task"),
    proposalId: readFlag(argv, "--proposal") ?? readFlag(argv, "--proposal-id"),
    windowIds: readAllFlags(argv, "--window-id").flatMap(splitCsv).map(Number).filter((value) => Number.isInteger(value) && value > 0),
    taskSessionIds: readAllFlags(argv, "--session").flatMap(splitCsv).filter(Boolean),
    queuePaper: argv.includes("--queue-paper") || argv.includes("--queue"),
  };
}

export async function runOnboardingScanCli(options: OnboardingScanCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const response = options.command === "apply"
      ? await fetchFn(new URL("/onboarding/approvals", options.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: options.taskId,
          task_hint: options.taskHint,
          proposal_id: options.proposalId,
          window_ids: options.windowIds,
          task_session_ids: options.taskSessionIds,
          queue_paper: options.queuePaper,
          actor_id: "onboarding_cli",
        }),
      })
      : await fetchFn(new URL("/onboarding/scan", options.baseUrl));
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      stderr.write(`${JSON.stringify(body)}\n`);
      return 1;
    }
    stdout.write(formatBody(body, options.format, options.baseUrl));
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseFormat(value: string | undefined): OnboardingScanCliOptions["format"] {
  return value === "agent" || value === "text" ? value : "json";
}

function formatBody(body: Record<string, unknown>, format: OnboardingScanCliOptions["format"], baseUrl: string): string {
  if (format === "agent") return agentSummary(body, baseUrl);
  if (format === "text") return textSummary(body);
  return `${JSON.stringify(body)}\n`;
}

function textSummary(body: Record<string, unknown>): string {
  const proposals = Array.isArray(body.proposals) ? body.proposals : [];
  const summary = isRecord(body.summary) ? body.summary : {};
  const windowCount = readNumber(summary.window_count);
  const groupedWindowCount = readNumber(summary.grouped_window_count);
  const taskSessionCount = readNumber(summary.task_session_count);
  const browserContextCount = readNumber(summary.browser_context_count);
  const lines = [`Onboarding scan: ${proposals.length} proposed task groups`];
  if (typeof body.active_workspace === "string" || typeof body.focused_window_id === "number") {
    lines.push(`workspace: ${body.active_workspace ?? "unknown"}; focused window: ${body.focused_window_id ?? "unknown"}`);
  }
  if (windowCount !== undefined || groupedWindowCount !== undefined || taskSessionCount !== undefined || browserContextCount !== undefined) {
    lines.push(`scan: ${windowCount ?? 0} windows, ${groupedWindowCount ?? 0} grouped, ${taskSessionCount ?? 0} task sessions, ${browserContextCount ?? 0} browser contexts`);
  }
  for (const proposal of proposals) {
    if (!isRecord(proposal)) continue;
    const windows = Array.isArray(proposal.windows) ? proposal.windows.length : 0;
    const sessions = Array.isArray(proposal.task_sessions) ? proposal.task_sessions.length : 0;
    const browserContexts = Array.isArray(proposal.browser_contexts) ? proposal.browser_contexts.length : 0;
    lines.push(`- ${proposal.task_id}: ${proposal.title} (${proposal.confidence}; ${windows} windows, ${browserContexts} tabs, ${sessions} sessions)`);
  }
  const warnings = Array.isArray(body.warnings) ? body.warnings.filter((warning): warning is string => typeof warning === "string") : [];
  for (const warning of warnings) {
    lines.push(`warning: ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

function agentSummary(body: Record<string, unknown>, baseUrl: string): string {
  const proposals = Array.isArray(body.proposals) ? body.proposals : [];
  const summary = isRecord(body.summary) ? body.summary : {};
  const warnings = Array.isArray(body.warnings) ? body.warnings.filter((warning): warning is string => typeof warning === "string") : [];
  const lines = [
    "# eventloopOS agent onboarding brief",
    "",
    "Goal: make this Mac usable as one human-review intake stack.",
    "",
    "## Current daemon",
    "",
    `- Orchestrator: ${baseUrl}`,
    `- Active workspace: ${typeof body.active_workspace === "string" ? body.active_workspace : "unknown"}`,
    `- Focused window id: ${typeof body.focused_window_id === "number" ? body.focused_window_id : "unknown"}`,
    `- Windows scanned: ${readNumber(summary.window_count) ?? 0}`,
    `- Windows grouped: ${readNumber(summary.grouped_window_count) ?? 0}`,
    `- Task sessions seen: ${readNumber(summary.task_session_count) ?? 0}`,
    `- Browser contexts seen: ${readNumber(summary.browser_context_count) ?? 0}`,
    "",
    "## Agent install checks",
    "",
    "Run these from repo root and fix failures before dogfooding:",
    "",
    "```sh",
    "pnpm install",
    "pnpm run dev:doctor:preflight",
    "pnpm run proof:agent",
    "```",
    "",
    "For real dogfood, user should have AeroSpace fork running, Docker running, Codex CLI installed, and optional integration CLIs such as `agent-slack`, `gws`, and `gh` already authenticated.",
    "",
    "## Integration setup",
    "",
    "- Private source file: `config/mcp-sources.json` if present. Never put tokens or account names in tracked `*.example.json` files.",
    "- List configured sources only while orchestrator is running: `pnpm run mcp:sources`.",
    "- Preview source without routing or committing cursors: `pnpm run mcp:preview <source_id>`.",
    "- Route once after preview is sane: `pnpm run mcp:route-once <source_id>`.",
    "- Dogfood polling: `EVENTLOOPOS_DOGFOOD_MCP_POLL=1 pnpm run dev:dogfood`.",
    "",
    "## Multi-instance dogfood",
    "",
    "- Stable stack: `pnpm run dev:dogfood`.",
    "- Experimental stack with separate default ports/Postgres container: `EVENTLOOPOS_DOGFOOD_PROFILE=experiment pnpm run dev:dogfood`.",
    "- Background stack without second queue app/hotkeys: `EVENTLOOPOS_DOGFOOD_PROFILE=experiment EVENTLOOPOS_DOGFOOD_QUEUE_APP=0 pnpm run dev:dogfood`.",
    "- Explicit override: `EVENTLOOPOS_ORCHESTRATOR_URL=http://127.0.0.1:4488 EVENTLOOPOS_POSTGRES_PORT=55588 EVENTLOOPOS_POSTGRES_CONTAINER=eventloopos-postgres-exp pnpm run dev:dogfood`.",
    "",
    "## Proposed task groups",
    "",
  ];
  if (proposals.length === 0) {
    lines.push("- None yet. Ask user what current work contexts are, then create/bind tasks manually.");
  }
  for (const proposal of proposals) {
    if (!isRecord(proposal)) continue;
    const windows = Array.isArray(proposal.windows) ? proposal.windows.length : 0;
    const sessions = Array.isArray(proposal.task_sessions) ? proposal.task_sessions.length : 0;
    const browserContexts = Array.isArray(proposal.browser_contexts) ? proposal.browser_contexts.length : 0;
    lines.push(`- ${String(proposal.task_id ?? "unknown")}: ${String(proposal.title ?? "Untitled")} (${String(proposal.confidence ?? "unknown")}; ${windows} windows, ${browserContexts} tabs, ${sessions} sessions)`);
  }
  if (warnings.length > 0) {
    lines.push("", "## Warnings", "");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push(
    "",
    "## Next agent actions",
    "",
    "1. Ask user which proposed groups are real tasks.",
    "2. Approve an accepted group by saving its windows, binding sessions, and creating its first paper:",
    "   `pnpm run onboarding:apply -- --proposal onboard_abc123 --queue-paper`.",
    "   Or use explicit ids: `pnpm run onboarding:apply -- --task-id task_blog --window-id 123 --window-id 456 --session codex_thread_abc --queue-paper`.",
    "3. Bind extra visible Codex/Claude sessions with `pnpm run task:bind` if needed.",
    "4. Open the queue app and pull the queued onboarding paper to prove the approved workbench appears in the intake stack.",
    "5. If Slack/Gmail/todo sources exist, preview each source, then route one event.",
    "6. Run `pnpm run dogfood:review` and show user activity/metrics summary.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function readAllFlags(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) values.push(value);
  }
  return values;
}

function splitCsv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runOnboardingScanCli(onboardingScanOptionsFromEnvAndArgv(process.env, process.argv.slice(2)));
  process.exitCode = exitCode;
}
