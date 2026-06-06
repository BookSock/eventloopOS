import { inspectCodexSession, type CodexSessionInspection } from "./codex/session_inspector.js";
import { inspectClaudeSession, type ClaudeSessionInspection } from "./claude/session_inspector.js";
import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { StoredEventResult } from "../store.js";
import type { TaskRuntimeSession } from "../task_sessions/types.js";

// Phase 5 of the hotkey-state-machine spec — auto-paper-on-Codex-idle.
//
// For each registered task whose primary anchor is a Codex thread, we inspect
// its rollout file each tick. When the thread has been idle longer than the
// per-task threshold AND we have not already emitted a paper for the *current*
// idle period, we synthesize a `codex.task_idle` event and post it through the
// existing event ingestion pipeline (same path as the `paper:` source).
//
// Throttle: once a paper is emitted for task T, suppress further emits until
// the thread becomes active again (last_event_at advances) and a fresh idle
// period accumulates past the threshold.

export const DEFAULT_IDLE_THRESHOLD_SECONDS = 60;
export const DEFAULT_TICK_INTERVAL_MS = 30_000;
export const DEFAULT_AUTO_DORMANT_SECONDS = 24 * 60 * 60;

export type AutoPaperTaskRecord = {
  id: string;
  primary_anchor_kind: string;
  primary_anchor_id: string;
  auto_paper_idle_seconds?: number;
  last_paper_emitted_at?: string | null;
  dormant_at?: string | null;
};

export type AutoPaperManualModeReader = {
  getManualModeState(): Promise<{ active: boolean; entered_at?: string }>;
};

export type AutoPaperActiveTaskReader = {
  getCurrentTaskState(): Promise<{ current_task_id: string | null }>;
};

export type AutoPaperFocusedCodexReader = {
  getFocusedCodex(): Promise<{
    codex_thread_id?: string | null;
    ghostty_window_id?: string | null;
    task_id?: string | null;
    terminal_ref?: string | null;
  }>;
};

export type AutoPaperTaskRegistry = {
  listTasks(): Promise<AutoPaperTaskRecord[]>;
  recordTaskPaperEmitted(taskId: string, emittedAt: Date): Promise<void>;
  markTaskDormant?(taskId: string, dormantAt: Date): Promise<unknown>;
};

export type AutoPaperEventIngestor = {
  ingestEventAsReviewPacket(event: McpEvent, now: Date): Promise<StoredEventResult>;
};

export type AutoPaperTaskSessionReader = {
  listSessions(): Promise<TaskRuntimeSession[]> | TaskRuntimeSession[];
};

export type AutoPaperInspectFn = (
  threadId: string,
  options: { codexHome?: string; now?: Date },
) => Promise<CodexSessionInspection>;

export type AutoPaperClaudeInspectFn = (
  sessionId: string,
  options: { claudeHome?: string; now?: Date },
) => Promise<ClaudeSessionInspection>;

export type AutoPaperCodexIdleDeps = {
  registry: AutoPaperTaskRegistry;
  ingestor: AutoPaperEventIngestor;
  manualMode: AutoPaperManualModeReader;
  activeTask?: AutoPaperActiveTaskReader;
  focusedCodex?: AutoPaperFocusedCodexReader;
  taskSessions?: AutoPaperTaskSessionReader;
  inspect?: AutoPaperInspectFn;
  inspectClaude?: AutoPaperClaudeInspectFn;
  observability?: Observability;
  codexHome?: string;
  claudeHome?: string;
  defaultIdleSeconds?: number;
  autoDormantSeconds?: number;
  now: () => Date;
};

export type AutoPaperTickResult = {
  paused: boolean;
  reason?: string;
  considered: number;
  emitted: Array<{ task_id: string; idle_seconds: number; event_id: string; queue_item_id?: string }>;
  skipped: Array<{ task_id: string; reason: string; idle_seconds?: number }>;
};

type IdleWindowState = {
  // Most recent `last_event_at` we observed for the thread. Bumped whenever the
  // thread becomes active (new event lands).
  lastActivityAt: string | undefined;
  // The `last_event_at` at the moment we last emitted a paper for this task.
  // Used to detect "same idle period vs. fresh idle period."
  lastPaperWindowAnchor: string | undefined;
};

