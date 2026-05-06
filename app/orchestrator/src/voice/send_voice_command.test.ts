import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendVoiceCommand, voiceCommandOptionsFromEnv } from "./send_voice_command.js";

describe("voice command client", () => {
  it("builds options from environment", () => {
    const options = voiceCommandOptionsFromEnv({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      EVENTLOOPOS_VOICE_TRANSCRIPT: "Blog post priority changed",
      EVENTLOOPOS_VOICE_PROJECT_HINT: "pagerfree",
      EVENTLOOPOS_VOICE_TASK_HINT: "blog feedback",
      EVENTLOOPOS_VOICE_IDEMPOTENCY_KEY: "voice-1",
      EVENTLOOPOS_VOICE_SOURCE_ID: "mic-1",
      EVENTLOOPOS_VOICE_OCCURRED_AT: "2026-05-06T17:10:00Z",
    });

    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
    assert.equal(options.transcript, "Blog post priority changed");
    assert.equal(options.projectHint, "pagerfree");
    assert.equal(options.taskHint, "blog feedback");
    assert.equal(options.idempotencyKey, "voice-1");
    assert.equal(options.sourceId, "mic-1");
    assert.equal(options.occurredAt, "2026-05-06T17:10:00Z");
  });

  it("sends transcript from env-style options to voice command endpoint", async () => {
    const writes: string[] = [];
    let requestedUrl = "";
    let requestedBody = "";
    let requestedIdempotencyKey = "";

    const exitCode = await sendVoiceCommand({
      baseUrl: "http://127.0.0.1:4377",
      transcript: "Blog post is priority and should mention launch.",
      projectHint: "pagerfree",
      taskHint: "blog feedback",
      idempotencyKey: "idem_voice_test",
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
      fetchFn: async (url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body);
        requestedIdempotencyKey = new Headers(init?.headers).get("idempotency-key") ?? "";
        return response({ ok: true, route_decision: { action: "inject_into_agent_thread" } }, 202);
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://127.0.0.1:4377/voice/commands");
    assert.equal(requestedIdempotencyKey, "idem_voice_test");
    assert.deepEqual(JSON.parse(requestedBody), {
      transcript: "Blog post is priority and should mention launch.",
      project_hint: "pagerfree",
      task_hint: "blog feedback",
      idempotency_key: "idem_voice_test",
    });
    assert.deepEqual(writes, [`${JSON.stringify({ ok: true, route_decision: { action: "inject_into_agent_thread" } })}\n`]);
  });

  it("reads transcript from stdin when env transcript is absent", async () => {
    let requestedBody = "";

    const exitCode = await sendVoiceCommand({
      baseUrl: "http://127.0.0.1:4377",
      stdin: fakeStdin(["Need send this to blog task\n"]),
      stdout: {
        write() {
          return true;
        },
      },
      fetchFn: async (_url, init) => {
        requestedBody = String(init?.body);
        return response({ ok: true }, 202);
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(requestedBody), {
      transcript: "Need send this to blog task",
    });
  });

  it("returns non-zero when transcript is empty", async () => {
    const errors: string[] = [];
    const exitCode = await sendVoiceCommand({
      baseUrl: "http://127.0.0.1:4377",
      transcript: " ",
      stderr: {
        write(chunk: string) {
          errors.push(chunk);
          return true;
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(errors, ["transcript must be provided by EVENTLOOPOS_VOICE_TRANSCRIPT or stdin\n"]);
  });
});

function fakeStdin(chunks: string[]) {
  return {
    setEncoding() {
      return undefined;
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
