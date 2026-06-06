import type { TaskSessionController } from "./types.js";
import { normalizeTaskSessionPidFields } from "./pid_fields.js";
import { normalizeAgentRunStatus } from "../contracts.js";

export type ClaudeCliSessionConfig = {
  session_id: string;
  task_id?: string;
  name?: string;
  cwd?: string;
  model?: string;
  tools?: string;
  max_budget_usd?: string;
  status?: ClaudeCliTaskSession["status"];
  created_at?: string;
  updated_at?: string;
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
};

export type ClaudeCliTaskSession = {
  id: string;
  task_id?: string;
  provider: "claude";
  native_session_id: string;
  name?: string;
  cwd?: string;
  status: "idle" | "running" | "blocked" | "stopped" | "lost" | string;
  supports: {
    steer: boolean;
    followup: boolean;
    collect: boolean;
    interrupt: boolean;
    compact: boolean;
  };
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
};

export type ClaudeCliTaskMessage = {
  id: string;
  task_session_id: string;
  provider: "claude";
  native_session_id?: string;
  native_result_session_id?: string;
  mode: "followup";
  text: string;
  event_ids: string[];
  idempotency_key: string;
  sent_at?: string;
  status: "sent" | "failed" | "blocked";
  evidence: Array<{
    id: string;
    kind: "raw";
    title: string;
    ref: string;
    captured_at: string;
  }>;
};

export type ClaudeCliExec = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

export class ClaudeCliTaskSessionController implements TaskSessionController {
  readonly messages = new Map<string, ClaudeCliTaskMessage>();
  readonly messagesByIdempotencyKey = new Map<string, ClaudeCliTaskMessage>();
  private readonly sessions: ClaudeCliSessionConfig[];
  private readonly clock: () => Date;
  private readonly command: string;
  private readonly execFile: ClaudeCliExec;
  private readonly timeoutMs: number;

  constructor(options: {
    sessions: ClaudeCliSessionConfig[];
    execFile: ClaudeCliExec;
    command?: string;
    timeoutMs?: number;
    clock?: () => Date;
  }) {
    this.sessions = options.sessions;
    this.execFile = options.execFile;
    this.command = options.command ?? "claude";
    this.timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    this.clock = options.clock ?? (() => new Date());
  }

  listSessions(): ClaudeCliTaskSession[] {
    return this.sessions.map((session) => this.sessionFromConfig(session)).sort((left, right) => left.id.localeCompare(right.id));
  }

  getSession(taskSessionId: string): ClaudeCliTaskSession | undefined {
    return this.listSessions().find((session) => session.id === taskSessionId);
  }