type AutoPaperCandidate = {
  key: string;
  task: AutoPaperTaskRecord;
  provider: string;
  anchorId: string;
  anchorKind: "codex_thread" | "claude_session" | "task_session";
  session?: TaskRuntimeSession;
  status?: string;
};

type HumanAttentionReason = "blocked" | "waiting" | "lost";

export class AutoPaperCodexIdleWatcher {
  private readonly idleState = new Map<string, IdleWindowState>();

  constructor(private readonly deps: AutoPaperCodexIdleDeps) {}

  async tick(): Promise<AutoPaperTickResult> {
    const now = this.deps.now();
    const inspect = this.deps.inspect ?? inspectCodexSession;
    const inspectClaude = this.deps.inspectClaude ?? inspectClaudeSession;
    const defaultIdle = this.deps.defaultIdleSeconds ?? DEFAULT_IDLE_THRESHOLD_SECONDS;
    const autoDormantSeconds = this.deps.autoDormantSeconds ?? DEFAULT_AUTO_DORMANT_SECONDS;

    const manualMode = await this.deps.manualMode.getManualModeState();
    if (manualMode.active) {
      await this.deps.observability?.recordActivity({
        type: "auto_paper_codex_idle_skipped",
        occurred_at: now.toISOString(),
        actor: "system",
        status: "ok",
        summary: "Auto-paper tick skipped: manual mode active.",
        details: sanitizeActivityDetails({
          paused: true,
          reason: "manual_mode_active",
          manual_mode_entered_at: manualMode.entered_at,
        }),
      });
      return { paused: true, reason: "manual_mode_active", considered: 0, emitted: [], skipped: [] };
    }

    const tasks = await this.deps.registry.listTasks();
    const candidates = await this.buildCandidates(tasks);
    const currentTaskId = this.deps.activeTask
      ? (await this.deps.activeTask.getCurrentTaskState().catch(() => ({ current_task_id: null }))).current_task_id
      : null;
    const focusedCodex = this.deps.focusedCodex
      ? await this.deps.focusedCodex.getFocusedCodex().catch(() => undefined)
      : undefined;

    const emitted: AutoPaperTickResult["emitted"] = [];
    const skipped: AutoPaperTickResult["skipped"] = [];

    for (const candidate of candidates) {
      const task = candidate.task;
      if (task.dormant_at) {
        skipped.push({ task_id: task.id, reason: "task_dormant" });
        continue;
      }
      if (currentTaskId === task.id) {
        skipped.push({ task_id: task.id, reason: "task_currently_active" });
        continue;
      }
      if (focusedCodex?.task_id === task.id) {
        skipped.push({ task_id: task.id, reason: "task_focused_by_terminal" });
        continue;
      }
      if (candidate.anchorKind === "codex_thread" && focusedCodex?.codex_thread_id === candidate.anchorId) {
        skipped.push({ task_id: task.id, reason: "codex_thread_focused" });
        continue;
      }
      if (sessionTerminalRef(candidate.session) && focusedCodex?.terminal_ref === sessionTerminalRef(candidate.session)) {
        skipped.push({ task_id: task.id, reason: "task_focused_by_terminal" });
        continue;
      }

      const humanAttentionReason = humanAttentionReasonForStatus(candidate.status);
      if (humanAttentionReason) {
        const attention = humanAttentionDetailsForCandidate(candidate, humanAttentionReason, now);
        const state = this.idleState.get(candidate.key) ?? { lastActivityAt: undefined, lastPaperWindowAnchor: undefined };
        if (state.lastPaperWindowAnchor === attention.dedupeAnchor) {
          skipped.push({ task_id: task.id, reason: "already_emitted_for_window" });
          continue;
        }
        const event = buildAgentAttentionEvent({
          task,
          provider: candidate.provider,
          anchorId: candidate.anchorId,
          reason: humanAttentionReason,
          occurredAt: attention.occurredAt,
          dedupeAnchor: attention.dedupeAnchor,
          now,
          summary: attention.summary,
          rawUri: `eventloopos://task-sessions/${encodeURIComponent(candidate.anchorId)}`,
          rawMediaType: "application/json",
        });
        const result = await this.deps.ingestor.ingestEventAsReviewPacket(event, now);
        state.lastActivityAt = attention.dedupeAnchor;
        state.lastPaperWindowAnchor = attention.dedupeAnchor;
        this.idleState.set(candidate.key, state);
        await this.deps.registry.recordTaskPaperEmitted(task.id, now);
        emitted.push({
          task_id: task.id,
          idle_seconds: 0,
          event_id: event.id,
          queue_item_id: result.queue_item?.id,
        });
        continue;
      }

      const inspection = candidate.anchorKind === "claude_session"
        ? await inspectClaude(candidate.anchorId, { claudeHome: this.deps.claudeHome, now })
        : candidate.anchorKind === "codex_thread"
          ? await inspect(candidate.anchorId, { codexHome: this.deps.codexHome, now })
          : undefined;
      if (!inspection) {
        skipped.push({ task_id: task.id, reason: "unsupported_session_provider" });
        continue;
      }
      if (!inspection.exists) {
        skipped.push({ task_id: task.id, reason: "rollout_missing" });
        continue;
      }
      if (inspection.idle_seconds === undefined || !inspection.last_event_at) {
        skipped.push({ task_id: task.id, reason: "no_events" });
        continue;
      }
      if (autoDormantSeconds > 0 && inspection.idle_seconds >= autoDormantSeconds) {
        if (this.deps.registry.markTaskDormant) {
          await this.deps.registry.markTaskDormant(task.id, now);
          await this.deps.observability?.recordActivity({
            type: "task_marked_dormant",
            occurred_at: now.toISOString(),
            actor: "system",
            task_id: task.id,
            status: "ok",
            summary: `Task ${task.id} marked dormant after ${inspection.idle_seconds}s idle.`,
            details: sanitizeActivityDetails({
              thread_id: task.primary_anchor_id,
              idle_seconds: inspection.idle_seconds,
              last_event_at: inspection.last_event_at,
              auto_dormant_seconds: autoDormantSeconds,
            }),
          });
        }
        skipped.push({ task_id: task.id, reason: "marked_dormant", idle_seconds: inspection.idle_seconds });
        continue;
      }

      const state = this.idleState.get(candidate.key) ?? { lastActivityAt: undefined, lastPaperWindowAnchor: undefined };
      // Detect new activity: last_event_at advanced past the timestamp we last saw.
      if (state.lastActivityAt && state.lastActivityAt !== inspection.last_event_at) {
        // Thread became active again — clear the per-window anchor so the next
        // idle period can re-emit.
        if (state.lastPaperWindowAnchor && state.lastPaperWindowAnchor !== inspection.last_event_at) {
          state.lastPaperWindowAnchor = undefined;
        }
      }
      state.lastActivityAt = inspection.last_event_at;
      this.idleState.set(candidate.key, state);

      const threshold = task.auto_paper_idle_seconds ?? defaultIdle;
      if (inspection.idle_seconds < threshold) {
        skipped.push({ task_id: task.id, reason: "below_threshold", idle_seconds: inspection.idle_seconds });
        continue;
      }

      if (state.lastPaperWindowAnchor === inspection.last_event_at) {
        skipped.push({ task_id: task.id, reason: "already_emitted_for_window", idle_seconds: inspection.idle_seconds });
        continue;
      }

      const event = buildAgentAttentionEvent({
        task,
        provider: candidate.provider,
        anchorId: candidate.anchorId,
        reason: "idle",
        occurredAt: inspection.last_event_at,
        rawUri: inspection.rollout_path ? `file://${inspection.rollout_path}` : `eventloopos://tasks/${task.id}`,
        rawMediaType: "application/jsonl",
        summary: inspection.recent_summary
          ? `${providerLabel(candidate.provider)} session idle ${inspection.idle_seconds ?? 0}s: ${inspection.recent_summary}`
          : `${providerLabel(candidate.provider)} session idle ${inspection.idle_seconds ?? 0}s.`,
        now,
      });
      const result = await this.deps.ingestor.ingestEventAsReviewPacket(event, now);
      state.lastPaperWindowAnchor = inspection.last_event_at;
      this.idleState.set(candidate.key, state);
      await this.deps.registry.recordTaskPaperEmitted(task.id, now);

      emitted.push({
        task_id: task.id,
        idle_seconds: inspection.idle_seconds,
        event_id: event.id,
        queue_item_id: result.queue_item?.id,
      });

      await this.deps.observability?.recordActivity({
        type: "auto_paper_codex_idle_emitted",
        occurred_at: now.toISOString(),
        actor: "system",
        task_id: task.id,
        event_id: event.id,
        queue_item_id: result.queue_item?.id,
        status: "ok",
        summary: `Auto-paper emitted for ${task.id} after ${inspection.idle_seconds}s idle.`,
        details: sanitizeActivityDetails({
          provider: candidate.provider,
          anchor_kind: candidate.anchorKind,
          anchor_id: candidate.anchorId,
          idle_seconds: inspection.idle_seconds,
          last_event_at: inspection.last_event_at,
          recent_summary: inspection.recent_summary,
        }),
      });
    }

    return { paused: false, considered: candidates.length, emitted, skipped };
  }

