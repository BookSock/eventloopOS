import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { AerospaceWindow, WorkspaceSnapshot } from "../workspace/aerospace.js";
import { normalizeTitlePrefix } from "../store.js";

export const DEFAULT_AMBIENT_SAVE_POLL_MS = 5_000;
export const DEFAULT_AMBIENT_SAVE_DEBOUNCE_MS = 3_000;
const TASK_SNAPSHOT_APP_BLOCKLIST = new Set([
  "aerospace",
  "eventloopos queue",
  "eventloopqueueapp",
  "tailscale",
]);
const TASK_SNAPSHOT_BUNDLE_BLOCKLIST = new Set([
  "com.eventloopos.queue",
  "com.nikitavoloboev.aerospace",
  "io.tailscale.ipn.macos",
]);

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
export type TaskWindowClaim = {
  task_id: string;
  window_id?: string;
  app_bundle?: string;
  title_prefix?: string;
};
export type TaskWindowClaimReader = () => Promise<Iterable<TaskWindowClaim>> | Iterable<TaskWindowClaim>;
export type TaskWindowClaimWriter = (input: {
  taskId: string;
  windowId?: string;
  appBundle?: string;
  titlePrefix?: string;
  source?: string;
  now: Date;
  ttlMs?: number;
}) => Promise<unknown> | unknown;

