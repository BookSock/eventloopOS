import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { masterCommandOptionsFromEnvAndArgv, runMasterCommandCli } from "./master_command_cli.js";

describe("master command CLI", () => {
  it("routes text through voice command ingress by default", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";

    const exitCode = await runMasterCommandCli({
      baseUrl: "http://127.0.0.1:4377",
      text: "Blog launch is higher priority.",
      taskHint: "blog feedback",
      idempotencyKey: "idem_master_route",
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        return response({ ok: true, event: { id: "evt_voice" } }, 202);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/voice/commands");
    assert.deepEqual(JSON.parse(requestedBody), {
      transcript: "Blog launch is higher priority.",
      task_hint: "blog feedback",
      idempotency_key: "idem_master_route",
      source_id: "idem_master_route",
    });
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, event: { id: "evt_voice" } })}\n`]);
  });

  it("accepts pnpm-style positional text for default routing", async () => {
    const options = masterCommandOptionsFromEnvAndArgv({}, ["Blog launch is higher priority."]);

    assert.equal(options.baseUrl, "http://127.0.0.1:4377");
    assert.equal(options.text, "Blog launch is higher priority.");
    assert.equal(options.newTask, false);
  });

  it("starts a new task session when requested", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";

    const exitCode = await runMasterCommandCli({
      baseUrl: "http://127.0.0.1:4377",
      text: "Draft email to Sam about launch timeline.",
      taskHint: "sam launch email",
      newTask: true,
      cwd: "/repo",
      model: "gpt-5.3-codex",
      idempotencyKey: "idem_master_start",
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        return response({ ok: true, started: { task_id: "task_sam_launch_email" } }, 202);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/task-sessions");
    const body = JSON.parse(requestedBody) as Record<string, unknown>;
    assert.equal(body.task_id, "task_sam_launch_email");
    assert.equal(body.cwd, "/repo");
    assert.equal(body.model, "gpt-5.3-codex");
    assert.equal(body.idempotency_key, "idem_master_start");
    assert.match(String(body.prompt), /Draft email to Sam/);
    assert.match(String(body.prompt), /^\[task:sam-launch-email\]/);
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, started: { task_id: "task_sam_launch_email" } })}\n`]);
  });

  it("supports explicit start-new-task command", async () => {
    const options = masterCommandOptionsFromEnvAndArgv({}, [
      "start-new-task",
      "--task",
      "sam launch email",
      "Draft email to Sam.",
    ]);

    assert.equal(options.newTask, true);
    assert.equal(options.taskHint, "sam launch email");
    assert.equal(options.text, "Draft email to Sam.");
  });

  it("prints help without requiring text", async () => {
    const writes: string[] = [];
    const exitCode = await runMasterCommandCli({
      baseUrl: "http://127.0.0.1:4377",
      help: true,
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
    });

    assert.equal(exitCode, 0);
    assert.match(writes.join(""), /pnpm run master:send -- "/);
    assert.match(writes.join(""), /start-new-task/);
  });

  it("parses env and argv", () => {
    const options = masterCommandOptionsFromEnvAndArgv(
      { EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test", EVENTLOOPOS_MASTER_NEW_TASK: "1" },
      ["--base-url", "http://arg.test", "--task", "blog", "--text", "do work"],
    );

    assert.equal(options.baseUrl, "http://arg.test");
    assert.equal(options.taskHint, "blog");
    assert.equal(options.text, "do work");
    assert.equal(options.newTask, true);
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
