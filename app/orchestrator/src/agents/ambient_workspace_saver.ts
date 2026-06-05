import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { TaskRuntimeSession } from "../task_sessions/types.js";
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
  process_root_pid?: number;
};
export type TaskWindowClaimReader = () => Promise<Iterable<TaskWindowClaim>> | Iterable<TaskWindowClaim>;
export type TaskWindowClaimWriter = (input: {
  taskId: string;
  windowId?: string;
  appBundle?: string;
  titlePrefix?: string;
  processRootPid?: number;
  source?: string;
  now: Date;
  ttlMs?: number;
}) => Promise<unknown> | unknown;
export type TaskSessionReader = () => Promise<Iterable<TaskRuntimeSession>> | Iterable<TaskRuntimeSession>;
export type ProcessAncestorReader = (pid: number) => Promise<Iterable<number>> | Iterable<number>;

export type AmbientWorkspaceSaverDeps = {
  workspace: Pick<WorkspaceController, "capture">;
  getCurrentTaskState: CurrentTaskStateReader;
  updateTaskLayout: TaskLayoutWriter;
  isManualModeActive: ManualModeReader;
  recordWindowObservation?: WindowWorkspaceObservationWriter;
  getFollowsWindowIds?: FollowsWindowIdReader;
  getTaskWindowClaims?: TaskWindowClaimReader;
  claimTaskWindow?: TaskWindowClaimWriter;
  listTaskSessions?: TaskSessionReader;
  getProcessAncestorPids?: ProcessAncestorReader;
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
      await autoClaimProcessTreeTaskWindows(deps, rawSnapshot, tickNow);
      const snapshot = await filterSnapshotForTaskSaveWithProcessAncestry(
        deps,
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
    const appBundle = readWindowAppBundleCandidate(window);
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

async function autoClaimProcessTreeTaskWindows(
  deps: AmbientWorkspaceSaverDeps,
  snapshot: WorkspaceSnapshot,
  now: Date,
): Promise<void> {
  if (!deps.claimTaskWindow) return;

  const existingClaims = await readTaskWindowClaims(deps);
  const sessions = deps.listTaskSessions ? Array.from(await deps.listTaskSessions()) : [];
  const sessionOwners = [
    ...sessions
      .map(sessionOwnerFromRuntimeSession)
      .filter((owner): owner is TaskSessionOwner => owner !== undefined && owner.pids.size > 0),
    ...existingClaims
      .map(taskSessionOwnerFromProcessRootClaim)
      .filter((owner): owner is TaskSessionOwner => owner !== undefined && owner.pids.size > 0),
  ];
  if (sessionOwners.length === 0) return;

  const readAncestors = deps.getProcessAncestorPids ?? defaultReadProcessAncestorPids;
  let claimed = 0;
  let ambiguous = 0;

  for (const window of snapshot.windows) {
    if (typeof window.pid !== "number" || !Number.isInteger(window.pid) || window.pid <= 0) continue;
    if (taskIdFromTaggedWindow(window)) continue;
    if (existingClaims.some((claim) => taskWindowClaimMatches(window, claim))) continue;

    const ancestors = new Set([window.pid, ...Array.from(await readAncestors(window.pid), (pid) => Number(pid)).filter(isPositiveInteger)]);
    const matchingTaskIds = new Set(
      sessionOwners
        .filter((owner) => setIntersects(owner.pids, ancestors))
        .map((owner) => owner.taskId),
    );
    if (matchingTaskIds.size !== 1) {
      if (matchingTaskIds.size > 1) ambiguous += 1;
      continue;
    }

    const [taskId] = matchingTaskIds;
    if (!taskId) continue;
    try {
      await deps.claimTaskWindow({
        taskId,
        windowId: String(window.id),
        appBundle: readWindowAppBundleCandidate(window),
        titlePrefix: normalizeTitlePrefix(window.title),
        source: "ambient_process_tree",
        now,
        ttlMs: 30 * 60 * 1_000,
      });
      claimed += 1;
    } catch {
      // Process-tree claims are attribution hints. Never block workspace saving.
    }
  }

  if ((claimed > 0 || ambiguous > 0) && deps.observability) {
    if (claimed > 0) await deps.observability.incrementCounter("task_window_claims_process_tree_total", claimed);
    if (ambiguous > 0) await deps.observability.incrementCounter("task_window_claims_process_tree_ambiguous_total", ambiguous);
    await deps.observability.recordActivity({
      type: "task_window_claims_process_tree",
      occurred_at: now.toISOString(),
      actor: "system",
      status: "ok",
      summary: `Inferred ${claimed} task window claim(s) from process ancestry.`,
      details: sanitizeActivityDetails({ claimed, ambiguous, source: "ambient_process_tree" }),
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
    const appBundle = readWindowAppBundleCandidate(window);
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

async function filterSnapshotForTaskSaveWithProcessAncestry(
  deps: AmbientWorkspaceSaverDeps,
  snapshot: WorkspaceSnapshot,
  followsWindowIds: ReadonlySet<string>,
  currentTaskId: string,
  taskWindowClaims: readonly TaskWindowClaim[],
): Promise<WorkspaceSnapshot> {
  if (!snapshot.activeWorkspace) return snapshot;
  const readAncestors = deps.getProcessAncestorPids ?? defaultReadProcessAncestorPids;
  const ancestorCache = new Map<number, Promise<ReadonlySet<number>>>();

  async function windowAncestors(window: AerospaceWindow): Promise<ReadonlySet<number>> {
    const windowPid = window.pid;
    if (!isPositiveInteger(windowPid)) return new Set();
    const cached = ancestorCache.get(windowPid);
    if (cached) return cached;
    const next = Promise.resolve(readAncestors(windowPid)).then((pids): ReadonlySet<number> =>
      new Set([windowPid, ...Array.from(pids, (pid) => Number(pid)).filter(isPositiveInteger)]),
    );
    ancestorCache.set(windowPid, next);
    return next;
  }

  const windows: WorkspaceSnapshot["windows"] = [];
  for (const window of snapshot.windows) {
    if (window.workspace !== snapshot.activeWorkspace && !followsWindowIds.has(String(window.id))) continue;
    if (!await isTaskSnapshotEligibleWindowWithProcessAncestry(window, currentTaskId, taskWindowClaims, windowAncestors)) continue;
    windows.push(window);
  }

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

async function isTaskSnapshotEligibleWindowWithProcessAncestry(
  window: AerospaceWindow,
  currentTaskId: string,
  taskWindowClaims: readonly TaskWindowClaim[],
  readAncestors: (window: AerospaceWindow) => Promise<ReadonlySet<number>>,
): Promise<boolean> {
  const app = window.app.trim().toLowerCase();
  const bundle = typeof window.appBundleId === "string" ? window.appBundleId.trim().toLowerCase() : "";
  if (TASK_SNAPSHOT_APP_BLOCKLIST.has(app) || TASK_SNAPSHOT_BUNDLE_BLOCKLIST.has(bundle)) return false;

  const taggedTaskId = taskIdFromTaggedWindow(window);
  if (taggedTaskId && taggedTaskId !== currentTaskId) return false;

  const claimedTaskIds = await taskIdsFromWindowClaimsWithProcessAncestry(window, taskWindowClaims, readAncestors);
  if (claimedTaskIds.size === 0) return true;
  return claimedTaskIds.size === 1 && claimedTaskIds.has(currentTaskId);
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
  if (isPositiveInteger(claim.process_root_pid) && window.pid === claim.process_root_pid) return true;
  return taskWindowIdentityMatches(window, claim);
}

async function taskIdsFromWindowClaimsWithProcessAncestry(
  window: AerospaceWindow,
  claims: readonly TaskWindowClaim[],
  readAncestors: (window: AerospaceWindow) => Promise<ReadonlySet<number>>,
): Promise<Set<string>> {
  const matched = new Set<string>();
  let ancestors: ReadonlySet<number> | undefined;

  for (const claim of claims) {
    if (claim.window_id && String(window.id) === claim.window_id) {
      matched.add(claim.task_id);
      continue;
    }
    if (isPositiveInteger(claim.process_root_pid) && isPositiveInteger(window.pid)) {
      ancestors ??= await readAncestors(window);
      if (ancestors.has(claim.process_root_pid)) {
        matched.add(claim.task_id);
        continue;
      }
    }
    if (taskWindowIdentityMatches(window, claim)) matched.add(claim.task_id);
  }

  return matched;
}

function taskWindowIdentityMatches(window: AerospaceWindow, claim: TaskWindowClaim): boolean {
  const claimBundle = claim.app_bundle?.trim().toLowerCase();
  const windowBundle = window.appBundleId?.trim().toLowerCase() || window.app.trim().toLowerCase();
  const claimTitlePrefix = normalizeTitlePrefix(claim.title_prefix);
  const windowTitlePrefix = normalizeTitlePrefix(window.title);
  const bundleMatches = claimBundle ? claimBundle === windowBundle : true;
  const titleMatches = claimTitlePrefix ? windowTitlePrefix?.startsWith(claimTitlePrefix) === true : true;
  return Boolean((claimBundle || claimTitlePrefix) && bundleMatches && titleMatches);
}

type TaskSessionOwner = {
  taskId: string;
  pids: Set<number>;
};

function sessionOwnerFromRuntimeSession(session: TaskRuntimeSession): TaskSessionOwner | undefined {
  if (!isRecord(session) || typeof session.task_id !== "string" || !session.task_id) return undefined;
  const pids = new Set<number>();
  for (const key of ["pid", "process_id", "agent_pid", "terminal_pid", "root_pid"]) {
    addPid(pids, session[key]);
  }
  for (const key of ["pids", "process_pids", "agent_pids"]) {
    const values = session[key];
    if (Array.isArray(values)) {
      for (const value of values) addPid(pids, value);
    }
  }
  return { taskId: session.task_id, pids };
}

function taskSessionOwnerFromProcessRootClaim(claim: TaskWindowClaim): TaskSessionOwner | undefined {
  if (!isPositiveInteger(claim.process_root_pid)) return undefined;
  return { taskId: claim.task_id, pids: new Set([claim.process_root_pid]) };
}

function addPid(output: Set<number>, value: unknown): void {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (isPositiveInteger(parsed)) output.add(parsed);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function setIntersects(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function readWindowAppBundleCandidate(window: AerospaceWindow): string | undefined {
  return typeof window.appBundleId === "string" && window.appBundleId.length > 0
    ? window.appBundleId
    : typeof window.app === "string" && window.app.length > 0
      ? window.app
      : undefined;
}

const execFileAsync = promisify(execFile);

async function defaultReadProcessAncestorPids(pid: number): Promise<number[]> {
  const ancestors: number[] = [];
  let current = pid;
  for (let depth = 0; depth < 12; depth += 1) {
    const parent = await readParentPid(current);
    if (!parent || parent === current || ancestors.includes(parent)) break;
    ancestors.push(parent);
    current = parent;
    if (current === 1) break;
  }
  return ancestors;
}

async function readParentPid(pid: number): Promise<number | undefined> {
  try {
    const result = await execFileAsync("ps", ["-o", "ppid=", "-p", String(pid)], { timeout: 1_000 });
    const parsed = Number(result.stdout.trim());
    return isPositiveInteger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function createAmbientWorkspaceSaverFromRuntime(
  runtime: Runtime,
  overrides: {
    pollIntervalMs?: number;
    debounceMs?: number;
  } = {},
): AmbientWorkspaceSaver | undefined {
  if (!runtime.workspace) return undefined;
  const workspace = runtime.workspace;
  const store = runtime.store;

  const getCurrentTaskState: CurrentTaskStateReader = async () => {
    const state = await store.getCurrentTaskState();
    return { currentTaskId: state.current_task_id ?? null };
  };

  const updateTaskLayout: TaskLayoutWriter = async (taskId, snapshot) => {
    await store.updateTaskLayout(taskId, snapshot, runtime.now());
    return await store.saveTaskWorkspaceSnapshot({
      taskId,
      snapshot,
      capturedAt: runtime.now(),
      actorId: "ambient-workspace-saver",
    });
  };

  const isManualModeActive: ManualModeReader = async () => {
    const state = await runtime.store.getManualModeState();
    return state.active === true;
  };

  const recordWindowObservation: WindowWorkspaceObservationWriter = (input) => store.recordWindowWorkspaceObservation(input);
  const getFollowsWindowIds: FollowsWindowIdReader = async () => {
    const ttlMs = Number(process.env.EVENTLOOPOS_FOLLOWS_TTL_MS ?? 24 * 60 * 60 * 1_000);
    const minWorkspaceCount = Number(process.env.EVENTLOOPOS_FOLLOWS_THRESHOLD ?? 3);
    const follows = await store.listFollowsWindows({ now: runtime.now(), ttlMs, minWorkspaceCount });
    return follows.map((follow) => follow.window_id);
  };
  const getTaskWindowClaims: TaskWindowClaimReader = async () => store.listTaskWindowClaims({ now: runtime.now() });
  const claimTaskWindow: TaskWindowClaimWriter = (input) => store.claimTaskWindow({
    taskId: input.taskId,
    windowId: input.windowId,
    appBundle: input.appBundle,
    titlePrefix: input.titlePrefix,
    processRootPid: input.processRootPid,
    source: input.source,
    now: input.now,
    ttlMs: input.ttlMs,
  });
  const listTaskSessions: TaskSessionReader | undefined =
    typeof runtime.taskSessions?.listSessions === "function"
      ? async () => runtime.taskSessions?.listSessions?.() ?? []
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
    listTaskSessions,
    observability: runtime.observability,
    pollIntervalMs: overrides.pollIntervalMs,
    debounceMs: overrides.debounceMs,
    now: runtime.now,
  });
}
