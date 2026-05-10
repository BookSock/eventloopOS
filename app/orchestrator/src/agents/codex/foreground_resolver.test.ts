import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  _clearForegroundResolverCache,
  resolveForegroundCodex,
  type ListRolloutFiles,
} from "./foreground_resolver.js";
import { _clearGhosttyResolverCache } from "./ghostty_window_resolver.js";
import type { RunOsascript } from "./ghostty_window_resolver.js";

type Reply = string | Error;

function osascriptStub(replies: Map<string, Reply>): { run: RunOsascript; calls: string[] } {
  const calls: string[] = [];
  const run: RunOsascript = async (args) => {
    const script = args[args.length - 1];
    calls.push(script);
    for (const [needle, reply] of replies.entries()) {
      if (script.includes(needle)) {
        if (reply instanceof Error) throw reply;
        return { stdout: reply };
      }
    }
    return { stdout: "" };
  };
  return { run, calls };
}

const ghosttyFront = "Ghostty";
const noFront = "Finder";
const tabbedTitle = "win-task-blog\t[task:blog] codex";
const untaggedTitle = "win-untagged\tnormal title";

describe("resolveForegroundCodex", () => {
  beforeEach(() => {
    _clearForegroundResolverCache();
    _clearGhosttyResolverCache();
  });

  it("returns title_resolver source when foreground Ghostty title contains [task:<slug>]", async () => {
    const { run } = osascriptStub(new Map<string, Reply>([
      ["frontmost is true", ghosttyFront],
      ["front window", tabbedTitle],
      ["every window whose name contains", "ghostty-id-blog"],
    ]));
    const result = await resolveForegroundCodex({ runOsascript: run });
    assert.equal(result.source, "title_resolver");
    assert.equal(result.codex_thread_id, null);
    assert.equal(result.ghostty_window_id, "ghostty-id-blog");
  });

  it("returns codex_session source via mtime fallback when title has no tag", async () => {
    const { run } = osascriptStub(new Map<string, Reply>([
      ["frontmost is true", ghosttyFront],
      ["front window", untaggedTitle],
    ]));
    const newest = "019e12ce-0d1f-7530-b3bc-76e2915a4cf4";
    const lister: ListRolloutFiles = async () => [
      { path: "/codex/old.jsonl", threadId: "111e12ce-0d1f-7530-b3bc-000000000001", mtimeMs: 100 },
      { path: "/codex/new.jsonl", threadId: newest, mtimeMs: 999 },
    ];
    const result = await resolveForegroundCodex({
      runOsascript: run,
      codexHome: "/tmp/fake-codex",
      listRolloutFiles: lister,
    });
    assert.equal(result.source, "codex_session");
    assert.equal(result.codex_thread_id, newest);
    assert.equal(result.ghostty_window_id, "win-untagged");
  });

  it("returns none when Ghostty isn't frontmost", async () => {
    const { run } = osascriptStub(new Map<string, Reply>([
      ["frontmost is true", noFront],
    ]));
    const result = await resolveForegroundCodex({ runOsascript: run });
    assert.deepEqual(result, { codex_thread_id: null, ghostty_window_id: null, source: "none" });
  });

  it("returns none when no codex sessions exist and title has no tag and no window id", async () => {
    const { run } = osascriptStub(new Map<string, Reply>([
      ["frontmost is true", ghosttyFront],
      ["front window", "\t"],
    ]));
    const lister: ListRolloutFiles = async () => [];
    const result = await resolveForegroundCodex({
      runOsascript: run,
      listRolloutFiles: lister,
    });
    assert.equal(result.source, "none");
    assert.equal(result.codex_thread_id, null);
    assert.equal(result.ghostty_window_id, null);
  });

  it("caches the result for the cache TTL window", async () => {
    const { run, calls } = osascriptStub(new Map<string, Reply>([
      ["frontmost is true", ghosttyFront],
      ["front window", untaggedTitle],
    ]));
    const lister: ListRolloutFiles = async () => [
      { path: "/codex/r.jsonl", threadId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", mtimeMs: 1 },
    ];
    let nowMs = 1_000;
    const opts = {
      runOsascript: run,
      listRolloutFiles: lister,
      now: () => nowMs,
      cacheTtlMs: 1_000,
    };
    const a = await resolveForegroundCodex(opts);
    const callsAfterFirst = calls.length;
    nowMs += 500;
    const b = await resolveForegroundCodex(opts);
    assert.deepEqual(a, b);
    assert.equal(calls.length, callsAfterFirst, "cached call should not invoke osascript again");
    nowMs += 600;
    await resolveForegroundCodex(opts);
    assert.ok(calls.length > callsAfterFirst, "after TTL, osascript is invoked again");
  });
});
