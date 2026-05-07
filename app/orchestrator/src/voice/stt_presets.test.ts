import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTranscriptCommandConfigFromEnv } from "./stt_presets.js";

describe("local STT presets", () => {
  it("keeps explicit transcript commands as the highest-priority config", () => {
    const config = resolveTranscriptCommandConfigFromEnv({
      EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND: "custom-stt",
      EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON: "[\"--jsonl\"]",
      EVENTLOOPOS_VOICE_STT_PRESET: "whisper_cpp_stream",
      EVENTLOOPOS_WHISPER_MODEL: "models/ggml-base.en.bin",
    });

    assert.deepEqual(config, {
      command: "custom-stt",
      args: ["--jsonl"],
      configured: true,
      source: "explicit",
    });
  });

  it("builds a whisper.cpp stream microphone command from env", () => {
    const config = resolveTranscriptCommandConfigFromEnv({
      EVENTLOOPOS_VOICE_STT_PRESET: "whisper_cpp_stream",
      EVENTLOOPOS_WHISPER_CPP_STREAM_BIN: "/opt/whisper.cpp/build/bin/whisper-stream",
      EVENTLOOPOS_WHISPER_MODEL: "/models/ggml-base.en.bin",
      EVENTLOOPOS_WHISPER_STEP_MS: "750",
      EVENTLOOPOS_WHISPER_LENGTH_MS: "6000",
      EVENTLOOPOS_WHISPER_KEEP_MS: "300",
      EVENTLOOPOS_WHISPER_THREADS: "8",
      EVENTLOOPOS_WHISPER_CAPTURE_ID: "1",
      EVENTLOOPOS_WHISPER_LANGUAGE: "en",
    });

    assert.deepEqual(config, {
      command: "/opt/whisper.cpp/build/bin/whisper-stream",
      args: [
        "-m",
        "/models/ggml-base.en.bin",
        "--step",
        "750",
        "--length",
        "6000",
        "--keep",
        "300",
        "-t",
        "8",
        "-c",
        "1",
        "-l",
        "en",
      ],
      configured: true,
      source: "preset",
      preset: "whisper_cpp_stream",
    });
  });

  it("requires model path for whisper.cpp stream preset", () => {
    const config = resolveTranscriptCommandConfigFromEnv({
      EVENTLOOPOS_VOICE_STT_PRESET: "whisper_cpp_stream",
    });

    assert.equal(config.configured, true);
    assert.equal(config.error, "EVENTLOOPOS_WHISPER_MODEL is required for whisper_cpp_stream preset");
  });
});
