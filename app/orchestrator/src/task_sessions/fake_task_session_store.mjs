import { isoNow, makeEvidenceRef } from "../agents/local_contracts.mjs";

export class FakeTaskSessionStore {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.sessions = new Map();
    this.messages = new Map();
    this.auditLog = [];
  }

  createSession(input = {}) {
    const now = isoNow(this.clock);
    const id = input.id ?? `task_session_${this.sessions.size + 1}`;
    const session = {
      id,
      task_id: input.task_id,
      provider: input.provider ?? "fake",
      native_thread_id: input.native_thread_id,
      terminal_ref: input.terminal_ref,
      status: input.status ?? "idle",
      supports: {
        steer: false,
        followup: true,
        collect: true,
        interrupt: false,
        compact: false,
        ...(input.supports ?? {}),
      },
      last_seen_at: input.last_seen_at ?? now,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
    };

    this.sessions.set(id, session);
    this.audit("task_session.created", { task_session_id: id });
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  sendFollowupMessage({ task_session_id, text, event_ids = [], idempotency_key }) {
    return this.sendTaskMessage({
      task_session_id,
      mode: "followup",
      text,
      event_ids,
      idempotency_key,
    });
  }

  sendTaskMessage(input) {
    const session = this.sessions.get(input.task_session_id);
    const now = isoNow(this.clock);
    const idempotencyKey =
      input.idempotency_key ?? `fake:${input.task_session_id}:${input.mode}:${input.text}`;

    const existing = [...this.messages.values()].find(
      (message) => message.idempotency_key === idempotencyKey,
    );
    if (existing) {
      this.audit("task_message.deduped", {
        task_session_id: input.task_session_id,
        task_message_id: existing.id,
        idempotency_key: idempotencyKey,
      });
      return existing;
    }

    const status = session ? "sent" : "blocked";
    const message = {
      id: input.id ?? `task_msg_${this.messages.size + 1}`,
      task_session_id: input.task_session_id,
      mode: input.mode,
      text: input.text,
      event_ids: input.event_ids ?? [],
      idempotency_key: idempotencyKey,
      sent_at: status === "sent" ? now : undefined,
      status,
      evidence: [
        makeEvidenceRef({
          id: `ev_task_msg_${this.messages.size + 1}`,
          title: status === "sent" ? "Fake task message sent" : "Fake task message blocked",
          ref: input.task_session_id,
          captured_at: now,
        }),
      ],
    };

    this.messages.set(message.id, message);
    this.audit("task_message.send_stub", {
      task_session_id: input.task_session_id,
      task_message_id: message.id,
      status,
      mode: input.mode,
      event_ids: message.event_ids,
      idempotency_key: idempotencyKey,
    });

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

  audit(type, details) {
    const entry = {
      id: `audit_${this.auditLog.length + 1}`,
      type,
      details,
      occurred_at: isoNow(this.clock),
    };
    this.auditLog.push(entry);
    return entry;
  }
}
