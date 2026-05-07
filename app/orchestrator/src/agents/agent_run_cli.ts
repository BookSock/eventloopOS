import { pathToFileURL } from "node:url";
import type { Action, AgentRun, EvidenceRef, RawRef } from "../contracts.js";

type AgentRunCliCommand = "upsert" | "get";

type AgentRunCliOptions = {
  command: AgentRunCliCommand;
  baseUrl: string;
  id?: string;
  provider?: AgentRun["provider"];
  taskId?: string;
  taskHint?: string;
  threadId?: string;
  status?: AgentRun["status"];
  blockedReason?: string;
  riskTags: string[];
  evidenceTitle?: string;
  evidenceUrl?: string;
  evidenceKind?: string;
  outputRefUri?: string;
  outputRefMediaType?: string;
  resumeActionLabel?: string;
  resumeActionSideEffect?: Action["side_effect"];
  stdin?: StdinLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

type StdinLike = {
  isTTY?: boolean;
  setEncoding(encoding: BufferEncoding): unknown;
  [Symbol.asyncIterator](): AsyncIterator<unknown, unknown, unknown>;
};

const runStatuses: AgentRun["status"][] = ["queued", "running", "blocked", "waiting_approval", "completed", "failed", "cancelled"];
const providers: AgentRun["provider"][] = ["codex", "claude", "openai", "manual", "fake"];
const sideEffects: Action["side_effect"][] = ["none", "local", "external", "production", "sensitive"];

export function agentRunCliOptionsFromEnvAndArgv(env: NodeJS.ProcessEnv, argv: string[]): AgentRunCliOptions {
  const args = parseArgs(argv);
  return {
    command: args.command ?? commandFromEnv(env.EVENTLOOPOS_AGENT_RUN_COMMAND) ?? "upsert",
    baseUrl: args.baseUrl ?? env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    id: args.id ?? env.EVENTLOOPOS_AGENT_RUN_ID,
    provider: args.provider ?? providerFromEnv(env.EVENTLOOPOS_AGENT_RUN_PROVIDER),
    taskId: args.taskId ?? env.EVENTLOOPOS_TASK_ID,
    taskHint: args.taskHint ?? env.EVENTLOOPOS_TASK_HINT,
    threadId: args.threadId ?? env.EVENTLOOPOS_AGENT_THREAD_ID,
    status: args.status ?? statusFromEnv(env.EVENTLOOPOS_AGENT_RUN_STATUS),
    blockedReason: args.blockedReason ?? env.EVENTLOOPOS_AGENT_RUN_BLOCKED_REASON,
    riskTags: args.riskTags.length > 0 ? args.riskTags : splitList(env.EVENTLOOPOS_AGENT_RUN_RISK_TAGS),
    evidenceTitle: args.evidenceTitle ?? env.EVENTLOOPOS_AGENT_RUN_EVIDENCE_TITLE,
    evidenceUrl: args.evidenceUrl ?? env.EVENTLOOPOS_AGENT_RUN_EVIDENCE_URL,
    evidenceKind: args.evidenceKind ?? env.EVENTLOOPOS_AGENT_RUN_EVIDENCE_KIND,
    outputRefUri: args.outputRefUri ?? env.EVENTLOOPOS_AGENT_RUN_OUTPUT_REF_URI,
    outputRefMediaType: args.outputRefMediaType ?? env.EVENTLOOPOS_AGENT_RUN_OUTPUT_REF_MEDIA_TYPE,
    resumeActionLabel: args.resumeActionLabel ?? env.EVENTLOOPOS_AGENT_RUN_RESUME_ACTION_LABEL,
    resumeActionSideEffect: args.resumeActionSideEffect ?? sideEffectFromEnv(env.EVENTLOOPOS_AGENT_RUN_RESUME_ACTION_SIDE_EFFECT),
  };
}

export async function runAgentRunCli(options: AgentRunCliOptions): Promise<number> {
  if (options.command === "get") {
    return await getAgentRun(options);
  }
  return await upsertAgentRun(options);
}

export async function buildAgentRunFromCliOptions(options: AgentRunCliOptions): Promise<{ ok: true; value: AgentRun } | { ok: false; message: string }> {
  const id = options.id?.trim();
  if (!id) return { ok: false, message: "agent run id must be provided with --id or EVENTLOOPOS_AGENT_RUN_ID" };

  const provider = options.provider ?? "manual";
  const status = options.status ?? "waiting_approval";
  const now = (options.now ?? (() => new Date()))().toISOString();
  const explicitBlockedReason = cleanOptional(options.blockedReason);
  const stdinText = explicitBlockedReason ? "" : await readOptionalStdin(options.stdin ?? process.stdin);
  const blockedReason = explicitBlockedReason ?? cleanOptional(stdinText);
  const stableRunId = stableId(id);
  const evidence = buildEvidence(options, stableRunId, now);
  const outputRefs = buildOutputRefs(options, stableRunId);

  return {
    ok: true,
    value: {
      id,
      provider,
      task_id: normalizeTaskId(options.taskId ?? options.taskHint),
      thread_id: cleanOptional(options.threadId),
      status,
      updated_at: now,
      blocked_reason: blockedReason,
      risk_tags: options.riskTags,
      evidence,
      output_refs: outputRefs,
      resume_actions: buildResumeActions(options, id, stableRunId),
    },
  };
}

async function upsertAgentRun(options: AgentRunCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const run = await buildAgentRunFromCliOptions(options);
  if (!run.ok) {
    stderr.write(`${run.message}\n`);
    return 1;
  }

  try {
    const response = await fetchFn(new URL("/agent-runs", options.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(run.value),
    });
    const body = await response.json() as unknown;
    stdout.write(`${JSON.stringify(body)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function getAgentRun(options: AgentRunCliOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const id = options.id?.trim();
  if (!id) {
    stderr.write("agent run id must be provided with --id or EVENTLOOPOS_AGENT_RUN_ID\n");
    return 1;
  }

  try {
    const response = await fetchFn(new URL(`/agent-runs/${encodeURIComponent(id)}`, options.baseUrl), {
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

function buildEvidence(options: AgentRunCliOptions, stableRunId: string, capturedAt: string): EvidenceRef[] {
  const title = cleanOptional(options.evidenceTitle);
  const url = cleanOptional(options.evidenceUrl);
  if (!title && !url) return [];

  return [
    {
      id: `ev_${stableRunId}_cli`,
      kind: cleanOptional(options.evidenceKind) ?? "agent_run",
      title: title ?? "Agent run evidence",
      url,
      captured_at: capturedAt,
    },
  ];
}

function buildOutputRefs(options: AgentRunCliOptions, stableRunId: string): RawRef[] {
  const uri = cleanOptional(options.outputRefUri);
  if (!uri) return [];
  return [
    {
      id: `raw_${stableRunId}_cli`,
      uri,
      media_type: cleanOptional(options.outputRefMediaType),
    },
  ];
}

function buildResumeActions(options: AgentRunCliOptions, agentRunId: string, stableRunId: string): Action[] {
  return [
    {
      id: `act_${stableRunId}_resume`,
      type: "resume_agent",
      label: cleanOptional(options.resumeActionLabel) ?? "Resume agent run",
      requires_confirmation: true,
      side_effect: options.resumeActionSideEffect ?? "local",
      payload: {
        agent_run_id: agentRunId,
        thread_id: cleanOptional(options.threadId),
      },
    },
  ];
}

function parseArgs(argv: string[]): Partial<Omit<AgentRunCliOptions, "riskTags">> & { riskTags: string[] } {
  const options: Partial<Omit<AgentRunCliOptions, "riskTags">> & { riskTags: string[] } = { riskTags: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "upsert" || arg === "get") {
      options.command = arg;
      continue;
    }
    switch (arg) {
      case "--base-url":
        options.baseUrl = readArgValue(argv, ++index, arg);
        break;
      case "--id":
      case "--run-id":
        options.id = readArgValue(argv, ++index, arg);
        break;
      case "--provider":
        options.provider = parseProvider(readArgValue(argv, ++index, arg));
        break;
      case "--task-id":
        options.taskId = readArgValue(argv, ++index, arg);
        break;
      case "--task":
      case "--task-hint":
        options.taskHint = readArgValue(argv, ++index, arg);
        break;
      case "--thread":
      case "--thread-id":
        options.threadId = readArgValue(argv, ++index, arg);
        break;
      case "--status":
        options.status = parseStatus(readArgValue(argv, ++index, arg));
        break;
      case "--blocked-reason":
      case "--summary":
        options.blockedReason = readArgValue(argv, ++index, arg);
        break;
      case "--risk-tag":
        options.riskTags.push(readArgValue(argv, ++index, arg));
        break;
      case "--evidence-title":
        options.evidenceTitle = readArgValue(argv, ++index, arg);
        break;
      case "--evidence-url":
        options.evidenceUrl = readArgValue(argv, ++index, arg);
        break;
      case "--evidence-kind":
        options.evidenceKind = readArgValue(argv, ++index, arg);
        break;
      case "--output-ref-uri":
        options.outputRefUri = readArgValue(argv, ++index, arg);
        break;
      case "--output-ref-media-type":
        options.outputRefMediaType = readArgValue(argv, ++index, arg);
        break;
      case "--resume-label":
      case "--resume-action-label":
        options.resumeActionLabel = readArgValue(argv, ++index, arg);
        break;
      case "--resume-side-effect":
        options.resumeActionSideEffect = parseSideEffect(readArgValue(argv, ++index, arg));
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

function commandFromEnv(input: string | undefined): AgentRunCliCommand | undefined {
  return input === "upsert" || input === "get" ? input : undefined;
}

function providerFromEnv(input: string | undefined): AgentRun["provider"] | undefined {
  return input ? parseProvider(input) : undefined;
}

function statusFromEnv(input: string | undefined): AgentRun["status"] | undefined {
  return input ? parseStatus(input) : undefined;
}

function sideEffectFromEnv(input: string | undefined): Action["side_effect"] | undefined {
  return input ? parseSideEffect(input) : undefined;
}

function parseProvider(input: string): AgentRun["provider"] {
  if (providers.includes(input as AgentRun["provider"])) return input as AgentRun["provider"];
  throw new Error(`provider must be one of: ${providers.join(", ")}`);
}

function parseStatus(input: string): AgentRun["status"] {
  if (runStatuses.includes(input as AgentRun["status"])) return input as AgentRun["status"];
  throw new Error(`status must be one of: ${runStatuses.join(", ")}`);
}

function parseSideEffect(input: string): Action["side_effect"] {
  if (sideEffects.includes(input as Action["side_effect"])) return input as Action["side_effect"];
  throw new Error(`resume side effect must be one of: ${sideEffects.join(", ")}`);
}

function splitList(input: string | undefined): string[] {
  return input?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function normalizeTaskId(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  if (/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) return trimmed;
  return `task_${stableId(trimmed)}`;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

async function readOptionalStdin(stdin: StdinLike): Promise<string> {
  if (stdin.isTTY) return "";
  stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of stdin) {
    text += chunk;
  }
  return text;
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAgentRunCli(agentRunCliOptionsFromEnvAndArgv(process.env, process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
