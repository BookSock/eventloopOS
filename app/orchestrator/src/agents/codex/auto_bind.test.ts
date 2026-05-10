import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoBindCodexFromWindows } from "./auto_bind.js";

describe("autoBindCodexFromWindows", () => {
  function makeWorkspace(windows: Array<{ id: number; app: string; title: string; workspace: string }>) {
    return {
      status() { return { available: true, backend: "aerospace" } as const; },
      capture() {
        return {
          backend: "aerospace" as const,
          windows: windows.map((window) => ({ ...window })),
        };
      },
      planRestore() { throw new Error("not used"); },
    };
  }

  it("auto-binds when window title has [task:foo] and one matching session exists", async () => {
    const sessions = [
      { id: "session_blog", task_id: "task_blog_launch", provider: "codex", status: "idle" },
      { id: "session_recruiting", task_id: "task_recruiting", provider: "codex", status: "idle" },
    ];
    const bindCalls: Array<{ task_session_id: string; task_id: string; terminal_ref?: string }> = [];
    const taskSessions = {
      listSessions() { return sessions; },
      sendFollowupMessage() { throw new Error("not used"); },
      bindTaskSession(input: { task_session_id: string; task_id: string; terminal_ref?: string }) {
        bindCalls.push(input);
        return { ok: true, task_session_id: input.task_session_id, task_id: input.task_id };
      },
    };
    const workspace = makeWorkspace([
      { id: 101, app: "Ghostty", title: "[task:blog launch] codex", workspace: "main" },
      { id: 102, app: "Google Chrome", title: "[task:blog launch] not a terminal", workspace: "main" },
    ]);

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
    });

    assert.equal(result.matched_count, 1);
    assert.equal(result.bound.length, 1);
    assert.equal(result.bound[0].task_id, "task_blog_launch");
    assert.equal(result.bound[0].terminal_ref, "ghostty:win-101");
    assert.equal(bindCalls.length, 1);
    assert.equal(bindCalls[0].terminal_ref, "ghostty:win-101");
  });

  it("skips when multiple sessions match a task tag", async () => {
    const sessions = [
      { id: "session_blog_a", task_id: "task_blog", provider: "codex", status: "idle" },
      { id: "session_blog_b", task_id: "task_blog", provider: "codex", status: "idle" },
    ];
    const taskSessions = {
      listSessions() { return sessions; },
      sendFollowupMessage() { throw new Error("not used"); },
      bindTaskSession() { throw new Error("should not bind on ambiguous match"); },
    };
    const workspace = makeWorkspace([
      { id: 200, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
    ]);

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
    });

    assert.equal(result.matched_count, 1);
    assert.equal(result.bound.length, 0);
    assert.equal(result.skipped[0]?.reason, "multiple_sessions_for_task");
  });

  it("skips when terminal_ref is already set to the per-window ref", async () => {
    const sessions = [
      { id: "session_x", task_id: "task_blog", provider: "codex", status: "idle", terminal_ref: "ghostty:win-300" },
    ];
    const taskSessions = {
      listSessions() { return sessions; },
      sendFollowupMessage() { throw new Error("not used"); },
      bindTaskSession() { throw new Error("should not rebind already bound"); },
    };
    const workspace = makeWorkspace([
      { id: 300, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
    ]);

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
    });

    assert.equal(result.bound.length, 0);
    assert.equal(result.skipped[0]?.reason, "already_bound");
  });

  it("emits per-window terminal_ref so two [task:foo] windows do not collide on ghostty:front", async () => {
    const sessions = [
      { id: "session_blog_a", task_id: "task_blog_a", provider: "codex", status: "idle" },
      { id: "session_blog_b", task_id: "task_blog_b", provider: "codex", status: "idle" },
    ];
    const bindCalls: Array<{ task_session_id: string; task_id: string; terminal_ref?: string }> = [];
    const taskSessions = {
      listSessions() { return sessions; },
      sendFollowupMessage() { throw new Error("not used"); },
      bindTaskSession(input: { task_session_id: string; task_id: string; terminal_ref?: string }) {
        bindCalls.push(input);
        return { ok: true, task_session_id: input.task_session_id, task_id: input.task_id };
      },
    };
    const workspace = makeWorkspace([
      { id: 501, app: "Ghostty", title: "[task:blog_a] codex", workspace: "main" },
      { id: 502, app: "Ghostty", title: "[task:blog_b] codex", workspace: "main" },
    ]);

    const result = await autoBindCodexFromWindows({ workspace, taskSessions });

    assert.equal(result.bound.length, 2);
    const refs = new Set(result.bound.map((entry) => entry.terminal_ref));
    assert.ok(refs.has("ghostty:win-501"), `expected ghostty:win-501, got ${[...refs].join(",")}`);
    assert.ok(refs.has("ghostty:win-502"), `expected ghostty:win-502, got ${[...refs].join(",")}`);
    assert.notEqual(result.bound[0].terminal_ref, result.bound[1].terminal_ref, "two windows must not collide on the same terminal_ref");
  });
});
