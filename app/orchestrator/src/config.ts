export type OrchestratorConfig = {
  host: string;
  port: number;
  seedFixturePath?: string;
  databaseUrl?: string;
  taskSessions: "fake" | "off";
  mcpSources: "seeded" | "config" | "off";
  mcpSourcesPath?: string;
  workspace: "aerospace" | "off";
  workspaceExecute: "disabled" | "enabled";
};

export type ConfigValidationResult =
  | { ok: true; value: OrchestratorConfig }
  | { ok: false; issues: string[] };

const DEFAULT_PORT = 4377;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const host = env.ORCHESTRATOR_HOST ?? "127.0.0.1";
  const portRaw = env.ORCHESTRATOR_PORT ?? String(DEFAULT_PORT);
  const port = Number(portRaw);
  const taskSessionsRaw = env.ORCHESTRATOR_TASK_SESSIONS ?? "fake";
  const mcpSourcesPath = env.ORCHESTRATOR_MCP_SOURCES_PATH;
  const mcpSourcesRaw = env.ORCHESTRATOR_MCP_SOURCES ?? (mcpSourcesPath ? "config" : "seeded");
  const workspaceRaw = env.ORCHESTRATOR_WORKSPACE ?? "aerospace";
  const workspaceExecuteRaw = env.ORCHESTRATOR_WORKSPACE_EXECUTE ?? "disabled";
  const issues: string[] = [];

  if (!host.trim()) {
    issues.push("ORCHESTRATOR_HOST must be non-empty");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push("ORCHESTRATOR_PORT must be an integer between 1 and 65535");
  }
  if (taskSessionsRaw !== "fake" && taskSessionsRaw !== "off") {
    issues.push("ORCHESTRATOR_TASK_SESSIONS must be fake or off");
  }
  if (mcpSourcesRaw !== "seeded" && mcpSourcesRaw !== "config" && mcpSourcesRaw !== "off") {
    issues.push("ORCHESTRATOR_MCP_SOURCES must be seeded, config, or off");
  }
  if (mcpSourcesRaw === "config" && !mcpSourcesPath) {
    issues.push("ORCHESTRATOR_MCP_SOURCES_PATH must be set when ORCHESTRATOR_MCP_SOURCES=config");
  }
  if (workspaceRaw !== "aerospace" && workspaceRaw !== "off") {
    issues.push("ORCHESTRATOR_WORKSPACE must be aerospace or off");
  }
  if (workspaceExecuteRaw !== "disabled" && workspaceExecuteRaw !== "enabled") {
    issues.push("ORCHESTRATOR_WORKSPACE_EXECUTE must be disabled or enabled");
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const taskSessions = taskSessionsRaw === "off" ? "off" : "fake";
  const mcpSources = mcpSourcesRaw === "config" ? "config" : mcpSourcesRaw === "off" ? "off" : "seeded";
  const workspace = workspaceRaw === "off" ? "off" : "aerospace";
  const workspaceExecute = workspaceExecuteRaw === "enabled" ? "enabled" : "disabled";

  return {
    ok: true,
    value: {
      host,
      port,
      seedFixturePath: env.ORCHESTRATOR_SEED_FIXTURE,
      databaseUrl: env.DATABASE_URL,
      taskSessions,
      mcpSources,
      mcpSourcesPath,
      workspace,
      workspaceExecute,
    },
  };
}
