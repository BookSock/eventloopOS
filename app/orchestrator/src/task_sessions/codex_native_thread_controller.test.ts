import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CodexNativeThreadController,
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

  it("returns blocked when task session no longer maps to a native thread", async () => {
    const controller = new CodexNativeThreadController(fakeClient({ threads: [] }), {
      clock: () => new Date("2026-05-06T22:30:00.000Z"),
    });

    const message = await controller.sendFollowupMessage({
      task_session_id: taskSessionIdForNativeThread("missing_thread"),
      text: "No target.",
      event_ids: [],
      idempotency_key: "inject_missing",
    });

    assert.equal(message.status, "blocked");
    assert.equal(message.sent_at, undefined);
    assert.equal(message.evidence[0]?.title, "Codex native thread missing");
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
    assert.match(message.evidence[0]?.title ?? "", /app-server unavailable/);
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
  startTurn?: CodexNativeThreadClient["startTurn"];
}): CodexNativeThreadClient {
  return {
    listThreads() {
      return input.threads;
    },
    getThread(threadId) {
      return input.threads.find((thread) => thread.id === threadId);
    },
    startTurn: input.startTurn ?? (() => ({ id: "turn_default", status: "queued" })),
  };
}
