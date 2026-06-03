import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { WorkspaceSnapshot } from "../workspace/aerospace.js";
import { normalizeTitlePrefix } from "../store.js";

export const DEFAULT_AMBIENT_SAVE_POLL_MS = 5_000;
export const DEFAULT_AMBIENT_SAVE_DEBOUNCE_MS = 3_000;

export type CurrentTaskState = {
  currentTaskId: string | null;
};

// TODO(phase-2-integration): replace this duck-typed shape with the real
// `runtime.store.getCurrentTaskState` / `runtime.store.updateTaskLayout`
// signatures once Phase 2 lands.
export type CurrentTaskStateReader = () => Promise<CurrentTaskState> | CurrentTaskState;
export type TaskLayoutWriter = (taskId: string, snapshot: WorkspaceSnapshot) => Promise<unknown> | unknown;
export type ManualModeReader = () => Promise<boolean> | boolean;
export type WindowWorkspaceObservationWriter = (input: {
  windowId: string;
  workspaceId: string;
  isTaskWorkspace: boolean;
  observedAt: Date;
  appBundle?: string;
  titlePrefix?: string;
}) => Promise<unknown> | unknown;
export type FollowsWindowIdReader = () => Promise<Iterable<string | number>> | Iterable<string | number>;

export type AmbientWorkspaceSaverDeps = {
  workspace: Pick<WorkspaceController, "capture">;
  getCurrentTaskState: CurrentTaskStateReader;
  updateTaskLayout: TaskLayoutWriter;
  isManualModeActive: ManualModeReader;
  recordWindowObservation?: WindowWorkspaceObservationWriter;
  getFollowsWindowIds?: FollowsWindowIdReader;
  observability?: Observability;
  pollIntervalMs?: number;
  debounceMs?: number;
  now?: () => Date;
};

export type AmbientSaveTickResult =
  | { decision: "skipped_unbounded" }
  | { decision: "skipped_manual_mode" }
  | { decision: "skipped_unchanged"; taskId: string }
  | { decision: "debounced"; taskId: string; pendingSince: string }
  | { decision: "committed"; taskId: string; capturedAt: string }
  | { decision: "error"; error: string };

export type AmbientWorkspaceSaver = {
  tick(now?: Date): Promise<AmbientSaveTickResult>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
};

type PendingChange = {
  taskId: string;
  snapshot: WorkspaceSnapshot;
  firstSeenAtMs: number;
};

