import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { GatewayStore } from "../gateway_store.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { AerospaceCommand, WorkspaceSnapshot } from "../workspace/aerospace.js";
import { focusWorkspacePlan, moveToWorkspacePlan } from "../workspace/aerospace.js";
import type { TaskWindowClaimRecord } from "../store.js";
import { normalizeTitlePrefix } from "../store.js";
import type { TaskRuntimeSession } from "../task_sessions/types.js";

export const DEFAULT_FOLLOWS_POLL_MS = 500;
export const DEFAULT_FOLLOWS_TTL_HOURS = 24;
export const DEFAULT_FOLLOWS_PRUNE_MS = 60 * 60 * 1_000;

export type FocusedWorkspaceReader = () => Promise<string | undefined>;
export type AerospaceCommandRunner = (command: AerospaceCommand) => Promise<unknown>;
export type TaskSessionReader = () => Promise<Iterable<TaskRuntimeSession>> | Iterable<TaskRuntimeSession>;

export type FollowsWindowOrchestratorDeps = {
  store: Pick<
    GatewayStore,
    | "listFollowsWindows"
    | "getCurrentTaskState"
    | "getManualModeState"
    | "pruneWindowWorkspaceObservations"
    | "listTaskWindowClaims"
    | "getTask"
    | "getTaskLayout"
  >;
  workspace: Pick<WorkspaceController, "capture">;
  getFocusedWorkspace: FocusedWorkspaceReader;
  runAerospaceCommand: AerospaceCommandRunner;
  listTaskSessions?: TaskSessionReader;
  getProcessAncestorPids?: (pid: number) => Promise<Iterable<number>> | Iterable<number>;
  observability?: Observability;
  pollIntervalMs?: number;
  ttlMs?: number;
  pruneIntervalMs?: number;
  minWorkspaceCount?: number;
  now?: () => Date;
};

export type FollowsTickResult =
  | { decision: "skipped_manual_mode" }
  | { decision: "skipped_no_current_task" }
  | { decision: "skipped_no_focused_workspace" }
  | { decision: "no_change"; focusedWorkspace: string; foreignClaimedMoved?: number; foreignClaimedSkipped?: number }
  | {
      decision: "switch_handled";
      previousWorkspace?: string;
      newWorkspace: string;
      moved: number;
      alreadyOnTarget: number;
      skipped: number;
      foreignClaimedMoved?: number;
      foreignClaimedSkipped?: number;
    }
  | { decision: "error"; error: string };

export type FollowsWindowOrchestrator = {
  tick(now?: Date): Promise<FollowsTickResult>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
};

const SYSTEM_APPS_BLOCKLIST = new Set([
  "loginwindow",
  "windowserver",
  "dock",
  "controlcenter",
  "notificationcenter",
  "systemuiserver",
  "aerospace",
]);

