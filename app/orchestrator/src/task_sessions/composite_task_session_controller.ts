import type { TaskFollowupInput, TaskSessionController } from "./types.js";

export type CompositeTaskSessionRuntime = {
  name: string;
  controller: TaskSessionController;
};

export class CompositeTaskSessionController implements TaskSessionController {
  constructor(private readonly runtimes: CompositeTaskSessionRuntime[]) {}

  async listSessions(): Promise<unknown[]> {
    const lists = await Promise.all(
      this.runtimes.map(async (runtime) => runtime.controller.listSessions ? await runtime.controller.listSessions() : []),
    );
    return lists.flat().sort((left, right) => sessionSortKey(left).localeCompare(sessionSortKey(right)));
  }

  async getSession(taskSessionId: string): Promise<unknown | undefined> {
    return (await this.ownerForSession(taskSessionId))?.session;
  }

  async sendFollowupMessage(input: TaskFollowupInput): Promise<unknown> {
    const owner = await this.ownerForSession(input.task_session_id);
    if (!owner) {
      return blockedTaskMessage(input, `task session ${input.task_session_id} was not found`);
    }
    return owner.runtime.controller.sendFollowupMessage(input);
  }

  async bindTaskSession(input: { task_session_id: string; task_id: string }): Promise<unknown> {
    const owner = await this.ownerForSession(input.task_session_id);
    if (!owner) {
      return {
        ok: false,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
        error: `task session ${input.task_session_id} was not found`,
      };
    }
    if (!owner.runtime.controller.bindTaskSession) {
      return {
        ok: false,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
        error: `task session ${input.task_session_id} does not support task binding`,
      };
    }
    return owner.runtime.controller.bindTaskSession(input);
  }

  private async ownerForSession(taskSessionId: string): Promise<{
    runtime: CompositeTaskSessionRuntime;
    session: unknown;
  } | undefined> {
    for (const runtime of this.runtimes) {
      if (runtime.controller.getSession) {
        const session = await runtime.controller.getSession(taskSessionId);
        if (session) return { runtime, session };
        continue;
      }

      if (!runtime.controller.listSessions) continue;
      const session = (await runtime.controller.listSessions()).find((candidate) => sessionId(candidate) === taskSessionId);
      if (session) return { runtime, session };
    }
    return undefined;
  }
}

function sessionId(session: unknown): string | undefined {
  if (!session || typeof session !== "object" || Array.isArray(session)) return undefined;
  const id = (session as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function sessionSortKey(session: unknown): string {
  return sessionId(session) ?? "";
}

function blockedTaskMessage(input: TaskFollowupInput, error: string): Record<string, unknown> {
  return {
    id: `composite_task_msg_${stableId(input.idempotency_key)}`,
    task_session_id: input.task_session_id,
    mode: "followup",
    text: input.text,
    event_ids: input.event_ids,
    idempotency_key: input.idempotency_key,
    status: "blocked",
    error,
    evidence: [
      {
        id: `ev_composite_task_msg_${stableId(input.idempotency_key)}`,
        kind: "raw",
        title: "Composite task session followup blocked",
        ref: input.task_session_id,
        captured_at: new Date(0).toISOString(),
      },
    ],
  };
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