  async sendFollowupMessage(input: {
    task_session_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
  }): Promise<ClaudeCliTaskMessage> {
    const existing = this.messagesByIdempotencyKey.get(input.idempotency_key);
    if (existing) return existing;

    const now = this.clock().toISOString();
    const session = this.getSession(input.task_session_id);
    if (!session) {
      return this.recordMessage({
        ...input,
        now,
        status: "blocked",
        evidenceTitle: "Claude CLI session missing",
      });
    }

    const args = [
      "-p",
      "--output-format",
      "json",
      "--resume",
      session.native_session_id,
    ];
    const config = this.configForSession(session.native_session_id);
    if (config?.model) args.push("--model", config.model);
    if (config?.tools !== undefined) args.push("--tools", config.tools);
    if (config?.max_budget_usd) args.push("--max-budget-usd", config.max_budget_usd);
    args.push(input.text);

    try {
      const result = await this.execFile(this.command, args, {
        cwd: session.cwd,
        timeoutMs: this.timeoutMs,
      });
      return this.recordMessage({
        ...input,
        now,
        nativeSessionId: session.native_session_id,
        nativeResultSessionId: parseClaudeResultSessionId(result.stdout),
        status: "sent",
        evidenceTitle: "Claude CLI followup sent",
      });
    } catch (error) {
      return this.recordMessage({
        ...input,
        now,
        nativeSessionId: session.native_session_id,
        status: "failed",
        evidenceTitle: `Claude CLI followup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private sessionFromConfig(config: ClaudeCliSessionConfig): ClaudeCliTaskSession {
    const now = this.clock().toISOString();
    const createdAt = config.created_at ?? config.updated_at ?? now;
    const updatedAt = config.updated_at ?? createdAt;
    return {
      id: taskSessionIdForClaudeSession(config.session_id),
      task_id: config.task_id,
      provider: "claude",
      native_session_id: config.session_id,
      name: config.name,
      cwd: config.cwd,
      status: config.status ?? "idle",
      supports: {
        steer: true,
        followup: true,
        collect: true,
        interrupt: false,
        compact: true,
      },
      last_seen_at: updatedAt,
      created_at: createdAt,
      updated_at: updatedAt,
      ...pidFields(config),
    };
  }

  private configForSession(sessionId: string): ClaudeCliSessionConfig | undefined {
    return this.sessions.find((session) => session.session_id === sessionId);
  }

  private recordMessage(input: {
    task_session_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
    now: string;
    nativeSessionId?: string;
    nativeResultSessionId?: string;
    status: ClaudeCliTaskMessage["status"];
    evidenceTitle: string;
  }): ClaudeCliTaskMessage {
    const message: ClaudeCliTaskMessage = {
      id: `claude_task_msg_${stableId(input.idempotency_key)}`,
      task_session_id: input.task_session_id,
      provider: "claude",
      native_session_id: input.nativeSessionId,
      native_result_session_id: input.nativeResultSessionId,
      mode: "followup",
      text: input.text,
      event_ids: input.event_ids,
      idempotency_key: input.idempotency_key,
      sent_at: input.status === "sent" ? input.now : undefined,
      status: input.status,
      evidence: [
        {
          id: `ev_claude_task_msg_${stableId(input.idempotency_key)}`,
          kind: "raw",
          title: input.evidenceTitle,
          ref: input.nativeSessionId ?? input.task_session_id,
          captured_at: input.now,
        },
      ],
    };
    this.messages.set(message.id, message);
    this.messagesByIdempotencyKey.set(message.idempotency_key, message);
    return message;
  }
}

export function parseClaudeSessionConfigs(raw: string | undefined): ClaudeCliSessionConfig[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Claude session config must be a JSON object");
  }

  return Object.entries(parsed).map(([sessionId, value]) => {
    if (!sessionId) {
      throw new Error("Claude session id must be non-empty");
    }
    if (typeof value === "string") {
      if (!value) throw new Error("Claude session task id must be non-empty");
      return {
        session_id: sessionId,
        task_id: value,
      };
    }
    if (!isRecord(value)) {
      throw new Error("Claude session config values must be task ids or objects");
    }
    return {
      session_id: sessionId,
      task_id: optionalString(value.task_id),
      name: optionalString(value.name),
      cwd: optionalString(value.cwd),
      model: optionalString(value.model),
      tools: typeof value.tools === "string" ? value.tools : undefined,
      max_budget_usd: optionalString(value.max_budget_usd),
      status: parseStatus(value.status),
      created_at: optionalString(value.created_at),
      updated_at: optionalString(value.updated_at),
      ...pidConfigFields(value),
    };
  });
}

export function taskSessionIdForClaudeSession(sessionId: string): string {
  return `claude_session_${stableId(sessionId)}`;
}

function parseClaudeResultSessionId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!isRecord(parsed)) return undefined;
    return optionalString(parsed.session_id) ?? optionalString(parsed.sessionId);
  } catch {
    return undefined;
  }
}

function parseStatus(value: unknown): ClaudeCliTaskSession["status"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return undefined;
  if (normalized === "idle" || normalized === "running" || normalized === "blocked" || normalized === "stopped" || normalized === "lost") {
    return normalized;
  }
  if (normalized.includes("lost")) return "lost";
  const agentStatus = normalizeAgentRunStatus(normalized);
  if (agentStatus === "blocked" || agentStatus === "waiting_approval") return agentStatus;
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  return numbers.length > 0 ? numbers : undefined;
}

function pidConfigFields(record: Record<string, unknown>): Pick<ClaudeCliSessionConfig, "pid" | "agent_pid" | "terminal_pid" | "root_pid" | "pids"> {
  const pid = optionalNumber(record.pid);
  const agentPid = optionalNumber(record.agent_pid ?? record.agentPid);
  const terminalPid = optionalNumber(record.terminal_pid ?? record.terminalPid);
  const rootPid = optionalNumber(record.root_pid ?? record.rootPid);
  const pids = optionalNumberArray(record.pids);
  return normalizeTaskSessionPidFields({ pid, agent_pid: agentPid, terminal_pid: terminalPid, root_pid: rootPid, pids });
}

function pidFields(input: {
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
}): Pick<ClaudeCliTaskSession, "pid" | "agent_pid" | "terminal_pid" | "root_pid" | "pids"> {
  return normalizeTaskSessionPidFields(input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
