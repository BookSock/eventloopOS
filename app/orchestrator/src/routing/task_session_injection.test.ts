import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import { injectEventIntoTaskSessionIfPossible } from "./task_session_injection.js";

describe("task session injection", () => {
  it("routes hinted events to newest followup-capable session for a task", async () => {
    const sentTo: string[] = [];
    const taskSessions: TaskSessionController = {
      listSessions: () => [
        session({
          id: "task_session_old",
          task_id: "task_blog_feedback",
          status: "idle",
          updated_at: "2026-05-08T10:00:00.000Z",
        }),
        session({
          id: "task_session_new",
          task_id: "task_blog_feedback",
          status: "idle",
          updated_at: "2026-05-08T15:00:00.000Z",
        }),
        session({
          id: "task_session_stopped_newer",
          task_id: "task_blog_feedback",
          status: "stopped",
          updated_at: "2026-05-08T16:00:00.000Z",
        }),
      ],
      sendFollowupMessage: (input) => {
        sentTo.push(input.task_session_id);
        return {
          id: `msg_${input.task_session_id}`,
          task_session_id: input.task_session_id,
          status: "sent",
        };
      },
    };

    const result = await injectEventIntoTaskSessionIfPossible(
      slackEvent({ task_hint: "blog feedback" }),
      taskSessions,
      { listContextEntries: async () => [] } as unknown as GatewayStore,
      new Date("2026-05-08T15:30:00.000Z"),
    );

    assert.equal(result?.routeDecision.target_task_id, "task_blog_feedback");
    assert.equal(result?.routeDecision.target_task_session_id, "task_session_new");
    assert.deepEqual(sentTo, ["task_session_new"]);
  });

  it("prefers running session over newer idle duplicate", async () => {
    const taskSessions: TaskSessionController = {
      listSessions: () => [
        session({
          id: "task_session_idle_new",
          task_id: "task_blog_feedback",
          status: "idle",
          updated_at: "2026-05-08T15:00:00.000Z",
        }),
        session({
          id: "task_session_running_old",
          task_id: "task_blog_feedback",
          status: "running",
          updated_at: "2026-05-08T10:00:00.000Z",
        }),
      ],
      sendFollowupMessage: (input) => ({
        id: `msg_${input.task_session_id}`,
        task_session_id: input.task_session_id,
        status: "sent",
      }),
    };

    const result = await injectEventIntoTaskSessionIfPossible(
      slackEvent({ task_hint: "blog feedback" }),
      taskSessions,
      { listContextEntries: async () => [] } as unknown as GatewayStore,
      new Date("2026-05-08T15:30:00.000Z"),
    );

    assert.equal(result?.routeDecision.target_task_session_id, "task_session_running_old");
  });
});

function session(input: {
  id: string;
  task_id: string;
  status: string;
  updated_at: string;
}) {
  return {
    provider: "codex",
    supports: { followup: true },
    last_seen_at: input.updated_at,
    created_at: input.updated_at,
    ...input,
  };
}

function slackEvent(input: { task_hint: string }): McpEvent {
  const now = "2026-05-08T15:30:00.000Z";
  return {
    id: "evt_slack_blog_feedback",
    source: "slack",
    source_id: "slack:C123:1746718200.000000",
    idempotency_key: "slack:C123:1746718200.000000",
    occurred_at: now,
    received_at: now,
    actor: {
      id: "slack_user_123",
      type: "human",
    },
    task_hint: input.task_hint,
    type: "slack.message",
    title: "Blog feedback",
    summary: "Launch details should go into the blog draft.",
    raw_ref: {
      id: "raw_evt_slack_blog_feedback",
      uri: "slack://channel/C123/p1746718200000000",
      media_type: "application/json",
    },
    links: [],
    resources: [],
  };
}
