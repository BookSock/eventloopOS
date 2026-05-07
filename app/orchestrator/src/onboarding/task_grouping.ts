import { createHash } from "node:crypto";
import type { TaskRuntimeSession } from "../task_sessions/types.js";
import type { WorkspaceSnapshot } from "../workspace/aerospace.js";

export type OnboardingWindow = {
  id: number;
  app: string;
  title: string;
  workspace: string;
  task_hint?: string;
};

export type OnboardingTaskProposal = {
  id: string;
  task_id: string;
  title: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  windows: OnboardingWindow[];
  task_sessions: TaskRuntimeSession[];
  suggested_next_action: string;
};

export type OnboardingScan = {
  ok: true;
  captured_at: string;
  proposals: OnboardingTaskProposal[];
  ungrouped_windows: OnboardingWindow[];
  task_sessions: TaskRuntimeSession[];
  warnings: string[];
};

export function buildOnboardingScan(input: {
  snapshot?: WorkspaceSnapshot;
  taskSessions?: TaskRuntimeSession[];
  capturedAt: string;
  warnings?: string[];
}): OnboardingScan {
  const windows = (input.snapshot?.windows ?? []).map(toOnboardingWindow);
  const taskSessions = input.taskSessions ?? [];
  const groups = new Map<string, {
    taskId: string;
    title: string;
    reason: string;
    windows: OnboardingWindow[];
    sessions: TaskRuntimeSession[];
    confidence: "high" | "medium" | "low";
  }>();

  for (const session of taskSessions) {
    const taskId = normalizeTaskId(readString(session.task_id) ?? "");
    if (!isMeaningfulTaskId(taskId)) continue;
    const group = ensureGroup(groups, taskId, titleFromTaskId(taskId), "existing task session", "medium");
    group.sessions.push(session);
    group.confidence = maxConfidence(group.confidence, "medium");
  }

  for (const window of windows) {
    const taskHint = window.task_hint;
    if (taskHint) {
      const taskId = normalizeTaskId(taskHint);
      const group = ensureGroup(groups, taskId, titleFromTaskId(taskId), "window title contains [task:...]", "high");
      group.windows.push(window);
      group.confidence = "high";
      continue;
    }

    const sessionTaskId = matchingSessionTaskId(window, taskSessions);
    if (sessionTaskId) {
      const group = ensureGroup(groups, sessionTaskId, titleFromTaskId(sessionTaskId), "window title matches task session", "medium");
      group.windows.push(window);
      group.confidence = maxConfidence(group.confidence, "medium");
      continue;
    }

    const fallback = fallbackTaskForWindow(window);
    if (fallback) {
      const group = ensureGroup(groups, fallback.taskId, fallback.title, fallback.reason, "low");
      group.windows.push(window);
    }
  }

  const groupedWindowIds = new Set(Array.from(groups.values()).flatMap((group) => group.windows.map((window) => window.id)));
  const proposals = Array.from(groups.values())
    .filter((group) => group.windows.length > 0 || group.sessions.length > 0)
    .map((group) => ({
      id: `onboard_${stableId([group.taskId, ...group.windows.map((window) => String(window.id)), ...group.sessions.map((session) => readString(session.id) ?? "")])}`,
      task_id: group.taskId,
      title: group.title,
      confidence: group.confidence,
      reason: group.reason,
      windows: group.windows,
      task_sessions: group.sessions,
      suggested_next_action: group.confidence === "high"
        ? "Approve this task context, then let agents continue from it."
        : "Review and rename/merge before agents rely on this grouping.",
    }))
    .sort(compareProposals);

  return {
    ok: true,
    captured_at: input.capturedAt,
    proposals,
    ungrouped_windows: windows.filter((window) => !groupedWindowIds.has(window.id)),
    task_sessions: taskSessions,
    warnings: input.warnings ?? [],
  };
}

function toOnboardingWindow(window: WorkspaceSnapshot["windows"][number]): OnboardingWindow {
  return {
    id: window.id,
    app: window.app,
    title: window.title,
    workspace: window.workspace,
    task_hint: taskHintFromText(`${window.app} ${window.title} ${window.workspace}`),
  };
}

function taskHintFromText(text: string): string | undefined {
  const match = /\[task:([^\]]+)\]/i.exec(text);
  return match?.[1]?.trim();
}

function matchingSessionTaskId(window: OnboardingWindow, sessions: TaskRuntimeSession[]): string | undefined {
  const haystack = `${window.title} ${window.workspace}`.toLowerCase();
  for (const session of sessions) {
    const taskId = readString(session.task_id);
    if (!taskId) continue;
    const words = taskId.replace(/^task_/, "").split(/[_\s-]+/).filter((word) => word.length >= 3);
    if (words.length > 0 && words.every((word) => haystack.includes(word.toLowerCase()))) {
      return normalizeTaskId(taskId);
    }
  }
  return undefined;
}

function fallbackTaskForWindow(window: OnboardingWindow): { taskId: string; title: string; reason: string } | undefined {
  const app = window.app.toLowerCase();
  const title = window.title.toLowerCase();
  if (app.includes("ghostty") || app.includes("terminal") || title.includes("codex") || title.includes("claude")) {
    return {
      taskId: "task_coding_unassigned",
      title: "Coding Unassigned",
      reason: "terminal or coding-agent window without task tag",
    };
  }
  if (app.includes("chrome") || app.includes("safari") || app.includes("arc")) {
    return {
      taskId: "task_reading_queue",
      title: "Reading Queue",
      reason: "browser window without task tag",
    };
  }
  return undefined;
}

function ensureGroup(
  groups: Map<string, { taskId: string; title: string; reason: string; windows: OnboardingWindow[]; sessions: TaskRuntimeSession[]; confidence: "high" | "medium" | "low" }>,
  taskId: string,
  title: string,
  reason: string,
  confidence: "high" | "medium" | "low",
) {
  const existing = groups.get(taskId);
  if (existing) return existing;
  const created = { taskId, title, reason, windows: [], sessions: [], confidence };
  groups.set(taskId, created);
  return created;
}

function normalizeTaskId(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^task_/, "");
  const slug = trimmed.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `task_${slug || "untitled"}`;
}

function isMeaningfulTaskId(taskId: string): boolean {
  return taskId !== "task_untitled" && !taskId.startsWith("task_codex_thread_");
}

function titleFromTaskId(taskId: string): string {
  return taskId.replace(/^task_/, "").split("_").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function maxConfidence(left: "high" | "medium" | "low", right: "high" | "medium" | "low") {
  const score = { low: 0, medium: 1, high: 2 };
  return score[right] > score[left] ? right : left;
}

function compareProposals(left: OnboardingTaskProposal, right: OnboardingTaskProposal): number {
  const confidenceScore = { high: 0, medium: 1, low: 2 };
  return confidenceScore[left.confidence] - confidenceScore[right.confidence]
    || right.windows.length - left.windows.length
    || left.title.localeCompare(right.title);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}
