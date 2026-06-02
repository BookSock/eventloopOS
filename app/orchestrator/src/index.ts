import { execFile } from "node:child_process";
import { createAmbientWorkspaceSaverFromRuntime, type AmbientWorkspaceSaver } from "./agents/ambient_workspace_saver.js";
import {
  createFollowsWindowOrchestratorFromRuntime,
  type FollowsWindowOrchestrator,
} from "./agents/follows_window_orchestrator.js";
import {
  startAutoPaperCodexIdleWatcher,
  type AutoPaperCodexIdleHandle,
  type AutoPaperTaskRecord,
  type AutoPaperTaskRegistry,
} from "./agents/auto_paper_codex_idle.js";
import { loadConfig, type OrchestratorConfig } from "./config.js";
import { PostgresQueueStore } from "./db/postgres_queue_store.js";
import { createInMemoryGatewayStore, createPostgresGatewayStore } from "./gateway_store.js";
import { createInMemoryObservability } from "./observability.js";
import { loadOrCreatePersistentInMemoryStore, withStorePersistence } from "./persistent_in_memory_gateway_store.js";
import { createRuntime } from "./runtime.js";
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
import { translateCodexStderr } from "./task_sessions/codex_stderr_friendly.js";
import { CodexNativeThreadController } from "./task_sessions/codex_native_thread_controller.js";
import { CompositeTaskSessionController, type CompositeTaskSessionRuntime } from "./task_sessions/composite_task_session_controller.js";
import { CodexTaskMapResolver } from "./task_sessions/codex_task_map.js";
import { createSeededDevelopmentTaskSessions } from "./task_sessions/development_task_session_controller.js";
import { PersistentTerminalRefController } from "./task_sessions/persistent_terminal_ref_controller.js";
import type { GatewayStore } from "./gateway_store.js";
import { terminalSendEnabledFromEnv, type TerminalSendCommand, type TerminalSendExecutor } from "./task_sessions/terminal_send.js";
import type { TaskSessionController } from "./task_sessions/types.js";
import { AerospaceWorkspaceController } from "./workspace/controller.js";

const config = loadConfig();

if (!config.ok) {
  console.error(`Invalid orchestrator config:\n${config.issues.map((issue) => `- ${issue}`).join("\n")}`);
  process.exit(1);
}

const gatewayRuntime = await createGatewayRuntime();
const taskSessionRuntime = createTaskSessionRuntime(gatewayRuntime.persistTerminalRefs ? gatewayRuntime.store : undefined);
const taskSessions = taskSessionRuntime?.controller;
const mcpSources = await createMcpSourceRegistry();
const workspace = config.value.workspace === "aerospace" ? new AerospaceWorkspaceController(execFilePromise) : undefined;
const terminalSendExecutor: TerminalSendExecutor = (command: TerminalSendCommand) =>
  new Promise((resolve, reject) => {
    execFile(command.file, command.args, (error) => (error ? reject(error) : resolve()));
  });

const server = createGatewayServer({
  store: gatewayRuntime.store,
  taskSessions,
  mcpSources,
  workspace,
  workspaceExecuteEnabled: config.value.workspaceExecute === "enabled",
  observability: gatewayRuntime.observability,
  terminalSendExecutor,
  terminalSendEnabled: terminalSendEnabledFromEnv(process.env),
  codexHome: process.env.EVENTLOOPOS_CODEX_HOME,
});

server.listen(config.value.port, config.value.host, () => {
  console.log(`eventloop orchestrator listening on http://${config.value.host}:${config.value.port}`);
});

