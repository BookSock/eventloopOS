import type { GatewayStore } from "../gateway_store.js";
import type {
  TaskFollowupInput,
  TaskRuntimeBinding,
  TaskRuntimeMessage,
  TaskRuntimeSession,
  TaskRuntimeStart,
  TaskSessionController,
} from "./types.js";

export type PersistentTerminalRefControllerOptions = {
  inner: TaskSessionController;
  store: Pick<GatewayStore, "getTaskSessionTerminalRef" | "setTaskSessionTerminalRef">;
  now?: () => Date;
  terminalRefTimeoutMs?: number;
};

export class PersistentTerminalRefController implements TaskSessionController {
  private readonly inner: TaskSessionController;
  private readonly store: Pick<GatewayStore, "getTaskSessionTerminalRef" | "setTaskSessionTerminalRef">;
  private readonly now: () => Date;
  private readonly terminalRefTimeoutMs: number;

  constructor(options: PersistentTerminalRefControllerOptions) {
    this.inner = options.inner;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.terminalRefTimeoutMs = options.terminalRefTimeoutMs ?? 1_000;
  }

  async listSessions(): Promise<TaskRuntimeSession[]> {
    if (!this.inner.listSessions) return [];
    const sessions = await this.inner.listSessions();
    return Promise.all(sessions.map((session) => this.hydrateSession(session)));
  }

  async getSession(taskSessionId: string): Promise<TaskRuntimeSession | undefined> {
    if (!this.inner.getSession) return undefined;
    const session = await this.inner.getSession(taskSessionId);
    if (!session) return session;
    return this.hydrateSession(session);
  }

  async startTaskSession(input: {
    task_id: string;
    prompt: string;
    cwd?: string;
    model?: string;
    idempotency_key: string;
  }): Promise<TaskRuntimeStart> {
    if (!this.inner.startTaskSession) {
      return { ok: false, task_id: input.task_id, error: "task runtime does not support session start" };
    }
    const result = await this.inner.startTaskSession(input);
    if (result.session) {
      result.session = await this.hydrateSession(result.session);
    }
    return result;
  }

  sendFollowupMessage(input: TaskFollowupInput): Promise<TaskRuntimeMessage> | TaskRuntimeMessage {
    return this.inner.sendFollowupMessage(input);
  }

  async bindTaskSession(input: { task_session_id: string; task_id: string; terminal_ref?: string }): Promise<TaskRuntimeBinding> {
    if (!this.inner.bindTaskSession) {
      return {
        ok: false,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
        error: `task session ${input.task_session_id} does not support task binding`,
      };
    }
    const binding = await this.inner.bindTaskSession(input);
    if (binding.ok && input.terminal_ref) {
      await bestEffortWithTimeout(
        this.store.setTaskSessionTerminalRef(input.task_session_id, input.terminal_ref, this.now()),
        this.terminalRefTimeoutMs,
      );
    }
    if (binding.session) {
      binding.session = await this.hydrateSession(binding.session);
    }
    return binding;
  }

  private async hydrateSession(session: TaskRuntimeSession): Promise<TaskRuntimeSession> {
    if (typeof session.terminal_ref === "string" && session.terminal_ref) return session;
    const id = typeof session.id === "string" ? session.id : undefined;
    if (!id) return session;
    const stored = await bestEffortWithTimeout(this.store.getTaskSessionTerminalRef(id), this.terminalRefTimeoutMs);
    if (!stored) return session;
    return { ...session, terminal_ref: stored.terminal_ref };
  }
}

async function bestEffortWithTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T | undefined> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
