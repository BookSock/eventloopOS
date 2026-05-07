import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it } from "node:test";
import {
  githubApiUrlToWebUrl,
  ghNotificationToPollItem,
  ghNotificationsArgs,
  githubNotificationWebUrl,
  listGhNotifications,
  notificationsOptionsFromEnv,
  notificationsOptionsWithCursor,
  parseGhNotificationsOutput,
  type GhExecFile,
} from "./gh_notifications_server.js";

describe("gh notifications MCP server", () => {
  it("builds read-only gh api notification args from env options", () => {
    const options = notificationsOptionsFromEnv({
      EVENTLOOPOS_GH_COMMAND: "gh",
      EVENTLOOPOS_GH_REPO: "acme-corp/dbtool",
      EVENTLOOPOS_GH_PARTICIPATING: "false",
      EVENTLOOPOS_GH_ALL: "true",
      EVENTLOOPOS_GH_SINCE: "2026-05-01T00:00:00Z",
      EVENTLOOPOS_GH_BEFORE: "2026-05-07T00:00:00Z",
      EVENTLOOPOS_GH_LIMIT: "99",
    });

    assert.deepEqual(ghNotificationsArgs(options), [
      "api",
      "-X",
      "GET",
      "repos/acme-corp/dbtool/notifications",
      "-f",
      "per_page=50",
      "-f",
      "participating=false",
      "-f",
      "all=true",
      "-f",
      "since=2026-05-01T00:00:00Z",
      "-f",
      "before=2026-05-07T00:00:00Z",
    ]);
  });

  it("uses MCP cursor as GitHub since when explicit since is absent", () => {
    const options = notificationsOptionsFromEnv({});

    assert.deepEqual(ghNotificationsArgs(notificationsOptionsWithCursor(options, "2026-05-06T17:00:00Z")), [
      "api",
      "-X",
      "GET",
      "notifications",
      "-f",
      "per_page=20",
      "-f",
      "participating=true",
      "-f",
      "all=false",
      "-f",
      "since=2026-05-06T17:00:00Z",
    ]);
    assert.equal(notificationsOptionsWithCursor({ ...options, since: "2026-05-01T00:00:00Z" }, "2026-05-06T17:00:00Z").since, "2026-05-01T00:00:00Z");
    assert.equal(notificationsOptionsWithCursor(options, "0").since, undefined);
  });

  it("parses gh output as notification array", () => {
    assert.deepEqual(parseGhNotificationsOutput("[{\"id\":\"1\"}]"), [{ id: "1" }]);
    assert.throws(() => parseGhNotificationsOutput("{\"id\":\"1\"}"), /must be a JSON array/);
  });

  it("maps GitHub notifications to existing GitHub poll item shape", () => {
    const notification = notificationFixture();

    assert.deepEqual(ghNotificationToPollItem(notification), {
      id: "1",
      repo: "octokit/octokit.rb",
      type: "github.notification.issue",
      title: "Greetings",
      body: "reason=mention; subject_type=Issue; unread=true; last_read_at=2014-11-07T22:01:45Z",
      actor: "github",
      occurred_at: "2014-11-07T22:01:45Z",
      updated_at: "2014-11-07T22:01:45Z",
      url: "https://github.com/octokit/octokit.rb/issues/123#issuecomment-456",
      raw: notification,
    });
  });

  it("converts common GitHub API URLs to browser URLs", () => {
    assert.equal(
      githubApiUrlToWebUrl("https://api.github.com/repos/octokit/octokit.rb/issues/123"),
      "https://github.com/octokit/octokit.rb/issues/123",
    );
    assert.equal(
      githubApiUrlToWebUrl("https://api.github.com/repos/octokit/octokit.rb/pulls/42"),
      "https://github.com/octokit/octokit.rb/pull/42",
    );
    assert.equal(
      githubApiUrlToWebUrl("https://api.github.com/repos/octokit/octokit.rb/commits/abc123"),
      "https://github.com/octokit/octokit.rb/commit/abc123",
    );
    assert.equal(
      githubApiUrlToWebUrl("https://api.github.com/repos/octokit/octokit.rb/issues/comments/456", "octokit/octokit.rb", "https://github.com/octokit/octokit.rb/issues/123"),
      "https://github.com/octokit/octokit.rb/issues/123#issuecomment-456",
    );
  });

  it("prefers latest comment URL anchored to subject URL", () => {
    assert.equal(githubNotificationWebUrl(notificationFixture()), "https://github.com/octokit/octokit.rb/issues/123#issuecomment-456");
  });

  it("lists notifications through injected gh exec without live GitHub", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const fakeExec: GhExecFile = async (command, args) => {
      calls.push({ command, args });
      return {
        stderr: "",
        stdout: JSON.stringify([notificationFixture()]),
      };
    };

    const result = await listGhNotifications(notificationsOptionsFromEnv({
      EVENTLOOPOS_GH_LIMIT: "1",
    }), fakeExec);

    assert.equal(calls[0]?.command, "gh");
    assert.deepEqual(calls[0]?.args, [
      "api",
      "-X",
      "GET",
      "notifications",
      "-f",
      "per_page=1",
      "-f",
      "participating=true",
      "-f",
      "all=false",
    ]);
    assert.equal(result.nextCursor, "2014-11-07T22:01:45Z");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.repo, "octokit/octokit.rb");
  });

  it("serves list_notifications over stdio through MCP SDK", async () => {
    const serverPath = fileURLToPath(new URL("./gh_notifications_server.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        EVENTLOOPOS_GH_COMMAND: process.execPath,
        EVENTLOOPOS_GH_LIMIT: "1",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "eventloopos-gh-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_notifications"]);
      assert.equal(tools.tools[0]?.annotations?.readOnlyHint, true);
      assert.equal((tools.tools[0]?.inputSchema.properties?.cursor as { type?: string } | undefined)?.type, "string");
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});

function notificationFixture(): Record<string, unknown> {
  return {
    id: "1",
    repository: {
      full_name: "octokit/octokit.rb",
      html_url: "https://github.com/octokit/octokit.rb",
    },
    subject: {
      title: "Greetings",
      url: "https://api.github.com/repos/octokit/octokit.rb/issues/123",
      latest_comment_url: "https://api.github.com/repos/octokit/octokit.rb/issues/comments/456",
      type: "Issue",
    },
    reason: "mention",
    unread: true,
    updated_at: "2014-11-07T22:01:45Z",
    last_read_at: "2014-11-07T22:01:45Z",
    url: "https://api.github.com/notifications/threads/1",
  };
}
