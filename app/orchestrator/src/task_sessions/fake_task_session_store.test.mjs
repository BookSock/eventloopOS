import test from "node:test";
import assert from "node:assert/strict";
import { FakeTaskSessionStore } from "./fake_task_session_store.mjs";

const fixedClock = () => new Date("2026-05-06T19:02:00.000Z");

test("fake task session record sends followup message with audit entry", () => {
  const store = new FakeTaskSessionStore({ clock: fixedClock });
  const session = store.createSession({
    id: "task_session_fake_codex",
    task_id: "task_agent_adapter",
    native_thread_id: "thread_fake_codex",
  });

  const message = store.sendFollowupMessage({
    task_session_id: session.id,
    text: "New fixture info arrived. Continue after approval packet.",
    event_ids: ["evt_fake_codex_followup"],
    idempotency_key: "idem_fake_followup_1",
  });

  assert.equal(message.status, "sent");
  assert.equal(message.mode, "followup");
  assert.equal(message.sent_at, "2026-05-06T19:02:00.000Z");
  assert.deepEqual(message.event_ids, ["evt_fake_codex_followup"]);
  assert.equal(message.evidence[0].title, "Fake task message sent");
  assert.equal(store.getSession(session.id).status, "running");
  assert.deepEqual(store.auditLog.at(-1), {
    id: "audit_2",
    type: "task_message.send_stub",
    details: {
      task_session_id: "task_session_fake_codex",
      task_message_id: "task_msg_1",
      status: "sent",
      mode: "followup",
      event_ids: ["evt_fake_codex_followup"],
      idempotency_key: "idem_fake_followup_1",
    },
    occurred_at: "2026-05-06T19:02:00.000Z",
  });
});

test("fake task message send stub blocks without stable session match", () => {
  const store = new FakeTaskSessionStore({ clock: fixedClock });

  const message = store.sendFollowupMessage({
    task_session_id: "task_session_missing",
    text: "Cannot send without matched session.",
    event_ids: ["evt_missing_session"],
    idempotency_key: "idem_missing_session",
  });

  assert.equal(message.status, "blocked");
  assert.equal(message.sent_at, undefined);
  assert.equal(store.auditLog[0].details.status, "blocked");
});
