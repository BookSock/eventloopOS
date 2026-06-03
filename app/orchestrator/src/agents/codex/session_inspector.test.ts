import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCodexSession } from "./session_inspector.js";

describe("inspectCodexSession", () => {
  it("returns exists=false when codex home is missing", async () => {
    const result = await inspectCodexSession("nonexistent_thread", { codexHome: join(tmpdir(), `codex-missing-${Date.now()}`) });
    assert.equal(result.exists, false);
  });

  it("derives idle_seconds and recent_event_types from a rollout file", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-test-"));
    const dayPath = join(codexHome, "sessions", "2026", "05", "06");
    await mkdir(dayPath, { recursive: true });
    const threadId = "thread_idle_test";
    const rolloutPath = join(dayPath, `rollout-2026-05-06T10-00-00-${threadId}.jsonl`);
    const lines = [
      JSON.stringify({ timestamp: "2026-05-06T17:30:00.000Z", type: "session_meta", payload: {} }),
      JSON.stringify({ timestamp: "2026-05-06T17:31:00.000Z", type: "user_input", payload: { text: "hello agent" } }),
      JSON.stringify({
        timestamp: "2026-05-06T17:32:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "needs user decision on API shape" },
      }),
    ];
    await writeFile(rolloutPath, lines.join("\n") + "\n");

    try {
      const result = await inspectCodexSession(threadId, {
        codexHome,
        now: new Date("2026-05-06T17:42:00.000Z"),
      });
      assert.equal(result.exists, true);
      assert.equal(result.event_count, 3);
      assert.equal(result.last_event_at, "2026-05-06T17:32:00.000Z");
      assert.equal(result.idle_seconds, 600);
      assert.deepEqual(result.recent_event_types, ["event_msg", "user_input", "session_meta"]);
      assert.equal(result.recent_summary, "event_msg/agent_message: needs user decision on API shape");
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});
