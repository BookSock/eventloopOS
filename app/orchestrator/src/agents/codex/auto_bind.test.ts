import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoBindCodexFromWindows, type GhosttyWindowResolver } from "./auto_bind.js";

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

  // Default resolver for tests: every Ghostty match resolves to a synthetic
  // text id derived from the slug. Concrete tests can override per case.
  function makeResolver(map: Record<string, { ghosttyTextId: string | null; matched?: number; ambiguous?: boolean }>): GhosttyWindowResolver {
    return async ({ taskSlug }) => {
      const entry = map[taskSlug];
      if (!entry) return { ghosttyTextId: null, matched: 0, ambiguous: false };
      return { ghosttyTextId: entry.ghosttyTextId, matched: entry.matched ?? (entry.ghosttyTextId ? 1 : 0), ambiguous: entry.ambiguous ?? false };
    };
  }

  it("auto-binds when window title has [task:foo] and one matching session exists, preferring the resolved Ghostty text-id over the AeroSpace numeric id", async () => {
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
      ghosttyResolver: makeResolver({ "blog launch": { ghosttyTextId: "ghost-abc-123" } }),
    });

    assert.equal(result.matched_count, 1);
    assert.equal(result.bound.length, 1);
    assert.equal(result.bound[0].task_id, "task_blog_launch");
    assert.equal(result.bound[0].terminal_ref, "ghostty:win-ghost-abc-123", "uses resolved Ghostty text-id, not AeroSpace numeric id");
    assert.equal(bindCalls.length, 1);
    assert.equal(bindCalls[0].terminal_ref, "ghostty:win-ghost-abc-123");
  });

  it("falls back to ghostty:front when the Ghostty resolver returns null (Ghostty not running, no window match)", async () => {
    const sessions = [
      { id: "session_blog", task_id: "task_blog", provider: "codex", status: "idle" },
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
      { id: 101, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
    ]);

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
      ghosttyResolver: async () => ({ ghosttyTextId: null, matched: 0, ambiguous: false }),
    });

    assert.equal(result.bound.length, 1);
    assert.equal(result.bound[0].terminal_ref, "ghostty:front", "fallback preserves V10a single-Ghostty behavior");
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
      ghosttyResolver: makeResolver({ blog: { ghosttyTextId: "ghost-xyz" } }),
    });

    assert.equal(result.matched_count, 1);
    assert.equal(result.bound.length, 0);
    assert.equal(result.skipped[0]?.reason, "multiple_sessions_for_task");
  });

  it("skips when terminal_ref is already set to the per-window ref", async () => {
    const sessions = [
      { id: "session_x", task_id: "task_blog", provider: "codex", status: "idle", terminal_ref: "ghostty:win-ghost-300" },
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
      ghosttyResolver: makeResolver({ blog: { ghosttyTextId: "ghost-300" } }),
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

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
      ghosttyResolver: makeResolver({
        blog_a: { ghosttyTextId: "ghost-a" },
        blog_b: { ghosttyTextId: "ghost-b" },
      }),
    });

    assert.equal(result.bound.length, 2);
    const refs = new Set(result.bound.map((entry) => entry.terminal_ref));
    assert.ok(refs.has("ghostty:win-ghost-a"), `expected ghostty:win-ghost-a, got ${[...refs].join(",")}`);
    assert.ok(refs.has("ghostty:win-ghost-b"), `expected ghostty:win-ghost-b, got ${[...refs].join(",")}`);
    assert.notEqual(result.bound[0].terminal_ref, result.bound[1].terminal_ref, "two windows must not collide on the same terminal_ref");
  });

  it("ambiguous resolver result still binds (first id) and surfaces multiple_ghostty_windows_for_task observability", async () => {
    const sessions = [
      { id: "session_blog", task_id: "task_blog", provider: "codex", status: "idle" },
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
      { id: 700, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
    ]);
    const recordedActivities: Array<{ type: string; details?: Record<string, unknown> }> = [];
    const observability = {
      incrementCounter: async () => {},
      recordActivity: async (event: { type: string; details?: Record<string, unknown> }) => {
        recordedActivities.push({ type: event.type, details: event.details });
      },
      recordError: async () => {},
      recordEvent: async () => {},
    };

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
      observability: observability as never,
      ghosttyResolver: makeResolver({ blog: { ghosttyTextId: "ghost-first", matched: 2, ambiguous: true } }),
    });

    assert.equal(result.bound.length, 1);
    assert.equal(result.bound[0].terminal_ref, "ghostty:win-ghost-first");
    const ambiguousActivities = recordedActivities.filter((a) => a.type === "multiple_ghostty_windows_for_task");
    assert.equal(ambiguousActivities.length, 1, "expected one multiple_ghostty_windows_for_task activity");
  });
});
