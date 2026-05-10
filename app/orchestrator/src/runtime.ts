import type { GhosttyWindowResolver } from "./agents/codex/auto_bind.js";
import type { GatewayStore } from "./gateway_store.js";
import type { Observability } from "./observability.js";
import type { McpSourceRegistry } from "./routes/mcp_sources.js";
import type { TaskSessionController } from "./task_sessions/types.js";
import type { TerminalSendExecutor } from "./task_sessions/terminal_send.js";
import type { WorkspaceController } from "./workspace/controller.js";

/**
 * The Runtime is the named spine of the orchestrator: a flat, immutable record
 * of long-lived primitives that every HTTP route and timer consumes. There is
 * intentionally no module-scoped accessor — Runtime is always passed as a
 * parameter so dependencies stay explicit. Tests override one field via:
 *
 *   const runtime = createRuntime({ ...real, store: fakeStore });
 *
 * Keep this flat. If it grows past ~8 fields, group by concern.
 */
export type Runtime = Readonly<{
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  workspace?: WorkspaceController;
  observability: Observability;
  mcpSources?: McpSourceRegistry;
  workspaceExecuteEnabled?: boolean;
  terminalSendExecutor?: TerminalSendExecutor;
  terminalSendEnabled?: boolean;
  codexHome?: string;
  ghosttyResolver?: GhosttyWindowResolver;
  now: () => Date;
}>;

export type CreateRuntimeOptions = {
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  workspace?: WorkspaceController;
  observability: Observability;
  mcpSources?: McpSourceRegistry;
  workspaceExecuteEnabled?: boolean;
  terminalSendExecutor?: TerminalSendExecutor;
  terminalSendEnabled?: boolean;
  codexHome?: string;
  ghosttyResolver?: GhosttyWindowResolver;
  now?: () => Date;
};

export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const runtime: Runtime = {
    store: options.store,
    taskSessions: options.taskSessions,
    workspace: options.workspace,
    observability: options.observability,
    mcpSources: options.mcpSources,
    workspaceExecuteEnabled: options.workspaceExecuteEnabled,
    terminalSendExecutor: options.terminalSendExecutor,
    terminalSendEnabled: options.terminalSendEnabled,
    codexHome: options.codexHome,
    ghosttyResolver: options.ghosttyResolver,
    now: options.now ?? (() => new Date()),
  };
  return Object.freeze(runtime);
}