const autoBindIntervalMs = parsePositiveInteger(process.env.EVENTLOOPOS_CODEX_AUTO_BIND_INTERVAL_MS);
let autoBindTimer: NodeJS.Timeout | undefined;
if (autoBindIntervalMs && autoBindIntervalMs > 0) {
  const orchestratorUrl = `http://${config.value.host}:${config.value.port}`;
  autoBindTimer = setInterval(async () => {
    try {
      const response = await fetch(`${orchestratorUrl}/agents/codex/auto-bind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        console.warn(`auto-bind tick HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(`auto-bind tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, autoBindIntervalMs);
  console.log(`codex auto-bind enabled every ${autoBindIntervalMs}ms`);
}

let ambientWorkspaceSaver: AmbientWorkspaceSaver | undefined;
if (process.env.EVENTLOOPOS_AMBIENT_WORKSPACE_SAVE === "1" && workspace) {
  const observability = gatewayRuntime.observability ?? createInMemoryObservability();
  const runtime = createRuntime({
    store: gatewayRuntime.store,
    workspace,
    observability,
  });
  const pollIntervalMs = parsePositiveInteger(process.env.EVENTLOOPOS_AMBIENT_SAVE_POLL_MS);
  const debounceMs = parsePositiveInteger(process.env.EVENTLOOPOS_AMBIENT_SAVE_DEBOUNCE_MS);
  ambientWorkspaceSaver = createAmbientWorkspaceSaverFromRuntime(runtime, {
    pollIntervalMs,
    debounceMs,
  });
  ambientWorkspaceSaver?.start();
  if (ambientWorkspaceSaver) {
    console.log(
      `ambient workspace saver enabled (poll=${pollIntervalMs ?? 5000}ms, debounce=${debounceMs ?? 3000}ms)`,
    );
  }
}

const autoPromoteIntervalMs = parsePositiveInteger(process.env.EVENTLOOPOS_READING_QUEUE_AUTO_PROMOTE_INTERVAL_MS);
const autoPromoteMinAgeSeconds = parsePositiveInteger(process.env.EVENTLOOPOS_READING_QUEUE_AUTO_PROMOTE_MIN_AGE_SECONDS) ?? 300;
let autoPromoteTimer: NodeJS.Timeout | undefined;
if (autoPromoteIntervalMs && autoPromoteIntervalMs > 0) {
  const orchestratorUrl = `http://${config.value.host}:${config.value.port}`;
  autoPromoteTimer = setInterval(async () => {
    try {
      const response = await fetch(`${orchestratorUrl}/reading-queue/auto-promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ min_age_seconds: autoPromoteMinAgeSeconds, actor_id: "orchestrator-auto-promote-timer" }),
      });
      if (!response.ok) {
        console.warn(`auto-promote tick HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(`auto-promote tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, autoPromoteIntervalMs);
  console.log(`reading-queue auto-promote enabled every ${autoPromoteIntervalMs}ms (min age ${autoPromoteMinAgeSeconds}s)`);
}

let followsWindowOrchestrator: FollowsWindowOrchestrator | undefined;
if (process.env.EVENTLOOPOS_FOLLOWS_WINDOWS === "1" && workspace) {
  const observability = gatewayRuntime.observability ?? createInMemoryObservability();
  const runtime = createRuntime({
    store: gatewayRuntime.store,
    workspace,
    observability,
  });
  const pollIntervalMs = parsePositiveInteger(process.env.EVENTLOOPOS_FOLLOWS_POLL_MS);
  const ttlMs = parsePositiveInteger(process.env.EVENTLOOPOS_FOLLOWS_TTL_MS);
  const pruneIntervalMs = parsePositiveInteger(process.env.EVENTLOOPOS_FOLLOWS_PRUNE_MS);
  const minWorkspaceCount = parsePositiveInteger(process.env.EVENTLOOPOS_FOLLOWS_THRESHOLD);
  followsWindowOrchestrator = createFollowsWindowOrchestratorFromRuntime(
    runtime,
    async () => {
      try {
        const { stdout } = await execFilePromise("aerospace", ["list-workspaces", "--focused"], { timeoutMs: 2_000 });
        const value = stdout.trim();
        return value.length > 0 ? value : undefined;
      } catch {
        return undefined;
      }
    },
    async (command) => {
      await execFilePromise(command.command, command.args, { timeoutMs: 5_000 });
    },
    { pollIntervalMs, ttlMs, pruneIntervalMs, minWorkspaceCount },
  );
  followsWindowOrchestrator?.start();
  if (followsWindowOrchestrator) {
    console.log(
      `follows-window orchestrator enabled (poll=${pollIntervalMs ?? 1000}ms, ttl=${ttlMs ?? 24 * 60 * 60 * 1000}ms)`,
    );
  }
}

let autoPaperWatcher: AutoPaperCodexIdleHandle | undefined;
if (process.env.EVENTLOOPOS_AUTO_PAPER_ENABLED === "1") {
  const tickMs = parsePositiveInteger(process.env.EVENTLOOPOS_AUTO_PAPER_TICK_MS);
  const idleSeconds = parsePositiveInteger(process.env.EVENTLOOPOS_AUTO_PAPER_IDLE_SECONDS);
  const dormantHours = parsePositiveNumber(process.env.EVENTLOOPOS_AUTO_DORMANT_HOURS);
  const observability = gatewayRuntime.observability ?? createInMemoryObservability();
  const registry = createAutoPaperTaskRegistry(gatewayRuntime.store);
  if (!registry) {
    console.warn(
      "EVENTLOOPOS_AUTO_PAPER_ENABLED=1 but the configured store does not yet expose listTasks/recordTaskPaperEmitted (phase 2 not landed). Auto-paper watcher disabled.",
    );
  } else {
    autoPaperWatcher = startAutoPaperCodexIdleWatcher({
      registry,
      ingestor: gatewayRuntime.store,
      manualMode: gatewayRuntime.store,
      activeTask: gatewayRuntime.store,
      observability,
      codexHome: process.env.EVENTLOOPOS_CODEX_HOME,
      defaultIdleSeconds: idleSeconds,
      autoDormantSeconds: dormantHours === undefined ? undefined : Math.floor(dormantHours * 60 * 60),
      intervalMs: tickMs,
      now: () => new Date(),
    });
    console.log(
      `auto-paper codex idle watcher enabled (tick=${tickMs ?? 30_000}ms, idle_threshold=${idleSeconds ?? 60}s)`,
    );
  }
}

function createAutoPaperTaskRegistry(store: GatewayStore): AutoPaperTaskRegistry | undefined {
  // TODO(phase-2-integration): replace this duck-typed adapter with a direct
  // dependency on GatewayStore.listTasks / recordTaskPaperEmitted once the
  // tasks table lands.
  const candidate = store as unknown as {
    listTasks?: () => Promise<AutoPaperTaskRecord[]>;
    recordTaskPaperEmitted?: (taskId: string, emittedAt: Date) => Promise<void>;
    markTaskDormant?: (taskId: string, dormantAt: Date) => Promise<unknown>;
  };
  if (typeof candidate.listTasks !== "function" || typeof candidate.recordTaskPaperEmitted !== "function") {
    return undefined;
  }
  return {
    listTasks: () => candidate.listTasks!(),
    recordTaskPaperEmitted: (taskId, emittedAt) => candidate.recordTaskPaperEmitted!(taskId, emittedAt),
    markTaskDormant: candidate.markTaskDormant
      ? (taskId, dormantAt) => candidate.markTaskDormant!(taskId, dormantAt)
      : undefined,
  };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (autoPromoteTimer) clearInterval(autoPromoteTimer);
    if (autoBindTimer) clearInterval(autoBindTimer);
    autoPaperWatcher?.close();
    ambientWorkspaceSaver?.stop();
    followsWindowOrchestrator?.stop();
    taskSessionRuntime?.close?.();
    server.close(() => {
      gatewayRuntime.close?.().finally(() => process.exit(0));
    });
  });
}

async function createGatewayRuntime(): Promise<{
  store: ReturnType<typeof createInMemoryGatewayStore> | ReturnType<typeof createPostgresGatewayStore>;
  observability?: Observability;
  persistTerminalRefs?: boolean;
  close?: () => Promise<void>;
}> {
  if (config.ok && config.value.databaseUrl) {
    const postgres = new PostgresQueueStore({
      connectionString: config.value.databaseUrl,
      migrationsDir: config.value.postgresMigrationsDir,
    });
    try {
      await postgres.migrate();
    } catch (error) {
      await postgres.close().catch(() => undefined);
      throw new Error([
        "Postgres unavailable or migrations failed.",
        "Check DATABASE_URL, start the database, or run without Postgres using EVENTLOOPOS_DOGFOOD_POSTGRES=0 for local dogfood.",
        "If EVENTLOOPOS_POSTGRES_MIGRATIONS_DIR is set, verify the migration directory and SQL files.",
        `Postgres error: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"));
    }
    return {
      store: createPostgresGatewayStore(postgres),
      observability: new PostgresObservability(postgres.pool),
      persistTerminalRefs: true,
      close: () => postgres.close(),
    };
  }

  if (process.env.EVENTLOOPOS_IN_MEMORY_STORE_FILE) {
    const inMemoryStore = await loadOrCreatePersistentInMemoryStore(
      process.env.EVENTLOOPOS_IN_MEMORY_STORE_FILE,
      () => createSeededStore(config.ok ? config.value.seedFixturePath : undefined),
    );
    return {
      store: withStorePersistence(
        createInMemoryGatewayStore(inMemoryStore),
        inMemoryStore,
        process.env.EVENTLOOPOS_IN_MEMORY_STORE_FILE,
      ),
      persistTerminalRefs: true,
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

function createTaskSessionRuntime(store?: GatewayStore): { controller: TaskSessionController; close?: () => void } | undefined {
  if (!config.ok || config.value.taskSessions === "off") {
    return undefined;
  }

  const runtimes: Array<CompositeTaskSessionRuntime & { close?: () => void }> = config.value.taskSessions.map((mode) => {
    if (mode === "codex_app_server") return createCodexTaskSessionRuntime(config.value);
    if (mode === "claude_cli") {
      const claude = createClaudeTaskSessionRuntime(config.value);
      return store ? { ...claude, controller: new PersistentTerminalRefController({ inner: claude.controller, store }) } : claude;
    }
    const fake: CompositeTaskSessionRuntime = {
      name: "fake",
      controller: createSeededDevelopmentTaskSessions(),
    };
    return store ? { ...fake, controller: new PersistentTerminalRefController({ inner: fake.controller, store }) } : fake;
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
      : createCodexAppServerStdioConnection({
          onStderr: (chunk) => {
            const friendly = translateCodexStderr(chunk);
            if (friendly) {
              console.warn(friendly.message);
            }
          },
        });
    const taskMap = new CodexTaskMapResolver({
      inlineMap: runtimeConfig.codexTaskMap,
      mapPath: runtimeConfig.codexTaskMapPath,
      onError: (error) => {
        console.error(`Codex task map read failed: ${error.message}`);
      },
    });
    connection.initialized.catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const friendly = translateCodexStderr(message);
      if (friendly) {
        console.warn(friendly.message);
        return;
      }
      console.warn(`[codex-bridge] Codex app-server initialization failed: ${message}. Keystroke + queue paths still work.`);
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
