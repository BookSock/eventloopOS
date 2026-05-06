import type { McpPollResult, McpPollSourceConfig } from "../../integrations/mcp_poll/types.js";

export type CircuitState = "closed" | "open" | "half_open";

export type FakeRuntimeDefaults = {
  timeoutMs: number;
  failureThreshold: number;
  halfOpenAfterMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
};

export const defaultFakeRuntimeDefaults: FakeRuntimeDefaults = {
  timeoutMs: 5_000,
  failureThreshold: 2,
  halfOpenAfterMs: 30_000,
  initialBackoffMs: 500,
  maxBackoffMs: 30_000,
};

export type FakeMcpBehavior =
  | { kind: "success"; result: McpPollResult; stderr?: string }
  | { kind: "fail"; error: Error; stderr?: string }
  | { kind: "hang"; stderr?: string };

export type FakeMcpRuntimeSourceState = {
  circuit: CircuitState;
  failures: number;
  nextAttemptAtMs: number;
  backoffMs: number;
  stderrLogPath: string;
  childCleanupRequested: boolean;
  lastError?: string;
};

export class FakeMcpRuntime {
  readonly states = new Map<string, FakeMcpRuntimeSourceState>();
  readonly stderrWrites: Array<{ sourceId: string; path: string; text: string }> = [];

  constructor(
    private readonly behaviors: Map<string, FakeMcpBehavior[]>,
    private readonly nowMs: () => number,
    private readonly defaults: FakeRuntimeDefaults = defaultFakeRuntimeDefaults,
  ) {}

  getState(sourceId: string): FakeMcpRuntimeSourceState | undefined {
    return this.states.get(sourceId);
  }

  async callTool(config: McpPollSourceConfig, args: Record<string, unknown>): Promise<McpPollResult> {
    void args;
    const state = this.ensureState(config);
    const now = this.nowMs();

    if (state.circuit === "open") {
      if (now < state.nextAttemptAtMs) {
        throw new Error(`MCP circuit open for ${config.id}`);
      }
      state.circuit = "half_open";
    }

    const behavior = this.behaviors.get(config.id)?.shift() ?? { kind: "success", result: { items: [] } };
    const timeoutMs = config.poll.timeoutMs || this.defaults.timeoutMs;

    try {
      const result = await this.runWithTimeout(config, behavior, timeoutMs);
      state.circuit = "closed";
      state.failures = 0;
      state.backoffMs = this.defaults.initialBackoffMs;
      state.lastError = undefined;
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

  requestChildCleanup(sourceId: string): void {
    const state = this.states.get(sourceId);
    if (state) {
      state.childCleanupRequested = true;
    }
  }

  private async runWithTimeout(
    config: McpPollSourceConfig,
    behavior: FakeMcpBehavior,
    timeoutMs: number,
  ): Promise<McpPollResult> {
    if (behavior.stderr) {
      const state = this.ensureState(config);
      this.stderrWrites.push({
        sourceId: config.id,
        path: state.stderrLogPath,
        text: behavior.stderr,
      });
    }

    const work = new Promise<McpPollResult>((resolve, reject) => {
      queueMicrotask(() => {
        if (behavior.kind === "success") {
          resolve(behavior.result);
        } else if (behavior.kind === "fail") {
          reject(behavior.error);
        }
      });
    });

    if (behavior.kind === "hang") {
      return await new Promise<McpPollResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`MCP source ${config.id} timed out after ${timeoutMs}ms`)), timeoutMs);
      });
    }

    return await Promise.race([
      work,
      new Promise<McpPollResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`MCP source ${config.id} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  }

  private ensureState(config: McpPollSourceConfig): FakeMcpRuntimeSourceState {
    const existing = this.states.get(config.id);
    if (existing) {
      return existing;
    }

    const state: FakeMcpRuntimeSourceState = {
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
