import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onboardingScanOptionsFromEnvAndArgv, runOnboardingScanCli } from "./onboarding_scan_cli.js";

describe("onboarding scan CLI", () => {
  it("parses env and argv", () => {
    assert.deepEqual(onboardingScanOptionsFromEnvAndArgv(
      { EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test" },
      ["--format", "agent"],
    ), {
      baseUrl: "http://env.test",
      command: "scan",
      format: "agent",
      taskId: undefined,
      taskHint: undefined,
      proposalId: undefined,
      windowIds: [],
      taskSessionIds: [],
      browserContextIds: [],
      queuePaper: false,
    });
  });

  it("prints text summary", async () => {
    let output = "";
    const exitCode = await runOnboardingScanCli({
      baseUrl: "http://example.test",
      command: "scan",
      format: "text",
      windowIds: [],
      taskSessionIds: [],
      browserContextIds: [],
      queuePaper: false,
      stdout: { write: (chunk: string) => { output += chunk; return true; } },
      fetchFn: async () => new Response(JSON.stringify({
        ok: true,
        active_workspace: "main",
        focused_window_id: 1,
        summary: {
          window_count: 2,
          grouped_window_count: 1,
          ungrouped_window_count: 1,
          task_session_count: 1,
          proposal_count: 1,
        },
        proposals: [
          { task_id: "task_blog", title: "Blog", confidence: "high", windows: [{ id: 1 }], task_sessions: [] },
        ],
        warnings: [],
      }), { status: 200 }),
    });

    assert.equal(exitCode, 0);
    assert.match(output, /task_blog/);
    assert.match(output, /workspace: main; focused window: 1/);
    assert.match(output, /scan: 2 windows, 1 grouped, 1 task sessions/);
  });

  it("prints agent onboarding brief", async () => {
    let output = "";
    const exitCode = await runOnboardingScanCli({
      baseUrl: "http://example.test",
      command: "scan",
      format: "agent",
      windowIds: [],
      taskSessionIds: [],
      browserContextIds: [],
      queuePaper: false,
      stdout: { write: (chunk: string) => { output += chunk; return true; } },
      fetchFn: async () => new Response(JSON.stringify({
        ok: true,
        active_workspace: "main",
        focused_window_id: 1,
        summary: {
          window_count: 2,
          grouped_window_count: 1,
          ungrouped_window_count: 1,
          task_session_count: 1,
          proposal_count: 1,
        },
        proposals: [
          { task_id: "task_blog", title: "Blog", confidence: "high", windows: [{ id: 1 }], task_sessions: [] },
        ],
        warnings: ["AeroSpace unavailable"],
      }), { status: 200 }),
    });

    assert.equal(exitCode, 0);
    assert.match(output, /eventloopOS agent onboarding brief/);
    assert.match(output, /pnpm run dev:doctor:preflight/);
    assert.match(output, /EVENTLOOPOS_DOGFOOD_PROFILE=experiment/);
    assert.match(output, /pnpm run onboarding:apply -- --proposal onboard_abc123 --queue-paper/);
    assert.match(output, /task_blog/);
    assert.match(output, /AeroSpace unavailable/);
  });

  it("applies approved windows and sessions", async () => {
    let requestedUrl = "";
    let requestBody: unknown;
    let output = "";
    const exitCode = await runOnboardingScanCli({
      baseUrl: "http://example.test",
      command: "apply",
      format: "json",
      taskId: "task_blog",
      proposalId: "onboard_blog",
      windowIds: [1, 2],
      taskSessionIds: ["codex_thread_abc"],
      browserContextIds: ["browser_tab:42"],
      queuePaper: true,
      stdout: { write: (chunk: string) => { output += chunk; return true; } },
      fetchFn: async (url, init) => {
        requestedUrl = url.toString();
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, task_id: "task_blog" }), { status: 200 });
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "http://example.test/onboarding/approvals");
    assert.deepEqual(requestBody, {
      task_id: "task_blog",
      proposal_id: "onboard_blog",
      window_ids: [1, 2],
      task_session_ids: ["codex_thread_abc"],
      browser_context_ids: ["browser_tab:42"],
      queue_paper: true,
      actor_id: "onboarding_cli",
    });
    assert.deepEqual(JSON.parse(output), { ok: true, task_id: "task_blog" });
  });

  it("parses proposal approval id", () => {
    const options = onboardingScanOptionsFromEnvAndArgv({}, ["apply", "--proposal", "onboard_abc"]);

    assert.equal(options.command, "apply");
    assert.equal(options.proposalId, "onboard_abc");
  });

  it("parses queue paper flag", () => {
    const options = onboardingScanOptionsFromEnvAndArgv({}, ["apply", "--proposal", "onboard_abc", "--queue-paper"]);

    assert.equal(options.command, "apply");
    assert.equal(options.proposalId, "onboard_abc");
    assert.equal(options.queuePaper, true);
  });

  it("parses browser context selectors", () => {
    const options = onboardingScanOptionsFromEnvAndArgv({}, [
      "apply",
      "--browser-context",
      "browser_tab:1,browser_tab:2",
      "--tab",
      "browser_tab:3",
    ]);

    assert.deepEqual(options.browserContextIds, ["browser_tab:1", "browser_tab:2", "browser_tab:3"]);
  });
});
