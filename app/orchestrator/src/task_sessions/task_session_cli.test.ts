import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeTaskId,
  runTaskSessionCli,
  slugifyTaskName,
  taskSessionCliOptionsFromEnvAndArgv,
} from "./task_session_cli.js";

describe("task session CLI", () => {
  it("parses list command defaults from environment", () => {
    const options = taskSessionCliOptionsFromEnvAndArgv(
      { EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999" },
      ["list"],
    );

    assert.equal(options.command, "list");
    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
  });

  it("parses bind command and normalizes human task hints", () => {
    const options = taskSessionCliOptionsFromEnvAndArgv(
      {
        EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test",
        EVENTLOOPOS_TASK_SESSION_ID: "env_session",
      },
      [
        "bind",
        "--base-url",
        "http://arg.test",
        "--session",
        "codex_thread_abc",
        "--task",
        "blog feedback",
      ],
    );

    assert.equal(options.command, "bind");
    assert.equal(options.baseUrl, "http://arg.test");
    assert.equal(options.taskSessionId, "codex_thread_abc");
    assert.equal(normalizeTaskId(options.taskHint), "task_blog_feedback");
  });

  it("parses messages command filters", () => {
    const options = taskSessionCliOptionsFromEnvAndArgv(
      {
        EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test",
        EVENTLOOPOS_TASK_MESSAGE_STATUS: "sent",
      },
      [
        "messages",
        "--session",
        "task_session_blog",
        "--event-id",
        "evt_browser_ctx_123",
        "--idempotency-key",
        "idem_task_followup_1",
        "--limit",
        "5",
      ],
    );

    assert.equal(options.command, "messages");
    assert.equal(options.baseUrl, "http://env.test");
    assert.equal(options.taskSessionId, "task_session_blog");
    assert.equal(options.eventId, "evt_browser_ctx_123");
    assert.equal(options.idempotencyKey, "idem_task_followup_1");
    assert.equal(options.status, "sent");
    assert.equal(options.limit, 5);
  });

  it("parses followup command with positional text and event ids", () => {
    const options = taskSessionCliOptionsFromEnvAndArgv(
      {},
      [
        "followup",
        "--session",
        "codex_thread_abc",
        "--event-ids",
        "evt_1, evt_2",
        "Launch moved up.",
      ],
    );

    assert.equal(options.command, "followup");
    assert.equal(options.taskSessionId, "codex_thread_abc");
    assert.equal(options.text, "Launch moved up.");
    assert.deepEqual(options.eventIds, ["evt_1", "evt_2"]);
  });

  it("lists task sessions through orchestrator", async () => {
    const writes: string[] = [];
    let requestedUrl = "";

    const exitCode = await runTaskSessionCli({
      command: "list",
      baseUrl: "http://127.0.0.1:4377",
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url) => {
        requestedUrl = String(url);
        return response({ sessions: [{ id: "task_session_blog" }], count: 1 }, 200);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/task-sessions");
    assert.deepEqual(writes, [`${JSON.stringify({ sessions: [{ id: "task_session_blog" }], count: 1 })}\n`]);
  });

  it("lists task message history through orchestrator", async () => {
    const writes: string[] = [];
    let requestedUrl = "";

    const exitCode = await runTaskSessionCli({
      command: "messages",
      baseUrl: "http://127.0.0.1:4377",
      taskSessionId: "task_session_blog",
      status: "sent",
      eventId: "evt_browser_ctx_123",
      limit: 10,
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url) => {
        requestedUrl = String(url);
        return response({ ok: true, messages: [{ id: "task_msg_1" }], count: 1 }, 200);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/task-messages?task_session_id=task_session_blog&event_id=evt_browser_ctx_123&status=sent&limit=10");
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, messages: [{ id: "task_msg_1" }], count: 1 })}\n`]);
  });

  it("binds a task session through orchestrator", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";

    const exitCode = await runTaskSessionCli({
      command: "bind",
      baseUrl: "http://127.0.0.1:4377",
      taskSessionId: "codex_thread_abc",
      taskHint: "blog feedback",
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        return response({ ok: true, binding: { task_id: "task_blog_feedback" } }, 200);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/task-sessions/codex_thread_abc/task-binding");
    assert.deepEqual(JSON.parse(requestedBody), { task_id: "task_blog_feedback" });
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, binding: { task_id: "task_blog_feedback" } })}\n`]);
  });

  it("sends idempotent task followup through orchestrator with clear session identity", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";
    let requestedIdempotencyKey = "";

    const exitCode = await runTaskSessionCli({
      command: "followup",
      baseUrl: "http://127.0.0.1:4377",
      taskSessionId: "codex_thread_abc",
      text: "Launch moved up.",
      eventIds: ["evt_launch"],
      idempotencyKey: "idem_followup_launch",
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        requestedIdempotencyKey = String(new Headers(init?.headers).get("idempotency-key"));
        return response({
          ok: true,
          message: {
            task_session_id: "codex_thread_abc",
            provider: "codex",
            native_thread_id: "thread_abc",
            status: "sent",
          },
        }, 202);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/task-sessions/codex_thread_abc/followup");
    assert.equal(requestedIdempotencyKey, "idem_followup_launch");
    assert.deepEqual(JSON.parse(requestedBody), {
      text: "Launch moved up.",
      event_ids: ["evt_launch"],
      idempotency_key: "idem_followup_launch",
    });
    assert.deepEqual(writes, [`${JSON.stringify({
      ok: true,
      message: {
        task_session_id: "codex_thread_abc",
        provider: "codex",
        native_thread_id: "thread_abc",
        status: "sent",
      },
    })}\n`]);
  });

  it("rejects bind command missing required fields before network calls", async () => {
    let called = false;
    const errors: string[] = [];
    const exitCode = await runTaskSessionCli({
      command: "bind",
      baseUrl: "http://127.0.0.1:4377",
      stderr: { write: (chunk) => { errors.push(String(chunk)); return true; } },
      fetchFn: (async () => {
        called = true;
        return response({}, 500);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 1);
    assert.equal(called, false);
    assert.match(errors.join(""), /task session id must be provided/);
  });
});

describe("slugifyTaskName", () => {
  it("dashes spaces, drops emoji/punctuation, lowercases", () => {
    assert.equal(slugifyTaskName("new task im making to get a good"), "new-task-im-making-to-get-a-good");
    assert.equal(slugifyTaskName("Hello   World!"), "hello-world");
    assert.equal(slugifyTaskName("BLOG Feedback ✨"), "blog-feedback");
    assert.equal(slugifyTaskName("café résumé"), "caf-rsum");
    assert.equal(slugifyTaskName("--leading-and-trailing--"), "leading-and-trailing");
    assert.equal(slugifyTaskName("ALL UPPER"), "all-upper");
  });
});

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