export function createAmbientWorkspaceSaver(deps: AmbientWorkspaceSaverDeps): AmbientWorkspaceSaver {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_AMBIENT_SAVE_POLL_MS;
  const debounceMs = deps.debounceMs ?? DEFAULT_AMBIENT_SAVE_DEBOUNCE_MS;
  const now = deps.now ?? (() => new Date());

  const lastSavedSnapshotByTask = new Map<string, string>();
  let pending: PendingChange | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function tick(injectedNow?: Date): Promise<AmbientSaveTickResult> {
    const tickNow = injectedNow ?? now();
    try {
      if (await deps.isManualModeActive()) {
        pending = undefined;
        await emit({
          type: "ambient_workspace_save_skipped_manual_mode",
          summary: "Ambient workspace save skipped: manual mode active",
          tickNow,
        });
        return { decision: "skipped_manual_mode" };
      }

      const taskState = await deps.getCurrentTaskState();
      const currentTaskId = taskState.currentTaskId;
      if (!currentTaskId) {
        pending = undefined;
        await emit({
          type: "ambient_workspace_save_skipped_unbounded",
          summary: "Ambient workspace save skipped: no current_task_id (unbounded)",
          tickNow,
        });
        return { decision: "skipped_unbounded" };
      }

      const rawSnapshot = await deps.workspace.capture();
      await recordWindowObservations(deps, rawSnapshot, currentTaskId, tickNow);
      const snapshot = filterSnapshotForTaskSave(rawSnapshot, await readFollowsWindowIds(deps));
      const fingerprint = snapshotFingerprint(snapshot);
      const lastFingerprint = lastSavedSnapshotByTask.get(currentTaskId);

      if (pending && pending.taskId !== currentTaskId) {
        pending = undefined;
      }

      if (fingerprint === lastFingerprint) {
        pending = undefined;
        await emit({
          type: "ambient_workspace_save_skipped_unchanged",
          summary: `Ambient workspace save skipped: layout unchanged for ${currentTaskId}`,
          taskId: currentTaskId,
          tickNow,
          details: { window_count: snapshot.windows.length },
        });
        return { decision: "skipped_unchanged", taskId: currentTaskId };
      }

      const tickMs = tickNow.getTime();
      if (!pending || pending.taskId !== currentTaskId) {
        pending = { taskId: currentTaskId, snapshot, firstSeenAtMs: tickMs };
        return {
          decision: "debounced",
          taskId: currentTaskId,
          pendingSince: new Date(pending.firstSeenAtMs).toISOString(),
        };
      }

      const pendingFingerprint = snapshotFingerprint(pending.snapshot);
      if (pendingFingerprint !== fingerprint) {
        pending = { taskId: currentTaskId, snapshot, firstSeenAtMs: tickMs };
        return {
          decision: "debounced",
          taskId: currentTaskId,
          pendingSince: new Date(pending.firstSeenAtMs).toISOString(),
        };
      }

      if (tickMs - pending.firstSeenAtMs < debounceMs) {
        return {
          decision: "debounced",
          taskId: currentTaskId,
          pendingSince: new Date(pending.firstSeenAtMs).toISOString(),
        };
      }

      await deps.updateTaskLayout(currentTaskId, snapshot);
      lastSavedSnapshotByTask.set(currentTaskId, fingerprint);
      pending = undefined;
      const capturedAt = tickNow.toISOString();
      await emit({
        type: "ambient_workspace_save_committed",
        summary: `Ambient workspace save committed for ${currentTaskId}`,
        taskId: currentTaskId,
        tickNow,
        details: {
          window_count: snapshot.windows.length,
          active_workspace: snapshot.activeWorkspace,
          focused_window_id: snapshot.focusedWindowId,
        },
      });
      return { decision: "committed", taskId: currentTaskId, capturedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emit({
        type: "ambient_workspace_save_error",
        summary: `Ambient workspace save error: ${message}`,
        tickNow,
        status: "failed",
        details: { error: message },
      }).catch(() => undefined);
      return { decision: "error", error: message };
    }
  }

  async function emit(input: {
    type: string;
    summary: string;
    taskId?: string;
    tickNow: Date;
    status?: "ok" | "failed";
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (!deps.observability) return;
    await deps.observability.recordActivity({
      type: input.type,
      occurred_at: input.tickNow.toISOString(),
      actor: "system",
      status: input.status ?? "ok",
      task_id: input.taskId,
      summary: input.summary,
      details: sanitizeActivityDetails(input.details ?? {}),
    });
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch(() => undefined);
    }, pollIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  return {
    tick,
    start,
    stop,
    isRunning: () => timer !== undefined,
  };
}

async function recordWindowObservations(
  deps: AmbientWorkspaceSaverDeps,
  snapshot: WorkspaceSnapshot,
  currentTaskId: string,
  observedAt: Date,
): Promise<void> {
  if (!deps.recordWindowObservation) return;
  const activeWorkspace = snapshot.activeWorkspace;
  for (const window of snapshot.windows) {
    if (!window.workspace) continue;
    const isActiveWorkspace = activeWorkspace !== undefined && window.workspace === activeWorkspace;
    const isTaskWorkspace = isActiveWorkspace && currentTaskId.length > 0;
    const appBundle =
      typeof window.appBundleId === "string" && window.appBundleId.length > 0
        ? window.appBundleId
        : typeof window.app === "string" && window.app.length > 0
          ? window.app
          : undefined;
    const titlePrefix = normalizeTitlePrefix(window.title);
    try {
      await deps.recordWindowObservation({
        windowId: String(window.id),
        workspaceId: window.workspace,
        isTaskWorkspace,
        observedAt,
        appBundle,
        titlePrefix,
      });
    } catch {
      // Swallow per-window observation failures so the saver is never blocked
      // by Phase 6 storage hiccups; the saver's primary job is layout capture.
    }
  }
}

export function snapshotFingerprint(snapshot: WorkspaceSnapshot): string {
  const windows = snapshot.windows
    .map((window) =>
      [
        window.id,
        window.app,
        window.title,
        window.workspace,
        window.monitorId ?? "",
        window.layout ?? "",
        window.frame?.x ?? "",
        window.frame?.y ?? "",
        window.frame?.width ?? "",
        window.frame?.height ?? "",
      ].join("|"),
    )
    .sort()
    .join("\n");
  return [
    `backend=${snapshot.backend}`,
    `active_workspace=${snapshot.activeWorkspace ?? ""}`,
    `focused_window_id=${snapshot.focusedWindowId ?? ""}`,
    `windows=${windows}`,
  ].join("\n");
}

export function filterSnapshotForTaskSave(snapshot: WorkspaceSnapshot, followsWindowIds: ReadonlySet<string> = new Set()): WorkspaceSnapshot {
  if (!snapshot.activeWorkspace) return snapshot;
  const windows = snapshot.windows.filter(
    (window) => window.workspace === snapshot.activeWorkspace || followsWindowIds.has(String(window.id)),
  );
  const focusedWindowId =
    snapshot.focusedWindowId !== undefined && windows.some((window) => window.id === snapshot.focusedWindowId)
      ? snapshot.focusedWindowId
      : undefined;

  return {
    ...snapshot,
    windows,
    focusedWindowId,
  };
}

async function readFollowsWindowIds(deps: AmbientWorkspaceSaverDeps): Promise<ReadonlySet<string>> {
  if (!deps.getFollowsWindowIds) return new Set();
  const ids = await deps.getFollowsWindowIds();
  return new Set(Array.from(ids, (id) => String(id)));
}

// Adapter that lets the orchestrator wire its (Phase-2-pending) store-level
// helpers into the saver without forcing the saver to know about Runtime
// shape. Today this is a thin best-effort lookup; once Phase 2 lands, the
// // TODO(phase-2-integration) sites can be tightened to direct calls.
export function createAmbientWorkspaceSaverFromRuntime(
  runtime: Runtime,
  overrides: {
    pollIntervalMs?: number;
    debounceMs?: number;
  } = {},
): AmbientWorkspaceSaver | undefined {
  if (!runtime.workspace) return undefined;
  const workspace = runtime.workspace;

  const store = runtime.store as unknown as {
    getCurrentTaskState?: () => Promise<CurrentTaskState> | CurrentTaskState;
    updateTaskLayout?: (taskId: string, snapshot: WorkspaceSnapshot) => Promise<unknown> | unknown;
    saveTaskWorkspaceSnapshot?: (input: {
      taskId: string;
      snapshot: WorkspaceSnapshot;
      capturedAt: Date;
      actorId?: string;
    }) => Promise<unknown>;
    listFollowsWindows?: (input: { now: Date; ttlMs: number; minWorkspaceCount: number }) => Promise<Array<{ window_id: string }>>;
  };

  const getCurrentTaskState: CurrentTaskStateReader = async () => {
    // TODO(phase-2-integration): once `store.getCurrentTaskState` is real,
    // call it directly. Until then, treat absence as "no current task" so the
    // saver is a no-op and only emits the unbounded skip event.
    if (typeof store.getCurrentTaskState === "function") {
      return await store.getCurrentTaskState();
    }
    return { currentTaskId: null };
  };

  const updateTaskLayout: TaskLayoutWriter = async (taskId, snapshot) => {
    // TODO(phase-2-integration): switch to `store.updateTaskLayout` once it
    // exists. Until then, fall back to the underlying
    // `saveTaskWorkspaceSnapshot` primitive that already persists per-task
    // layouts — that is the storage cell Phase 2's PUT /tasks/:id/layout will
    // wrap.
    if (typeof store.updateTaskLayout === "function") {
      return await store.updateTaskLayout(taskId, snapshot);
    }
    if (typeof store.saveTaskWorkspaceSnapshot === "function") {
      return await store.saveTaskWorkspaceSnapshot({
        taskId,
        snapshot,
        capturedAt: runtime.now(),
        actorId: "ambient-workspace-saver",
      });
    }
    return undefined;
  };

  const isManualModeActive: ManualModeReader = async () => {
    const state = await runtime.store.getManualModeState();
    return state.active === true;
  };

  const recordWindowObservation: WindowWorkspaceObservationWriter | undefined =
    typeof (runtime.store as unknown as { recordWindowWorkspaceObservation?: unknown }).recordWindowWorkspaceObservation === "function"
      ? (input) => runtime.store.recordWindowWorkspaceObservation(input)
      : undefined;
  const getFollowsWindowIds: FollowsWindowIdReader | undefined =
    typeof store.listFollowsWindows === "function"
      ? async () => {
          const ttlMs = Number(process.env.EVENTLOOPOS_FOLLOWS_TTL_MS ?? 24 * 60 * 60 * 1_000);
          const minWorkspaceCount = Number(process.env.EVENTLOOPOS_FOLLOWS_THRESHOLD ?? 3);
          const follows = await store.listFollowsWindows!({ now: runtime.now(), ttlMs, minWorkspaceCount });
          return follows.map((follow) => follow.window_id);
        }
      : undefined;

  return createAmbientWorkspaceSaver({
    workspace,
    getCurrentTaskState,
    updateTaskLayout,
    isManualModeActive,
    recordWindowObservation,
    getFollowsWindowIds,
    observability: runtime.observability,
    pollIntervalMs: overrides.pollIntervalMs,
    debounceMs: overrides.debounceMs,
    now: runtime.now,
  });
}
