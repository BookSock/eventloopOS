import type { TaskSessionController } from "./types.js";
import { normalizeTaskSessionPidFields } from "./pid_fields.js";
import { normalizeAgentRunStatus } from "../contracts.js";

export type CodexNativeThread = {
  id: string;
  task_id?: string;
  status?: string;
  name?: string | null;
  preview?: string;
  cwd?: string;
  created_at?: string;
  updated_at?: string;
  createdAt?: number;
  updatedAt?: number;
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
};

export type CodexNativeTurn = {
  id?: string;
  status?: "queued" | "sent" | "failed" | "blocked";
};

export type CodexNativeThreadClient = {
  listThreads(): Promise<CodexNativeThread[]> | CodexNativeThread[];
  getThread(threadId: string): Promise<CodexNativeThread | undefined> | CodexNativeThread | undefined;
  taskIdForThreadId?(threadId: string): Promise<string | undefined> | string | undefined;
  startThread?(input: {
    task_id: string;
    cwd?: string;
    model?: string;
  }): Promise<CodexNativeThread> | CodexNativeThread;
  startTurn(input: {
    thread_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
  }): Promise<CodexNativeTurn> | CodexNativeTurn;
};

export type CodexTaskSessionBindingWriter = {
  bindThreadToTask(threadId: string, taskId: string, terminalRef?: string): Promise<unknown> | unknown;
};

