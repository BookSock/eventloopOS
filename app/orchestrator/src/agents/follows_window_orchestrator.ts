import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { GatewayStore } from "../gateway_store.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { AerospaceCommand, WorkspaceSnapshot } from "../workspace/aerospace.js";
import { moveToWorkspacePlan } from "../workspace/aerospace.js";

export const DEFAULT_FOLLOWS_POLL_MS = 1_000;
export const DEFAULT_FOLLOWS_TTL_HOURS = 24;
export const DEFAULT_FOLLOWS_PRUNE_MS = 60 * 60 * 1_000;

export type FocusedWorkspaceReader = () => Promise<string | undefined>;
export type AerospaceCommandRunner = (command: AerospaceCommand) => Promise<unknown>;

export type FollowsWindowOrchestratorDeps = {
  store: Pick<
    GatewayStore,
    "listFollowsWindows" | "getCurrentTaskState" | "getManualModeState" | "pruneWindowWorkspaceObservations"
  >;
  workspace: Pick<WorkspaceController, "capture">;
  getFocusedWorkspace: FocusedWorkspaceReader;
  runAerospaceCommand: AerospaceCommandRunner;
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
  | { decision: "no_change"; focusedWorkspace: string }
  | {
      decision: "switch_handled";
      previousWorkspace?: string;
      newWorkspace: string;
      moved: number;
      alreadyOnTarget: number;
      skipped: number;
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

  async function tick(injectedNow?: Date): Promise<FollowsTickResult> {
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
      if (previousWorkspace === focused) {
        await maybePrune(tickNow);
        return { decision: "no_change", focusedWorkspace: focused };
      }
      lastFocusedWorkspace = focused;

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
        };
      }

      const snapshot = await deps.workspace.capture();
      const windowsById = new Map<string, WorkspaceSnapshot["windows"][number]>();
      for (const window of snapshot.windows) {
        windowsById.set(String(window.id), window);
      }

      let moved = 0;
      let alreadyOnTarget = 0;
      let skipped = 0;

      for (const follow of follows) {
        const window = windowsById.get(follow.window_id);
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

export type FollowsWindowOrchestratorRuntimeOptions = {
  pollIntervalMs?: number;
  ttlMs?: number;
  pruneIntervalMs?: number;
  minWorkspaceCount?: number;
};

export function createFollowsWindowOrchestratorFromRuntime(
  runtime: {
    store: GatewayStore;
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
    observability: runtime.observability,
    pollIntervalMs: overrides.pollIntervalMs,
    ttlMs: overrides.ttlMs,
    pruneIntervalMs: overrides.pruneIntervalMs,
    minWorkspaceCount: overrides.minWorkspaceCount,
    now: runtime.now,
  });
}
