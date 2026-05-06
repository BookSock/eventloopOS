import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { validateMcpPollSourceConfig } from "../../integrations/mcp_poll/config_schema.js";
import type { McpPollSourceConfig } from "../../integrations/mcp_poll/types.js";
import {
  filterMcpServerEnv,
  McpSdkRuntime,
  type McpRuntimeTransportFactory,
} from "./sdk_runtime.js";

describe("MCP SDK runtime", () => {
  it("times out hanging SDK requests and opens circuit after repeated failures", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    let now = 1_000;
    const transportFactory: McpRuntimeTransportFactory = () => ({
      transport: new FixtureMcpTransport({ hangMethods: new Set(["tools/call"]) }),
    });
    const runtime = new McpSdkRuntime(
      () => now,
      {
        timeoutMs: 20,
        failureThreshold: 2,
        halfOpenAfterMs: 100,
        initialBackoffMs: 10,
        maxBackoffMs: 40,
      },
      transportFactory,
    );

    await assert.rejects(() => runtime.callTool(config, {}), /timed out after 20ms/);
    assert.equal(runtime.getState(config.id)?.circuit, "closed");

    await assert.rejects(() => runtime.callTool(config, {}), /timed out after 20ms/);
    assert.equal(runtime.getState(config.id)?.circuit, "open");
    assert.equal(runtime.getState(config.id)?.childCleanupRequested, true);
    assert.equal(runtime.getState(config.id)?.lastError, "MCP source slack_dm_source timed out after 20ms");

    await assert.rejects(() => runtime.callTool(config, {}), /MCP circuit open/);

    now += 100;
    await assert.rejects(() => runtime.callTool(config, {}), /timed out after 20ms/);
    assert.equal(runtime.getState(config.id)?.circuit, "open");
  });

  it("captures stderr emitted by fixture transport", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    const writes: Array<{ sourceId: string; path: string; text: string }> = [];
    const stderr = new PassThrough();
    const runtime = new McpSdkRuntime(
      Date.now,
      undefined,
      () => ({
        transport: new FixtureMcpTransport({
          stderr,
          toolResult: awaitableFixtureResult(),
        }),
        stderr,
      }),
      (write) => {
        writes.push(write);
      },
    );

    await runtime.callTool(config, {});

    assert.deepEqual(writes, [
      {
        sourceId: config.id,
        path: "var/log/mcp/slack_dm_source.stderr.log",
        text: "tool warning\n",
      },
    ]);
  });

  it("filters server env to declared allowlist", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");

    assert.deepEqual(
      filterMcpServerEnv(config, {
        SLACK_MCP_TOKEN: "token",
        AWS_SECRET_ACCESS_KEY: "must-not-pass",
      }),
      {
        SLACK_MCP_TOKEN: "token",
      },
    );
  });

  it("uses SDK tools/list and tools/call with normalized fixture JSON", async () => {
    const config = await readConfig("../../tests/fixtures/mcp/source-slack.json");
    const fixtureResult = await readJsonFixture("slack-tool-result.json");
    const envs: Record<string, string>[] = [];
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = new McpSdkRuntime(
      Date.now,
      undefined,
      (_config, env) => {
        envs.push(env);
        return {
          transport: new FixtureMcpTransport({
            requests,
            toolResult: fixtureResult,
          }),
        };
      },
      () => undefined,
      {
        SLACK_MCP_TOKEN: "token",
        AWS_SECRET_ACCESS_KEY: "must-not-pass",
      },
    );

    const tools = await runtime.listTools(config);
    const result = await runtime.callTool(config, config.poll.args);

    assert.deepEqual(tools, [
      {
        name: "search_messages",
        description: "Search Slack messages",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    ]);
    assert.deepEqual(result, fixtureResult);
    assert.deepEqual(envs, [{ SLACK_MCP_TOKEN: "token" }, { SLACK_MCP_TOKEN: "token" }]);
    assert.deepEqual(
      requests.filter((request) => request.method !== "initialize").map((request) => request.method),
      ["tools/list", "tools/call"],
    );
    assert.deepEqual(
      requests.find((request) => request.method === "tools/call")?.params,
      {
        name: "search_messages",
        arguments: {
          query: "is:dm OR mentions:me",
        },
      },
    );
  });
});

class FixtureMcpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly options: {
      hangMethods?: Set<string>;
      requests?: Array<{ method: string; params: unknown }>;
      stderr?: PassThrough;
      toolResult?: unknown;
    } = {},
  ) {}

  async start(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!isRequest(message)) {
      return;
    }

    this.options.requests?.push({ method: message.method, params: message.params });
    if (this.options.hangMethods?.has(message.method)) {
      return;
    }

    queueMicrotask(() => {
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: this.resultFor(message),
      } as JSONRPCMessage);
    });
  }

  private resultFor(message: { method: string }): unknown {
    if (message.method === "initialize") {
      return {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "fixture-mcp",
          version: "0.0.0",
        },
      };
    }
    if (message.method === "tools/list") {
      return {
        tools: [
          {
            name: "search_messages",
            description: "Search Slack messages",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
            },
          },
        ],
      };
    }
    if (message.method === "tools/call") {
      this.options.stderr?.write("tool warning\n");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(this.options.toolResult ?? { items: [] }),
          },
        ],
      };
    }
    return {};
  }
}

async function readConfig(path: string): Promise<McpPollSourceConfig> {
  const parsed = JSON.parse(await readFile(join(process.cwd(), path), "utf8")) as unknown;
  const result = validateMcpPollSourceConfig(parsed);
  if (!result.ok) {
    throw new Error(result.issues.join(", "));
  }
  return result.value;
}

async function readJsonFixture(fileName: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(process.cwd(), "../../tests/fixtures/mcp", fileName), "utf8")) as Record<
    string,
    unknown
  >;
}

function awaitableFixtureResult(): Record<string, unknown> {
  return { items: [] };
}

function isRequest(message: JSONRPCMessage): message is JSONRPCMessage & {
  id: string | number;
  method: string;
  params?: unknown;
} {
  return "id" in message && "method" in message;
}
