import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateMcpPollSourceConfig } from "./config_schema.js";
import { createSeededDevelopmentMcpSourceRegistry, DevelopmentMcpSourceRegistry, readMcpSourceConfigs } from "./development_registry.js";
import { readMcpPollFixture } from "./fixture_parser.js";
import { createMcpPollerState, pollMcpSource } from "./poller.js";
import type { McpCursorState, McpPollSourceConfig } from "./types.js";
import type { McpPollStateSnapshot } from "./persistent_cursor_store.js";

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
        name: "Alex",
      },
      project_hint: "acme",
      task_hint: "blog feedback",
      type: "slack.message",
      title: "Slack message from Alex",
      summary: "Customer says dbtool copy needs clearer Postgres version support.",
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
          details: {
            provider: "slack",
            team_id: "T123",
            channel_id: "C123",
            thread_ts: "456.000",
            confidence_reason: "slack_permalink",
          },
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
    assert.equal(result.events[0].idempotency_key, "github:acme-corp/dbtool:issue-comment-99");
    assert.equal(result.events[0].resources[0].repo, "acme-corp/dbtool");
  });

  it("maps generic MCP item output to Event object", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-generic.json");
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-generic-poll.json"));
    const state = createMcpPollerState(config);

    const result = await pollMcpSource({
      config,
      state,
      runner: {
        callTool: async () => fixture,
      },
      receivedAt: "2026-05-06T17:03:05Z",
    });

    assert.equal(result.events.length, 1);
    assert.equal(result.duplicatesIgnored, 1);
    assert.equal(result.events[0].id, "evt_voice_note_generic_mcp_source_office_priority_1");
    assert.equal(result.events[0].source, "voice_note");
    assert.equal(result.events[0].source_id, "generic_mcp_source:office-priority-1");
    assert.equal(result.events[0].type, "voice.priority_hint");
    assert.equal(result.events[0].task_hint, "blog feedback");
    assert.deepEqual(result.events[0].actor, {
      id: "actor_voice_jason",
      type: "human",
      name: "Jason",
    });
    assert.deepEqual(result.events[0].links, [
      {
        label: "Voice note",
        url: "eventloop://voice/office-priority-1",
      },
    ]);
    assert.equal(result.events[0].resources[0].kind, "voice_note");
  });

  it("checks configured MCP poll tool metadata once before polling", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-slack-github-poll.json"));
    const state = createMcpPollerState(config);
    let listToolsCalls = 0;
    let callToolCalls = 0;

    const first = await pollMcpSource({
      config,
      state,
      runner: {
        async listTools() {
          listToolsCalls += 1;
          return [
            {
              name: "search_messages",
              annotations: {
                readOnlyHint: true,
              },
            },
          ];
        },
        async callTool() {
          callToolCalls += 1;
          return fixture;
        },
      },
      receivedAt: "2026-05-06T17:00:00Z",
    });
    const second = await pollMcpSource({
      config,
      state,
      runner: {
        async listTools() {
          listToolsCalls += 1;
          return [
            {
              name: "search_messages",
              annotations: {
                readOnlyHint: true,
              },
            },
          ];
        },
        async callTool() {
          callToolCalls += 1;
          return fixture;
        },
      },
      receivedAt: "2026-05-06T17:01:00Z",
    });

    assert.equal(listToolsCalls, 1);
    assert.equal(callToolCalls, 2);
    assert.equal(first.events.length, 1);
    assert.equal(second.events.length, 0);
  });

  it("blocks MCP polling when configured tool is missing or not read-only", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    let callToolCalls = 0;

    await assert.rejects(
      () => pollMcpSource({
        config,
        state: createMcpPollerState(config),
        runner: {
          async listTools() {
            return [
              {
                name: "post_message",
                annotations: {
                  readOnlyHint: false,
                },
              },
            ];
          },
          async callTool() {
            callToolCalls += 1;
            return { items: [] };
          },
        },
        receivedAt: "2026-05-06T17:00:00Z",
      }),
      /MCP poll tool search_messages is not advertised by source slack_dm_source/,
    );

    await assert.rejects(
      () => pollMcpSource({
        config,
        state: createMcpPollerState(config),
        runner: {
          async listTools() {
            return [
              {
                name: "search_messages",
                annotations: {
                  readOnlyHint: false,
                },
              },
            ];
          },
          async callTool() {
            callToolCalls += 1;
            return { items: [] };
          },
        },
        receivedAt: "2026-05-06T17:00:00Z",
      }),
      /MCP poll tool search_messages for source slack_dm_source must advertise annotations.readOnlyHint=true/,
    );

    await assert.rejects(
      () => pollMcpSource({
        config,
        state: createMcpPollerState(config),
        runner: {
          async listTools() {
            return [
              {
                name: "search_messages",
              },
            ];
          },
          async callTool() {
            callToolCalls += 1;
            return { items: [] };
          },
        },
        receivedAt: "2026-05-06T17:00:00Z",
      }),
      /MCP poll tool search_messages for source slack_dm_source must advertise annotations.readOnlyHint=true/,
    );

    assert.equal(callToolCalls, 0);
  });

  it("lists seeded development MCP sources and polls by source id", async () => {
    const registry = createSeededDevelopmentMcpSourceRegistry();
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-slack-github-poll.json"));

    const sources = registry.listSources();
    const result = await registry.pollSource("slack_dm_source", fixture, "2026-05-06T17:00:00Z");
    const duplicateResult = await registry.pollSource("slack_dm_source", fixture, "2026-05-06T17:01:00Z");

    assert.deepEqual(sources.map((source) => source.id), ["generic_mcp_source", "github_update_source", "slack_dm_source"]);
    assert.equal(sources.find((source) => source.id === "slack_dm_source")?.risk_policy.allowWriteTools, false);
    assert.equal(sources.find((source) => source.id === "generic_mcp_source")?.event_mapper, "generic_item_to_event");
    assert.equal(result?.events.length, 1);
    assert.equal(result?.events[0].source, "slack");
    assert.equal(result?.duplicates_ignored, 1);
    assert.equal(result?.cursor, "456.000");
    assert.equal(duplicateResult?.events.length, 0);
    assert.equal(duplicateResult?.duplicates_ignored, 2);
    assert.equal(await registry.pollSource("missing_source", fixture, "2026-05-06T17:00:00Z"), undefined);
  });

  it("hydrates and commits MCP cursor state across registry restarts", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    const fixture = await readMcpPollFixture(join(process.cwd(), "../../tests/fixtures/events/mcp-slack-github-poll.json"));
    const durableStates = new Map<string, McpPollStateSnapshot>();
    const stateStore = {
      async getMcpPollState(sourceId: string) {
        return durableStates.get(sourceId);
      },
      async saveMcpPollState(sourceId: string, state: McpCursorState, now: Date) {
        const snapshot = {
          source_id: sourceId,
          cursor: state.cursor,
          seen: Array.from(state.seen),
          updated_at: now.toISOString(),
        };
        durableStates.set(sourceId, snapshot);
        return snapshot;
      },
    };
    const runner = { callTool: async () => fixture };
    const firstRegistry = new DevelopmentMcpSourceRegistry([config], runner, stateStore);

    const first = await firstRegistry.pollSource("slack_dm_source", {}, "2026-05-06T17:00:00Z");
    assert.equal(first?.events.length, 1);
    assert.equal(first?.cursor, "456.000");
    if (!first?.state) throw new Error("expected staged MCP state");
    await firstRegistry.commitPollState("slack_dm_source", first.state, new Date("2026-05-06T17:00:01Z"));

    const afterRestartRegistry = new DevelopmentMcpSourceRegistry([config], runner, stateStore);
    const afterRestart = await afterRestartRegistry.pollSource("slack_dm_source", {}, "2026-05-06T17:01:00Z");

    assert.equal(afterRestart?.events.length, 0);
    assert.equal(afterRestart?.duplicates_ignored, 2);
    assert.equal(afterRestart?.cursor, "456.000");
  });

  it("commits explicit script nextCursor after item cursor fields", async () => {
    const config = await readConfig("../../config/mcp-sources.script-events.example.json");
    const state = createMcpPollerState(config);

    const result = await pollMcpSource({
      config,
      state,
      runner: {
        callTool: async (_config, args) => {
          assert.equal(args.cursor, undefined);
          return {
            items: [
              {
                id: "todo-1",
                source: "todo_md",
                type: "todo_md.item",
                title: "Draft launch note",
                summary: "Draft launch note",
              },
            ],
            nextCursor: "cursor-after-script-run",
          };
        },
      },
      receivedAt: "2026-05-06T17:04:00Z",
    });

    assert.equal(result.events.length, 1);
    assert.equal(result.cursor, "cursor-after-script-run");
    assert.equal(result.state.cursor, "cursor-after-script-run");
  });

  it("validates documented MCP source config example", async () => {
    const configs = await readMcpSourceConfigs(join(process.cwd(), "../../config/mcp-sources.example.json"));

    assert.deepEqual(configs.map((config) => config.id), ["slack_dm_source", "github_update_source", "generic_mcp_source"]);
    assert.equal(configs[0].riskPolicy.readOnly, true);
    assert.equal(configs[0].riskPolicy.allowWriteTools, false);
    assert.equal(configs[1].server.command, "docker");
    assert.equal(configs[2].eventMapper, "generic_item_to_event");
  });

  it("validates documented local integration source examples", async () => {
    const scriptConfigs = await readMcpSourceConfigs(join(process.cwd(), "../../config/mcp-sources.script-events.example.json"));
    const todoConfigs = await readMcpSourceConfigs(join(process.cwd(), "../../config/mcp-sources.todo-md.example.json"));
    const gmailConfigs = await readMcpSourceConfigs(join(process.cwd(), "../../config/mcp-sources.gmail-gws.example.json"));
    const slackConfigs = await readMcpSourceConfigs(join(process.cwd(), "../../config/mcp-sources.agent-slack.example.json"));

    assert.equal(scriptConfigs[0].id, "script_events_source");
    assert.equal(todoConfigs[0].id, "todo_md_source");
    assert.equal(gmailConfigs[0].server.envAllowlist.includes("EVENTLOOPOS_GMAIL_CONFIG_DIR"), true);
    assert.equal(slackConfigs[0].eventMapper, "slack_message_to_event");
  });

  it("rejects write-enabled MCP source configs for MVP polling", async () => {
    const rawConfig = JSON.parse(await readFile(join(process.cwd(), "../../tests/fixtures/mcp/source-generic.json"), "utf8")) as Record<
      string,
      unknown
    >;
    rawConfig.riskPolicy = {
      readOnly: false,
      allowWriteTools: true,
      maxRiskLevel: "critical",
      untrustedTextFields: ["summary"],
    };

    const result = validateMcpPollSourceConfig(rawConfig);

    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? [] : result.issues, [
      "riskPolicy.readOnly must be true for MVP polling sources",
      "riskPolicy.allowWriteTools must be false for MVP polling sources",
      "riskPolicy.maxRiskLevel must be low for MVP polling sources",
    ]);
  });

  it("rejects secret-like env allowlist entries", async () => {
    const rawConfig = JSON.parse(await readFile(join(process.cwd(), "../../tests/fixtures/mcp/source-generic.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const server = rawConfig.server as Record<string, unknown>;
    server.envAllowlist = ["GOOD_TOKEN", "GOOD_TOKEN", "bad-token", "SECRET=value"];

    const result = validateMcpPollSourceConfig(rawConfig);

    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? [] : result.issues, [
      "server.envAllowlist entry GOOD_TOKEN must be unique",
      "server.envAllowlist entry bad-token must be an environment variable name, not a value",
      "server.envAllowlist entry SECRET=value must be an environment variable name, not a value",
      "server.envAllowlist entry SECRET=value must not contain a secret or assignment",
    ]);
  });
});

async function readConfig(path: string): Promise<McpPollSourceConfig> {
  const parsed = JSON.parse(await readFile(join(process.cwd(), path), "utf8")) as unknown;
  const rawConfig = isRecord(parsed) && Array.isArray(parsed.sources) ? parsed.sources[0] : parsed;
  const sourceResult = validateMcpPollSourceConfig(rawConfig);
  if (!sourceResult.ok) {
    throw new Error(sourceResult.issues.join(", "));
  }
  return sourceResult.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
