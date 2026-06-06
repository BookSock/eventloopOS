import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ClaudeCliTaskSessionController,
  parseClaudeSessionConfigs,
  taskSessionIdForClaudeSession,
  type ClaudeCliExec,
} from "./claude_cli_task_session_controller.js";

describe("ClaudeCliTaskSessionController", () => {
  it("maps configured Claude sessions to routable task sessions", () => {
    const controller = new ClaudeCliTaskSessionController({
      sessions: [
        {
          session_id: "claude-session-blog",
          task_id: "task_blog_feedback",
          name: "Blog feedback",
          cwd: "/repo",
          status: "running",
          created_at: "2026-05-06T17:00:00.000Z",
          updated_at: "2026-05-06T18:00:00.000Z",
          pid: 510,
          agent_pid: 511,
          terminal_pid: 509,
          root_pid: 500,
          pids: [510, 511],
        },
      ],
      execFile: async () => ({ stdout: "{}", stderr: "" }),
    });

    assert.deepEqual(controller.listSessions(), [
      {
        id: taskSessionIdForClaudeSession("claude-session-blog"),
        task_id: "task_blog_feedback",
        provider: "claude",
        native_session_id: "claude-session-blog",
        name: "Blog feedback",
        cwd: "/repo",
        status: "running",
        supports: {
          steer: true,
          followup: true,
          collect: true,
          interrupt: false,
          compact: true,
        },
        last_seen_at: "2026-05-06T18:00:00.000Z",
        created_at: "2026-05-06T17:00:00.000Z",
        updated_at: "2026-05-06T18:00:00.000Z",
        pid: 510,
        agent_pid: 511,
        terminal_pid: 509,
        root_pid: 500,
        pids: [500, 509, 510, 511],
      },
    ]);
  });

  it("sends followup through claude print resume mode and dedupes retries", async () => {
    const calls: Array<{ command: string; args: string[]; options: { cwd?: string; timeoutMs: number } }> = [];
    const execFile: ClaudeCliExec = async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        stdout: JSON.stringify({ session_id: "claude-session-blog" }),
        stderr: "",
      };
    };
    const controller = new ClaudeCliTaskSessionController({
      sessions: [
        {
          session_id: "claude-session-blog",
          task_id: "task_blog_feedback",
          cwd: "/repo",
          model: "haiku",
          tools: "",
          max_budget_usd: "0.08",
        },
      ],
      execFile,
      clock: () => new Date("2026-05-06T22:30:00.000Z"),
    });

    const first = await controller.sendFollowupMessage({
      task_session_id: taskSessionIdForClaudeSession("claude-session-blog"),
      text: "Use launch date in next blog draft.",
      event_ids: ["evt_voice_blog"],
      idempotency_key: "inject_voice_blog",
    });
    const duplicate = await controller.sendFollowupMessage({
      task_session_id: taskSessionIdForClaudeSession("claude-session-blog"),
      text: "Different retry payload should dedupe.",
      event_ids: [],
      idempotency_key: "inject_voice_blog",
    });

    assert.equal(first.status, "sent");
    assert.equal(first.provider, "claude");
    assert.equal(first.native_session_id, "claude-session-blog");
    assert.equal(first.native_result_session_id, "claude-session-blog");
    assert.equal(first.sent_at, "2026-05-06T22:30:00.000Z");
    assert.equal(duplicate, first);
    assert.deepEqual(calls, [
      {
        command: "claude",
        args: [
          "-p",
          "--output-format",
          "json",
          "--resume",
          "claude-session-blog",
          "--model",
          "haiku",
          "--tools",
          "",
          "--max-budget-usd",
          "0.08",
          "Use launch date in next blog draft.",
        ],
        options: {
          cwd: "/repo",
          timeoutMs: 300_000,
        },
      },
    ]);
  });

  it("returns blocked when configured Claude session is missing", async () => {
    const controller = new ClaudeCliTaskSessionController({
      sessions: [],
      execFile: async () => {
        throw new Error("should not execute");
      },
      clock: () => new Date("2026-05-06T22:30:00.000Z"),
    });

    const message = await controller.sendFollowupMessage({
      task_session_id: taskSessionIdForClaudeSession("missing-session"),
      text: "No target.",
      event_ids: [],
      idempotency_key: "inject_missing",
    });

    assert.equal(message.status, "blocked");
    assert.equal(message.sent_at, undefined);
    assert.equal(message.evidence[0]?.title, "Claude CLI session missing");
  });

  it("returns failed when claude cli exits non-zero", async () => {
    const controller = new ClaudeCliTaskSessionController({
      sessions: [{ session_id: "claude-session-blog" }],
      execFile: async () => {
        throw new Error("claude auth missing");
      },
      clock: () => new Date("2026-05-06T22:30:00.000Z"),
    });

    const message = await controller.sendFollowupMessage({
      task_session_id: taskSessionIdForClaudeSession("claude-session-blog"),
      text: "Try Claude session.",
      event_ids: ["evt_1"],
      idempotency_key: "inject_fail",
    });

    assert.equal(message.status, "failed");
    assert.equal(message.native_session_id, "claude-session-blog");
    assert.equal(message.sent_at, undefined);
    assert.match(message.evidence[0]?.title ?? "", /claude auth missing/);
  });
});

describe("parseClaudeSessionConfigs", () => {
  it("parses string and object config forms", () => {
    assert.deepEqual(parseClaudeSessionConfigs(JSON.stringify({
      "session-a": "task_blog_feedback",
      "session-b": {
        task_id: "task_infra",
        name: "Infra",
        cwd: "/repo",
        model: "haiku",
        tools: "",
        max_budget_usd: "0.08",
        status: "blocked",
        created_at: "2026-05-06T17:00:00.000Z",
        updated_at: "2026-05-06T18:00:00.000Z",
        pid: 510,
        agentPid: 511,
        terminal_pid: 509,
        pids: [510, 511],
      },
      "session-c": {
        task_id: "task_checkout",
        status: "Needs User Input",
      },
    })), [
      {
        session_id: "session-a",
        task_id: "task_blog_feedback",
      },
      {
        session_id: "session-b",
        task_id: "task_infra",
        name: "Infra",
        cwd: "/repo",
        model: "haiku",
        tools: "",
        max_budget_usd: "0.08",
        status: "blocked",
        created_at: "2026-05-06T17:00:00.000Z",
        updated_at: "2026-05-06T18:00:00.000Z",
        pid: 510,
        agent_pid: 511,
        terminal_pid: 509,
        root_pid: 509,
        pids: [509, 510, 511],
      },
      {
        session_id: "session-c",
        task_id: "task_checkout",
        name: undefined,
        cwd: undefined,
        model: undefined,
        tools: undefined,
        max_budget_usd: undefined,
        status: "waiting_approval",
        created_at: undefined,
        updated_at: undefined,
      },
    ]);
  });

  it("rejects malformed config", () => {
    assert.throws(() => parseClaudeSessionConfigs("[]"), /must be a JSON object/);
    assert.throws(() => parseClaudeSessionConfigs(JSON.stringify({ "session-a": 123 })), /values must be task ids or objects/);
    assert.throws(() => parseClaudeSessionConfigs(JSON.stringify({ "session-a": "" })), /task id must be non-empty/);
  });
});
