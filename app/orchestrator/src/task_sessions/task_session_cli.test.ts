import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeTaskId,
  runTaskSessionCli,
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

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
