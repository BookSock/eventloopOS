import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentRunCliOptionsFromEnvAndArgv,
  buildAgentRunFromCliOptions,
  runAgentRunCli,
} from "./agent_run_cli.js";

describe("agent run CLI", () => {
  it("parses upsert args over env defaults", () => {
    const options = agentRunCliOptionsFromEnvAndArgv(
      {
        EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test",
        EVENTLOOPOS_AGENT_RUN_PROVIDER: "manual",
        EVENTLOOPOS_AGENT_RUN_RISK_TAGS: "external_send, prod",
      },
      [
        "upsert",
        "--base-url",
        "http://arg.test",
        "--id",
        "run_cli_1",
        "--provider",
        "codex",
        "--task",
        "blog feedback",
        "--thread-id",
        "thread_cli_1",
        "--status",
        "blocked",
        "--summary",
        "Needs launch detail approval.",
        "--risk-tag",
        "credential",
      ],
    );

    assert.equal(options.command, "upsert");
    assert.equal(options.baseUrl, "http://arg.test");
    assert.equal(options.id, "run_cli_1");
    assert.equal(options.provider, "codex");
    assert.equal(options.taskHint, "blog feedback");
    assert.equal(options.threadId, "thread_cli_1");
    assert.equal(options.status, "blocked");
    assert.deepEqual(options.riskTags, ["credential"]);
  });

  it("builds a normalized AgentRun with evidence and resume action", async () => {
    const run = await buildAgentRunFromCliOptions({
      command: "upsert",
      baseUrl: "http://127.0.0.1:4377",
      id: "Run CLI 1",
      provider: "claude",
      taskHint: "blog feedback",
      threadId: "claude_thread_1",
      status: "waiting_approval",
      blockedReason: "Approve draft reply.",
      riskTags: ["external_send"],
      evidenceTitle: "Draft reply",
      evidenceUrl: "https://docs.example.test/draft",
      outputRefUri: "artifact://agent/run-cli-1.jsonl",
      resumeActionSideEffect: "local",
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });

    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.value.id, "Run CLI 1");
    assert.equal(run.value.provider, "claude");
    assert.equal(run.value.task_id, "task_blog_feedback");
    assert.equal(run.value.updated_at, "2026-05-07T12:00:00.000Z");
    assert.equal(run.value.evidence[0]?.id, "ev_run_cli_1_cli");
    assert.equal(run.value.evidence[0]?.url, "https://docs.example.test/draft");
    assert.equal(run.value.output_refs[0]?.uri, "artifact://agent/run-cli-1.jsonl");
    assert.equal(run.value.resume_actions[0]?.type, "resume_agent");
    assert.equal(run.value.resume_actions[0]?.requires_confirmation, true);
  });

  it("accepts human-attention status aliases and sends canonical status", async () => {
    const options = agentRunCliOptionsFromEnvAndArgv(
      {
        EVENTLOOPOS_AGENT_RUN_ID: "run_cli_review",
        EVENTLOOPOS_AGENT_RUN_PROVIDER: "claude",
        EVENTLOOPOS_AGENT_RUN_STATUS: "ready for review",
      },
      [],
    );
    const run = await buildAgentRunFromCliOptions({
      ...options,
      blockedReason: "Review checkout fix.",
      riskTags: [],
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });

    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.value.status, "waiting_approval");
  });

  it("sends an upsert request to orchestrator", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";

    const exitCode = await runAgentRunCli({
      command: "upsert",
      baseUrl: "http://127.0.0.1:4377",
      id: "run_cli_send",
      provider: "codex",
      status: "waiting_approval",
      blockedReason: "Needs human decision.",
      riskTags: [],
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        return response({ ok: true, queue_item: { id: "qit_run_cli_send_agent_waiting" } }, 200);
      }) as typeof fetch,
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/agent-runs");
    assert.equal(JSON.parse(requestedBody).id, "run_cli_send");
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, queue_item: { id: "qit_run_cli_send_agent_waiting" } })}\n`]);
  });

  it("fetches an existing agent run", async () => {
    const writes: string[] = [];
    let requestedUrl = "";

    const exitCode = await runAgentRunCli({
      command: "get",
      baseUrl: "http://127.0.0.1:4377",
      id: "run_cli_send",
      riskTags: [],
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      fetchFn: (async (url) => {
        requestedUrl = String(url);
        return response({ agent_run: { id: "run_cli_send" } }, 200);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/agent-runs/run_cli_send");
    assert.deepEqual(writes, [`${JSON.stringify({ agent_run: { id: "run_cli_send" } })}\n`]);
  });

  it("rejects missing run id before network calls", async () => {
    let called = false;
    const errors: string[] = [];
    const exitCode = await runAgentRunCli({
      command: "upsert",
      baseUrl: "http://127.0.0.1:4377",
      riskTags: [],
      stderr: { write: (chunk) => { errors.push(String(chunk)); return true; } },
      fetchFn: (async () => {
        called = true;
        return response({}, 500);
      }) as typeof fetch,
    });

    assert.equal(exitCode, 1);
    assert.equal(called, false);
    assert.match(errors.join(""), /agent run id must be provided/);
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
