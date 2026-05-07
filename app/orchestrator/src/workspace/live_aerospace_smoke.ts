import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AerospaceWorkspaceController } from "./controller.js";
import type { AerospaceWindow, ExecFunction, WorkspaceCapabilityStatus, WorkspaceSnapshot } from "./aerospace.js";

const execFileAsync = promisify(execFile);

export type LiveAerospaceSmokeResult =
  | {
      ok: true;
      skipped: true;
      reason: "not_enabled";
    }
  | {
      ok: true;
      skipped: false;
      status: WorkspaceCapabilityStatus;
      window_count: number;
      restore_plan_command_count: number;
      restore_plan_skip_count: number;
      execution_proof?: LiveAerospaceExecutionProof;
    }
  | {
      ok: false;
      skipped: false;
      status: WorkspaceCapabilityStatus;
      reason: string;
      detail?: string;
    };

export type LiveAerospaceExecutionProof = {
  target_window_id: number;
  original_workspace: string;
  scratch_workspace: string;
  disturbed_workspace: string;
  restored_workspace: string;
  disturb_command_count: number;
  restore_command_count: number;
};

export async function runLiveAerospaceSmoke(options: {
  enabled?: boolean;
  executeRestore?: boolean;
  scratchWorkspace?: string;
  exec?: ExecFunction;
}): Promise<LiveAerospaceSmokeResult> {
  if (!options.enabled) {
    return {
      ok: true,
      skipped: true,
      reason: "not_enabled",
    };
  }

  const controller = new AerospaceWorkspaceController(options.exec ?? execAerospace);
  const status = await controller.status();

  if (!status.available) {
    return {
      ok: false,
      skipped: false,
      status,
      reason: status.reason,
    };
  }

  const snapshot = await controller.capture();
  const current = await controller.capture();
  const plan = await controller.planRestore(snapshot, current.windows);
  const executionProof = options.executeRestore
    ? await proveRestoreExecution(controller, snapshot, options.scratchWorkspace ?? "eventloop-smoke")
    : undefined;

  const result: LiveAerospaceSmokeResult = {
    ok: true,
    skipped: false,
    status,
    window_count: snapshot.windows.length,
    restore_plan_command_count: plan.commands.length,
    restore_plan_skip_count: plan.skipped.length,
  };
  if (executionProof) {
    result.execution_proof = executionProof;
  }

  return result;
}

async function proveRestoreExecution(
  controller: AerospaceWorkspaceController,
  originalSnapshot: WorkspaceSnapshot,
  scratchWorkspace: string,
): Promise<LiveAerospaceExecutionProof> {
  const target = pickRestoreExecutionTarget(originalSnapshot.windows);
  if (!target) {
    throw new Error("no AeroSpace windows available for restore execution proof");
  }

  const targetScratchWorkspace = target.workspace === scratchWorkspace ? `${scratchWorkspace}-2` : scratchWorkspace;
  const disturbedSnapshot: WorkspaceSnapshot = {
    backend: "aerospace",
    activeWorkspace: targetScratchWorkspace,
    focusedWindowId: target.id,
    windows: [{ ...target, workspace: targetScratchWorkspace }],
  };

  let disturbed = false;
  try {
    const disturbPlan = await controller.planRestore(disturbedSnapshot, originalSnapshot.windows);
    await controller.executeRestorePlan(disturbPlan);
    disturbed = true;

    const disturbedCurrent = await controller.capture();
    const disturbedTarget = findWindow(disturbedCurrent.windows, target.id);
    if (disturbedTarget?.workspace !== targetScratchWorkspace) {
      throw new Error(
        `AeroSpace did not move window ${target.id} to ${targetScratchWorkspace}; current workspace: ${disturbedTarget?.workspace ?? "missing"}`,
      );
    }

    const restoreSnapshot: WorkspaceSnapshot = {
      ...originalSnapshot,
      activeWorkspace: target.workspace,
      focusedWindowId: target.id,
    };
    const restorePlan = await controller.planRestore(restoreSnapshot, disturbedCurrent.windows);
    await controller.executeRestorePlan(restorePlan);

    const restoredCurrent = await controller.capture();
    const restoredTarget = findWindow(restoredCurrent.windows, target.id);
    if (restoredTarget?.workspace !== target.workspace) {
      throw new Error(
        `AeroSpace did not restore window ${target.id} to ${target.workspace}; current workspace: ${restoredTarget?.workspace ?? "missing"}`,
      );
    }

    return {
      target_window_id: target.id,
      original_workspace: target.workspace,
      scratch_workspace: targetScratchWorkspace,
      disturbed_workspace: disturbedTarget.workspace,
      restored_workspace: restoredTarget.workspace,
      disturb_command_count: disturbPlan.commands.length,
      restore_command_count: restorePlan.commands.length,
    };
  } catch (error) {
    if (disturbed) {
      await tryCleanupRestore(controller, originalSnapshot);
    }
    throw error;
  }
}

function pickRestoreExecutionTarget(windows: AerospaceWindow[]): AerospaceWindow | undefined {
  return windows.find((window) => window.app !== "AeroSpace") ?? windows[0];
}

function findWindow(windows: AerospaceWindow[], windowId: number): AerospaceWindow | undefined {
  return windows.find((window) => window.id === windowId);
}

async function tryCleanupRestore(controller: AerospaceWorkspaceController, originalSnapshot: WorkspaceSnapshot): Promise<void> {
  try {
    const current = await controller.capture();
    const plan = await controller.planRestore(originalSnapshot, current.windows);
    await controller.executeRestorePlan(plan);
  } catch {
    // Best-effort cleanup only. The caller reports the original failure.
  }
}

async function execAerospace(command: string, args: string[]): Promise<{ stdout: string; stderr?: string }> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout,
    stderr,
  };
}

async function main(): Promise<number> {
  try {
    const result = await runLiveAerospaceSmoke({
      enabled: process.env.EVENTLOOPOS_ENABLE_LIVE_AEROSPACE === "1",
      executeRestore: process.env.EVENTLOOPOS_ENABLE_LIVE_AEROSPACE_EXECUTE === "1",
      scratchWorkspace: process.env.EVENTLOOPOS_AEROSPACE_SMOKE_WORKSPACE,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          skipped: false,
          reason: "execute_restore_failed",
          detail: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    );
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
