import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CodexNativeThreadController,
  nativeThreadIdFromTaskSessionId,
  taskSessionIdForNativeThread,
  type CodexNativeThread,
  type CodexNativeThreadClient,
} from "./codex_native_thread_controller.js";

describe("CodexNativeThreadController", () => {
  it("maps native Codex threads to routable task sessions", async () => {
    const controller = new CodexNativeThreadController(fakeClient({
      threads: [
        {
          id: "thread_blog_123",
          task_id: "task_blog_feedback",
          status: "running",
          name: "Blog feedback",
          preview: "Revise launch blog",
          cwd: "/repo",
          created_at: "2026-01-01T17:00:00.000Z",
          updated_at: "2026-01-01T18:00:00.000Z",
          pid: 410,
          agent_pid: 411,
          terminal_pid: 409,
          root_pid: 400,
          pids: [410, 411],
        },
      ],
    }));

    const sessions = await controller.listSessions();

    assert.deepEqual(sessions, [
      {
        id: taskSessionIdForNativeThread("thread_blog_123"),
        task_id: "task_blog_feedback",
        provider: "codex",
        native_thread_id: "thread_blog_123",
        name: "Blog feedback",
        preview: "Revise launch blog",
        cwd: "/repo",
        status: "running",
        supports: {
          steer: true,
          followup: true,
          collect: true,
          interrupt: true,
          compact: true,
        },
        last_seen_at: "2026-01-01T18:00:00.000Z",
        created_at: "2026-01-01T17:00:00.000Z",
        updated_at: "2026-01-01T18:00:00.000Z",
        pid: 410,
        agent_pid: 411,
        terminal_pid: 409,
        root_pid: 400,
        pids: [410, 411],
      },
    ]);
  });

  it("starts turns and dedupes followup messages by idempotency key", async () => {
    const starts: unknown[] = [];
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [{ id: "thread_blog_123", task_id: "task_blog_feedback" }],
        startTurn(input) {
          starts.push(input);
          return { id: "turn_1", status: "queued" };
        },
      }),
      { clock: () => new Date("2026-05-06T22:30:00.000Z") },
    );
    const sessionId = taskSessionIdForNativeThread("thread_blog_123");

    const first = await controller.sendFollowupMessage({
      task_session_id: sessionId,
      text: "Use launch date in next blog draft.",
      event_ids: ["evt_voice_blog"],
      idempotency_key: "inject_voice_blog",
    });
    const duplicate = await controller.sendFollowupMessage({
      task_session_id: sessionId,
      text: "Different retry payload should dedupe.",
      event_ids: [],
      idempotency_key: "inject_voice_blog",
    });

    assert.equal(first.status, "sent");
    assert.equal(first.provider, "codex");
    assert.equal(first.native_thread_id, "thread_blog_123");
    assert.equal(first.native_turn_id, "turn_1");
    assert.equal(first.sent_at, "2026-05-06T22:30:00.000Z");
    assert.equal(duplicate, first);
    assert.deepEqual(starts, [
      {
        thread_id: "thread_blog_123",
        text: "Use launch date in next blog draft.",
        event_ids: ["evt_voice_blog"],
        idempotency_key: "inject_voice_blog",
      },
    ]);
  });

  it("decodes task session ids back to native thread ids", () => {
    assert.equal(nativeThreadIdFromTaskSessionId(taskSessionIdForNativeThread("thread_blog_123")), "thread_blog_123");
    assert.equal(nativeThreadIdFromTaskSessionId("terminal_session_123"), undefined);
  });

  it("returns blocked when a non-Codex task session no longer maps to a native thread", async () => {
    const controller = new CodexNativeThreadController(fakeClient({ threads: [] }), {
      clock: () => new Date("2026-05-06T22:30:00.000Z"),
    });

    const message = await controller.sendFollowupMessage({
      task_session_id: "terminal_session_missing",
      text: "No target.",
      event_ids: [],
      idempotency_key: "inject_missing",
    });

    assert.equal(message.status, "blocked");
    assert.equal(message.sent_at, undefined);
    assert.equal(message.evidence[0]?.title, "Codex native thread missing");
  });

  it("resolves stale Codex task sessions as lost when the task map still knows the task id", async () => {
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [],
        taskIdForThreadId(threadId) {
          return threadId === "missing_thread" ? "task_recovery" : undefined;
        },
      }),
      { clock: () => new Date("2026-05-06T22:30:00.000Z") },
    );
    const sessionId = taskSessionIdForNativeThread("missing_thread");

    const session = await controller.getSession(sessionId);
    const message = await controller.sendFollowupMessage({
      task_session_id: sessionId,
      text: "Recover target.",
      event_ids: [],
      idempotency_key: "inject_lost",
    });

    assert.equal(session?.status, "lost");
    assert.equal(session?.task_id, "task_recovery");
    assert.equal(session?.native_thread_id, "missing_thread");
    assert.equal(message.status, "failed");
    assert.equal(message.error, "Codex native thread lost: missing_thread");
  });

  it("returns failed instead of throwing when native turn start fails", async () => {
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [{ id: "thread_blog_123", task_id: "task_blog_feedback" }],
        startTurn() {
          throw new Error("app-server unavailable");
        },
      }),
      { clock: () => new Date("2026-05-06T22:30:00.000Z") },
    );

    const message = await controller.sendFollowupMessage({
      task_session_id: taskSessionIdForNativeThread("thread_blog_123"),
      text: "Try native thread.",
      event_ids: ["evt_1"],
      idempotency_key: "inject_fail",
    });

    assert.equal(message.status, "failed");
    assert.equal(message.native_thread_id, "thread_blog_123");
    assert.equal(message.sent_at, undefined);
    assert.equal(message.error, "app-server unavailable");
    assert.match(message.evidence[0]?.title ?? "", /app-server unavailable/);
  });

  it("marks app-server forgotten threads as lost after thread-not-found failures", async () => {
    let startTurnCount = 0;
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [{ id: "thread_blog_123", task_id: "task_blog_feedback" }],
        startTurn() {
          startTurnCount += 1;
          throw new Error("thread not found: thread_blog_123");
        },
      }),
      { clock: () => new Date("2026-05-06T22:30:00.000Z") },
    );
    const sessionId = taskSessionIdForNativeThread("thread_blog_123");

    const first = await controller.sendFollowupMessage({
      task_session_id: sessionId,
      text: "Try native thread.",
      event_ids: ["evt_1"],
      idempotency_key: "inject_missing_native_thread",
    });
    const sessions = await controller.listSessions();
    const second = await controller.sendFollowupMessage({
      task_session_id: sessionId,
      text: "Try native thread again.",
      event_ids: ["evt_2"],
      idempotency_key: "inject_missing_native_thread_again",
    });

    assert.equal(first.status, "failed");
    assert.equal(first.error, "thread not found: thread_blog_123");
    assert.equal(sessions[0]?.status, "lost");
    assert.equal(second.status, "failed");
    assert.equal(second.error, "Codex native thread lost: thread_blog_123");
    assert.equal(startTurnCount, 1);
  });

  it("starts a task session then sends the initial prompt", async () => {
    const starts: unknown[] = [];
    const bindings: unknown[] = [];
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [{ id: "thread_new", task_id: "task_new_outreach" }],
        startThread: () => ({
          id: "thread_new",
          task_id: "task_new_outreach",
          status: "idle",
        }),
        startTurn(input) {
          starts.push(input);
          return { id: "turn_new", status: "queued" };
        },
      }),
      {
        clock: () => new Date("2026-05-06T22:30:00.000Z"),
        bindingWriter: {
          bindThreadToTask(threadId, taskId) {
            bindings.push({ threadId, taskId });
          },
        },
      },
    );

    const result = await controller.startTaskSession({
      task_id: "task_new_outreach",
      prompt: "Research prospect and draft DM.",
      idempotency_key: "idem_new_outreach",
    });

    assert.equal(result.ok, true);
    assert.equal(result.task_session_id, taskSessionIdForNativeThread("thread_new"));
    assert.equal(result.message?.status, "sent");
    assert.deepEqual(starts, [
      {
        thread_id: "thread_new",
        text: "Research prospect and draft DM.",
        event_ids: [],
        idempotency_key: "idem_new_outreach",
      },
    ]);
    assert.deepEqual(bindings, [{ threadId: "thread_new", taskId: "task_new_outreach" }]);
  });

  it("keeps newly started threads routable when app-server list omits them", async () => {
    const starts: unknown[] = [];
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [],
        startThread: () => ({
          id: "thread_replacement",
          task_id: "task_new_outreach",
          status: "idle",
        }),
        startTurn(input) {
          starts.push(input);
          return { id: `turn_${starts.length}`, status: "queued" };
        },
      }),
      { clock: () => new Date("2026-05-06T22:30:00.000Z") },
    );

    const result = await controller.startTaskSession({
      task_id: "task_new_outreach",
      prompt: "Recover this task.",
      idempotency_key: "idem_replacement",
    });
    const sessions = await controller.listSessions();
    const followup = await controller.sendFollowupMessage({
      task_session_id: result.task_session_id ?? "",
      text: "Follow up on replacement.",
      event_ids: ["evt_replacement"],
      idempotency_key: "idem_replacement_followup",
    });

    assert.equal(result.task_session_id, taskSessionIdForNativeThread("thread_replacement"));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.task_id, "task_new_outreach");
    assert.equal(followup.status, "sent");
    assert.equal(followup.native_thread_id, "thread_replacement");
    assert.deepEqual(starts, [
      {
        thread_id: "thread_replacement",
        text: "Recover this task.",
        event_ids: [],
        idempotency_key: "idem_replacement",
      },
      {
        thread_id: "thread_replacement",
        text: "Follow up on replacement.",
        event_ids: ["evt_replacement"],
        idempotency_key: "idem_replacement_followup",
      },
    ]);
  });

  it("binds a task session to a task through native thread mapping", async () => {
    const bindings: unknown[] = [];
    const controller = new CodexNativeThreadController(
      fakeClient({
        threads: [{ id: "thread_blog_123", name: "Blog feedback" }],
      }),
      {
        bindingWriter: {
          bindThreadToTask(threadId, taskId) {
            bindings.push({ threadId, taskId });
          },
        },
      },
    );

    const result = await controller.bindTaskSession({
      task_session_id: taskSessionIdForNativeThread("thread_blog_123"),
      task_id: "task_blog_feedback",
    });

    assert.equal(result.ok, true);
    assert.equal(result.native_thread_id, "thread_blog_123");
    assert.equal(result.session?.provider, "codex");
    assert.equal(result.session?.task_id, "task_blog_feedback");
    assert.deepEqual(bindings, [{ threadId: "thread_blog_123", taskId: "task_blog_feedback" }]);
  });

  it("returns binding failure when task session is missing", async () => {
    const controller = new CodexNativeThreadController(fakeClient({ threads: [] }), {
      bindingWriter: {
        bindThreadToTask() {
          throw new Error("should not write");
        },
      },
    });

    const result = await controller.bindTaskSession({
      task_session_id: taskSessionIdForNativeThread("missing_thread"),
      task_id: "task_blog_feedback",
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /was not found/);
  });
});

function fakeClient(input: {
  threads: CodexNativeThread[];
  startThread?: CodexNativeThreadClient["startThread"];
  startTurn?: CodexNativeThreadClient["startTurn"];
  taskIdForThreadId?: CodexNativeThreadClient["taskIdForThreadId"];
}): CodexNativeThreadClient {
  return {
    listThreads() {
      return input.threads;
    },
    getThread(threadId) {
      return input.threads.find((thread) => thread.id === threadId);
    },
    taskIdForThreadId: input.taskIdForThreadId,
    startThread: input.startThread,
    startTurn: input.startTurn ?? (() => ({ id: "turn_default", status: "queued" })),
  };
}
