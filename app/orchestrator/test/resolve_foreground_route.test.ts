import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import { _clearForegroundResolverCache, type ListRolloutFiles } from "../src/agents/codex/foreground_resolver.js";
import { _clearGhosttyResolverCache, type RunOsascript } from "../src/agents/codex/ghostty_window_resolver.js";

type ResolveResponse = {
  codex_thread_id: string | null;
  ghostty_window_id: string | null;
  source: "title_resolver" | "codex_session" | "none";
};

describe("POST /agents/codex/resolve-foreground", () => {
  let server: Server;
  let baseUrl: string;
  let osascriptReplies: Map<string, string> = new Map();
  let rollouts: Array<{ path: string; threadId: string; mtimeMs: number }> = [];

  const runOsascript: RunOsascript = async (args) => {
    const script = args[args.length - 1];
    for (const [needle, reply] of osascriptReplies.entries()) {
      if (script.includes(needle)) {
        return { stdout: reply };
      }
    }
    return { stdout: "" };
  };

  const listRolloutFiles: ListRolloutFiles = async () => rollouts;

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({ store, runOsascript, listRolloutFiles });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    _clearForegroundResolverCache();
    _clearGhosttyResolverCache();
    osascriptReplies = new Map();
    rollouts = [];
  });

  async function post(): Promise<ResolveResponse> {
    const response = await fetch(`${baseUrl}/agents/codex/resolve-foreground`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    return await response.json() as ResolveResponse;
  }

  it("returns title_resolver when [task:<slug>] tag present", async () => {
    osascriptReplies.set("frontmost is true", "Ghostty");
    osascriptReplies.set("front window", "front-id\t[task:blog] codex working");
    osascriptReplies.set("every window whose name contains", "ghost-blog-101");
    const result = await post();
    assert.equal(result.source, "title_resolver");
    assert.equal(result.ghostty_window_id, "ghost-blog-101");
    assert.equal(result.codex_thread_id, null);
  });

  it("returns codex_session via mtime when no tag and rollouts exist", async () => {
    osascriptReplies.set("frontmost is true", "Ghostty");
    osascriptReplies.set("front window", "front-id\tnaked codex");
    rollouts = [
      { path: "/x/old.jsonl", threadId: "11111111-1111-1111-1111-111111111111", mtimeMs: 100 },
      { path: "/x/new.jsonl", threadId: "22222222-2222-2222-2222-222222222222", mtimeMs: 999 },
    ];
    const result = await post();
    assert.equal(result.source, "codex_session");
    assert.equal(result.codex_thread_id, "22222222-2222-2222-2222-222222222222");
    assert.equal(result.ghostty_window_id, "front-id");
  });

  it("returns none when Ghostty is not frontmost", async () => {
    osascriptReplies.set("frontmost is true", "Finder");
    const result = await post();
    assert.deepEqual(
      { codex_thread_id: result.codex_thread_id, ghostty_window_id: result.ghostty_window_id, source: result.source },
      { codex_thread_id: null, ghostty_window_id: null, source: "none" },
    );
  });
});