  private async buildCandidates(tasks: AutoPaperTaskRecord[]): Promise<AutoPaperCandidate[]> {
    const candidates: AutoPaperCandidate[] = [];
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const primaryCodexAnchorsByTaskId = new Map<string, string>();

    for (const task of tasks) {
      if (task.primary_anchor_kind !== "codex_thread" || !task.primary_anchor_id) continue;
      candidates.push({
        key: `task:${task.id}:codex:${task.primary_anchor_id}`,
        task,
        provider: "codex",
        anchorId: task.primary_anchor_id,
        anchorKind: "codex_thread",
      });
      primaryCodexAnchorsByTaskId.set(task.id, task.primary_anchor_id);
    }

    const sessions = this.deps.taskSessions?.listSessions
      ? await Promise.resolve(this.deps.taskSessions.listSessions()).catch(() => [] as TaskRuntimeSession[])
      : [];

    for (const session of sessions) {
      const taskId = sessionTaskId(session);
      const sessionId = sessionIdForCandidate(session);
      if (!taskId || !sessionId) continue;
      const provider = sessionProvider(session);
      const status = sessionStatus(session);
      const anchor = sessionAnchor(session, provider);
      if (provider === "codex" && anchor && primaryCodexAnchorsByTaskId.get(taskId) === anchor) continue;
      if (!anchor && !humanAttentionReasonForStatus(status)) continue;
      const task = tasksById.get(taskId) ?? {
        id: taskId,
        primary_anchor_kind: "task_session",
        primary_anchor_id: sessionId,
      };
      candidates.push({
        key: `session:${sessionId}`,
        task,
        provider,
        anchorId: anchor ?? sessionId,
        anchorKind: provider === "claude" && anchor ? "claude_session" : provider === "codex" && anchor ? "codex_thread" : "task_session",
        session,
        status,
      });
    }

    return candidates;
  }
}

