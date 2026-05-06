import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Stream } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpPollResult, McpPollSourceConfig } from "../../integrations/mcp_poll/types.js";

export type CircuitState = "closed" | "open" | "half_open";

export type McpRuntimeDefaults = {
  timeoutMs: number;
  failureThreshold: number;
  halfOpenAfterMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
};

export const defaultMcpRuntimeDefaults: McpRuntimeDefaults = {
  timeoutMs: 5_000,
  failureThreshold: 2,
  halfOpenAfterMs: 30_000,
  initialBackoffMs: 500,
  maxBackoffMs: 30_000,
};

export type McpRuntimeSourceState = {
  circuit: CircuitState;
  failures: number;
  nextAttemptAtMs: number;
  backoffMs: number;
  stderrLogPath: string;
  childCleanupRequested: boolean;
  lastError?: string;
};

export type McpRuntimeTransport = {
  transport: Transport;
  stderr?: Stream | null;
};

export type McpRuntimeTransportFactory = (
  config: McpPollSourceConfig,
  env: Record<string, string>,
) => McpRuntimeTransport;

export type McpRuntimeStderrWriter = (params: {
  sourceId: string;
  path: string;
  text: string;
}) => Promise<void> | void;

export class McpSdkRuntime {
  readonly states = new Map<string, McpRuntimeSourceState>();

  constructor(
    private readonly nowMs: () => number = Date.now,
    private readonly defaults: McpRuntimeDefaults = defaultMcpRuntimeDefaults,
    private readonly transportFactory: McpRuntimeTransportFactory = createStdioMcpTransport,
    private readonly stderrWriter: McpRuntimeStderrWriter = writeMcpStderr,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  getState(sourceId: string): McpRuntimeSourceState | undefined {
    return this.states.get(sourceId);
  }

  async listTools(config: McpPollSourceConfig): Promise<Array<Record<string, unknown>>> {
    return await this.runWithCircuit(config, async (client, timeoutMs) => {
      const result = await client.listTools(undefined, { timeout: timeoutMs });
      return result.tools.map((tool) => ({ ...tool }));
    });
  }

  async callTool(config: McpPollSourceConfig, args: Record<string, unknown>): Promise<McpPollResult> {
    return await this.runWithCircuit(config, async (client, timeoutMs) => {
      const result = await client.callTool(
        {
          name: config.poll.tool,
          arguments: args,
        },
        undefined,
        { timeout: timeoutMs },
      );
      return normalizeMcpPollResult(result);
    });
  }

  requestChildCleanup(sourceId: string): void {
    const state = this.states.get(sourceId);
    if (state) {
      state.childCleanupRequested = true;
    }
  }

  private async runWithCircuit<T>(
    config: McpPollSourceConfig,
    operation: (client: Client, timeoutMs: number) => Promise<T>,
  ): Promise<T> {
    const state = this.ensureState(config);
    const now = this.nowMs();

    if (state.circuit === "open") {
      if (now < state.nextAttemptAtMs) {
        throw new Error(`MCP circuit open for ${config.id}`);
      }
      state.circuit = "half_open";
    }

    try {
      const result = await this.runClientOperation(config, operation);
      state.circuit = "closed";
      state.failures = 0;
      state.backoffMs = this.defaults.initialBackoffMs;
      state.lastError = undefined;
      state.childCleanupRequested = false;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.failures += 1;
      state.lastError = message;
      state.childCleanupRequested = true;

      if (state.failures >= this.defaults.failureThreshold || state.circuit === "half_open") {
        state.circuit = "open";
        state.nextAttemptAtMs = now + this.defaults.halfOpenAfterMs;
      } else {
        state.nextAttemptAtMs = now + state.backoffMs;
        state.backoffMs = Math.min(state.backoffMs * 2, this.defaults.maxBackoffMs);
      }

      throw error;
    }
  }

  private async runClientOperation<T>(
    config: McpPollSourceConfig,
    operation: (client: Client, timeoutMs: number) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = config.poll.timeoutMs || this.defaults.timeoutMs;
    const { transport, stderr } = this.transportFactory(config, filterMcpServerEnv(config, this.env));
    const client = new Client({ name: "eventloopos-orchestrator", version: "0.0.0" });

    this.captureStderr(config, stderr);

    let timeout: NodeJS.Timeout | undefined;
    try {
      const work = (async () => {
        await client.connect(transport, { timeout: timeoutMs });
        return await operation(client, timeoutMs);
      })();

      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`MCP source ${config.id} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      return await Promise.race([work, timeoutFailure]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      await client.close().catch(() => undefined);
    }
  }

  private captureStderr(config: McpPollSourceConfig, stderr: Stream | null | undefined): void {
    if (!stderr) {
      return;
    }

    stderr.on("data", (chunk: Buffer | string) => {
      void Promise.resolve(
        this.stderrWriter({
          sourceId: config.id,
          path: config.server.stderrLogPath,
          text: chunk.toString(),
        }),
      ).catch((error) => {
        const state = this.ensureState(config);
        const message = error instanceof Error ? error.message : String(error);
        state.lastError = `MCP stderr log failed: ${message}`;
      });
    });
  }

  private ensureState(config: McpPollSourceConfig): McpRuntimeSourceState {
    const existing = this.states.get(config.id);
    if (existing) {
      return existing;
    }

    const state: McpRuntimeSourceState = {
      circuit: "closed",
      failures: 0,
      nextAttemptAtMs: 0,
      backoffMs: this.defaults.initialBackoffMs,
      stderrLogPath: config.server.stderrLogPath,
      childCleanupRequested: false,
    };
    this.states.set(config.id, state);
    return state;
  }
}

export function createStdioMcpTransport(
  config: McpPollSourceConfig,
  env: Record<string, string>,
): McpRuntimeTransport {
  const transport = new StdioClientTransport({
    command: config.server.command,
    args: config.server.args,
    env,
    stderr: "pipe",
  });
  return { transport, stderr: transport.stderr };
}

export function filterMcpServerEnv(
  config: McpPollSourceConfig,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    config.server.envAllowlist.flatMap((key) => {
      const value = env[key];
      return typeof value === "string" ? [[key, value]] : [];
    }),
  );
}

function normalizeMcpPollResult(result: unknown): McpPollResult {
  if (!isRecord(result)) {
    throw new Error("MCP tool result must be an object");
  }

  if (isRecord(result.structuredContent)) {
    return readPollResult(result.structuredContent);
  }

  if (isRecord(result.toolResult)) {
    return readPollResult(result.toolResult);
  }

  const content = result.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        const parsed = JSON.parse(block.text) as unknown;
        return readPollResult(parsed);
      }
    }
  }

  return readPollResult(result);
}

function readPollResult(value: unknown): McpPollResult {
  if (!isRecord(value)) {
    throw new Error("MCP poll result must be an object");
  }
  if (!Array.isArray(value.items) || value.items.some((item) => !isRecord(item))) {
    throw new Error("MCP poll result items must be objects");
  }
  if (value.nextCursor !== undefined && typeof value.nextCursor !== "string") {
    throw new Error("MCP poll result nextCursor must be a string");
  }

  return {
    items: value.items.map((item) => ({ ...item })),
    nextCursor: value.nextCursor,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeMcpStderr(params: { path: string; text: string }): Promise<void> {
  await mkdir(dirname(params.path), { recursive: true });
  await appendFile(params.path, params.text, "utf8");
}
