import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it } from "node:test";
import {
  agentSlackMessageToPollItem,
  agentSlackSearchArgs,
  parseAgentSlackJsonOutput,
  searchAgentSlackMessages,
  searchOptionsFromEnv,
  type AgentSlackExecFile,
} from "./agent_slack_events_server.js";

describe("agent-slack MCP server", () => {
  it("parses agent-slack output with notices around JSON", () => {
    assert.deepEqual(
      parseAgentSlackJsonOutput("Update available.\n{\"messages\":[{\"ts\":\"1770000000.000001\"}]}\n"),
      { messages: [{ ts: "1770000000.000001" }] },
    );
    assert.throws(() => parseAgentSlackJsonOutput("no json here"), /did not contain a JSON object/);
  });

  it("builds read-only search args from env options", () => {
    const options = searchOptionsFromEnv({
      EVENTLOOPOS_AGENT_SLACK_COMMAND: "agent-slack",
      EVENTLOOPOS_AGENT_SLACK_QUERY: "launch blog",
      EVENTLOOPOS_AGENT_SLACK_WORKSPACE: "acme",
      EVENTLOOPOS_AGENT_SLACK_CHANNELS: "D123,C456",
      EVENTLOOPOS_AGENT_SLACK_USER: "@jason",
      EVENTLOOPOS_AGENT_SLACK_AFTER: "2026-05-01",
      EVENTLOOPOS_AGENT_SLACK_BEFORE: "2026-05-07",
      EVENTLOOPOS_AGENT_SLACK_LIMIT: "7",
      EVENTLOOPOS_AGENT_SLACK_MAX_CONTENT_CHARS: "300",
    });

    assert.deepEqual(agentSlackSearchArgs(options), [
      "search",
      "messages",
      "launch blog",
      "--limit",
      "7",
      "--max-content-chars",
      "300",
      "--workspace",
      "acme",
      "--channel",
      "D123",
      "--channel",
      "C456",
      "--user",
      "@jason",
      "--after",
      "2026-05-01",
      "--before",
      "2026-05-07",
    ]);
  });

  it("maps compact agent-slack messages to Slack poll items", () => {
    assert.deepEqual(agentSlackMessageToPollItem({
      url: "https://acme.slack.com/archives/C123/p1770000000000001",
      text: "Blog post needs launch date.",
      user_name: "Malis",
      thread_ts: "1770000000.000001",
    }), {
      team_id: "acme",
      channel_id: "C123",
      ts: "1770000000.000001",
      text: "Blog post needs launch date.",
      permalink: "https://acme.slack.com/archives/C123/p1770000000000001",
      user_id: "unknown",
      user_name: "Malis",
      thread_ts: "1770000000.000001",
      title: "Slack message from Malis",
      resource_title: "Slack thread",
      occurred_at: "2026-02-02T02:40:00.000Z",
      raw: {
        url: "https://acme.slack.com/archives/C123/p1770000000000001",
        text: "Blog post needs launch date.",
        user_name: "Malis",
        thread_ts: "1770000000.000001",
      },
    });
  });

  it("searches through injected agent-slack exec without live Slack", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const fakeExec: AgentSlackExecFile = async (command, args) => {
      calls.push({ command, args });
      return {
        stderr: "",
        stdout: JSON.stringify({
          messages: [
            {
              team_id: "T123",
              channel_id: "D123",
              ts: "1770000000.000001",
              text: "Blog post priority changed.",
              user_id: "U123",
              user_name: "Jason",
              permalink: "https://acme.slack.com/archives/D123/p1770000000000001",
            },
          ],
        }),
      };
    };

    const result = await searchAgentSlackMessages(searchOptionsFromEnv({
      EVENTLOOPOS_AGENT_SLACK_QUERY: "blog",
      EVENTLOOPOS_AGENT_SLACK_LIMIT: "1",
    }), fakeExec);

    assert.equal(calls[0]?.command, "agent-slack");
    assert.deepEqual(calls[0]?.args, ["search", "messages", "blog", "--limit", "1", "--max-content-chars", "1200"]);
    assert.deepEqual(result, {
      items: [
        {
          team_id: "T123",
          channel_id: "D123",
          ts: "1770000000.000001",
          text: "Blog post priority changed.",
          permalink: "https://acme.slack.com/archives/D123/p1770000000000001",
          user_id: "U123",
          user_name: "Jason",
          thread_ts: "1770000000.000001",
          title: "Slack message from Jason",
          resource_title: "Slack thread",
          occurred_at: "2026-02-02T02:40:00.000Z",
          raw: {
            team_id: "T123",
            channel_id: "D123",
            ts: "1770000000.000001",
            text: "Blog post priority changed.",
            user_id: "U123",
            user_name: "Jason",
            permalink: "https://acme.slack.com/archives/D123/p1770000000000001",
          },
        },
      ],
      nextCursor: "1770000000.000001",
    });
  });

  it("serves search_messages over stdio through MCP SDK", async () => {
    const serverPath = fileURLToPath(new URL("./agent_slack_events_server.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        EVENTLOOPOS_AGENT_SLACK_COMMAND: process.execPath,
        EVENTLOOPOS_AGENT_SLACK_QUERY: "blog",
        EVENTLOOPOS_AGENT_SLACK_LIMIT: "1",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "eventloopos-agent-slack-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["search_messages"]);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
