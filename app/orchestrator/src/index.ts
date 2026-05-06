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
import { createSeededStore } from "./store.js";
import { createSeededDevelopmentTaskSessions } from "./task_sessions/development_task_session_controller.js";
import { AerospaceWorkspaceController } from "./workspace/controller.js";

const config = loadConfig();

if (!config.ok) {
  console.error(`Invalid orchestrator config:\n${config.issues.map((issue) => `- ${issue}`).join("\n")}`);
  process.exit(1);
}

const store = await createGatewayStore();
const taskSessions = config.value.taskSessions === "fake" ? createSeededDevelopmentTaskSessions() : undefined;
const mcpSources = await createMcpSourceRegistry();
const workspace = config.value.workspace === "aerospace" ? new AerospaceWorkspaceController(execFilePromise) : undefined;
const server = createGatewayServer({
  store,
  taskSessions,
  mcpSources,
  workspace,
  workspaceExecuteEnabled: config.value.workspaceExecute === "enabled",
});

server.listen(config.value.port, config.value.host, () => {
  console.log(`eventloop orchestrator listening on http://${config.value.host}:${config.value.port}`);
});

async function createGatewayStore() {
  if (config.ok && config.value.databaseUrl) {
    const postgres = new PostgresQueueStore({ connectionString: config.value.databaseUrl });
    await postgres.migrate();
    return createPostgresGatewayStore(postgres);
  }

  return createInMemoryGatewayStore(await createSeededStore(config.ok ? config.value.seedFixturePath : undefined));
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
