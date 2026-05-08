export function taskSessionMatchesTask(candidate: unknown, taskId: string): candidate is { id: string; task_id: string } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0 && record.task_id === taskId;
}

export function bestTaskSessionForTask(sessions: unknown[], taskId: string): unknown | undefined {
  return sessions
    .filter((candidate) => taskSessionMatchesTask(candidate, taskId))
    .filter(taskSessionCanReceiveFollowup)
    .sort(compareTaskSessionsForInjection)[0];
}

function taskSessionCanReceiveFollowup(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  if (record.status === "stopped" || record.status === "lost") return false;
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
  switch (status) {
    case "running":
      return 4;
    case "idle":
      return 3;
    case "blocked":
      return 2;
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