function buildAgentAttentionEvent(input: {
  task: AutoPaperTaskRecord;
  provider: string;
  anchorId: string;
  reason: "idle" | HumanAttentionReason;
  occurredAt: string;
  dedupeAnchor?: string;
  now: Date;
  summary: string;
  rawUri: string;
  rawMediaType?: string;
}): McpEvent {
  const { task, provider, reason, occurredAt, now } = input;
  const idempotencyAnchor = input.dedupeAnchor ?? occurredAt;
  const idempotencyKey = `auto_paper_${provider}_${reason}:${task.id}:${idempotencyAnchor}`;
  const eventId = `evt_auto_paper_${stableId(provider)}_${reason}_${stableId(task.id)}_${stableId(idempotencyAnchor)}`;
  // The ingestion pipeline normalizes task_hint via taskIdForHint("task_<slug>"),
  // which prefixes "task_" again. Strip our leading "task_" so the resulting
  // packet.task_id round-trips back to the original task.id.
  const taskHint = task.id.startsWith("task_") ? task.id.slice("task_".length) : task.id;
  const label = providerLabel(provider);
  return {
    id: eventId,
    source: `auto_paper_${provider}_${reason}`,
    source_id: `auto_paper_${provider}_${reason}`,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt,
    received_at: now.toISOString(),
    actor: { id: "auto_paper_agent_attention", type: "system", name: "Auto-paper watcher" },
    task_hint: taskHint,
    type: `${provider}.${eventKindForReason(reason)}`,
    title: `${label} ${eventTitleForReason(reason)} on ${task.id}`,
    summary: input.summary,
    raw_ref: {
      id: `raw_${eventId}`,
      uri: input.rawUri,
      media_type: input.rawMediaType ?? "application/json",
    },
    links: [],
    resources: [],
  };
}

