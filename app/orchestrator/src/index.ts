import { execFile } from "node:child_process";
import { loadConfig, type OrchestratorConfig } from "./config.js";
import { PostgresQueueStore } from "./db/postgres_queue_store.js";
import { createInMemoryGatewayStore, createPostgresGatewayStore } from "./gateway_store.js";
import {
  createSeededDevelopmentMcpSourceRegistry,
  DevelopmentMcpSourceRegistry,
  readMcpSourceConfigs,
} from "./integrations/mcp_poll/development_registry.js";
import { McpSdkRuntime } from "./mcp_sources/runtime/sdk_runtime.js";
import { createGatewayServer } from "./server.js";
import { PostgresObservability, type Observability } from "./observability.js";
import { createSeededStore } from "./store.js";
import { ClaudeCliTaskSessionController, parseClaudeSessionConfigs } from "./task_sessions/claude_cli_task_session_controller.js";
import { CodexAppServerThreadClient } from "./task_sessions/codex_app_server_thread_client.js";
import { createCodexAppServerStdioConnection } from "./task_sessions/codex_app_server_stdio.js";
import { createCodexAppServerWebSocketConnection } from "./task_sessions/codex_app_server_ws.js";
import { CodexNativeThreadController } from "./task_sessions/codex_native_thread_controller.js";
import { CompositeTaskSessionController, type CompositeTaskSessionRuntime } from "./task_sessions/composite_task_session_controller.js";
import { CodexTaskMapResolver } from "./task_sessions/codex_task_map.js";
import { createSeededDevelopmentTaskSessions } from "./task_sessions/development_task_session_controller.js";
import type { TaskSessionController } from "./task_sessions/types.js";
import { AerospaceWorkspaceController } from "./workspace/controller.js";

const config = loadConfig();

if (!config.ok) {
  console.error(`Invalid orchestrator config:\n${config.issues.map((issue) => `- ${issue}`).join("\n")}`);
  process.exit(1);
}

const gatewayRuntime = await createGatewayRuntime();
const taskSessionRuntime = createTaskSessionRuntime();
const taskSessions = taskSessionRuntime?.controller;
const mcpSources = await createMcpSourceRegistry();
const workspace = config.value.workspace === "aerospace" ? new AerospaceWorkspaceController(execFilePromise) : undefined;
const server = createGatewayServer({
  store: gatewayRuntime.store,
  taskSessions,
  mcpSources,
  workspace,
  workspaceExecuteEnabled: config.value.workspaceExecute === "enabled",
  observability: gatewayRuntime.observability,
});

server.listen(config.value.port, config.value.host, () => {
  console.log(`eventloop orchestrator listening on http://${config.value.host}:${config.value.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    taskSessionRuntime?.close?.();
    server.close(() => {
      gatewayRuntime.close?.().finally(() => process.exit(0));
    });
  });
}

async function createGatewayRuntime(): Promise<{
  store: ReturnType<typeof createInMemoryGatewayStore> | ReturnType<typeof createPostgresGatewayStore>;
  observability?: Observability;
  close?: () => Promise<void>;
}> {
  if (config.ok && config.value.databaseUrl) {
    const postgres = new PostgresQueueStore({ connectionString: config.value.databaseUrl });
    await postgres.migrate();
    return {
      store: createPostgresGatewayStore(postgres),
      observability: new PostgresObservability(postgres.pool),
      close: () => postgres.close(),
    };
  }

  return {
    store: createInMemoryGatewayStore(await createSeededStore(config.ok ? config.value.seedFixturePath : undefined)),
  };
}

async function createMcpSourceRegistry() {
  if (!config.ok || config.value.mcpSources === "off") {
    return undefined;
  }

  if (config.value.mcpSources === "config") {
    const configs = await readMcpSourceConfigs(config.value.mcpSourcesPath ?? "");
    return new DevelopmentMcpSourceRegistry(configs, new McpSdkRuntime(), gatewayRuntime.store);
  }

  return createSeededDevelopmentMcpSourceRegistry();
}

function createTaskSessionRuntime(): { controller: TaskSessionController; close?: () => void } | undefined {
  if (!config.ok || config.value.taskSessions === "off") {
    return undefined;
  }

  const runtimes: Array<CompositeTaskSessionRuntime & { close?: () => void }> = config.value.taskSessions.map((mode) => {
    if (mode === "codex_app_server") return createCodexTaskSessionRuntime(config.value);
    if (mode === "claude_cli") return createClaudeTaskSessionRuntime(config.value);
    return {
      name: "fake",
      controller: createSeededDevelopmentTaskSessions(),
    };
  });

  if (runtimes.length === 1) {
    return {
      controller: runtimes[0].controller,
      close: runtimes[0].close,
    };
  }

  return {
    controller: new CompositeTaskSessionController(runtimes),
    close: () => {
      for (const runtime of runtimes) runtime.close?.();
    },
  };
}

function createCodexTaskSessionRuntime(runtimeConfig: OrchestratorConfig): CompositeTaskSessionRuntime & { close: () => void } {
    const connection = runtimeConfig.codexAppServerUrl
      ? createCodexAppServerWebSocketConnection({ url: runtimeConfig.codexAppServerUrl })
      : createCodexAppServerStdioConnection();
    const taskMap = new CodexTaskMapResolver({
      inlineMap: runtimeConfig.codexTaskMap,
      mapPath: runtimeConfig.codexTaskMapPath,
      onError: (error) => {
        console.error(`Codex task map read failed: ${error.message}`);
      },
    });
    connection.initialized.catch((error) => {
      console.error(`Codex app-server initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return {
      name: "codex_app_server",
      controller: new CodexNativeThreadController(
        new CodexAppServerThreadClient(connection.request, { taskIdForThreadId: (threadId) => taskMap.taskIdForThreadId(threadId) }),
        { bindingWriter: taskMap },
      ),
      close: () => connection.close(),
    };
}

function createClaudeTaskSessionRuntime(runtimeConfig: OrchestratorConfig): CompositeTaskSessionRuntime {
  return {
    name: "claude_cli",
    controller: new ClaudeCliTaskSessionController({
      sessions: parseClaudeSessionConfigs(runtimeConfig.claudeSessionsRaw),
      execFile: execFilePromise,
    }),
  };
}

async function execFilePromise(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout: options.timeoutMs ?? 5_000, cwd: options.cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
