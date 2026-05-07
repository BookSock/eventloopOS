import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AerospaceWorkspaceController } from "./controller.js";
import type { ExecFunction, WorkspaceCapabilityStatus } from "./aerospace.js";

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
    }
  | {
      ok: false;
      skipped: false;
      status: WorkspaceCapabilityStatus;
      reason: string;
    };

export async function runLiveAerospaceSmoke(options: {
  enabled?: boolean;
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

  return {
    ok: true,
    skipped: false,
    status,
    window_count: snapshot.windows.length,
    restore_plan_command_count: plan.commands.length,
    restore_plan_skip_count: plan.skipped.length,
  };
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
  const result = await runLiveAerospaceSmoke({
    enabled: process.env.EVENTLOOPOS_ENABLE_LIVE_AEROSPACE === "1",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
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
