import { createHash } from "node:crypto";
import type { ContextEntry } from "../store/context_entries.js";
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
  browser_contexts: OnboardingBrowserContext[];
  task_sessions: TaskRuntimeSession[];
  suggested_next_action: string;
};

export type OnboardingBrowserContext = {
  id: string;
  title: string;
  url?: string;
  task_id?: string;
  window_id?: string;
  tab_id?: string;
  captured_at: string;
  restore_confidence: "high" | "medium" | "low";
};

export type OnboardingScan = {
  ok: true;
  captured_at: string;
  active_workspace?: string;
  focused_window_id?: number;
  summary: {
    window_count: number;
    grouped_window_count: number;
    ungrouped_window_count: number;
    task_session_count: number;
    browser_context_count: number;
    proposal_count: number;
  };
  proposals: OnboardingTaskProposal[];
  ungrouped_windows: OnboardingWindow[];
  browser_contexts: OnboardingBrowserContext[];
  task_sessions: TaskRuntimeSession[];
  warnings: string[];
};

export function buildOnboardingScan(input: {
  snapshot?: WorkspaceSnapshot;
  taskSessions?: TaskRuntimeSession[];
  browserContexts?: ContextEntry[];
  capturedAt: string;
  warnings?: string[];
}): OnboardingScan {
  const windows = (input.snapshot?.windows ?? []).map(toOnboardingWindow);
  const taskSessions = input.taskSessions ?? [];
  const browserContexts = (input.browserContexts ?? []).map(toOnboardingBrowserContext).filter((context): context is OnboardingBrowserContext => context !== undefined);
  const groups = new Map<string, {
    taskId: string;
    title: string;
    reason: string;
    windows: OnboardingWindow[];
    browserContexts: OnboardingBrowserContext[];
    sessions: TaskRuntimeSession[];
    confidence: "high" | "medium" | "low";
  }>();
  const browserContextTaskIds = new Map<string, string>();
  const unassignedWindows: OnboardingWindow[] = [];

  for (const session of taskSessions) {
    const taskId = normalizeTaskId(readString(session.task_id) ?? "");
    if (!isMeaningfulTaskId(taskId)) continue;
    const group = ensureGroup(groups, taskId, titleFromTaskId(taskId), "existing task session", "medium");
    group.sessions.push(session);
    group.confidence = maxConfidence(group.confidence, "medium");
  }

  for (const context of browserContexts) {
    const explicitTaskId = normalizeTaskId(context.task_id ?? "");
    const taggedTaskHint = taskHintFromText(`${context.title} ${context.url ?? ""}`);
    const matchedSessionTaskId = matchingSessionTaskIdForText(`${context.title} ${context.url ?? ""}`, taskSessions);
    const taskId = isMeaningfulTaskId(explicitTaskId)
      ? explicitTaskId
      : taggedTaskHint
        ? normalizeTaskId(taggedTaskHint)
        : matchedSessionTaskId ?? "task_reading_queue";
    const confidence = isMeaningfulTaskId(explicitTaskId) || taggedTaskHint ? "medium" : matchedSessionTaskId ? "medium" : "low";
    const reason = isMeaningfulTaskId(explicitTaskId)
      ? "captured browser tab already attached to task"
      : taggedTaskHint
        ? "browser tab title or URL contains [task:...]"
        : matchedSessionTaskId
          ? "browser tab matches task session"
          : "captured browser tab without task tag";
    const group = ensureGroup(groups, taskId, titleFromTaskId(taskId), reason, confidence);
    group.browserContexts.push(context);
    group.confidence = maxConfidence(group.confidence, confidence);
    browserContextTaskIds.set(context.id, taskId);
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

    const browserContextTaskId = matchingBrowserContextTaskId(window, browserContexts, browserContextTaskIds);
    if (browserContextTaskId) {
      const group = ensureGroup(groups, browserContextTaskId, titleFromTaskId(browserContextTaskId), "browser window matches captured tab context", "medium");
      group.windows.push(window);
      group.confidence = maxConfidence(group.confidence, "medium");
      continue;
    }

    const unboundCodingSession = matchingUnboundCodingSession(window, taskSessions);
    if (unboundCodingSession) {
      const group = ensureGroup(
        groups,
        unboundCodingSession.taskId,
        titleFromTaskId(unboundCodingSession.taskId),
        "terminal window matches unbound coding session",
        "medium",
      );
      group.windows.push(window);
      group.sessions.push(unboundCodingSession.session);
      group.confidence = maxConfidence(group.confidence, "medium");
      continue;
    }

    unassignedWindows.push(window);
  }

  for (const window of unassignedWindows) {
    const workspaceTaskGroup = matchingWorkspaceTaskGroup(window, groups);
    if (workspaceTaskGroup) {
      workspaceTaskGroup.windows.push(window);
      workspaceTaskGroup.confidence = maxConfidence(workspaceTaskGroup.confidence, "medium");
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
    .filter((group) => group.windows.length > 0 || group.sessions.length > 0 || group.browserContexts.length > 0)
    .map((group) => ({
      id: `onboard_${stableId([group.taskId, ...group.windows.map((window) => String(window.id)), ...group.browserContexts.map((context) => context.id), ...group.sessions.map((session) => readString(session.id) ?? "")])}`,
      task_id: group.taskId,
      title: group.title,
      confidence: group.confidence,
      reason: group.reason,
      windows: group.windows,
      browser_contexts: group.browserContexts,
      task_sessions: group.sessions,
      suggested_next_action: group.confidence === "high"
        ? "Approve this task context, then let agents continue from it."
        : "Review and rename/merge before agents rely on this grouping.",
    }))
    .sort(compareProposals);

  return {
    ok: true,
    captured_at: input.capturedAt,
    active_workspace: input.snapshot?.activeWorkspace,
    focused_window_id: input.snapshot?.focusedWindowId,
    summary: {
      window_count: windows.length,
      grouped_window_count: groupedWindowIds.size,
      ungrouped_window_count: windows.length - groupedWindowIds.size,
      task_session_count: taskSessions.length,
      browser_context_count: browserContexts.length,
      proposal_count: proposals.length,
    },
    proposals,
    ungrouped_windows: windows.filter((window) => !groupedWindowIds.has(window.id)),
    browser_contexts: browserContexts,
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

function toOnboardingBrowserContext(entry: ContextEntry): OnboardingBrowserContext | undefined {
  const resource = entry.resource;
  if (resource.kind !== "browser_tab") return undefined;
  const id = readString(resource.id) ?? `browser_tab:${entry.event_id}`;
  const title = readString(resource.title) ?? entry.event_title;
  return {
    id,
    title,
    url: readString(resource.url),
    task_id: entry.task_id,
    window_id: readString(resource.window_id),
    tab_id: readString(resource.tab_id),
    captured_at: readString(resource.captured_at) ?? entry.captured_at,
    restore_confidence: restoreConfidence(resource.restore_confidence),
  };
}

function taskHintFromText(text: string): string | undefined {
  const match = /\[task:([^\]]+)\]/i.exec(text);
  return match?.[1]?.trim();
}

function matchingSessionTaskId(window: OnboardingWindow, sessions: TaskRuntimeSession[]): string | undefined {
  return matchingSessionTaskIdForText(`${window.title} ${window.workspace}`, sessions);
}

function matchingSessionTaskIdForText(text: string, sessions: TaskRuntimeSession[]): string | undefined {
  const haystack = text.toLowerCase();
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

function matchingBrowserContextTaskId(
  window: OnboardingWindow,
  browserContexts: OnboardingBrowserContext[],
  browserContextTaskIds: Map<string, string>,
): string | undefined {
  if (!isBrowserWindow(window)) return undefined;

  for (const context of browserContexts) {
    const taskId = browserContextTaskIds.get(context.id);
    if (!taskId) continue;
    if (context.window_id && Number(context.window_id) === window.id) return taskId;
    if (browserContextMatchesWindow(context, window)) return taskId;
  }

  return undefined;
}

function browserContextMatchesWindow(context: OnboardingBrowserContext, window: OnboardingWindow): boolean {
  const windowText = `${window.title} ${window.workspace}`.toLowerCase();
  const contextText = `${context.title} ${context.url ?? ""}`.toLowerCase();
  const titleTokens = significantTokens(context.title);
  if (titleTokens.length >= 2 && titleTokens.every((token) => windowText.includes(token))) return true;
  const windowTokens = significantTokens(window.title);
  if (windowTokens.length >= 2 && windowTokens.every((token) => contextText.includes(token))) return true;
  return false;
}

function matchingWorkspaceTaskGroup(
  window: OnboardingWindow,
  groups: Map<string, { taskId: string; title: string; reason: string; windows: OnboardingWindow[]; browserContexts: OnboardingBrowserContext[]; sessions: TaskRuntimeSession[]; confidence: "high" | "medium" | "low" }>,
): { taskId: string; title: string; reason: string; windows: OnboardingWindow[]; browserContexts: OnboardingBrowserContext[]; sessions: TaskRuntimeSession[]; confidence: "high" | "medium" | "low" } | undefined {
  if (!window.workspace) return undefined;
  const candidates = Array.from(groups.values()).filter((group) => {
    if (group.taskId === "task_reading_queue" || group.taskId === "task_coding_unassigned") return false;
    if (!group.windows.some((candidate) => candidate.workspace === window.workspace)) return false;
    return taskWindowTokensOverlap(group, window);
  });
  if (candidates.length !== 1) return undefined;
  return candidates[0];
}

function taskWindowTokensOverlap(
  group: { taskId: string; title: string; browserContexts: OnboardingBrowserContext[]; sessions: TaskRuntimeSession[] },
  window: OnboardingWindow,
): boolean {
  const taskTokens = significantTokens([
    group.taskId,
    group.title,
    ...group.browserContexts.map((context) => `${context.title} ${context.url ?? ""}`),
    ...group.sessions.map((session) => sessionMatchText(session, group.taskId)),
  ].join(" "));
  if (taskTokens.length === 0) return false;
  const windowTokens = significantTokens(`${window.app} ${window.title}`);
  return windowTokens.some((token) => taskTokens.includes(token));
}

function matchingUnboundCodingSession(
  window: OnboardingWindow,
  sessions: TaskRuntimeSession[],
): { taskId: string; session: TaskRuntimeSession } | undefined {
  if (!isCodingWindow(window)) return undefined;
  const windowTokens = significantTokens(`${window.title} ${window.workspace}`);
  if (windowTokens.length === 0) return undefined;

  for (const session of sessions) {
    const explicitTaskId = normalizeTaskId(readString(session.task_id) ?? "");
    if (isMeaningfulTaskId(explicitTaskId)) continue;
    if (!isCodingSession(session)) continue;

    const inferredTaskId = inferredTaskIdForSession(session);
    if (!isMeaningfulTaskId(inferredTaskId)) continue;

    const sessionTokens = significantTokens(sessionMatchText(session, inferredTaskId));
    if (sessionTokens.length === 0) continue;
    const overlap = windowTokens.filter((token) => sessionTokens.includes(token));
    if (overlap.length > 0) {
      return { taskId: inferredTaskId, session };
    }
  }

  return undefined;
}

function isCodingWindow(window: OnboardingWindow): boolean {
  const app = window.app.toLowerCase();
  const title = window.title.toLowerCase();
  return app.includes("ghostty") || app.includes("terminal") || title.includes("codex") || title.includes("claude");
}

function isCodingSession(session: TaskRuntimeSession): boolean {
  const provider = readString(session.provider)?.toLowerCase() ?? "";
  return provider.includes("codex") || provider.includes("claude") || provider.includes("terminal");
}

function inferredTaskIdForSession(session: TaskRuntimeSession): string {
  const named = readString(session.name) ?? readString(session.title);
  if (named) return normalizeTaskId(named);
  const cwd = readString(session.cwd);
  if (cwd) {
    const segments = cwd.split("/").map((segment) => segment.trim()).filter(Boolean);
    const basename = segments.at(-1);
    if (basename) return normalizeTaskId(basename);
  }
  return normalizeTaskId(readString(session.preview) ?? "");
}

function sessionMatchText(session: TaskRuntimeSession, inferredTaskId: string): string {
  return [
    inferredTaskId,
    readString(session.name),
    readString(session.title),
    readString(session.cwd),
    readString(session.preview),
  ].filter((part): part is string => Boolean(part)).join(" ");
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

function isBrowserWindow(window: OnboardingWindow): boolean {
  const app = window.app.toLowerCase();
  return app.includes("chrome") || app.includes("safari") || app.includes("arc");
}

function significantTokens(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4))).slice(0, 5);
}

function ensureGroup(
  groups: Map<string, { taskId: string; title: string; reason: string; windows: OnboardingWindow[]; browserContexts: OnboardingBrowserContext[]; sessions: TaskRuntimeSession[]; confidence: "high" | "medium" | "low" }>,
  taskId: string,
  title: string,
  reason: string,
  confidence: "high" | "medium" | "low",
) {
  const existing = groups.get(taskId);
  if (existing) return existing;
  const created = { taskId, title, reason, windows: [], browserContexts: [], sessions: [], confidence };
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
    || right.browser_contexts.length - left.browser_contexts.length
    || left.title.localeCompare(right.title);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function restoreConfidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}