export type AmbientWorkspaceSaverDeps = {
  workspace: Pick<WorkspaceController, "capture">;
  getCurrentTaskState: CurrentTaskStateReader;
  updateTaskLayout: TaskLayoutWriter;
  isManualModeActive: ManualModeReader;
  recordWindowObservation?: WindowWorkspaceObservationWriter;
  getFollowsWindowIds?: FollowsWindowIdReader;
  getTaskWindowClaims?: TaskWindowClaimReader;
  claimTaskWindow?: TaskWindowClaimWriter;
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
      await autoClaimTaggedTaskWindows(deps, rawSnapshot, tickNow);
      const snapshot = filterSnapshotForTaskSave(
        rawSnapshot,
        await readFollowsWindowIds(deps),
        currentTaskId,
        await readTaskWindowClaims(deps),
      );
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

async function autoClaimTaggedTaskWindows(
  deps: AmbientWorkspaceSaverDeps,
  snapshot: WorkspaceSnapshot,
  now: Date,
): Promise<void> {
  if (!deps.claimTaskWindow) return;
  const existingClaims = await readTaskWindowClaims(deps);
  let claimed = 0;
  for (const window of snapshot.windows) {
    const taggedTaskId = taskIdFromTaggedWindow(window);
    if (!taggedTaskId) continue;
    if (existingClaims.some((claim) => claim.task_id === taggedTaskId && taskWindowClaimMatches(window, claim))) continue;
    const appBundle =
      typeof window.appBundleId === "string" && window.appBundleId.length > 0
        ? window.appBundleId
        : typeof window.app === "string" && window.app.length > 0
          ? window.app
          : undefined;
    try {
      await deps.claimTaskWindow({
        taskId: taggedTaskId,
        windowId: String(window.id),
        appBundle,
        titlePrefix: normalizeTitlePrefix(window.title),
        source: "ambient_tagged_window",
        now,
        ttlMs: 30 * 60 * 1_000,
      });
      claimed += 1;
    } catch {
      // Claims are attribution hints. Never block workspace saving if a task
      // was removed or storage rejects a stale tag.
    }
  }
  if (claimed > 0 && deps.observability) {
    await deps.observability.incrementCounter("task_window_claims_inferred_total", claimed);
    await deps.observability.recordActivity({
      type: "task_window_claims_inferred",
      occurred_at: now.toISOString(),
      actor: "system",
      status: "ok",
      summary: `Inferred ${claimed} task window claim(s) from tagged windows.`,
      details: sanitizeActivityDetails({ count: claimed, source: "ambient_tagged_window" }),
    });
  }
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

export function filterSnapshotForTaskSave(
  snapshot: WorkspaceSnapshot,
  followsWindowIds: ReadonlySet<string> = new Set(),
  currentTaskId?: string,
  taskWindowClaims: readonly TaskWindowClaim[] = [],
): WorkspaceSnapshot {
  if (!snapshot.activeWorkspace) return snapshot;
  const windows = snapshot.windows.filter(
    (window) =>
      isTaskSnapshotEligibleWindow(window, currentTaskId, taskWindowClaims)
      && (window.workspace === snapshot.activeWorkspace || followsWindowIds.has(String(window.id))),
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

function isTaskSnapshotEligibleWindow(
  window: WorkspaceSnapshot["windows"][number],
  currentTaskId?: string,
  taskWindowClaims: readonly TaskWindowClaim[] = [],
): boolean {
  const app = window.app.trim().toLowerCase();
  const bundle = typeof window.appBundleId === "string" ? window.appBundleId.trim().toLowerCase() : "";
  if (TASK_SNAPSHOT_APP_BLOCKLIST.has(app) || TASK_SNAPSHOT_BUNDLE_BLOCKLIST.has(bundle)) return false;

  const taggedTaskId = taskIdFromTaggedWindow(window);
  if (taggedTaskId && currentTaskId && taggedTaskId !== currentTaskId) return false;

  const claimedTaskId = taskIdFromWindowClaims(window, taskWindowClaims);
  return !claimedTaskId || !currentTaskId || claimedTaskId === currentTaskId;
}

function taskIdFromTaggedWindow(window: WorkspaceSnapshot["windows"][number]): string | undefined {
  const match = /\[task:([^\]]+)\]/i.exec(`${window.app} ${window.title} ${window.workspace}`);
  const hint = match?.[1]?.trim();
  return hint ? normalizeTaskId(hint) : undefined;
}

function normalizeTaskId(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^task_/, "");
  const slug = trimmed.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `task_${slug || "untitled"}`;
}

function taskIdFromWindowClaims(window: AerospaceWindow, claims: readonly TaskWindowClaim[]): string | undefined {
  for (const claim of claims) {
    if (taskWindowClaimMatches(window, claim)) return claim.task_id;
  }
  return undefined;
}

function taskWindowClaimMatches(window: AerospaceWindow, claim: TaskWindowClaim): boolean {
  if (claim.window_id && String(window.id) === claim.window_id) return true;
  const claimBundle = claim.app_bundle?.trim().toLowerCase();
  const windowBundle = window.appBundleId?.trim().toLowerCase() || window.app.trim().toLowerCase();
  const claimTitlePrefix = normalizeTitlePrefix(claim.title_prefix);
  const windowTitlePrefix = normalizeTitlePrefix(window.title);
  const bundleMatches = claimBundle ? claimBundle === windowBundle : true;
  const titleMatches = claimTitlePrefix ? windowTitlePrefix?.startsWith(claimTitlePrefix) === true : true;
  return Boolean((claimBundle || claimTitlePrefix) && bundleMatches && titleMatches);
}

async function readFollowsWindowIds(deps: AmbientWorkspaceSaverDeps): Promise<ReadonlySet<string>> {
  if (!deps.getFollowsWindowIds) return new Set();
  const ids = await deps.getFollowsWindowIds();
  return new Set(Array.from(ids, (id) => String(id)));
}

async function readTaskWindowClaims(deps: AmbientWorkspaceSaverDeps): Promise<readonly TaskWindowClaim[]> {
  if (!deps.getTaskWindowClaims) return [];
  return Array.from(await deps.getTaskWindowClaims());
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
    getCurrentTaskState?: () =>
      | Promise<CurrentTaskState | { current_task_id?: string | null }>
      | CurrentTaskState
      | { current_task_id?: string | null };
    updateTaskLayout?: (taskId: string, snapshot: WorkspaceSnapshot, now: Date) => Promise<unknown> | unknown;
    saveTaskWorkspaceSnapshot?: (input: {
      taskId: string;
      snapshot: WorkspaceSnapshot;
      capturedAt: Date;
      actorId?: string;
    }) => Promise<unknown>;
    listFollowsWindows?: (input: { now: Date; ttlMs: number; minWorkspaceCount: number }) => Promise<Array<{ window_id: string }>>;
    listTaskWindowClaims?: (input: { now: Date }) => Promise<TaskWindowClaim[]>;
    claimTaskWindow?: (input: {
      taskId: string;
      windowId?: string;
      appBundle?: string;
      titlePrefix?: string;
      source?: string;
      now: Date;
      ttlMs?: number;
    }) => Promise<unknown>;
  };

  const getCurrentTaskState: CurrentTaskStateReader = async () => {
    // TODO(phase-2-integration): once `store.getCurrentTaskState` is real,
    // call it directly. Until then, treat absence as "no current task" so the
    // saver is a no-op and only emits the unbounded skip event.
    if (typeof store.getCurrentTaskState === "function") {
      const state = await store.getCurrentTaskState();
      const currentTaskId =
        "currentTaskId" in state
          ? state.currentTaskId
          : "current_task_id" in state
            ? state.current_task_id
            : null;
      return {
        currentTaskId: currentTaskId ?? null,
      };
    }
    return { currentTaskId: null };
  };

  const updateTaskLayout: TaskLayoutWriter = async (taskId, snapshot) => {
    let updated: unknown;
    if (typeof store.updateTaskLayout === "function") {
      updated = await store.updateTaskLayout(taskId, snapshot, runtime.now());
    }
    if (typeof store.saveTaskWorkspaceSnapshot === "function") {
      const saved = await store.saveTaskWorkspaceSnapshot({
        taskId,
        snapshot,
        capturedAt: runtime.now(),
        actorId: "ambient-workspace-saver",
      });
      return saved;
    }
    return updated;
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
  const getTaskWindowClaims: TaskWindowClaimReader | undefined =
    typeof store.listTaskWindowClaims === "function"
      ? async () => store.listTaskWindowClaims!({ now: runtime.now() })
      : undefined;
  const claimTaskWindow: TaskWindowClaimWriter | undefined =
    typeof store.claimTaskWindow === "function"
      ? (input) => store.claimTaskWindow!({
          taskId: input.taskId,
          windowId: input.windowId,
          appBundle: input.appBundle,
          titlePrefix: input.titlePrefix,
          source: input.source,
          now: input.now,
          ttlMs: input.ttlMs,
        })
      : undefined;

  return createAmbientWorkspaceSaver({
    workspace,
    getCurrentTaskState,
    updateTaskLayout,
    isManualModeActive,
    recordWindowObservation,
    getFollowsWindowIds,
    getTaskWindowClaims,
    claimTaskWindow,
    observability: runtime.observability,
    pollIntervalMs: overrides.pollIntervalMs,
    debounceMs: overrides.debounceMs,
    now: runtime.now,
  });
}
