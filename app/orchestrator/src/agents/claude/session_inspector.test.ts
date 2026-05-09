import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectClaudeSession } from "./session_inspector.js";

describe("inspectClaudeSession", () => {
  it("returns exists=false when claude home is missing", async () => {
    const result = await inspectClaudeSession("nonexistent_session", { claudeHome: join(tmpdir(), `claude-missing-${Date.now()}`) });
    assert.equal(result.exists, false);
  });

  it("derives idle_seconds and recent_event_types from a session jsonl", async () => {
    const claudeHome = await mkdtemp(join(tmpdir(), "claude-test-"));
    const projectDir = join(claudeHome, "projects", "-Users-jason-test-project");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "session_test_abc";
    const rolloutPath = join(projectDir, `${sessionId}.jsonl`);
    const lines = [
      JSON.stringify({ type: "permission-mode", permissionMode: "default", sessionId }),
      JSON.stringify({ type: "user", timestamp: "2026-05-09T10:00:00.000Z", message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-05-09T10:01:00.000Z", message: { role: "assistant", content: [{ text: "hi back" }] } }),
    ];
    await writeFile(rolloutPath, lines.join("\n") + "\n");

    try {
      const result = await inspectClaudeSession(sessionId, {
        claudeHome,
        now: new Date("2026-05-09T10:11:00.000Z"),
      });
      assert.equal(result.exists, true);
      assert.equal(result.event_count, 3);
      assert.equal(result.last_event_at, "2026-05-09T10:01:00.000Z");
      assert.equal(result.idle_seconds, 600);
      assert.deepEqual(result.recent_event_types, ["assistant", "user", "permission-mode"]);
      assert.match(result.recent_summary ?? "", /assistant: hi back/);
    } finally {
      await rm(claudeHome, { recursive: true, force: true });
    }
  });
});
