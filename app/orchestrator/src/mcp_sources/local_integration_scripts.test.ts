import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { parseScriptEventsOutput } from "./script_events_server.js";

const execFile = promisify(execFileCallback);

describe("local integration poll scripts", () => {
  it("emits generic poll items for todo markdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloopos-todo-md-"));
    try {
      const todoPath = join(dir, "todo.md");
      await writeFile(todoPath, [
        "# Private todos",
        "- [ ] Ship local polling docs [task:local integration]",
        "- [x] Ignore completed tasks",
        "- TODO: Follow up with Gmail sender",
      ].join("\n"));

      const { stdout } = await execFile("node", ["../../scripts/poll-todo-md.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          EVENTLOOPOS_TODO_MD_PATHS: todoPath,
          EVENTLOOPOS_TODO_MD_PROJECT_HINT: "eventloopOS",
        },
      });
      const result = parseScriptEventsOutput(stdout);

      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].source, "todo_md");
      assert.equal(result.items[0].type, "todo_md.item");
      assert.equal(result.items[0].project_hint, "eventloopOS");
      assert.equal(result.items[0].task_hint, "local integration");
      const todoLinks = result.items[0].links as Array<{ url: string }>;
      assert.match(todoLinks[0].url, /^file:\/\//);
      assert.equal(result.items[1].title, "Follow up with Gmail sender");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits generic poll items for Gmail through a gws-compatible command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloopos-gws-"));
    try {
      const fakeGwsPath = join(dir, "fake-gws.mjs");
      await writeFile(fakeGwsPath, `#!/usr/bin/env node
const params = JSON.parse(process.argv[process.argv.indexOf("--params") + 1]);
if (process.argv.includes("list")) {
  console.log(JSON.stringify({ messages: [{ id: "msg-1" }] }));
} else {
  console.log(JSON.stringify({
    id: params.id,
    threadId: "thread-1",
    labelIds: ["INBOX", "UNREAD"],
    internalDate: "1770000000000",
    snippet: "Need local polling review",
    payload: {
      headers: [
        { name: "From", value: "Ada <ada@example.com>" },
        { name: "Subject", value: "Polling review" }
      ]
    }
  }));
}
`, { mode: 0o755 });

      const { stdout } = await execFile("node", ["../../scripts/poll-gmail-unread.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          EVENTLOOPOS_GMAIL_COMMAND: fakeGwsPath,
          EVENTLOOPOS_GMAIL_CONFIG_DIR: dir,
          EVENTLOOPOS_GMAIL_USER_ID: "me",
          EVENTLOOPOS_GMAIL_QUERY: "in:inbox is:unread",
          EVENTLOOPOS_GMAIL_LIMIT: "3",
          EVENTLOOPOS_GMAIL_PROJECT_HINT: "eventloopOS",
          EVENTLOOPOS_GMAIL_TASK_HINT: "local integration",
          EVENTLOOPOS_GMAIL_TIMEOUT_MS: "1000",
        },
      });
      const result = parseScriptEventsOutput(stdout);

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].source, "gmail");
      assert.equal(result.items[0].type, "gmail.message");
      assert.equal(result.items[0].project_hint, "eventloopOS");
      assert.equal(result.items[0].task_hint, "local integration");
      assert.equal(result.items[0].title, "Email from Ada <ada@example.com>: Polling review");
      const raw = result.items[0].raw as { threadId: string };
      assert.equal(raw.threadId, "thread-1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
