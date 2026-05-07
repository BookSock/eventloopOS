import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type OrchestratorConfig = {
  host: string;
  port: number;
  seedFixturePath?: string;
  databaseUrl?: string;
  taskSessions: "fake" | "codex_app_server" | "claude_cli" | "off";
  codexTaskMap?: Record<string, string>;
  codexTaskMapPath?: string;
  claudeSessionsRaw?: string;
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
  const mcpSourcesPathRaw = env.ORCHESTRATOR_MCP_SOURCES_PATH;
  const mcpSourcesPath = resolveConfiguredPath(mcpSourcesPathRaw);
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
  const codexTaskMapRaw = env.ORCHESTRATOR_CODEX_TASK_MAP;
  const codexTaskMapPathRaw = env.ORCHESTRATOR_CODEX_TASK_MAP_PATH;
  const codexTaskMapPath = resolveConfiguredPath(codexTaskMapPathRaw);
  const codexTaskMap = parseCodexTaskMap(codexTaskMapRaw, issues);
  validateClaudeSessionsRaw(env.ORCHESTRATOR_CLAUDE_SESSIONS, issues);
  if (codexTaskMapPathRaw !== undefined && !codexTaskMapPathRaw.trim()) {
    issues.push("ORCHESTRATOR_CODEX_TASK_MAP_PATH must be non-empty when set");
  }
  if (taskSessionsRaw !== "fake" && taskSessionsRaw !== "codex_app_server" && taskSessionsRaw !== "claude_cli" && taskSessionsRaw !== "off") {
    issues.push("ORCHESTRATOR_TASK_SESSIONS must be fake, codex_app_server, claude_cli, or off");
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

  const taskSessions = taskSessionsRaw === "off"
    ? "off"
    : taskSessionsRaw === "codex_app_server"
      ? "codex_app_server"
      : taskSessionsRaw === "claude_cli"
        ? "claude_cli"
        : "fake";
  const mcpSources = mcpSourcesRaw === "config" ? "config" : mcpSourcesRaw === "off" ? "off" : "seeded";
  const workspace = workspaceRaw === "off" ? "off" : "aerospace";
  const workspaceExecute = workspaceExecuteRaw === "enabled" ? "enabled" : "disabled";

  return {
    ok: true,
    value: {
      host,
      port,
      seedFixturePath: resolveConfiguredPath(env.ORCHESTRATOR_SEED_FIXTURE),
      databaseUrl: env.DATABASE_URL,
      taskSessions,
      codexTaskMap,
      codexTaskMapPath,
      claudeSessionsRaw: env.ORCHESTRATOR_CLAUDE_SESSIONS,
      mcpSources,
      mcpSourcesPath,
      workspace,
      workspaceExecute,
    },
  };
}

function resolveConfiguredPath(rawPath: string | undefined): string | undefined {
  const trimmedPath = rawPath?.trim();
  if (!trimmedPath) return rawPath;
  if (isAbsolute(trimmedPath)) return trimmedPath;

  const candidates = [
    resolve(process.cwd(), trimmedPath),
    resolve(process.cwd(), "../..", trimmedPath),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? trimmedPath;
}

function parseCodexTaskMap(raw: string | undefined, issues: string[]): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      issues.push("ORCHESTRATOR_CODEX_TASK_MAP must be a JSON object mapping thread ids to task ids");
      return undefined;
    }
    const map: Record<string, string> = {};
    for (const [threadId, taskId] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId || typeof taskId !== "string" || !taskId) {
        issues.push("ORCHESTRATOR_CODEX_TASK_MAP entries must be non-empty string task ids");
        return undefined;
      }
      map[threadId] = taskId;
    }
    return map;
  } catch {
    issues.push("ORCHESTRATOR_CODEX_TASK_MAP must be valid JSON");
    return undefined;
  }
}

function validateClaudeSessionsRaw(raw: string | undefined, issues: string[]): void {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      issues.push("ORCHESTRATOR_CLAUDE_SESSIONS must be a JSON object mapping Claude session ids to task ids or metadata");
      return;
    }
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!sessionId) {
        issues.push("ORCHESTRATOR_CLAUDE_SESSIONS entries must have non-empty session ids");
        return;
      }
      if (typeof value === "string") {
        if (!value) {
          issues.push("ORCHESTRATOR_CLAUDE_SESSIONS string entries must be non-empty task ids");
          return;
        }
        continue;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push("ORCHESTRATOR_CLAUDE_SESSIONS entries must be task id strings or metadata objects");
        return;
      }
    }
  } catch {
    issues.push("ORCHESTRATOR_CLAUDE_SESSIONS must be valid JSON");
  }
}
