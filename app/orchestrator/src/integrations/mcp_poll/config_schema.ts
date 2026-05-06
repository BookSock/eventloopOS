import type { McpPollSourceConfig } from "./types.js";

export type McpSourceConfigValidationResult =
  | { ok: true; value: McpPollSourceConfig }
  | { ok: false; issues: string[] };

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_DEDUPE_WINDOW = 1_000;

export function validateMcpPollSourceConfig(input: unknown): McpSourceConfigValidationResult {
  const issues: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, issues: ["source config must be an object"] };
  }

  const server = isRecord(input.server) ? input.server : undefined;
  const poll = isRecord(input.poll) ? input.poll : undefined;
  const cursor = isRecord(input.cursor) ? input.cursor : undefined;
  const riskPolicy = isRecord(input.riskPolicy) ? input.riskPolicy : undefined;

  const id = readString(input, "id", issues);
  const eventMapper = readEnum(
    input,
    "eventMapper",
    ["slack_message_to_event", "github_update_to_event", "generic_item_to_event"],
    issues,
  );

  if (!server) issues.push("server must be an object");
  if (!poll) issues.push("poll must be an object");
  if (!cursor) issues.push("cursor must be an object");
  if (!riskPolicy) issues.push("riskPolicy must be an object");

  const serverName = server ? readString(server, "name", issues, "server.name") : "";
  const command = server ? readString(server, "command", issues, "server.command") : "";
  const serverArgs = server ? readStringArray(server, "args", issues, "server.args") : [];
  const envAllowlist = server ? readStringArray(server, "envAllowlist", issues, "server.envAllowlist") : [];
  const stderrLogPath = server ? readString(server, "stderrLogPath", issues, "server.stderrLogPath") : "";

  const tool = poll ? readString(poll, "tool", issues, "poll.tool") : "";
  const pollArgs = poll && isRecord(poll.args) ? poll.args : {};
  if (poll && poll.args !== undefined && !isRecord(poll.args)) {
    issues.push("poll.args must be an object");
  }
  const timeoutMs = poll ? readOptionalPositiveInteger(poll, "timeoutMs", DEFAULT_TIMEOUT_MS, issues, "poll.timeoutMs") : DEFAULT_TIMEOUT_MS;

  const strategy = cursor ? readEnum(cursor, "strategy", ["field", "hash"], issues, "cursor.strategy") : "field";
  const field = cursor?.field === undefined ? undefined : readString(cursor, "field", issues, "cursor.field");
  const initial = cursor?.initial === undefined ? undefined : readString(cursor, "initial", issues, "cursor.initial");
  const dedupeWindow = cursor
    ? readOptionalPositiveInteger(cursor, "dedupeWindow", DEFAULT_DEDUPE_WINDOW, issues, "cursor.dedupeWindow")
    : DEFAULT_DEDUPE_WINDOW;

  if (strategy === "field" && !field) {
    issues.push("cursor.field must be set when cursor.strategy is field");
  }

  const readOnly = riskPolicy ? readBoolean(riskPolicy, "readOnly", issues, "riskPolicy.readOnly") : true;
  const allowWriteTools = riskPolicy ? readBoolean(riskPolicy, "allowWriteTools", issues, "riskPolicy.allowWriteTools") : false;
  const maxRiskLevel = riskPolicy
    ? readEnum(riskPolicy, "maxRiskLevel", ["low", "medium", "high", "critical"], issues, "riskPolicy.maxRiskLevel")
    : "low";
  const untrustedTextFields = riskPolicy
    ? readStringArray(riskPolicy, "untrustedTextFields", issues, "riskPolicy.untrustedTextFields")
    : [];

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      id,
      server: {
        name: serverName,
        command,
        args: serverArgs,
        envAllowlist,
        stderrLogPath,
      },
      poll: {
        tool,
        args: pollArgs,
        timeoutMs,
      },
      cursor: {
        strategy,
        field,
        initial,
        dedupeWindow,
      },
      eventMapper,
      riskPolicy: {
        readOnly,
        allowWriteTools,
        maxRiskLevel,
        untrustedTextFields,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  input: Record<string, unknown>,
  key: string,
  issues: string[],
  label = key,
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function readBoolean(input: Record<string, unknown>, key: string, issues: string[], label = key): boolean {
  const value = input[key];
  if (typeof value !== "boolean") {
    issues.push(`${label} must be a boolean`);
    return false;
  }
  return value;
}

function readStringArray(input: Record<string, unknown>, key: string, issues: string[], label = key): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push(`${label} must be an array of strings`);
    return [];
  }
  return value;
}

function readEnum<const T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  issues: string[],
  label = key,
): T {
  const value = input[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issues.push(`${label} must be one of ${allowed.join(", ")}`);
    return allowed[0];
  }
  return value as T;
}

function readOptionalPositiveInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  issues: string[],
  label = key,
): number {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    issues.push(`${label} must be a positive integer`);
    return fallback;
  }
  return value;
}
