import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDoctor, runDoctorCli } from "./doctor.js";

describe("developer doctor", () => {
  it("reports all live backend checks as machine-readable JSON", async () => {
    const report = await runDoctor({
      baseUrl: "http://127.0.0.1:4377",
      now: () => new Date("2026-05-06T18:00:00.000Z"),
      fetchFn: async (url) => {
        assert.equal(String(url), "http://127.0.0.1:4377/health");
        return response({ ok: true }, 200);
      },
      execFn: async (command, args) => {
        if (command === "aerospace") {
          assert.deepEqual(args, ["list-windows", "--all", "--json"]);
          return { stdout: "[]", stderr: "" };
        }
        if (command === "docker") {
          assert.deepEqual(args, ["info", "--format", "{{.ServerVersion}}"]);
          return { stdout: "29.3.1\n", stderr: "" };
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
          command: ["aerospace", "list-windows", "--all", "--json"],
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
      fetchFn: async () => response({ ok: true }, 200),
      execFn: async (command) => {
        if (command === "aerospace") {
          throw new Error("Can't connect to AeroSpace server. Is AeroSpace.app running?");
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
      ["codex_app_server", true, "Codex app-server responded; sampled 1 thread(s)"],
    ]);
  });

  it("prints JSON and exits non-zero when any check fails", async () => {
    const writes: string[] = [];
    const exitCode = await runDoctorCli({
      baseUrl: "http://127.0.0.1:4377",
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
