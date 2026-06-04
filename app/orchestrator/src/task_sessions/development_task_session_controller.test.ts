import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSeededDevelopmentTaskSessions, DevelopmentTaskSessionController } from "./development_task_session_controller.js";

describe("DevelopmentTaskSessionController", () => {
  it("lists and looks up seeded sessions", () => {
    const controller = createSeededDevelopmentTaskSessions(() => new Date("2026-05-06T22:00:00.000Z"));
    controller.seedSession({ id: "task_session_infra", task_id: "task_infra_incident", status: "blocked", pid: 610 });

    const sessions = controller.listSessions();

    assert.deepEqual(sessions.map((session) => session.id), ["task_session_blog", "task_session_infra"]);
    assert.equal(controller.getSession("task_session_blog")?.task_id, "task_blog_feedback");
    assert.equal(controller.getSession("task_session_infra")?.pid, 610);
    assert.equal(controller.getSession("task_session_missing"), undefined);
  });

  it("sends and dedupes followup messages", () => {
    const controller = new DevelopmentTaskSessionController({
      clock: () => new Date("2026-05-06T22:00:00.000Z"),
    });
    controller.seedSession({ id: "task_session_blog", task_id: "task_blog_feedback" });

    const first = controller.sendFollowupMessage({
      task_session_id: "task_session_blog",
      text: "Use launch date in next blog draft.",
      event_ids: ["evt_browser_context_attach_task"],
      idempotency_key: "idem_followup_blog",
    });
    const second = controller.sendFollowupMessage({
      task_session_id: "task_session_blog",
      text: "Different retry payload should still dedupe by key.",
      event_ids: [],
      idempotency_key: "idem_followup_blog",
    });

    assert.equal(first.status, "sent");
    assert.equal(first.provider, "fake");
    assert.equal(first.sent_at, "2026-05-06T22:00:00.000Z");
    assert.equal(first.id, "task_msg_idem_followup_blog");
    assert.deepEqual(first.event_ids, ["evt_browser_context_attach_task"]);
    assert.equal(controller.sessions.get("task_session_blog")?.status, "running");
    assert.equal(second, first);
    assert.equal(controller.messages.size, 1);
  });

  it("blocks when session is unknown", () => {
    const controller = createSeededDevelopmentTaskSessions(() => new Date("2026-05-06T22:00:00.000Z"));

    const message = controller.sendFollowupMessage({
      task_session_id: "task_session_missing",
      text: "No target session.",
      event_ids: [],
      idempotency_key: "idem_missing",
    });

    assert.equal(message.status, "blocked");
    assert.equal(message.sent_at, undefined);
    assert.equal(message.evidence[0].title, "Development task message blocked");
  });

  it("binds seeded sessions to new task ids", () => {
    const controller = createSeededDevelopmentTaskSessions(() => new Date("2026-05-06T22:00:00.000Z"));

    const result = controller.bindTaskSession({
      task_session_id: "task_session_blog",
      task_id: "task_blog_launch",
    });

    assert.equal(result.ok, true);
    assert.equal(result.session?.task_id, "task_blog_launch");
    assert.equal(controller.getSession("task_session_blog")?.task_id, "task_blog_launch");
    assert.equal(controller.getSession("task_session_blog")?.updated_at, "2026-05-06T22:00:00.000Z");
  });
});
