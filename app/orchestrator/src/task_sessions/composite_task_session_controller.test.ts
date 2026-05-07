import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompositeTaskSessionController } from "./composite_task_session_controller.js";
import type { TaskFollowupInput, TaskSessionController } from "./types.js";

describe("CompositeTaskSessionController", () => {
  it("lists and looks up sessions across runtimes", async () => {
    const controller = new CompositeTaskSessionController([
      {
        name: "codex",
        controller: fakeController({
          sessions: [{ id: "task_session_codex_blog", task_id: "task_blog", provider: "codex" }],
        }),
      },
      {
        name: "claude",
        controller: fakeController({
          sessions: [{ id: "task_session_claude_email", task_id: "task_email", provider: "claude" }],
        }),
      },
    ]);

    assert.deepEqual((await controller.listSessions()).map((session) => (session as { id: string }).id), [
      "task_session_claude_email",
      "task_session_codex_blog",
    ]);
    assert.deepEqual(await controller.getSession("task_session_codex_blog"), {
      id: "task_session_codex_blog",
      task_id: "task_blog",
      provider: "codex",
    });
    assert.equal(await controller.getSession("missing"), undefined);
  });

  it("routes followups and bindings to the owning runtime", async () => {
    const codex = fakeController({
      sessions: [{ id: "task_session_codex_blog", task_id: "task_blog", provider: "codex" }],
      supportsBinding: true,
    });
    const claude = fakeController({
      sessions: [{ id: "task_session_claude_email", task_id: "task_email", provider: "claude" }],
    });
    const controller = new CompositeTaskSessionController([
      { name: "codex", controller: codex },
      { name: "claude", controller: claude },
    ]);

    assert.deepEqual(await controller.sendFollowupMessage({
      task_session_id: "task_session_claude_email",
      text: "new info",
      event_ids: ["evt_1"],
      idempotency_key: "idem_1",
    }), {
      runtime: "task_session_claude_email",
      status: "sent",
      text: "new info",
    });
    assert.deepEqual(claude.sentInputs.map((input) => input.idempotency_key), ["idem_1"]);
    assert.deepEqual(codex.sentInputs, []);

    assert.deepEqual(await controller.bindTaskSession({
      task_session_id: "task_session_codex_blog",
      task_id: "task_new",
    }), {
      ok: true,
      task_session_id: "task_session_codex_blog",
      task_id: "task_new",
    });
    assert.deepEqual(codex.bindInputs, [{ task_session_id: "task_session_codex_blog", task_id: "task_new" }]);
  });

  it("blocks unknown sessions without sending to another runtime", async () => {
    const codex = fakeController({
      sessions: [{ id: "task_session_codex_blog", task_id: "task_blog", provider: "codex" }],
    });
    const controller = new CompositeTaskSessionController([{ name: "codex", controller: codex }]);

    const result = await controller.sendFollowupMessage({
      task_session_id: "missing",
      text: "new info",
      event_ids: [],
      idempotency_key: "idem_missing",
    }) as Record<string, unknown>;

    assert.equal(result.status, "blocked");
    assert.match(String(result.error), /missing/);
    assert.deepEqual(codex.sentInputs, []);
  });
});

function fakeController(options: {
  sessions: Array<Record<string, unknown>>;
  supportsBinding?: boolean;
}): TaskSessionController & {
  sentInputs: TaskFollowupInput[];
  bindInputs: Array<{ task_session_id: string; task_id: string }>;
} {
  const sentInputs: TaskFollowupInput[] = [];
  const bindInputs: Array<{ task_session_id: string; task_id: string }> = [];
  const controller: TaskSessionController & {
    sentInputs: TaskFollowupInput[];
    bindInputs: Array<{ task_session_id: string; task_id: string }>;
  } = {
    sentInputs,
    bindInputs,
    listSessions: () => options.sessions,
    getSession: (taskSessionId) => options.sessions.find((session) => session.id === taskSessionId),
    sendFollowupMessage: (input) => {
      sentInputs.push(input);
      return {
        runtime: input.task_session_id,
        status: "sent",
        text: input.text,
      };
    },
  };
  if (options.supportsBinding) {
    controller.bindTaskSession = (input) => {
      bindInputs.push(input);
      return {
        ok: true,
        task_session_id: input.task_session_id,
        task_id: input.task_id,
      };
    };
  }
  return controller;
}
