import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodexAppServerThreadClient, taskIdFromTaggedText } from "./codex_app_server_thread_client.js";

describe("CodexAppServerThreadClient", () => {
  it("lists app-server threads across pages and maps task ids", async () => {
    const calls: unknown[] = [];
    const client = new CodexAppServerThreadClient(
      async (request) => {
        calls.push(request);
        if ((request.params as { cursor?: string | null }).cursor === "next-page") {
          return {
            data: [
              {
                id: "thread_infra",
                name: "Infra incident",
                preview: "[task:infra incident] followup",
                status: { type: "idle" },
                cwd: "/repo",
                createdAt: 1_767_027_600,
                updatedAt: 1_767_031_200,
              },
            ],
            nextCursor: null,
            backwardsCursor: "prev-page",
          };
        }

        return {
          data: [
            {
              id: "thread_blog",
              name: "[task:blog feedback] Blog draft",
              preview: "Revise launch blog",
              status: { type: "active", activeFlags: [] },
              cwd: "/repo",
              createdAt: 1_767_027_600,
              updatedAt: 1_767_031_200,
            },
          ],
          nextCursor: "next-page",
          backwardsCursor: null,
        };
      },
      { threadListLimit: 2 },
    );

    const threads = await client.listThreads();

    assert.deepEqual(threads, [
      {
        id: "thread_blog",
        task_id: "task_blog_feedback",
        status: "running",
        name: "[task:blog feedback] Blog draft",
        preview: "Revise launch blog",
        cwd: "/repo",
        createdAt: 1_767_027_600,
        updatedAt: 1_767_031_200,
      },
      {
        id: "thread_infra",
        task_id: "task_infra_incident",
        status: "idle",
        name: "Infra incident",
        preview: "[task:infra incident] followup",
        cwd: "/repo",
        createdAt: 1_767_027_600,
        updatedAt: 1_767_031_200,
      },
    ]);
    assert.deepEqual(calls, [
      {
        method: "thread/list",
        params: { cursor: undefined, limit: 2, archived: false, useStateDbOnly: true },
      },
      {
        method: "thread/list",
        params: { cursor: "next-page", limit: 2, archived: false, useStateDbOnly: true },
      },
    ]);
  });

  it("uses explicit task id mapping before name tags", async () => {
    const client = new CodexAppServerThreadClient(
      async () => ({
        data: [
          {
            id: "thread_blog",
            name: "[task:wrong] Blog draft",
            status: { type: "active", activeFlags: [] },
          },
        ],
        nextCursor: null,
      }),
      { taskIdByThreadId: { thread_blog: "task_blog_feedback" } },
    );

    assert.equal((await client.listThreads())[0]?.task_id, "task_blog_feedback");
  });

  it("reads a single thread by id", async () => {
    const calls: unknown[] = [];
    const client = new CodexAppServerThreadClient(async (request) => {
      calls.push(request);
      return {
        thread: {
          id: "thread_blog",
          name: "[task:blog feedback] Blog draft",
          status: { type: "systemError" },
        },
      };
    });

    const thread = await client.getThread("thread_blog");

    assert.equal(thread?.id, "thread_blog");
    assert.equal(thread?.task_id, "task_blog_feedback");
    assert.equal(thread?.status, "blocked");
    assert.deepEqual(calls, [
      {
        method: "thread/read",
        params: { threadId: "thread_blog", includeTurns: false },
      },
    ]);
  });

  it("starts a turn with text input and event metadata", async () => {
    const calls: unknown[] = [];
    const client = new CodexAppServerThreadClient(async (request) => {
      calls.push(request);
      return {
        turn: {
          id: "turn_123",
          status: "inProgress",
        },
      };
    });

    const turn = await client.startTurn({
      thread_id: "thread_blog",
      text: "New Slack event for this task.",
      event_ids: ["evt_slack_blog"],
      idempotency_key: "inject_slack_blog",
    });

    assert.deepEqual(turn, { id: "turn_123", status: "queued" });
    assert.deepEqual(calls, [
      {
        method: "turn/start",
        params: {
          threadId: "thread_blog",
          input: [
            {
              type: "text",
              text: "New Slack event for this task.",
              text_elements: [],
            },
          ],
          responsesapiClientMetadata: {
            eventloopos_idempotency_key: "inject_slack_blog",
            eventloopos_event_ids: "evt_slack_blog",
          },
        },
      },
    ]);
  });

  it("rejects malformed thread list responses", async () => {
    const client = new CodexAppServerThreadClient(async () => ({ data: "not-array" }));

    await assert.rejects(() => client.listThreads(), /thread\/list response data must be an array/);
  });

  it("derives task ids from tagged text", () => {
    assert.equal(taskIdFromTaggedText("[task:Blog Feedback]"), "task_blog_feedback");
    assert.equal(taskIdFromTaggedText("no task"), undefined);
  });
});
