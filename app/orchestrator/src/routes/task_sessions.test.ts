import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import { createInMemoryObservability } from "../observability.js";
import { createRuntime } from "../runtime.js";
import type { InMemoryStore } from "../store.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import { handleStartTaskSessionRoute, handleTaskFollowupRoute, handleTaskSessionReplacementRoute } from "./task_sessions.js";

describe("task session routes", () => {
  it("persists task start messages and dedupes retried starts", async () => {
    let startCount = 0;
    const taskSessions: TaskSessionController = {
      startTaskSession(input) {
        startCount += 1;
        return {
          ok: true,
          task_id: input.task_id,
          task_session_id: "codex_thread_abc",
          session: {
            id: "codex_thread_abc",
            task_id: input.task_id,
            provider: "codex",
            native_thread_id: "native_thread_abc",
          },
          message: {
            id: "codex_task_msg_abc",
            task_session_id: "codex_thread_abc",
            mode: "followup",
            text: input.prompt,
            event_ids: [],
            idempotency_key: input.idempotency_key,
            status: "sent",
            provider: "codex",
            native_thread_id: "native_thread_abc",
            native_turn_id: "native_turn_abc",
          },
        };
      },
      sendFollowupMessage() {
        throw new Error("sendFollowupMessage must not be called");
      },
    };
    const store = createInMemoryGatewayStore(emptyStore());
    const runtime = createRuntime({
      store,
      taskSessions,
      observability: createInMemoryObservability(),
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });
    const request = {
      runtime,
      body: {
        task_id: "task_lab_live_postgres",
        prompt: "Reply exactly READY",
        idempotency_key: "idem_start_lab_live_postgres",
      },
      now: new Date("2026-06-01T12:00:00.000Z"),
      requestId: "req_start",
    };

    const first = await handleStartTaskSessionRoute(request);
    const duplicate = await handleStartTaskSessionRoute({
      ...request,
      requestId: "req_start_duplicate",
    });
    const messages = await store.listTaskMessages({ idempotency_key: "idem_start_lab_live_postgres" });

    assert.equal(first.status, 202);
    assert.equal(duplicate.status, 202);
    assert.equal(first.ok, true);
    assert.equal(duplicate.ok, true);
    assert.equal(startCount, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, "task_session_start");
    assert.equal(messages[0].task_id, "task_lab_live_postgres");
    assert.equal(messages[0].task_session_id, "codex_thread_abc");
    assert.equal(messages[0].status, "sent");
    assert.equal(messages[0].text_length, "Reply exactly READY".length);
    assert.equal(messages[0].provider, "codex");
    assert.equal(messages[0].native_thread_id, "native_thread_abc");
    assert.equal(messages[0].native_turn_id, "native_turn_abc");
    assert.equal(messages[0].message.text, undefined);
    assert.equal(((first.body.task_message as Record<string, unknown>).text), undefined);
    assert.equal(((duplicate.body.started as Record<string, unknown>).deduped), true);
  });

  it("persists direct task followups with the session task id", async () => {
    const taskSessions: TaskSessionController = {
      getSession(taskSessionId) {
        return {
          id: taskSessionId,
          task_id: "task_lab_live_postgres_fixed",
          provider: "codex",
        };
      },
      sendFollowupMessage(input) {
        return {
          id: "codex_task_msg_followup",
          task_session_id: input.task_session_id,
          mode: "followup",
          text: input.text,
          event_ids: input.event_ids,
          idempotency_key: input.idempotency_key,
          status: "sent",
          provider: "codex",
          native_thread_id: "native_thread_abc",
          native_turn_id: "native_turn_followup",
        };
      },
    };
    const store = createInMemoryGatewayStore(emptyStore());
    const runtime = createRuntime({
      store,
      taskSessions,
      observability: createInMemoryObservability(),
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    const result = await handleTaskFollowupRoute({
      runtime,
      taskSessionId: "codex_thread_abc",
      body: {
        text: "Reply exactly FOLLOWUP_READY",
        event_ids: ["evt_lab_followup"],
        idempotency_key: "idem_followup_lab",
      },
      occurredAt: "2026-06-01T12:00:00.000Z",
      requestId: "req_followup",
    });
    const messages = await store.listTaskMessages({ task_id: "task_lab_live_postgres_fixed" });

    assert.equal(result.status, 202);
    assert.equal(result.ok, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, "task_session_api");
    assert.equal(messages[0].task_id, "task_lab_live_postgres_fixed");
    assert.deepEqual(messages[0].event_ids, ["evt_lab_followup"]);
    assert.equal(messages[0].message.text, undefined);
  });

  it("persists runtime failed followups as failed instead of sent", async () => {
    const taskSessions: TaskSessionController = {
      getSession(taskSessionId) {
        return {
          id: taskSessionId,
          task_id: "task_lab_live_postgres_fixed",
          provider: "codex",
        };
      },
      sendFollowupMessage(input) {
        return {
          id: "codex_task_msg_failed_followup",
          task_session_id: input.task_session_id,
          mode: "followup",
          text: input.text,
          event_ids: input.event_ids,
          idempotency_key: input.idempotency_key,
          status: "failed",
          provider: "codex",
          native_thread_id: "native_thread_abc",
          error: "thread not found: native_thread_abc",
        };
      },
    };
    const observability = createInMemoryObservability();
    const store = createInMemoryGatewayStore(emptyStore());
    const runtime = createRuntime({
      store,
      taskSessions,
      observability,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    const result = await handleTaskFollowupRoute({
      runtime,
      taskSessionId: "codex_thread_abc",
      body: {
        text: "Reply exactly FOLLOWUP_READY",
        event_ids: ["evt_lab_failed_followup"],
        idempotency_key: "idem_failed_followup_lab",
      },
      occurredAt: "2026-06-01T12:00:00.000Z",
      requestId: "req_failed_followup",
    });
    const messages = await store.listTaskMessages({ task_id: "task_lab_live_postgres_fixed" });
    const activity = await observability.listActivity({ limit: 5 });

    assert.equal(result.status, 202);
    assert.equal(result.ok, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].status, "failed");
    assert.equal(messages[0].sent_at, undefined);
    assert.equal(messages[0].error, "thread not found: native_thread_abc");
    assert.equal(
      (result.body.message as Record<string, unknown>).recovery_hint,
      "Codex thread is stale. Replace or rebind the task session, then send the followup again.",
    );
    assert.equal(activity[0].type, "task_followup_failed");
    assert.equal(activity[0].status, "failed");
  });

  it("records failed followups when task session lookup fails before send", async () => {
    const taskSessions: TaskSessionController = {
      getSession() {
        throw new Error("Codex app-server stream is closed");
      },
      sendFollowupMessage() {
        throw new Error("Codex app-server stream is closed");
      },
    };
    const observability = createInMemoryObservability();
    const store = createInMemoryGatewayStore(emptyStore());
    const runtime = createRuntime({
      store,
      taskSessions,
      observability,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    const result = await handleTaskFollowupRoute({
      runtime,
      taskSessionId: "codex_thread_closed",
      body: {
        text: "Reply exactly FOLLOWUP_READY",
        event_ids: ["evt_lab_closed_followup"],
        idempotency_key: "idem_closed_followup_lab",
      },
      occurredAt: "2026-06-01T12:00:00.000Z",
      requestId: "req_closed_followup",
    });
    const messages = await store.listTaskMessages({ idempotency_key: "idem_closed_followup_lab" });
    const activity = await observability.listActivity({ limit: 5 });

    assert.equal(result.status, 202);
    assert.equal(result.ok, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].task_session_id, "codex_thread_closed");
    assert.equal(messages[0].status, "failed");
    assert.equal(messages[0].error, "Codex app-server stream is closed");
    assert.equal(
      (result.body.message as Record<string, unknown>).recovery_hint,
      "Codex app-server is unavailable. Restart dogfood stack or Codex app-server, then retry followup.",
    );
    assert.equal(activity[0].type, "task_followup_failed");
    assert.equal(activity[0].status, "failed");
    assert.equal(activity[0].summary, "Task followup failed: codex_thread_closed");
  });

  it("starts replacement sessions for lost task sessions", async () => {
    const taskSessions: TaskSessionController = {
      getSession(taskSessionId) {
        return {
          id: taskSessionId,
          task_id: "task_lab_live_postgres_fixed",
          provider: "codex",
          status: "lost",
          cwd: "/repo",
        };
      },
      startTaskSession(input) {
        return {
          ok: true,
          task_id: input.task_id,
          task_session_id: "codex_thread_replacement",
          session: {
            id: "codex_thread_replacement",
            task_id: input.task_id,
            provider: "codex",
            native_thread_id: "native_thread_replacement",
            cwd: input.cwd,
          },
          message: {
            id: "codex_task_msg_replacement",
            task_session_id: "codex_thread_replacement",
            mode: "followup",
            text: input.prompt,
            event_ids: [],
            idempotency_key: input.idempotency_key,
            status: "sent",
            provider: "codex",
            native_thread_id: "native_thread_replacement",
            native_turn_id: "native_turn_replacement",
          },
        };
      },
      sendFollowupMessage() {
        throw new Error("sendFollowupMessage must not be called");
      },
    };
    const store = createInMemoryGatewayStore(emptyStore());
    const runtime = createRuntime({
      store,
      taskSessions,
      observability: createInMemoryObservability(),
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    const result = await handleTaskSessionReplacementRoute({
      runtime,
      taskSessionId: "codex_thread_lost",
      body: {
        prompt: "Recover this task.",
        idempotency_key: "idem_replace_lab",
      },
      now: new Date("2026-06-01T12:00:00.000Z"),
      requestId: "req_replace",
    });
    const messages = await store.listTaskMessages({ task_id: "task_lab_live_postgres_fixed" });

    assert.equal(result.status, 202);
    assert.equal(result.ok, true);
    assert.equal((result.body.started as Record<string, unknown>).task_session_id, "codex_thread_replacement");
    assert.equal((result.body.replaced_session as Record<string, unknown>).id, "codex_thread_lost");
    assert.equal(result.body.replacement_for_task_session_id, "codex_thread_lost");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, "task_session_start");
    assert.equal(messages[0].task_id, "task_lab_live_postgres_fixed");
    assert.equal(messages[0].status, "sent");
    assert.equal(messages[0].native_thread_id, "native_thread_replacement");
  });
});

function emptyStore(): InMemoryStore {
  return {
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}
