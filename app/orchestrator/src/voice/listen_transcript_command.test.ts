import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listenTranscriptCommand, transcriptCommandOptionsFromEnv } from "./listen_transcript_command.js";

describe("voice transcript command", () => {
  it("builds command options from environment", () => {
    const options = transcriptCommandOptionsFromEnv({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND: "whisper-stream",
      EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON: "[\"--model\",\"ggml-base.en.bin\"]",
      EVENTLOOPOS_VOICE_WAKE_PHRASE: "computer",
    });

    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
    assert.equal(options.command, "whisper-stream");
    assert.deepEqual(options.args, ["--model", "ggml-base.en.bin"]);
    assert.equal(options.wakePhrase, "computer");
  });

  it("pipes command stdout into the existing voice router", async () => {
    const requestedBodies: unknown[] = [];
    const spawned: Array<{ command: string; args: string[] }> = [];

    const exitCode = await listenTranscriptCommand({
      baseUrl: "http://127.0.0.1:4377",
      command: "fake-stt",
      args: ["--line-mode"],
      wakePhrase: "computer",
      taskHint: "blog feedback",
      sourceId: "local-stt-command",
      idempotencyPrefix: "voice_cmd",
      stdout: {
        write() {
          return true;
        },
      },
      spawnFn: (command, args) => {
        spawned.push({ command, args });
        return {
          stdout: fakeStream(["noise\ncomputer: launch detail changed\n"]),
          exitCode: Promise.resolve(0),
        };
      },
      fetchFn: async (_url, init) => {
        requestedBodies.push(JSON.parse(String(init?.body)));
        return response({ ok: true }, 202);
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(spawned, [{ command: "fake-stt", args: ["--line-mode"] }]);
    assert.deepEqual(requestedBodies, [
      {
        transcript: "launch detail changed",
        task_hint: "blog feedback",
        idempotency_key: "voice_cmd_1",
        source_id: "local-stt-command",
      },
    ]);
  });

  it("returns non-zero when transcript command exits non-zero", async () => {
    const exitCode = await listenTranscriptCommand({
      baseUrl: "http://127.0.0.1:4377",
      command: "fake-stt",
      spawnFn: () => ({
        stdout: fakeStream([]),
        exitCode: Promise.resolve(2),
      }),
      fetchFn: async () => response({ ok: true }, 202),
    });

    assert.equal(exitCode, 1);
  });
});

function fakeStream(chunks: string[]) {
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
