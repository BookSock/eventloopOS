import type { CodexNativeThread, CodexNativeThreadClient, CodexNativeTurn } from "./codex_native_thread_controller.js";
import { normalizeTaskSessionPidFields } from "./pid_fields.js";
import { normalizeAgentRunStatus } from "../contracts.js";

export type CodexAppServerRequest = (request: {
  method: "initialize" | "thread/start" | "thread/list" | "thread/read" | "turn/start";
  params: unknown;
}) => Promise<unknown> | unknown;

export type CodexAppServerThreadClientOptions = {
  threadListLimit?: number;
  taskIdByThreadId?: Record<string, string>;
  taskIdForThreadId?: (threadId: string) => Promise<string | undefined> | string | undefined;
};

export class CodexAppServerThreadClient implements CodexNativeThreadClient {
  private readonly threadListLimit: number;
  private readonly taskIdByThreadId: Record<string, string>;
  private readonly taskIdResolver?: (threadId: string) => Promise<string | undefined> | string | undefined;

  constructor(
    private readonly request: CodexAppServerRequest,
    options: CodexAppServerThreadClientOptions = {},
  ) {
    this.threadListLimit = options.threadListLimit ?? 100;
    this.taskIdByThreadId = options.taskIdByThreadId ?? {};
    this.taskIdResolver = options.taskIdForThreadId;
  }

  async listThreads(): Promise<CodexNativeThread[]> {
    const threads: CodexNativeThread[] = [];
    let cursor: string | null | undefined;

    do {
      const response = await this.request({
        method: "thread/list",
        params: {
          cursor,
          limit: this.threadListLimit,
          archived: false,
          useStateDbOnly: true,
        },
      });
      const envelope = requireRecord(response, "thread/list response");
      const data = requireArray(envelope.data, "thread/list response data");
      const pageThreads = await Promise.all(data.map((thread) => this.threadFromAppServer(thread)));
      threads.push(...pageThreads);
      cursor = typeof envelope.nextCursor === "string" && envelope.nextCursor ? envelope.nextCursor : null;
    } while (cursor);

    return threads;
  }

  async getThread(threadId: string): Promise<CodexNativeThread | undefined> {
    const response = await this.request({
      method: "thread/read",
      params: {
        threadId,
        includeTurns: false,
      },
    });
    const envelope = requireRecord(response, "thread/read response");
    if (envelope.thread === undefined || envelope.thread === null) {
      return undefined;
    }

    return await this.threadFromAppServer(envelope.thread);
  }

  async startThread(input: {
    task_id: string;
    cwd?: string;
    model?: string;
  }): Promise<CodexNativeThread> {
    const response = await this.request({
      method: "thread/start",
      params: {
        cwd: input.cwd ?? null,
        model: input.model ?? null,
        baseInstructions: null,
        developerInstructions: `This Codex thread is owned by eventloopOS task ${input.task_id}. Keep work scoped to this task. Ask for human help by creating a waiting_approval/blocked report when needed.`,
        approvalPolicy: null,
        approvalsReviewer: null,
        config: null,
        ephemeral: null,
        modelProvider: null,
        personality: null,
        sandbox: null,
        serviceName: "eventloopos",
        serviceTier: null,
        sessionStartSource: null,
      },
    });
    const envelope = requireRecord(response, "thread/start response");
    const thread = await this.threadFromAppServer(envelope.thread);
    return {
      ...thread,
      task_id: input.task_id,
    };
  }

  async startTurn(input: {
    thread_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
  }): Promise<CodexNativeTurn> {
    const response = await this.request({
      method: "turn/start",
      params: {
        threadId: input.thread_id,
        input: [
          {
            type: "text",
            text: input.text,
            text_elements: [],
          },
        ],
        responsesapiClientMetadata: {
          eventloopos_idempotency_key: input.idempotency_key,
          eventloopos_event_ids: input.event_ids.join(","),
        },
      },
    });
    const envelope = requireRecord(response, "turn/start response");
    const turn = requireRecord(envelope.turn, "turn/start response turn");
    const status = typeof turn.status === "string" ? turn.status : undefined;

    return {
      id: typeof turn.id === "string" ? turn.id : undefined,
      status: status === "failed" || status === "interrupted" ? "failed" : "queued",
    };
  }

  async taskIdForThreadId(threadId: string): Promise<string | undefined> {
    return await this.mappedTaskIdForThread(threadId);
  }

  private async threadFromAppServer(input: unknown): Promise<CodexNativeThread> {
    const thread = requireRecord(input, "app-server thread");
    const id = requireString(thread.id, "app-server thread id");
    const name = readOptionalString(thread.name);
    const preview = readOptionalString(thread.preview);

    return {
      id,
      task_id: (await this.mappedTaskIdForThread(id)) ?? taskIdFromTaggedText(name) ?? taskIdFromTaggedText(preview),
      status: codexStatusToNative(readThreadStatus(thread.status)),
      name,
      preview,
      cwd: readOptionalString(thread.cwd),
      createdAt: readOptionalNumber(thread.createdAt),
      updatedAt: readOptionalNumber(thread.updatedAt),
      ...pidFieldsFromRecord(thread),
    };
  }

  private async mappedTaskIdForThread(threadId: string): Promise<string | undefined> {
    return await this.taskIdResolver?.(threadId) ?? this.taskIdByThreadId[threadId];
  }
}

export function taskIdFromTaggedText(text: string | undefined): string | undefined {
  const match = text?.match(/\[task:([^\]]+)\]/i);
  if (!match?.[1]) return undefined;
  return `task_${stableId(match[1])}`;
}

function readThreadStatus(status: unknown): string | undefined {
  if (typeof status === "string") return status;
  if (status === null || typeof status !== "object" || Array.isArray(status)) return undefined;
  const type = (status as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function codexStatusToNative(status: string | undefined): CodexNativeThread["status"] {
  switch (status) {
    case "active":
    case "inProgress":
      return "running";
    case "systemError":
      return "blocked";
    case "closed":
    case "archived":
      return "stopped";
    default:
      return normalizeHumanAttentionStatus(status) ?? "idle";
  }
}

function normalizeHumanAttentionStatus(status: string | undefined): CodexNativeThread["status"] | undefined {
  const normalized = status?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return undefined;
  if (normalized === "running" || normalized === "idle" || normalized === "blocked" || normalized === "stopped" || normalized === "lost") {
    return normalized;
  }
  if (normalized.includes("lost")) return "lost";
  const agentStatus = normalizeAgentRunStatus(normalized);
  if (agentStatus === "blocked" || agentStatus === "waiting_approval") return agentStatus;
  return undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  return numbers.length > 0 ? numbers : undefined;
}

function pidFieldsFromRecord(record: Record<string, unknown>): Pick<CodexNativeThread, "pid" | "agent_pid" | "terminal_pid" | "root_pid" | "pids"> {
  const pid = readOptionalNumber(record.pid);
  const agentPid = readOptionalNumber(record.agent_pid ?? record.agentPid);
  const terminalPid = readOptionalNumber(record.terminal_pid ?? record.terminalPid);
  const rootPid = readOptionalNumber(record.root_pid ?? record.rootPid);
  const pids = readOptionalNumberArray(record.pids);
  return normalizeTaskSessionPidFields({ pid, agent_pid: agentPid, terminal_pid: terminalPid, root_pid: rootPid, pids });
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