export function createFollowsWindowOrchestrator(deps: FollowsWindowOrchestratorDeps): FollowsWindowOrchestrator {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_FOLLOWS_POLL_MS;
  const ttlMs = deps.ttlMs ?? DEFAULT_FOLLOWS_TTL_HOURS * 60 * 60 * 1_000;
  const pruneIntervalMs = deps.pruneIntervalMs ?? DEFAULT_FOLLOWS_PRUNE_MS;
  const minWorkspaceCount = deps.minWorkspaceCount ?? 3;
  const now = deps.now ?? (() => new Date());

  let lastFocusedWorkspace: string | undefined;
  let lastPruneAtMs = 0;
  let timer: NodeJS.Timeout | undefined;
  let tickInFlight: Promise<FollowsTickResult> | undefined;
  let tickAgain = false;

  async function tick(injectedNow?: Date): Promise<FollowsTickResult> {
    if (!injectedNow && tickInFlight) {
      tickAgain = true;
      return tickInFlight;
    }
    const run = runTick(injectedNow);
    tickInFlight = run;
    try {
      return await run;
    } finally {
      if (tickInFlight === run) {
        tickInFlight = undefined;
      }
      if (!injectedNow && tickAgain) {
        tickAgain = false;
        void tick().catch(() => undefined);
      }
    }
  }

  async function runTick(injectedNow?: Date): Promise<FollowsTickResult> {
    const tickNow = injectedNow ?? now();
    try {
      const manual = await deps.store.getManualModeState();
      if (manual.active) {
        await emit({
          type: "follows_window_orchestrator_skipped_manual_mode",
          summary: "Follows window orchestrator skipped: manual mode active",
          tickNow,
        });
        return { decision: "skipped_manual_mode" };
      }

      const taskState = await deps.store.getCurrentTaskState();
      if (!taskState.current_task_id) {
        return { decision: "skipped_no_current_task" };
      }

      const focused = await deps.getFocusedWorkspace();
      if (!focused) {
        return { decision: "skipped_no_focused_workspace" };
      }

      const previousWorkspace = lastFocusedWorkspace;
      const claims = await deps.store.listTaskWindowClaims({ now: tickNow });
      if (previousWorkspace === focused) {
        const foreignClaimed = await redirectForeignClaimedWindows(deps, {
          snapshot: undefined,
          currentTaskId: taskState.current_task_id,
          focusedWorkspace: focused,
          claims,
          tickNow,
        });
        await maybePrune(tickNow);
        return {
          decision: "no_change",
          focusedWorkspace: focused,
          foreignClaimedMoved: foreignClaimed.moved,
          foreignClaimedSkipped: foreignClaimed.skipped,
        };
      }
      lastFocusedWorkspace = focused;

      const snapshot = await deps.workspace.capture();
      const foreignClaimed = await redirectForeignClaimedWindows(deps, {
        snapshot,
        currentTaskId: taskState.current_task_id,
        focusedWorkspace: focused,
        claims,
        tickNow,
      });

      const follows = await deps.store.listFollowsWindows({ now: tickNow, ttlMs, minWorkspaceCount });
      if (follows.length === 0) {
        await maybePrune(tickNow);
        return {
          decision: "switch_handled",
          previousWorkspace,
          newWorkspace: focused,
          moved: 0,
          alreadyOnTarget: 0,
          skipped: 0,
          foreignClaimedMoved: foreignClaimed.moved,
          foreignClaimedSkipped: foreignClaimed.skipped,
        };
      }

      const windowsById = new Map<string, WorkspaceSnapshot["windows"][number]>();
      for (const window of snapshot.windows) {
        windowsById.set(String(window.id), window);
      }

      let moved = 0;
      let alreadyOnTarget = 0;
      let skipped = 0;

      for (const follow of follows) {
        const window = windowsById.get(follow.window_id);
        if (foreignClaimed.movedWindowIds.has(follow.window_id)) {
          skipped += 1;
          continue;
        }
        if (!window) {
          skipped += 1;
          await emit({
            type: "follows_window_orchestrator_skipped_window",
            summary: `Follows window ${follow.window_id} not present in current snapshot`,
            tickNow,
            details: { window_id: follow.window_id, reason: "not_in_snapshot" },
          });
          continue;
        }
        if (SYSTEM_APPS_BLOCKLIST.has(window.app.toLowerCase())) {
          skipped += 1;
          continue;
        }
        if (window.workspace === focused) {
          alreadyOnTarget += 1;
          await emit({
            type: "follows_window_already_on_target",
            summary: `Follows window ${follow.window_id} already on workspace ${focused}`,
            tickNow,
            details: { window_id: follow.window_id, workspace: focused, app: window.app },
          });
          continue;
        }
        try {
          const command = moveToWorkspacePlan(window.id, focused);
          await deps.runAerospaceCommand(command);
          moved += 1;
          await emit({
            type: "follows_window_moved",
            summary: `Follows window ${follow.window_id} moved to workspace ${focused}`,
            tickNow,
            details: {
              window_id: follow.window_id,
              app: window.app,
              from_workspace: window.workspace,
              to_workspace: focused,
            },
          });
        } catch (error) {
          skipped += 1;
          await emit({
            type: "follows_window_move_failed",
            summary: `Follows window ${follow.window_id} move failed`,
            tickNow,
            status: "failed",
            details: {
              window_id: follow.window_id,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      await maybePrune(tickNow);

      return {
        decision: "switch_handled",
        previousWorkspace,
        newWorkspace: focused,
        moved,
        alreadyOnTarget,
        skipped,
        foreignClaimedMoved: foreignClaimed.moved,
        foreignClaimedSkipped: foreignClaimed.skipped,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emit({
        type: "follows_window_orchestrator_error",
        summary: `Follows window orchestrator error: ${message}`,
        tickNow,
        status: "failed",
        details: { error: message },
      }).catch(() => undefined);
      return { decision: "error", error: message };
    }
  }

  async function maybePrune(tickNow: Date): Promise<void> {
    const tickMs = tickNow.getTime();
    if (lastPruneAtMs === 0) {
      lastPruneAtMs = tickMs;
      return;
    }
    if (tickMs - lastPruneAtMs < pruneIntervalMs) return;
    lastPruneAtMs = tickMs;
    try {
      const removed = await deps.store.pruneWindowWorkspaceObservations(new Date(tickMs - ttlMs));
      if (removed > 0) {
        await emit({
          type: "follows_window_observations_pruned",
          summary: `Pruned ${removed} stale window-workspace observations`,
          tickNow,
          details: { removed, ttl_ms: ttlMs },
        });
      }
    } catch {
      // Pruning is best-effort housekeeping.
    }
  }

  async function emit(input: {
    type: string;
    summary: string;
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

async function redirectForeignClaimedWindows(
  deps: FollowsWindowOrchestratorDeps,
  input: {
    snapshot?: WorkspaceSnapshot;
    currentTaskId: string;
    focusedWorkspace: string;
    claims: readonly TaskWindowClaimRecord[];
    tickNow: Date;
  },
): Promise<{ moved: number; skipped: number; movedWindowIds: Set<string> }> {
  const foreignClaims = input.claims.filter((claim) => claim.task_id !== input.currentTaskId);
  const sessionOwners = await readTaskSessionOwners(deps);
  const foreignSessionOwners = sessionOwners.filter((owner) => owner.taskId !== input.currentTaskId);
  if (foreignClaims.length === 0 && foreignSessionOwners.length === 0) {
    return { moved: 0, skipped: 0, movedWindowIds: new Set() };
  }

  const snapshot = input.snapshot ?? await deps.workspace.capture();
  const movedWindowIds = new Set<string>();
  const taskWorkspaceCache = new Map<string, string | undefined>();
  let moved = 0;
  let skipped = 0;

  for (const window of snapshot.windows) {
    if (window.workspace !== input.focusedWorkspace) continue;
    if (SYSTEM_APPS_BLOCKLIST.has(window.app.toLowerCase())) continue;

    const matchingTaskIds = await taskIdsMatchingWindowOwner(deps, window, input.claims, sessionOwners);
    if (matchingTaskIds.size === 0 || matchingTaskIds.has(input.currentTaskId)) continue;
    if (matchingTaskIds.size > 1) {
      skipped += 1;
      await emitForeignRedirectActivity(deps, {
        type: "foreign_claimed_window_redirect_skipped",
        summary: `Foreign claimed window ${window.id} matched multiple tasks`,
        tickNow: input.tickNow,
        details: { window_id: String(window.id), reason: "ambiguous_task_claim", task_ids: [...matchingTaskIds] },
      });
      continue;
    }

    const [ownerTaskId] = matchingTaskIds;
    if (!ownerTaskId) continue;
    let ownerWorkspace = taskWorkspaceCache.get(ownerTaskId);
    if (!taskWorkspaceCache.has(ownerTaskId)) {
      ownerWorkspace = await ownerWorkspaceForTask(deps, ownerTaskId);
      taskWorkspaceCache.set(ownerTaskId, ownerWorkspace);
    }
    if (!ownerWorkspace || ownerWorkspace === input.focusedWorkspace) {
      skipped += 1;
      await emitForeignRedirectActivity(deps, {
        type: "foreign_claimed_window_redirect_skipped",
        summary: `Foreign claimed window ${window.id} has no different owner workspace`,
        tickNow: input.tickNow,
        details: {
          window_id: String(window.id),
          task_id: ownerTaskId,
          from_workspace: input.focusedWorkspace,
          to_workspace: ownerWorkspace,
          reason: ownerWorkspace ? "already_on_owner_workspace" : "owner_workspace_unknown",
        },
      });
      continue;
    }

    try {
      const command = moveToWorkspacePlan(window.id, ownerWorkspace);
      await deps.runAerospaceCommand(command);
      moved += 1;
      movedWindowIds.add(String(window.id));
      await emitForeignRedirectActivity(deps, {
        type: "foreign_claimed_window_redirected",
        summary: `Foreign claimed window ${window.id} moved back to ${ownerWorkspace}`,
        tickNow: input.tickNow,
        details: {
          window_id: String(window.id),
          app: window.app,
          task_id: ownerTaskId,
          from_workspace: input.focusedWorkspace,
          to_workspace: ownerWorkspace,
        },
      });
    } catch (error) {
      skipped += 1;
      await emitForeignRedirectActivity(deps, {
        type: "foreign_claimed_window_redirect_failed",
        summary: `Foreign claimed window ${window.id} redirect failed`,
        tickNow: input.tickNow,
        status: "failed",
        details: {
          window_id: String(window.id),
          task_id: ownerTaskId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  if (moved > 0) {
    try {
      await deps.runAerospaceCommand(focusWorkspacePlan(input.focusedWorkspace));
      await emitForeignRedirectActivity(deps, {
        type: "foreign_claimed_window_focus_restored",
        summary: `Focus restored to workspace ${input.focusedWorkspace} after foreign window redirect`,
        tickNow: input.tickNow,
        details: {
          workspace: input.focusedWorkspace,
          moved,
        },
      });
    } catch (error) {
      await emitForeignRedirectActivity(deps, {
        type: "foreign_claimed_window_focus_restore_failed",
        summary: `Focus restore to workspace ${input.focusedWorkspace} failed after foreign window redirect`,
        tickNow: input.tickNow,
        status: "failed",
        details: {
          workspace: input.focusedWorkspace,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return { moved, skipped, movedWindowIds };
}

async function ownerWorkspaceForTask(
  deps: FollowsWindowOrchestratorDeps,
  taskId: string,
): Promise<string | undefined> {
  const taskWorkspace = (await deps.store.getTask(taskId))?.aerospace_workspace_id;
  if (taskWorkspace) return taskWorkspace;
  return (await deps.store.getTaskLayout(taskId))?.layout.activeWorkspace;
}

async function taskIdsMatchingWindowOwner(
  deps: FollowsWindowOrchestratorDeps,
  window: WorkspaceSnapshot["windows"][number],
  claims: readonly TaskWindowClaimRecord[],
  sessionOwners: readonly TaskSessionOwner[],
): Promise<Set<string>> {
  const matched = new Set<string>();
  let ancestors: Set<number> | undefined;

  async function readAncestors(): Promise<Set<number>> {
    if (!ancestors) {
      if (!isPositiveInteger(window.pid)) {
        ancestors = new Set();
        return ancestors;
      }
      const readAncestorPids = deps.getProcessAncestorPids ?? defaultReadProcessAncestorPids;
      ancestors = new Set([window.pid, ...Array.from(await readAncestorPids(window.pid), (pid) => Number(pid)).filter(isPositiveInteger)]);
    }
    return ancestors;
  }

  for (const claim of claims) {
    if (claim.window_id && String(window.id) === claim.window_id) {
      matched.add(claim.task_id);
      continue;
    }
    if (isPositiveInteger(claim.process_root_pid) && isPositiveInteger(window.pid)) {
      if ((await readAncestors()).has(claim.process_root_pid)) {
        matched.add(claim.task_id);
        continue;
      }
    }
    if (claimMatchesWindowIdentity(window, claim)) matched.add(claim.task_id);
  }

  if (isPositiveInteger(window.pid)) {
    for (const owner of sessionOwners) {
      if (setIntersects(owner.pids, await readAncestors())) {
        matched.add(owner.taskId);
      }
    }
  }

  return matched;
}

type TaskSessionOwner = {
  taskId: string;
  pids: Set<number>;
};

async function readTaskSessionOwners(deps: FollowsWindowOrchestratorDeps): Promise<TaskSessionOwner[]> {
  if (!deps.listTaskSessions) return [];
  const sessions = Array.from(await deps.listTaskSessions());
  return sessions
    .map(sessionOwnerFromRuntimeSession)
    .filter((owner): owner is TaskSessionOwner => owner !== undefined && owner.pids.size > 0);
}

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

function claimMatchesWindowIdentity(window: WorkspaceSnapshot["windows"][number], claim: TaskWindowClaimRecord): boolean {
  const claimBundle = claim.app_bundle?.trim().toLowerCase();
  const windowBundle = window.appBundleId?.trim().toLowerCase() || window.app.trim().toLowerCase();
  const claimTitlePrefix = normalizeTitlePrefix(claim.title_prefix);
  const windowTitlePrefix = normalizeTitlePrefix(window.title);
  const bundleMatches = claimBundle ? claimBundle === windowBundle : true;
  const titleMatches = claimTitlePrefix ? windowTitlePrefix?.startsWith(claimTitlePrefix) === true : true;
  return Boolean((claimBundle || claimTitlePrefix) && bundleMatches && titleMatches);
}

async function emitForeignRedirectActivity(
  deps: FollowsWindowOrchestratorDeps,
  input: {
    type: string;
    summary: string;
    tickNow: Date;
    status?: "ok" | "failed";
    details: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.observability) return;
  await deps.observability.recordActivity({
    type: input.type,
    occurred_at: input.tickNow.toISOString(),
    actor: "system",
    status: input.status ?? "ok",
    summary: input.summary,
    details: sanitizeActivityDetails(input.details),
  });
}

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
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const result = await execFileAsync("ps", ["-o", "ppid=", "-p", String(pid)], { timeout: 1_000 });
    const parsed = Number(result.stdout.trim());
    return isPositiveInteger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function addPid(output: Set<number>, value: unknown): void {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (isPositiveInteger(parsed)) output.add(parsed);
}

function setIntersects(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type FollowsWindowOrchestratorRuntimeOptions = {
  pollIntervalMs?: number;
  ttlMs?: number;
  pruneIntervalMs?: number;
  minWorkspaceCount?: number;
};

export function createFollowsWindowOrchestratorFromRuntime(
  runtime: {
    store: GatewayStore;
    taskSessions?: {
      listSessions?: () => Promise<TaskRuntimeSession[]> | TaskRuntimeSession[];
    };
    workspace?: WorkspaceController;
    observability?: Observability;
    now: () => Date;
  },
  getFocusedWorkspace: FocusedWorkspaceReader,
  runAerospaceCommand: AerospaceCommandRunner,
  overrides: FollowsWindowOrchestratorRuntimeOptions = {},
): FollowsWindowOrchestrator | undefined {
  if (!runtime.workspace) return undefined;
  return createFollowsWindowOrchestrator({
    store: runtime.store,
    workspace: runtime.workspace,
    getFocusedWorkspace,
    runAerospaceCommand,
    listTaskSessions: typeof runtime.taskSessions?.listSessions === "function"
      ? async () => runtime.taskSessions?.listSessions?.() ?? []
      : undefined,
    observability: runtime.observability,
    pollIntervalMs: overrides.pollIntervalMs,
    ttlMs: overrides.ttlMs,
    pruneIntervalMs: overrides.pruneIntervalMs,
    minWorkspaceCount: overrides.minWorkspaceCount,
    now: runtime.now,
  });
}