function sessionTaskId(session: TaskRuntimeSession): string | undefined {
  return stringField(session, "task_id");
}

function sessionIdForCandidate(session: TaskRuntimeSession): string | undefined {
  return stringField(session, "id");
}

function sessionProvider(session: TaskRuntimeSession): string {
  return stringField(session, "provider") ?? "agent";
}

function sessionStatus(session: TaskRuntimeSession): string | undefined {
  return stringField(session, "status");
}

function humanAttentionReasonForStatus(status: string | undefined): HumanAttentionReason | undefined {
  const normalized = normalizeStatus(status);
  if (!normalized) return undefined;
  if (normalized === "lost" || normalized.includes("lost")) return "lost";
  if (normalized.includes("blocked") || HUMAN_BLOCKED_STATUSES.has(normalized)) return "blocked";
  if (HUMAN_WAITING_STATUSES.has(normalized)) return "waiting";
  if (
    normalized.includes("waiting")
    && (normalized.includes("approval") || normalized.includes("input") || normalized.includes("human") || normalized.includes("user"))
  ) {
    return "waiting";
  }
  if (
    normalized.includes("waiting")
    && (normalized.includes("review") || normalized.includes("question") || normalized.includes("answer"))
  ) {
    return "waiting";
  }
  if (
    normalized.includes("awaiting")
    && (
      normalized.includes("approval")
      || normalized.includes("input")
      || normalized.includes("human")
      || normalized.includes("review")
      || normalized.includes("user")
    )
  ) {
    return "waiting";
  }
  if (
    normalized.includes("pending")
    && (normalized.includes("approval") || normalized.includes("human") || normalized.includes("user") || normalized.includes("review"))
  ) {
    return "waiting";
  }
  if (
    normalized.includes("question")
    && (normalized.includes("human") || normalized.includes("user") || normalized.includes("agent"))
  ) {
    return "waiting";
  }
  return undefined;
}

const HUMAN_BLOCKED_STATUSES = new Set([
  "stuck",
  "agent_stuck",
  "human_blocked",
  "needs_unblock",
  "needs_unblocking",
  "requires_unblock",
]);

const HUMAN_WAITING_STATUSES = new Set([
  "action_required",
  "approval_pending",
  "approval_required",
  "awaiting_approval",
  "awaiting_answer",
  "awaiting_human",
  "awaiting_human_input",
  "awaiting_input",
  "awaiting_review",
  "awaiting_user",
  "awaiting_user_input",
  "human_review",
  "human_input_required",
  "human_review_required",
  "human_question",
  "input_required",
  "needs_answer",
  "needs_action",
  "needs_approval",
  "needs_human",
  "needs_human_input",
  "needs_input",
  "needs_review",
  "needs_user",
  "needs_user_input",
  "paused_for_input",
  "pending_approval",
  "pending_human",
  "pending_human_input",
  "pending_review",
  "question_for_human",
  "question_for_user",
  "ready_for_review",
  "requires_approval",
  "requires_action",
  "requires_human",
  "requires_human_input",
  "requires_input",
  "requires_review",
  "requires_user_input",
  "review_requested",
  "review_needed",
  "review_required",
  "user_input_required",
  "user_question",
  "waiting_approval",
  "waiting_for_approval",
  "waiting_for_human",
  "waiting_for_human_input",
  "waiting_for_input",
  "waiting_for_user",
  "waiting_for_user_input",
  "waiting_input",
  "waiting_on_human",
  "waiting_on_user",
]);

