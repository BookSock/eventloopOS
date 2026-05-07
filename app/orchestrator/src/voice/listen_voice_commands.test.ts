import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listenVoiceCommands, normalizeTranscript, voiceListenOptionsFromEnv } from "./listen_voice_commands.js";

describe("voice listen loop", () => {
  it("builds options from environment", () => {
    const options = voiceListenOptionsFromEnv({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      EVENTLOOPOS_VOICE_WAKE_PHRASE: "computer",
      EVENTLOOPOS_VOICE_PROJECT_HINT: "acme",
      EVENTLOOPOS_VOICE_TASK_HINT: "blog feedback",
      EVENTLOOPOS_VOICE_SOURCE_ID: "local-stt",
      EVENTLOOPOS_VOICE_IDEMPOTENCY_PREFIX: "voice_local",
    });

    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
    assert.equal(options.wakePhrase, "computer");
    assert.equal(options.projectHint, "acme");
    assert.equal(options.taskHint, "blog feedback");
    assert.equal(options.sourceId, "local-stt");
    assert.equal(options.idempotencyPrefix, "voice_local");
  });

  it("normalizes optional wake phrase commands", () => {
    assert.equal(normalizeTranscript("computer: blog post priority changed", "computer"), "blog post priority changed");
    assert.equal(normalizeTranscript("Ignore this", "computer"), undefined);
    assert.equal(normalizeTranscript("  no wake phrase needed  "), "no wake phrase needed");
  });

  it("forwards each wake-phrase transcript as a voice command", async () => {
    const requestedBodies: unknown[] = [];
    const writes: string[] = [];

    const exitCode = await listenVoiceCommands({
      baseUrl: "http://127.0.0.1:4377",
      wakePhrase: "computer",
      projectHint: "acme",
      taskHint: "blog feedback",
      sourceId: "local-stt",
      idempotencyPrefix: "voice_loop",
      stdin: fakeStdin([
        "ambient words\ncomputer: blog post is priority\ncomputer launch date in two weeks",
      ]),
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
      fetchFn: async (_url, init) => {
        requestedBodies.push(JSON.parse(String(init?.body)));
        return response({ ok: true }, 202);
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(requestedBodies, [
      {
        transcript: "blog post is priority",
        project_hint: "acme",
        task_hint: "blog feedback",
        idempotency_key: "voice_loop_1",
        source_id: "local-stt",
      },
      {
        transcript: "launch date in two weeks",
        project_hint: "acme",
        task_hint: "blog feedback",
        idempotency_key: "voice_loop_2",
        source_id: "local-stt",
      },
    ]);
    assert.equal(writes.length, 2);
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
