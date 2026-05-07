import { execFile } from "node:child_process";
import { loadConfig } from "./config.js";
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
import { CodexAppServerThreadClient } from "./task_sessions/codex_app_server_thread_client.js";
import { createCodexAppServerStdioConnection, type CodexAppServerStdioConnection } from "./task_sessions/codex_app_server_stdio.js";
import { CodexNativeThreadController } from "./task_sessions/codex_native_thread_controller.js";
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
    return new DevelopmentMcpSourceRegistry(configs, new McpSdkRuntime());
  }

  return createSeededDevelopmentMcpSourceRegistry();
}

function createTaskSessionRuntime(): { controller: TaskSessionController; close?: () => void } | undefined {
  if (!config.ok || config.value.taskSessions === "off") {
    return undefined;
  }

  if (config.value.taskSessions === "codex_app_server") {
    const connection: CodexAppServerStdioConnection = createCodexAppServerStdioConnection();
    const taskMap = new CodexTaskMapResolver({
      inlineMap: config.value.codexTaskMap,
      mapPath: config.value.codexTaskMapPath,
      onError: (error) => {
        console.error(`Codex task map read failed: ${error.message}`);
      },
    });
    connection.initialized.catch((error) => {
      console.error(`Codex app-server initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return {
      controller: new CodexNativeThreadController(
        new CodexAppServerThreadClient(connection.request, { taskIdForThreadId: (threadId) => taskMap.taskIdForThreadId(threadId) }),
        { bindingWriter: taskMap },
      ),
      close: () => connection.close(),
    };
  }

  return {
    controller: createSeededDevelopmentTaskSessions(),
  };
}

async function execFilePromise(command: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout: 5_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
