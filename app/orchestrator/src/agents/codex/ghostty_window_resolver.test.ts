import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  _clearGhosttyResolverCache,
  parseAppleScriptIdList,
  resolveGhosttyWindowId,
  type RunOsascript,
} from "./ghostty_window_resolver.js";

describe("parseAppleScriptIdList", () => {
  it("returns empty list for empty stdout", () => {
    assert.deepEqual(parseAppleScriptIdList(""), []);
    assert.deepEqual(parseAppleScriptIdList("\n"), []);
    assert.deepEqual(parseAppleScriptIdList("   "), []);
  });

  it("returns single id for bare text id", () => {
    assert.deepEqual(parseAppleScriptIdList("ghost-abc-123\n"), ["ghost-abc-123"]);
  });

  it("splits AppleScript list rendering 'a, b, c' on commas", () => {
    assert.deepEqual(parseAppleScriptIdList("ghost-1, ghost-2, ghost-3"), ["ghost-1", "ghost-2", "ghost-3"]);
  });
});

describe("resolveGhosttyWindowId", () => {
  beforeEach(() => {
    _clearGhosttyResolverCache();
  });

  it("returns null when osascript prints nothing (zero matches)", async () => {
    const calls: string[][] = [];
    const runOsascript: RunOsascript = async (args) => {
      calls.push(args);
      return { stdout: "" };
    };
    const result = await resolveGhosttyWindowId({ taskSlug: "blog_launch", runOsascript });
    assert.equal(result.ghosttyTextId, null);
    assert.equal(result.matched, 0);
    assert.equal(result.ambiguous, false);
    assert.equal(result.cached, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "-e");
    assert.match(calls[0][1] ?? "", /tell application "Ghostty"/);
    assert.match(calls[0][1] ?? "", /\[task:blog_launch\]/);
  });

  it("returns the single text id when exactly one window matches", async () => {
    const runOsascript: RunOsascript = async () => ({ stdout: "ghost-abc-123\n" });
    const result = await resolveGhosttyWindowId({ taskSlug: "blog_launch", runOsascript });
    assert.equal(result.ghosttyTextId, "ghost-abc-123");
    assert.equal(result.matched, 1);
    assert.equal(result.ambiguous, false);
  });

  it("returns the first id and flags ambiguous when multiple windows match", async () => {
    const runOsascript: RunOsascript = async () => ({ stdout: "ghost-a, ghost-b, ghost-c\n" });
    const result = await resolveGhosttyWindowId({ taskSlug: "blog", runOsascript });
    assert.equal(result.ghosttyTextId, "ghost-a");
    assert.equal(result.matched, 3);
    assert.equal(result.ambiguous, true);
  });

  it("returns null when osascript throws (Ghostty not running, permission denied, etc)", async () => {
    const runOsascript: RunOsascript = async () => {
      throw new Error("execution error: Application isn't running");
    };
    const result = await resolveGhosttyWindowId({ taskSlug: "blog", runOsascript });
    assert.equal(result.ghosttyTextId, null);
    assert.equal(result.matched, 0);
    assert.equal(result.ambiguous, false);
  });

  it("caches results for ~30s — second call within TTL skips osascript fork", async () => {
    let osascriptCalls = 0;
    const runOsascript: RunOsascript = async () => {
      osascriptCalls += 1;
      return { stdout: "ghost-cache-1" };
    };
    let virtualNow = 1_000_000;
    const now = () => virtualNow;

    const first = await resolveGhosttyWindowId({ taskSlug: "blog", runOsascript, now });
    assert.equal(first.ghosttyTextId, "ghost-cache-1");
    assert.equal(first.cached, false);
    assert.equal(osascriptCalls, 1);

    virtualNow += 5_000;
    const second = await resolveGhosttyWindowId({ taskSlug: "blog", runOsascript, now });
    assert.equal(second.ghosttyTextId, "ghost-cache-1");
    assert.equal(second.cached, true);
    assert.equal(osascriptCalls, 1, "osascript should not be re-invoked while cache is warm");

    virtualNow += 30_000;
    const third = await resolveGhosttyWindowId({ taskSlug: "blog", runOsascript, now });
    assert.equal(third.cached, false, "cache entry past TTL is refreshed");
    assert.equal(osascriptCalls, 2);
  });

  it("caches null results too — Ghostty not running shouldn't fork osascript per tick", async () => {
    let osascriptCalls = 0;
    const runOsascript: RunOsascript = async () => {
      osascriptCalls += 1;
      throw new Error("no app");
    };
    const now = () => 5_000_000;

    const first = await resolveGhosttyWindowId({ taskSlug: "ghost", runOsascript, now });
    const second = await resolveGhosttyWindowId({ taskSlug: "ghost", runOsascript, now });
    assert.equal(first.ghosttyTextId, null);
    assert.equal(second.ghosttyTextId, null);
    assert.equal(second.cached, true);
    assert.equal(osascriptCalls, 1, "null result still cached, no second fork");
  });

  it("escapes shell-hostile slug characters in the AppleScript string literal", async () => {
    const captured: string[][] = [];
    const runOsascript: RunOsascript = async (args) => {
      captured.push(args);
      return { stdout: "" };
    };
    await resolveGhosttyWindowId({ taskSlug: 'evil"slug\\here', runOsascript });
    const script = captured[0][1] ?? "";
    assert.match(script, /\\"/, "double-quote in slug must be escaped as \\\"");
    assert.match(script, /\\\\/, "backslash in slug must be doubled");
  });

  it("returns null without invoking osascript for empty slug", async () => {
    let calls = 0;
    const runOsascript: RunOsascript = async () => {
      calls += 1;
      return { stdout: "" };
    };
    const result = await resolveGhosttyWindowId({ taskSlug: "   ", runOsascript });
    assert.equal(result.ghosttyTextId, null);
    assert.equal(calls, 0, "empty slug short-circuits before forking osascript");
  });
});
