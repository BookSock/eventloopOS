import { normalizeAgentRunStatus } from "../contracts.js";

export type TaskSessionSelectionMode = "human_action" | "automatic_injection";

export type TaskSessionSelectionOptions = {
  mode?: TaskSessionSelectionMode;
};

export function taskSessionMatchesTask(candidate: unknown, taskId: string): candidate is { id: string; task_id: string } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0 && record.task_id === taskId;
}

export function bestTaskSessionForTask(
  sessions: unknown[],
  taskId: string,
  options: TaskSessionSelectionOptions = {},
): unknown | undefined {
  return sessions
    .filter((candidate) => taskSessionMatchesTask(candidate, taskId))
    .filter((candidate) => taskSessionCanReceiveFollowup(candidate, options))
    .sort(compareTaskSessionsForInjection)[0];
}

function taskSessionCanReceiveFollowup(candidate: unknown, options: TaskSessionSelectionOptions): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  if (record.status === "stopped" || record.status === "lost") return false;
  if (options.mode === "automatic_injection" && taskSessionNeedsHumanAttention(record.status)) return false;
  const supports = record.supports;
  if (supports && typeof supports === "object" && !Array.isArray(supports)) {
    return (supports as Record<string, unknown>).followup !== false;
  }
  return true;
}

function compareTaskSessionsForInjection(left: unknown, right: unknown): number {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftStatusRank = taskSessionStatusRank(leftRecord.status);
  const rightStatusRank = taskSessionStatusRank(rightRecord.status);
  if (rightStatusRank !== leftStatusRank) return rightStatusRank - leftStatusRank;

  const leftTimestamp = taskSessionLatestTimestamp(leftRecord);
  const rightTimestamp = taskSessionLatestTimestamp(rightRecord);
  if (rightTimestamp !== leftTimestamp) return rightTimestamp - leftTimestamp;

  return String(leftRecord.id).localeCompare(String(rightRecord.id));
}

function taskSessionStatusRank(status: unknown): number {
  if (taskSessionNeedsHumanAttention(status)) return 2;
  switch (status) {
    case "running":
      return 4;
    case "idle":
      return 3;
    case "blocked":
    case "stopped":
    case "lost":
      return 0;
    default:
      return 1;
  }
}

function taskSessionLatestTimestamp(record: Record<string, unknown>): number {
  return Math.max(
    timestamp(record.updated_at),
    timestamp(record.last_seen_at),
    timestamp(record.created_at),
  );
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskSessionNeedsHumanAttention(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  const canonical = normalizeAgentRunStatus(normalized);
  if (canonical === "blocked" || canonical === "waiting_approval") return true;
  if (normalized.includes("lost")) return true;
  if (normalized.includes("blocked") || normalized.includes("stuck")) return true;
  if (
    normalized.includes("waiting")
    && (
      normalized.includes("approval")
      || normalized.includes("answer")
      || normalized.includes("human")
      || normalized.includes("input")
      || normalized.includes("question")
      || normalized.includes("review")
      || normalized.includes("user")
    )
  ) {
    return true;
  }
  return false;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
