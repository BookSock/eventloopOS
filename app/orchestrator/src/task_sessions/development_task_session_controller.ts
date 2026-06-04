import { normalizeTaskSessionPidFields } from "./pid_fields.js";

export type DevelopmentTaskSession = {
  id: string;
  task_id?: string;
  provider: "fake";
  status: "idle" | "running" | "blocked" | "stopped" | "lost";
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
  terminal_ref?: string;
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
};

export type DevelopmentTaskMessage = {
  id: string;
  task_session_id: string;
  provider: "fake";
  mode: "followup";
  text: string;
  event_ids: string[];
  idempotency_key: string;
  sent_at?: string;
  status: "sent" | "blocked";
  evidence: Array<{
    id: string;
    kind: "raw";
    title: string;
    ref: string;
    captured_at: string;
  }>;
};

export type DevelopmentTaskBinding = {
  ok: boolean;
  task_session_id: string;
  task_id: string;
  session?: DevelopmentTaskSession;
  error?: string;
};

export class DevelopmentTaskSessionController {
  readonly sessions = new Map<string, DevelopmentTaskSession>();
  readonly messages = new Map<string, DevelopmentTaskMessage>();
  readonly messagesByIdempotencyKey = new Map<string, DevelopmentTaskMessage>();
  private readonly clock: () => Date;

  constructor({ clock = () => new Date() }: { clock?: () => Date } = {}) {
    this.clock = clock;
  }

  seedSession(input: {
    id: string;
    task_id?: string;
    status?: DevelopmentTaskSession["status"];
    terminal_ref?: string;
    pid?: number;
    agent_pid?: number;
    terminal_pid?: number;
    root_pid?: number;
    pids?: number[];
  }): DevelopmentTaskSession {
    const now = this.clock().toISOString();
    const session: DevelopmentTaskSession = {
      id: input.id,
      task_id: input.task_id,
      provider: "fake",
      status: input.status ?? "idle",
      supports: {
        steer: false,
        followup: true,
        collect: true,
        interrupt: false,
        compact: false,
      },
      last_seen_at: now,
      created_at: now,
      updated_at: now,
      ...(input.terminal_ref !== undefined ? { terminal_ref: input.terminal_ref } : {}),
      ...normalizeTaskSessionPidFields(input),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  listSessions(): DevelopmentTaskSession[] {
    return Array.from(this.sessions.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  getSession(taskSessionId: string): DevelopmentTaskSession | undefined {
    return this.sessions.get(taskSessionId);
  }

  startTaskSession(input: {
    task_id: string;
    prompt: string;
    idempotency_key: string;
  }): {
    ok: boolean;
    task_session_id: string;
    task_id: string;
    session: DevelopmentTaskSession;
    message: DevelopmentTaskMessage;
  } {
    const session = this.seedSession({
      id: `task_session_${stableId(input.task_id)}`,
      task_id: input.task_id,
      status: "idle",
    });
    const message = this.sendFollowupMessage({
      task_session_id: session.id,
      text: input.prompt,
      event_ids: [],
      idempotency_key: input.idempotency_key,
    });
    return {
      ok: true,
      task_session_id: session.id,
      task_id: input.task_id,
      session,
      message,
    };
  }

  sendFollowupMessage(input: {
    task_session_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
  }): DevelopmentTaskMessage {
    const existing = this.messagesByIdempotencyKey.get(input.idempotency_key);
    if (existing) return existing;

    const now = this.clock().toISOString();
    const session = this.sessions.get(input.task_session_id);
    const status = session ? "sent" : "blocked";
    const message: DevelopmentTaskMessage = {
      id: `task_msg_${stableId(input.idempotency_key)}`,
      task_session_id: input.task_session_id,
      provider: "fake",
      mode: "followup",
      text: input.text,
      event_ids: input.event_ids,
      idempotency_key: input.idempotency_key,
      sent_at: status === "sent" ? now : undefined,
      status,
      evidence: [
        {
          id: `ev_task_msg_${stableId(input.idempotency_key)}`,
          kind: "raw",
          title: status === "sent" ? "Development task message sent" : "Development task message blocked",
          ref: input.task_session_id,
          captured_at: now,
        },
      ],
    };

    this.messages.set(message.id, message);
    this.messagesByIdempotencyKey.set(message.idempotency_key, message);

    if (session) {
      this.sessions.set(session.id, {
        ...session,
        status: "running",
        last_seen_at: now,
        updated_at: now,
      });
    }

    return message;
  }

  bindTaskSession(input: { task_session_id: string; task_id: string; terminal_ref?: string }): DevelopmentTaskBinding {
    const session = this.sessions.get(input.task_session_id);
    if (!session) {
      return {
        ok: false,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
        error: `task session ${input.task_session_id} was not found`,
      };
    }

    const now = this.clock().toISOString();
    const updated = {
      ...session,
      task_id: input.task_id,
      last_seen_at: now,
      updated_at: now,
      ...(input.terminal_ref !== undefined ? { terminal_ref: input.terminal_ref } : {}),
    };
    this.sessions.set(updated.id, updated);
    return {
      ok: true,
      task_session_id: input.task_session_id,
      task_id: input.task_id,
      session: updated,
    };
  }
}

export function createSeededDevelopmentTaskSessions(clock?: () => Date): DevelopmentTaskSessionController {
  const controller = new DevelopmentTaskSessionController({ clock });
  controller.seedSession({
    id: "task_session_blog",
    task_id: "task_blog_feedback",
  });
  return controller;
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
