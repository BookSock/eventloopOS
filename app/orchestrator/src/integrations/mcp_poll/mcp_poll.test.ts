import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateMcpPollSourceConfig } from "./config_schema.js";
import { createSeededDevelopmentMcpSourceRegistry } from "./development_registry.js";
import { readMcpSourceConfigs } from "./development_registry.js";
import { readMcpPollFixture } from "./fixture_parser.js";
import { createMcpPollerState, pollMcpSource } from "./poller.js";
import type { McpPollSourceConfig } from "./types.js";

describe("MCP poll ingestion", () => {
  it("validates source config and maps Slack fixture to Event objects", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-slack-github-poll.json"));
    const state = createMcpPollerState(config);

    const result = await pollMcpSource({
      config,
      state,
      runner: {
        callTool: async () => fixture,
      },
      receivedAt: "2026-05-06T17:00:00Z",
    });

    assert.equal(result.events.length, 1);
    assert.equal(result.duplicatesIgnored, 1);
    assert.equal(result.cursor, "456.000");
    assert.deepEqual(result.events[0], {
      id: "evt_slack_T123_C123_456_000",
      source: "slack",
      source_id: "slack:T123:C123:456.000",
      idempotency_key: "slack:T123:C123:456.000",
      occurred_at: "2026-05-06T16:58:00Z",
      received_at: "2026-05-06T17:00:00Z",
      actor: {
        id: "actor_slack_U123",
        type: "human",
        name: "Malis",
      },
      project_hint: "pagerfree",
      task_hint: "blog feedback",
      type: "slack.message",
      title: "Slack message from Malis",
      summary: "Customer says pgrust copy needs clearer Postgres version support.",
      raw_ref: {
        id: "raw_slack_T123_C123_456.000",
        uri: "artifact://raw/slack:T123:C123:456.000.json",
        media_type: "application/json",
      },
      links: [
        {
          label: "Slack thread",
          url: "https://slack.example.com/archives/C123/p456000",
        },
      ],
      resources: [
        {
          id: "ctx_slack_T123_C123_456.000",
          kind: "slack_thread",
          title: "Slack thread",
          url: "https://slack.example.com/archives/C123/p456000",
          source: "slack",
          captured_at: "2026-05-06T17:00:00Z",
          restore_confidence: "high",
          workspace_id: "T123",
          channel_id: "C123",
          thread_ts: "456.000",
        },
      ],
    });
  });

  it("maps GitHub-like poll result to Event object", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-github.json");
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-github-poll.json"));
    const state = createMcpPollerState(config);

    const result = await pollMcpSource({
      config,
      state,
      runner: {
        callTool: async () => fixture,
      },
      receivedAt: "2026-05-06T17:02:00Z",
    });

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].source, "github");
    assert.equal(result.events[0].type, "github.issue_comment");
    assert.equal(result.events[0].idempotency_key, "github:pagerfreeglobal/pgrust:issue-comment-99");
    assert.equal(result.events[0].resources[0].repo, "pagerfreeglobal/pgrust");
  });

  it("lists seeded development MCP sources and polls by source id", async () => {
    const registry = createSeededDevelopmentMcpSourceRegistry();
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-slack-github-poll.json"));

    const sources = registry.listSources();
    const result = await registry.pollSource("slack_dm_source", fixture, "2026-05-06T17:00:00Z");
    const duplicateResult = await registry.pollSource("slack_dm_source", fixture, "2026-05-06T17:01:00Z");

    assert.deepEqual(sources.map((source) => source.id), ["github_update_source", "slack_dm_source"]);
    assert.equal(sources.find((source) => source.id === "slack_dm_source")?.risk_policy.allowWriteTools, false);
    assert.equal(result?.events.length, 1);
    assert.equal(result?.events[0].source, "slack");
    assert.equal(result?.duplicates_ignored, 1);
    assert.equal(result?.cursor, "456.000");
    assert.equal(duplicateResult?.events.length, 0);
    assert.equal(duplicateResult?.duplicates_ignored, 2);
    assert.equal(await registry.pollSource("missing_source", fixture, "2026-05-06T17:00:00Z"), undefined);
  });

  it("validates documented MCP source config example", async () => {
    const configs = await readMcpSourceConfigs(join(process.cwd(), "../../config/mcp-sources.example.json"));

    assert.deepEqual(configs.map((config) => config.id), ["slack_dm_source", "github_update_source"]);
    assert.equal(configs[0].riskPolicy.readOnly, true);
    assert.equal(configs[0].riskPolicy.allowWriteTools, false);
    assert.equal(configs[1].server.command, "docker");
  });
});

async function readConfig(path: string): Promise<McpPollSourceConfig> {
  const parsed = JSON.parse(await readFile(join(process.cwd(), path), "utf8")) as unknown;
  const result = validateMcpPollSourceConfig(parsed);
  if (!result.ok) {
    throw new Error(result.issues.join(", "));
  }
  return result.value;
}