export type CodexTaskSession = {
  id: string;
  task_id?: string;
  provider: "codex";
  native_thread_id: string;
  name?: string;
  preview?: string;
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

export type CodexTaskMessage = {
  id: string;
  task_session_id: string;
  provider: "codex";
  native_thread_id?: string;
  native_turn_id?: string;
  mode: "followup";
  text: string;
  event_ids: string[];
  idempotency_key: string;
  sent_at?: string;
  status: "sent" | "failed" | "blocked";
  error?: string;
  evidence: Array<{
    id: string;
    kind: "raw";
    title: string;
    ref: string;
    captured_at: string;
  }>;
};

export class CodexNativeThreadController implements TaskSessionController {
  readonly messages = new Map<string, CodexTaskMessage>();
  readonly messagesByIdempotencyKey = new Map<string, CodexTaskMessage>();
  private readonly knownNativeThreads = new Map<string, CodexNativeThread>();
  private readonly lostNativeThreadIds = new Set<string>();
  private readonly clock: () => Date;
  private readonly bindingWriter?: CodexTaskSessionBindingWriter;

  constructor(
    private readonly client: CodexNativeThreadClient,
    { clock = () => new Date(), bindingWriter }: { clock?: () => Date; bindingWriter?: CodexTaskSessionBindingWriter } = {},
  ) {
    this.clock = clock;
    this.bindingWriter = bindingWriter;
  }

  async listSessions(): Promise<CodexTaskSession[]> {
    const threads = await this.client.listThreads();
    const byId = new Map<string, CodexNativeThread>();
    for (const thread of this.knownNativeThreads.values()) byId.set(thread.id, thread);
    for (const thread of threads) byId.set(thread.id, thread);
    return [...byId.values()].map((thread) => this.threadToSession(thread)).sort((left, right) => left.id.localeCompare(right.id));
  }

  async getSession(taskSessionId: string): Promise<CodexTaskSession | undefined> {
    const sessions = await this.listSessions();
    const listed = sessions.find((session) => session.id === taskSessionId);
    if (listed) return listed;

    const nativeThreadId = nativeThreadIdFromTaskSessionId(taskSessionId);
    if (!nativeThreadId) return undefined;

    try {
      const thread = await this.client.getThread(nativeThreadId);
      if (thread) {
        this.knownNativeThreads.set(nativeThreadId, thread);
        return this.threadToSession(thread);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isThreadNotFoundError(message, nativeThreadId)) {
        this.lostNativeThreadIds.add(nativeThreadId);
      }
    }

    const taskId = await this.resolveKnownTaskIdForNativeThread(nativeThreadId);
    if (!taskId) return undefined;
    this.lostNativeThreadIds.add(nativeThreadId);
    return this.threadToSession({
      id: nativeThreadId,
      task_id: taskId,
      status: "stopped",
    });
  }

  async sendFollowupMessage(input: {
    task_session_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
  }): Promise<CodexTaskMessage> {
    const existing = this.messagesByIdempotencyKey.get(input.idempotency_key);
    if (existing) return existing;

    const now = this.clock().toISOString();
    const session = await this.getSession(input.task_session_id);
    if (!session) {
      const nativeThreadId = nativeThreadIdFromTaskSessionId(input.task_session_id);
      if (nativeThreadId) {
        this.lostNativeThreadIds.add(nativeThreadId);
        return this.recordMessage({
          ...input,
          now,
          nativeThreadId,
          status: "failed",
          evidenceTitle: `Codex native thread lost: ${nativeThreadId}`,
          error: `Codex native thread lost: ${nativeThreadId}`,
        });
      }
      return this.recordMessage({
        ...input,
        now,
        status: "blocked",
        evidenceTitle: "Codex native thread missing",
        error: "Codex native thread missing",
      });
    }
    if (session.status === "lost") {
      return this.recordMessage({
        ...input,
        now,
        nativeThreadId: session.native_thread_id,
        status: "failed",
        evidenceTitle: `Codex native thread lost: ${session.native_thread_id}`,
        error: `Codex native thread lost: ${session.native_thread_id}`,
      });
    }

    try {
      const turn = await this.client.startTurn({
        thread_id: session.native_thread_id,
        text: input.text,
        event_ids: input.event_ids,
        idempotency_key: input.idempotency_key,
      });
      return this.recordMessage({
        ...input,
        now,
        nativeThreadId: session.native_thread_id,
        nativeTurnId: turn.id,
        status: turn.status === "blocked" || turn.status === "failed" ? turn.status : "sent",
        evidenceTitle: "Codex native thread turn started",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isThreadNotFoundError(message, session.native_thread_id)) {
        this.lostNativeThreadIds.add(session.native_thread_id);
      }
      return this.recordMessage({
        ...input,
        now,
        nativeThreadId: session.native_thread_id,
        status: "failed",
        evidenceTitle: `Codex native thread turn failed: ${message}`,
        error: message,
      });
    }
  }

  async startTaskSession(input: {
    task_id: string;
    prompt: string;
    cwd?: string;
    model?: string;
    idempotency_key: string;
  }): Promise<{
    ok: boolean;
    task_session_id?: string;
    task_id: string;
    session?: CodexTaskSession;
    message?: CodexTaskMessage;
    error?: string;
  }> {
    if (!this.client.startThread) {
      return {
        ok: false,
        task_id: input.task_id,
        error: "Codex native thread client does not support thread start",
      };
    }

    try {
      const thread = await this.client.startThread({
        task_id: input.task_id,
        cwd: input.cwd,
        model: input.model,
      });
      await this.bindingWriter?.bindThreadToTask(thread.id, input.task_id);
      this.knownNativeThreads.set(thread.id, {
        ...thread,
        task_id: input.task_id,
        cwd: thread.cwd ?? input.cwd,
        status: thread.status ?? "idle",
      });
      const session = this.threadToSession({
        ...thread,
        task_id: input.task_id,
        cwd: thread.cwd ?? input.cwd,
      });
      const now = this.clock().toISOString();
      const turn = await this.client.startTurn({
        thread_id: session.native_thread_id,
        text: input.prompt,
        event_ids: [],
        idempotency_key: input.idempotency_key,
      });
      const message = this.recordMessage({
        task_session_id: session.id,
        text: input.prompt,
        event_ids: [],
        idempotency_key: input.idempotency_key,
        now,
        nativeThreadId: session.native_thread_id,
        nativeTurnId: turn.id,
        status: turn.status === "blocked" || turn.status === "failed" ? turn.status : "sent",
        evidenceTitle: "Codex native thread started",
      });
      return {
        ok: message.status === "sent",
        task_session_id: session.id,
        task_id: input.task_id,
        session,
        message,
        error: message.status === "sent" ? undefined : message.evidence[0]?.title,
      };
    } catch (error) {
      return {
        ok: false,
        task_id: input.task_id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async bindTaskSession(input: { task_session_id: string; task_id: string; terminal_ref?: string }): Promise<{
    ok: boolean;
    task_session_id: string;
    task_id: string;
    native_thread_id?: string;
    session?: CodexTaskSession;
    error?: string;
  }> {
    if (!this.bindingWriter) {
      return {
        ok: false,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
        error: "Codex task binding writer is not configured",
      };
    }

    const session = await this.getSession(input.task_session_id);
    if (!session) {
      return {
        ok: false,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
        error: `task session ${input.task_session_id} was not found`,
      };
    }

    await this.bindingWriter.bindThreadToTask(session.native_thread_id, input.task_id, input.terminal_ref);
    return {
      ok: true,
      task_session_id: input.task_session_id,
      task_id: input.task_id,
      native_thread_id: session.native_thread_id,
      session: {
        ...session,
        task_id: input.task_id,
      },
    };
  }

  private threadToSession(thread: CodexNativeThread): CodexTaskSession {
    const createdAt = timestampFromThread(thread.created_at, thread.createdAt);
    const updatedAt = timestampFromThread(thread.updated_at, thread.updatedAt) ?? createdAt;
    return {
      id: taskSessionIdForNativeThread(thread.id),
      task_id: thread.task_id,
      provider: "codex",
      native_thread_id: thread.id,
      name: thread.name ?? undefined,
      preview: thread.preview,
      cwd: thread.cwd,
      status: this.lostNativeThreadIds.has(thread.id) ? "lost" : taskSessionStatusForCodexThread(thread.status),
      supports: {
        steer: true,
        followup: true,
        collect: true,
        interrupt: true,
        compact: true,
      },
      last_seen_at: updatedAt,
      created_at: createdAt,
      updated_at: updatedAt,
      ...pidFields(thread),
    };
  }

  private async resolveKnownTaskIdForNativeThread(threadId: string): Promise<string | undefined> {
    return this.knownNativeThreads.get(threadId)?.task_id ?? await this.client.taskIdForThreadId?.(threadId);
  }

  private recordMessage(input: {
    task_session_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
    now: string;
    nativeThreadId?: string;
    nativeTurnId?: string;
    status: CodexTaskMessage["status"];
    evidenceTitle: string;
    error?: string;
  }): CodexTaskMessage {
    const message: CodexTaskMessage = {
      id: `codex_task_msg_${stableId(input.idempotency_key)}`,
      task_session_id: input.task_session_id,
      provider: "codex",
      native_thread_id: input.nativeThreadId,
      native_turn_id: input.nativeTurnId,
      mode: "followup",
      text: input.text,
      event_ids: input.event_ids,
      idempotency_key: input.idempotency_key,
      sent_at: input.status === "sent" ? input.now : undefined,
      status: input.status,
      error: input.error,
      evidence: [
        {
          id: `ev_codex_task_msg_${stableId(input.idempotency_key)}`,
          kind: "raw",
          title: input.evidenceTitle,
          ref: input.nativeThreadId ?? input.task_session_id,
          captured_at: input.now,
        },
      ],
    };
    this.messages.set(message.id, message);
    this.messagesByIdempotencyKey.set(message.idempotency_key, message);
    return message;
  }
}

export function taskSessionIdForNativeThread(threadId: string): string {
  return `codex_thread_${Buffer.from(threadId).toString("base64url")}`;
}

export function nativeThreadIdFromTaskSessionId(taskSessionId: string): string | undefined {
  if (!taskSessionId.startsWith("codex_thread_")) return undefined;
  const encoded = taskSessionId.slice("codex_thread_".length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

function taskSessionStatusForCodexThread(status: string | undefined): CodexTaskSession["status"] {
  const normalized = status?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return "idle";
  if (normalized === "running" || normalized === "idle" || normalized === "blocked" || normalized === "stopped" || normalized === "lost") {
    return normalized;
  }
  if (normalized === "closed" || normalized === "archived") return "stopped";
  if (normalized.includes("lost")) return "lost";
  const agentStatus = normalizeAgentRunStatus(normalized);
  if (agentStatus === "blocked" || agentStatus === "waiting_approval") return agentStatus;
  return "idle";
}

function timestampFromThread(iso: string | undefined, unixSeconds: number | undefined): string {
  if (iso) return iso;
  if (typeof unixSeconds === "number" && Number.isFinite(unixSeconds)) {
    return new Date(unixSeconds * 1000).toISOString();
  }
  return new Date(0).toISOString();
}

function pidFields(input: {
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
}): Pick<CodexTaskSession, "pid" | "agent_pid" | "terminal_pid" | "root_pid" | "pids"> {
  return normalizeTaskSessionPidFields(input);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function isThreadNotFoundError(message: string, threadId: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("thread not found") && normalized.includes(threadId.toLowerCase());
}