function normalizeStatus(status: string | undefined): string | undefined {
  const normalized = status?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized ? normalized : undefined;
}

function humanAttentionDetailsForCandidate(
  candidate: AutoPaperCandidate,
  reason: HumanAttentionReason,
  now: Date,
): { occurredAt: string; dedupeAnchor: string; summary: string } {
  const status = normalizeStatus(candidate.status) ?? reason;
  const statusTimestamp = sessionStatusTimestamp(candidate.session);
  const dedupeAnchor = statusTimestamp
    ? `status:${status}:at:${statusTimestamp}`
    : `status:${status}:session:${candidate.anchorId}`;
  return {
    occurredAt: statusTimestamp ?? now.toISOString(),
    dedupeAnchor,
    summary: humanAttentionSummary(candidate, reason),
  };
}

function sessionStatusTimestamp(session: TaskRuntimeSession | undefined): string | undefined {
  return validTimestampField(session, "status_updated_at")
    ?? validTimestampField(session, "status_changed_at")
    ?? validTimestampField(session, "updated_at")
    ?? validTimestampField(session, "last_activity_at")
    ?? validTimestampField(session, "last_event_at")
    ?? validTimestampField(session, "created_at");
}

function validTimestampField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = stringField(record, key);
  if (!value) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function humanAttentionSummary(candidate: AutoPaperCandidate, reason: HumanAttentionReason): string {
  const action = reason === "blocked"
    ? "blocked"
    : reason === "lost"
      ? "lost"
      : "waiting for human input";
  const prefix = `${providerLabel(candidate.provider)} session ${action} on ${candidate.task.id}`;
  const name = stringField(candidate.session, "name");
  const detail = firstStringField(candidate.session, [
    "decision_needed",
    "status_detail",
    "status_message",
    "preview",
    "recent_summary",
    "summary",
  ]);
  if (name && detail && name !== detail) return `${prefix}: ${name} - ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (name) return `${prefix}: ${name}`;
  return `${prefix}.`;
}

function firstStringField(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(record, key);
    if (value) return value;
  }
  return undefined;
}

function sessionTerminalRef(session: TaskRuntimeSession | undefined): string | undefined {
  return stringField(session, "terminal_ref");
}

function sessionAnchor(session: TaskRuntimeSession, provider: string): string | undefined {
  if (provider === "claude") return stringField(session, "native_session_id");
  if (provider === "codex") return stringField(session, "native_thread_id");
  return undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providerLabel(provider: string): string {
  if (provider === "codex") return "Codex";
  if (provider === "claude") return "Claude";
  return "Agent";
}

function eventKindForReason(reason: "idle" | HumanAttentionReason): string {
  if (reason === "idle") return "task_idle";
  if (reason === "blocked") return "task_blocked";
  if (reason === "lost") return "task_lost";
  return "task_waiting";
}

function eventTitleForReason(reason: "idle" | HumanAttentionReason): string {
  if (reason === "idle") return "session idle";
  if (reason === "blocked") return "session blocked";
  if (reason === "lost") return "session lost";
  return "session waiting";
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

export type AutoPaperCodexIdleHandle = {
  close(): void;
  tick(): Promise<AutoPaperTickResult>;
};

export function startAutoPaperCodexIdleWatcher(
  deps: AutoPaperCodexIdleDeps & { intervalMs?: number; onError?: (error: unknown) => void },
): AutoPaperCodexIdleHandle {
  const watcher = new AutoPaperCodexIdleWatcher(deps);
  const intervalMs = deps.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const timer = setInterval(() => {
    watcher.tick().catch((error) => {
      if (deps.onError) deps.onError(error);
      else console.warn(`auto-paper tick failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return {
    close() {
      clearInterval(timer);
    },
    tick: () => watcher.tick(),
  };
}
