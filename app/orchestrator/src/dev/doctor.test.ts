import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doctorOptionsFromEnv, runDoctor, runDoctorCli } from "./doctor.js";
import { captureWorkspacePlan } from "../workspace/aerospace.js";

describe("developer doctor", () => {
  it("reports all live backend checks as machine-readable JSON", async () => {
    const report = await runDoctor({
      baseUrl: "http://127.0.0.1:4377",
      now: () => new Date("2026-05-06T18:00:00.000Z"),
      platform: "darwin",
      fetchFn: async (url) => {
        assert.equal(String(url), "http://127.0.0.1:4377/health");
        return response({ ok: true }, 200);
      },
      execFn: async (command, args) => {
        if (command === "aerospace") {
          assert.deepEqual(args, captureWorkspacePlan().args);
          return { stdout: "[]", stderr: "" };
        }
        if (command === "docker") {
          assert.deepEqual(args, ["info", "--format", "{{.ServerVersion}}"]);
          return { stdout: "29.3.1\n", stderr: "" };
        }
        if (command === "pnpm") {
          assert.deepEqual(args, ["--filter", "@eventloopos/browser-extension", "exec", "playwright", "--version"]);
          return { stdout: "Version 1.59.1\n", stderr: "" };
        }
        if (command === "swift") {
          assert.deepEqual(args, ["--version"]);
          return { stdout: "swift-driver version: 1.127.8 Apple Swift version 6.2.1\n", stderr: "" };
        }
        throw new Error(`unexpected command ${command}`);
      },
      codexCheckFn: async () => ({
        name: "codex_app_server",
        ok: true,
        detail: "Codex app-server responded; sampled 1 thread(s)",
        command: ["codex", "app-server", "--listen", "stdio://"],
        source_url: "https://developers.openai.com/codex/app-server",
      }),
    });

    assert.deepEqual(report, {
      ok: true,
      generated_at: "2026-05-06T18:00:00.000Z",
      orchestrator_url: "http://127.0.0.1:4377",
      checks: [
        {
          name: "orchestrator_health",
          ok: true,
          detail: "orchestrator health endpoint responded",
          source_url: "http://127.0.0.1:4377/health",
        },
        {
          name: "aerospace_daemon",
          ok: true,
          detail: "AeroSpace CLI returned window JSON",
          command: [captureWorkspacePlan().command, ...captureWorkspacePlan().args],
          source_url: "https://nikitabobko.github.io/AeroSpace/commands.html#list-windows",
        },
        {
          name: "docker_daemon",
          ok: true,
          detail: "Docker daemon responded: 29.3.1",
          command: ["docker", "info", "--format", "{{.ServerVersion}}"],
          source_url: "https://docs.docker.com/reference/cli/docker/system/info/",
        },
        {
          name: "browser_e2e",
          ok: true,
          detail: "Playwright available: Version 1.59.1",
          command: ["pnpm", "--filter", "@eventloopos/browser-extension", "exec", "playwright", "--version"],
          source_url: "https://playwright.dev/docs/chrome-extensions",
        },
        {
          name: "mac_browser_restore_smoke",
          ok: true,
          detail: "Swift available for mac-browser restore smoke: swift-driver version: 1.127.8 Apple Swift version 6.2.1",
          command: ["swift", "--version"],
          source_url: "https://www.swift.org/getting-started/",
        },
        {
          name: "voice_transcript_command",
          ok: true,
          detail: "optional voice transcript command is not configured",
          source_url: "https://nodejs.org/api/child_process.html#child_processspawncommand-args-options",
        },
        {
          name: "codex_app_server",
          ok: true,
          detail: "Codex app-server responded; sampled 1 thread(s)",
          command: ["codex", "app-server", "--listen", "stdio://"],
          source_url: "https://developers.openai.com/codex/app-server",
        },
      ],
    });
  });

  it("surfaces blocked daemons without hiding other checks", async () => {
    const report = await runDoctor({
      baseUrl: "http://127.0.0.1:4377",
      platform: "darwin",
      fetchFn: async () => response({ ok: true }, 200),
      execFn: async (command, args) => {
        if (command === "aerospace") {
          throw new Error("Can't connect to AeroSpace server. Is AeroSpace.app running?");
        }
        if (command === "pnpm") {
          return { stdout: "Version 1.59.1\n", stderr: "" };
        }
        if (command === "swift") {
          assert.deepEqual(args, ["--version"]);
          return { stdout: "swift-driver version: 1.127.8 Apple Swift version 6.2.1\n", stderr: "" };
        }
        const error = new Error("docker failed") as Error & { stderr: string };
        error.stderr = "failed to connect to the docker API";
        throw error;
      },
      codexCheckFn: async () => ({
        name: "codex_app_server",
        ok: true,
        detail: "Codex app-server responded; sampled 1 thread(s)",
      }),
    });

    assert.equal(report.ok, false);
    assert.equal(report.checks[0]?.ok, true);
    assert.deepEqual(report.checks.slice(1).map((check) => [check.name, check.ok, check.detail]), [
      ["aerospace_daemon", false, "Can't connect to AeroSpace server. Is AeroSpace.app running?"],
      ["docker_daemon", false, "failed to connect to the docker API"],
      ["browser_e2e", true, "Playwright available: Version 1.59.1"],
      ["mac_browser_restore_smoke", true, "Swift available for mac-browser restore smoke: swift-driver version: 1.127.8 Apple Swift version 6.2.1"],
      ["voice_transcript_command", true, "optional voice transcript command is not configured"],
      ["codex_app_server", true, "Codex app-server responded; sampled 1 thread(s)"],
    ]);
  });

  it("checks configured local voice transcript command", async () => {
    const report = await runDoctor({
      baseUrl: "http://127.0.0.1:4377",
      platform: "darwin",
      voiceTranscriptCommand: "whisper-stream",
      voiceTranscriptArgs: ["--model", "ggml-base.en.bin"],
      voiceTranscriptCommandConfigured: true,
      fetchFn: async () => response({ ok: true }, 200),
      execFn: async (command, args) => {
        if (command === "whisper-stream") {
          assert.deepEqual(args, ["--model", "ggml-base.en.bin", "--help"]);
          return { stdout: "usage: whisper-stream\n", stderr: "" };
        }
        if (command === "swift") {
          assert.deepEqual(args, ["--version"]);
          return { stdout: "swift-driver version: 1.127.8 Apple Swift version 6.2.1\n", stderr: "" };
        }
        return { stdout: command === "docker" ? "29.3.1\n" : "[]", stderr: "" };
      },
      codexCheckFn: async () => ({
        name: "codex_app_server",
        ok: true,
        detail: "Codex app-server responded; sampled 1 thread(s)",
      }),
    });

    const voiceCheck = report.checks.find((check) => check.name === "voice_transcript_command");

    assert.equal(voiceCheck?.ok, true);
    assert.equal(voiceCheck?.detail, "voice transcript command launched with --help");
    assert.deepEqual(voiceCheck?.command, ["whisper-stream", "--model", "ggml-base.en.bin", "--help"]);
  });

  it("checks whisper.cpp stream preset readiness", async () => {
    const options = doctorOptionsFromEnv({
      EVENTLOOPOS_VOICE_STT_PRESET: "whisper_cpp_stream",
      EVENTLOOPOS_WHISPER_MODEL: "models/ggml-base.en.bin",
      EVENTLOOPOS_WHISPER_THREADS: "4",
    });
    const report = await runDoctor({
      ...options,
      baseUrl: "http://127.0.0.1:4377",
      platform: "darwin",
      fetchFn: async () => response({ ok: true }, 200),
      execFn: async (command, args) => {
        if (command === "whisper-stream") {
          assert.deepEqual(args, [
            "-m",
            "models/ggml-base.en.bin",
            "--step",
            "500",
            "--length",
            "5000",
            "--keep",
            "200",
            "-t",
            "4",
            "--help",
          ]);
          return { stdout: "usage: whisper-stream\n", stderr: "" };
        }
        if (command === "swift") {
          return { stdout: "swift-driver version: 1.127.8 Apple Swift version 6.2.1\n", stderr: "" };
        }
        return { stdout: command === "docker" ? "29.3.1\n" : "[]", stderr: "" };
      },
      codexCheckFn: async () => ({
        name: "codex_app_server",
        ok: true,
        detail: "Codex app-server responded; sampled 1 thread(s)",
      }),
    });

    const voiceCheck = report.checks.find((check) => check.name === "voice_transcript_command");

    assert.equal(voiceCheck?.ok, true);
    assert.deepEqual(voiceCheck?.command, [
      "whisper-stream",
      "-m",
      "models/ggml-base.en.bin",
      "--step",
      "500",
      "--length",
      "5000",
      "--keep",
      "200",
      "-t",
      "4",
      "--help",
    ]);
  });

  it("reports invalid whisper.cpp stream preset without launching a command", async () => {
    const options = doctorOptionsFromEnv({
      EVENTLOOPOS_VOICE_STT_PRESET: "whisper_cpp_stream",
    });
    const report = await runDoctor({
      ...options,
      baseUrl: "http://127.0.0.1:4377",
      platform: "darwin",
      fetchFn: async () => response({ ok: true }, 200),
      execFn: async (command) => {
        if (command === "swift") {
          return { stdout: "swift-driver version: 1.127.8 Apple Swift version 6.2.1\n", stderr: "" };
        }
        return { stdout: command === "docker" ? "29.3.1\n" : "[]", stderr: "" };
      },
      codexCheckFn: async () => ({
        name: "codex_app_server",
        ok: true,
        detail: "Codex app-server responded; sampled 1 thread(s)",
      }),
    });

    const voiceCheck = report.checks.find((check) => check.name === "voice_transcript_command");

    assert.equal(voiceCheck?.ok, false);
    assert.equal(voiceCheck?.detail, "EVENTLOOPOS_WHISPER_MODEL is required for whisper_cpp_stream preset");
  });

  it("prints JSON and exits non-zero when any check fails", async () => {
    const writes: string[] = [];
    const exitCode = await runDoctorCli({
      baseUrl: "http://127.0.0.1:4377",
      platform: "darwin",
      fetchFn: async () => {
        throw new Error("fetch failed");
      },
      execFn: async () => ({ stdout: "[]", stderr: "" }),
      codexCheckFn: async () => ({
        name: "codex_app_server",
        ok: true,
        detail: "Codex app-server responded; sampled 1 thread(s)",
      }),
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
    });

    assert.equal(exitCode, 1);
    const parsed = JSON.parse(writes.join(""));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.checks[0].name, "orchestrator_health");
    assert.equal(parsed.checks[0].detail, "fetch failed");
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
