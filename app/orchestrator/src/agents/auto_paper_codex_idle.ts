import { inspectCodexSession, type CodexSessionInspection } from "./codex/session_inspector.js";
import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { StoredEventResult } from "../store.js";

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

export type AutoPaperTaskRegistry = {
  // TODO(phase-2-integration): replace with runtime.store.listTasks() once Phase 2
  // lands the tasks table + GatewayStore methods.
  listTasks(): Promise<AutoPaperTaskRecord[]>;
  recordTaskPaperEmitted(taskId: string, emittedAt: Date): Promise<void>;
  markTaskDormant?(taskId: string, dormantAt: Date): Promise<unknown>;
};

export type AutoPaperEventIngestor = {
  ingestEventAsReviewPacket(event: McpEvent, now: Date): Promise<StoredEventResult>;
};

export type AutoPaperInspectFn = (
  threadId: string,
  options: { codexHome?: string; now?: Date },
) => Promise<CodexSessionInspection>;

export type AutoPaperCodexIdleDeps = {
  registry: AutoPaperTaskRegistry;
  ingestor: AutoPaperEventIngestor;
  manualMode: AutoPaperManualModeReader;
  activeTask?: AutoPaperActiveTaskReader;
  inspect?: AutoPaperInspectFn;
  observability?: Observability;
  codexHome?: string;
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

export class AutoPaperCodexIdleWatcher {
  private readonly idleState = new Map<string, IdleWindowState>();

  constructor(private readonly deps: AutoPaperCodexIdleDeps) {}

  async tick(): Promise<AutoPaperTickResult> {
    const now = this.deps.now();
    const inspect = this.deps.inspect ?? inspectCodexSession;
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
    const codexTasks = tasks.filter((task) => task.primary_anchor_kind === "codex_thread" && task.primary_anchor_id);
    const currentTaskId = this.deps.activeTask
      ? (await this.deps.activeTask.getCurrentTaskState().catch(() => ({ current_task_id: null }))).current_task_id
      : null;

    const emitted: AutoPaperTickResult["emitted"] = [];
    const skipped: AutoPaperTickResult["skipped"] = [];

    for (const task of codexTasks) {
      if (task.dormant_at) {
        skipped.push({ task_id: task.id, reason: "task_dormant" });
        continue;
      }
      if (currentTaskId === task.id) {
        skipped.push({ task_id: task.id, reason: "task_currently_active" });
        continue;
      }
      const inspection = await inspect(task.primary_anchor_id, { codexHome: this.deps.codexHome, now });
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

      const state = this.idleState.get(task.id) ?? { lastActivityAt: undefined, lastPaperWindowAnchor: undefined };
      // Detect new activity: last_event_at advanced past the timestamp we last saw.
      if (state.lastActivityAt && state.lastActivityAt !== inspection.last_event_at) {
        // Thread became active again — clear the per-window anchor so the next
        // idle period can re-emit.
        if (state.lastPaperWindowAnchor && state.lastPaperWindowAnchor !== inspection.last_event_at) {
          state.lastPaperWindowAnchor = undefined;
        }
      }
      state.lastActivityAt = inspection.last_event_at;
      this.idleState.set(task.id, state);

      const threshold = task.auto_paper_idle_seconds ?? defaultIdle;
      if (inspection.idle_seconds < threshold) {
        skipped.push({ task_id: task.id, reason: "below_threshold", idle_seconds: inspection.idle_seconds });
        continue;
      }

      if (state.lastPaperWindowAnchor === inspection.last_event_at) {
        skipped.push({ task_id: task.id, reason: "already_emitted_for_window", idle_seconds: inspection.idle_seconds });
        continue;
      }

      const event = buildTaskIdleEvent({
        task,
        inspection,
        now,
      });
      const result = await this.deps.ingestor.ingestEventAsReviewPacket(event, now);
      state.lastPaperWindowAnchor = inspection.last_event_at;
      this.idleState.set(task.id, state);
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
          thread_id: task.primary_anchor_id,
          idle_seconds: inspection.idle_seconds,
          last_event_at: inspection.last_event_at,
          recent_summary: inspection.recent_summary,
        }),
      });
    }

    return { paused: false, considered: codexTasks.length, emitted, skipped };
  }
}

function buildTaskIdleEvent(input: {
  task: AutoPaperTaskRecord;
  inspection: CodexSessionInspection;
  now: Date;
}): McpEvent {
  const { task, inspection, now } = input;
  const occurredAt = inspection.last_event_at ?? now.toISOString();
  const idempotencyKey = `auto_paper_codex_idle:${task.id}:${occurredAt}`;
  const eventId = `evt_auto_paper_codex_idle_${stableId(task.id)}_${stableId(occurredAt)}`;
  const summary = inspection.recent_summary
    ? `Codex thread idle ${inspection.idle_seconds ?? 0}s: ${inspection.recent_summary}`
    : `Codex thread idle ${inspection.idle_seconds ?? 0}s.`;
  // The ingestion pipeline normalizes task_hint via taskIdForHint("task_<slug>"),
  // which prefixes "task_" again. Strip our leading "task_" so the resulting
  // packet.task_id round-trips back to the original task.id.
  const taskHint = task.id.startsWith("task_") ? task.id.slice("task_".length) : task.id;
  return {
    id: eventId,
    source: "auto_paper_codex_idle",
    source_id: "auto_paper_codex_idle",
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt,
    received_at: now.toISOString(),
    actor: { id: "auto_paper_codex_idle", type: "system", name: "Auto-paper watcher" },
    task_hint: taskHint,
    type: "codex.task_idle",
    title: `Codex thread idle on ${task.id}`,
    summary,
    raw_ref: {
      id: `raw_${eventId}`,
      uri: inspection.rollout_path ? `file://${inspection.rollout_path}` : `eventloopos://tasks/${task.id}`,
      media_type: "application/jsonl",
    },
    links: [],
    resources: [],
  };
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
