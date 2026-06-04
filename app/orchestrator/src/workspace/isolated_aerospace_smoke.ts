import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  moveToWorkspacePlan,
  type AerospaceCommand,
  type AerospaceWindow,
  type ExecFunction,
  type WorkspaceCapabilityStatus,
  type WorkspaceSnapshot,
  layoutWindowPlan,
} from "./aerospace.js";
import { AerospaceWorkspaceController, type WorkspaceController } from "./controller.js";

const execFileAsync = promisify(execFile);

export type IsolatedAerospaceSmokeResult =
  | {
      ok: true;
      skipped: true;
      reason: "not_enabled";
    }
  | {
      ok: true;
      skipped: false;
      status: WorkspaceCapabilityStatus;
      run_id: string;
      artifact_dir?: string;
      manifest_path?: string;
      target_window_id: number;
      target_title: string;
      original_workspace: string;
      scratch_workspace: string;
      restored_workspace: string;
      non_test_window_count: number;
      non_test_changed_windows: NonTestWindowChange[];
      force_floating_proof?: ForceFloatingProof;
      commands: AerospaceCommand[];
      cleanup: SmokeWindowCleanupResult;
      cleanup_verified: boolean;
    }
  | {
      ok: false;
      skipped: false;
      status?: WorkspaceCapabilityStatus;
      run_id: string;
      artifact_dir?: string;
      manifest_path?: string;
      reason: string;
      detail?: string;
      non_test_changed_windows?: NonTestWindowChange[];
      cleanup?: SmokeWindowCleanupResult;
      cleanup_verified?: boolean;
    };

export type NonTestWindowChange = {
  window_id: number;
  app: string;
  title: string;
  before_workspace: string;
  after_workspace: string;
};

export type ForceFloatingProof = {
  attempted: boolean;
  tiling_refused?: boolean;
  tiling_refusal_detail?: string;
  initial_layout_after_force_floating?: string;
  scratch_layout_after_force_tile?: string;
  restored_layout_after_move_back?: string;
};

export type SmokeWindowCleanupResult = {
  attempted: boolean;
  ok: boolean;
  detail?: string;
};

export type SmokeWindowHandle = {
  title: string;
  appName?: string;
  cleanup(): Promise<SmokeWindowCleanupResult>;
};

export type SmokeWindowLauncher = (runId: string) => Promise<SmokeWindowHandle>;

export async function runIsolatedAerospaceSmoke(options: {
  enabled?: boolean;
  scratchWorkspace?: string;
  runId?: string;
  controller?: WorkspaceController;
  exec?: ExecFunction;
  launchWindow?: SmokeWindowLauncher;
  proveForceFloating?: boolean;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  artifactDir?: string;
}): Promise<IsolatedAerospaceSmokeResult> {
  const runId = options.runId ?? defaultRunId();
  const artifactDir = options.artifactDir;
  const manifestPath = artifactDir ? resolve(artifactDir, "manifest.json") : undefined;
  const withManifest = async <Result extends IsolatedAerospaceSmokeResult>(result: Result): Promise<Result> =>
    await writeResultManifest(result, manifestPath, artifactDir);

  if (!options.enabled) {
    return await withManifest({
      ok: true,
      skipped: true,
      reason: "not_enabled",
    });
  }

  const controller = options.controller ?? new AerospaceWorkspaceController(options.exec ?? execAerospace);
  const scratchWorkspace = options.scratchWorkspace ?? "eventloop-smoke";
  const waitTimeoutMs = options.waitTimeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const status = await controller.status();
  if (!status.available) {
    return await withManifest({
      ok: false,
      skipped: false,
      status,
      run_id: runId,
      reason: status.reason,
      detail: status.detail,
    });
  }

  const before = await controller.capture();
  const baseline = baselineWindowMap(before.windows);
  let handle: SmokeWindowHandle | undefined;
  let smokeWindowId: number | undefined;
  let cleanup: SmokeWindowCleanupResult = { attempted: false, ok: false };
  const commands: AerospaceCommand[] = [];
  let forceFloatingProof: ForceFloatingProof | undefined;

  try {
    const launchedHandle = await (options.launchWindow ?? launchDefaultSmokeWindow)(runId);
    handle = launchedHandle;
    if (before.windows.some((window) => titleMatches(window, launchedHandle.title))) {
      cleanup = await handle.cleanup();
      return await withManifest({
        ok: false,
        skipped: false,
        status,
        run_id: runId,
        reason: "smoke_window_title_collision",
        detail: `smoke window title already existed before launch: ${launchedHandle.title}`,
        cleanup,
        cleanup_verified: false,
      });
    }

    const launched = await waitForSmokeWindow(controller, launchedHandle.title, {
      timeoutMs: waitTimeoutMs,
      pollIntervalMs,
      excludedWindowIds: baseline,
      fallbackAppName: launchedHandle.appName,
    });
    let target = launched.target;
    smokeWindowId = target.id;
    const targetScratchWorkspace = target.workspace === scratchWorkspace ? `${scratchWorkspace}-2` : scratchWorkspace;

    if (options.proveForceFloating) {
      const currentLayout = await readAerospaceWindowLayout(options.exec ?? execAerospace, target.id);
      if (currentLayout !== "floating") {
        const forceFloating = await executeSmokeWindowCommand(controller, {
          target,
          handle: launchedHandle,
          baseline,
          waitTimeoutMs,
          pollIntervalMs,
          buildCommand: (windowId) => layoutWindowPlan(windowId, "floating"),
        });
        target = forceFloating.target;
        smokeWindowId = target.id;
        commands.push(forceFloating.command);
      }
      const initialFloatingLayout = await readAerospaceWindowLayout(options.exec ?? execAerospace, target.id);
      forceFloatingProof = {
        attempted: true,
        initial_layout_after_force_floating: initialFloatingLayout,
      };
      if (initialFloatingLayout !== "floating") {
        throw new Error(
          `AeroSpace force-floating proof could not place smoke window ${target.id} into a floating start state; current layout: ${initialFloatingLayout ?? "missing"}`,
        );
      }
    }

    const disturb = await executeSmokeWindowCommand(controller, {
      target,
      handle: launchedHandle,
      baseline,
      waitTimeoutMs,
      pollIntervalMs,
      buildCommand: (windowId) => moveToWorkspacePlan(windowId, targetScratchWorkspace),
    });
    target = disturb.target;
    smokeWindowId = target.id;
    const disturbCommand = disturb.command;
    commands.push(disturbCommand);

    const disturbed = await controller.capture();
    const disturbedTarget = findWindow(disturbed.windows, target.id);
    if (disturbedTarget?.workspace !== targetScratchWorkspace) {
      throw new Error(
        `AeroSpace did not move smoke window ${target.id} to ${targetScratchWorkspace}; current workspace: ${disturbedTarget?.workspace ?? "missing"}`,
      );
    }
    const disturbedChanges = changedNonTestWindows(baseline, disturbed.windows, target.id);
    if (disturbedChanges.length > 0) {
      return await withManifest(
        await failWithCleanup({
          runId,
          reason: "non_test_window_moved",
          detail: "AeroSpace isolated proof observed a non-test window workspace change after disturb step",
          changes: disturbedChanges,
          handle,
          status,
          controller,
          smokeWindowId: target.id,
          waitTimeoutMs,
          pollIntervalMs,
        }),
      );
    }

    if (options.proveForceFloating) {
      let forceTileCommand = layoutWindowPlan(target.id, "h_tiles");
      try {
        const forceTile = await executeSmokeWindowCommand(controller, {
          target,
          handle: launchedHandle,
          baseline,
          waitTimeoutMs,
          pollIntervalMs,
          buildCommand: (windowId) => layoutWindowPlan(windowId, "h_tiles"),
        });
        target = forceTile.target;
        smokeWindowId = target.id;
        forceTileCommand = forceTile.command;
        commands.push(forceTileCommand);
        const scratchLayout = await readAerospaceWindowLayout(options.exec ?? execAerospace, target.id);
        forceFloatingProof = {
          ...forceFloatingProof,
          attempted: true,
          scratch_layout_after_force_tile: scratchLayout,
        };
        if (!scratchLayout || scratchLayout === "floating") {
          throw new Error(
            `AeroSpace force-floating proof could not place smoke window ${target.id} into a tiled scratch state; current layout: ${scratchLayout ?? "missing"}`,
          );
        }
      } catch (error) {
        if (!isNonTilingLayoutError(error)) {
          throw error;
        }
        forceFloatingProof = {
          ...forceFloatingProof,
          attempted: true,
          tiling_refused: true,
          tiling_refusal_detail: error instanceof Error ? error.message : String(error),
          scratch_layout_after_force_tile: await readAerospaceWindowLayout(options.exec ?? execAerospace, target.id),
        };
      }

      const afterForceTile = await controller.capture();
      const forceTileChanges = changedNonTestWindows(baseline, afterForceTile.windows, target.id);
      if (forceTileChanges.length > 0) {
        return await withManifest(
          await failWithCleanup({
            runId,
            reason: "non_test_window_moved",
            detail: "AeroSpace isolated proof observed a non-test window workspace change after force-tile step",
            changes: forceTileChanges,
            handle,
            status,
            controller,
            smokeWindowId: target.id,
            waitTimeoutMs,
            pollIntervalMs,
          }),
        );
      }
    }

    const restore = await executeSmokeWindowCommand(controller, {
      target,
      handle: launchedHandle,
      baseline,
      waitTimeoutMs,
      pollIntervalMs,
      buildCommand: (windowId) => moveToWorkspacePlan(windowId, target.workspace),
    });
    target = restore.target;
    smokeWindowId = target.id;
    const restoreCommand = restore.command;
    commands.push(restoreCommand);

    const restored = await controller.capture();
    const restoredTarget = findWindow(restored.windows, target.id);
    if (restoredTarget?.workspace !== target.workspace) {
      throw new Error(
        `AeroSpace did not restore smoke window ${target.id} to ${target.workspace}; current workspace: ${restoredTarget?.workspace ?? "missing"}`,
      );
    }
    if (forceFloatingProof?.attempted) {
      const currentLayout = await readAerospaceWindowLayout(options.exec ?? execAerospace, target.id);
      if (currentLayout !== "floating") {
        const restoreFloating = await executeSmokeWindowCommand(controller, {
          target,
          handle: launchedHandle,
          baseline,
          waitTimeoutMs,
          pollIntervalMs,
          buildCommand: (windowId) => layoutWindowPlan(windowId, "floating"),
        });
        target = restoreFloating.target;
        smokeWindowId = target.id;
        commands.push(restoreFloating.command);
      }
      const restoredLayout = await readAerospaceWindowLayout(options.exec ?? execAerospace, target.id);
      forceFloatingProof = {
        ...forceFloatingProof,
        restored_layout_after_move_back: restoredLayout,
      };
      if (restoredLayout !== "floating") {
        throw new Error(
          `AeroSpace did not force smoke window ${target.id} back to floating after restore; current layout: ${restoredLayout ?? "missing"}`,
        );
      }
    }
    const restoredChanges = changedNonTestWindows(baseline, restored.windows, target.id);
    if (restoredChanges.length > 0) {
      return await withManifest(
        await failWithCleanup({
          runId,
          reason: "non_test_window_moved",
          detail: "AeroSpace isolated proof observed a non-test window workspace change after restore step",
          changes: restoredChanges,
          handle,
          status,
          controller,
          smokeWindowId: target.id,
          waitTimeoutMs,
          pollIntervalMs,
        }),
      );
    }

    cleanup = await handle.cleanup();
    const cleanupVerified = cleanup.ok
      ? await waitForWindowGone(controller, target.id, { timeoutMs: waitTimeoutMs, pollIntervalMs })
      : false;
    if (!cleanupVerified) {
      return await withManifest({
        ok: false,
        skipped: false,
        status,
        run_id: runId,
        reason: "smoke_window_cleanup_failed",
        detail: `smoke window ${target.id} still visible to AeroSpace after cleanup`,
        cleanup,
        cleanup_verified: false,
      });
    }

    return await withManifest({
      ok: true,
      skipped: false,
      status,
      run_id: runId,
      target_window_id: target.id,
      target_title: target.title,
      original_workspace: target.workspace,
      scratch_workspace: targetScratchWorkspace,
      restored_workspace: restoredTarget.workspace,
      non_test_window_count: baseline.size,
      non_test_changed_windows: [],
      force_floating_proof: forceFloatingProof,
      commands,
      cleanup,
      cleanup_verified: true,
    });
  } catch (error) {
    cleanup = handle ? await handle.cleanup() : cleanup;
    const cleanupVerified =
      cleanup.ok && smokeWindowId !== undefined
        ? await waitForWindowGone(controller, smokeWindowId, { timeoutMs: waitTimeoutMs, pollIntervalMs })
        : false;
    return await withManifest({
      ok: false,
      skipped: false,
      status,
      run_id: runId,
      reason: "isolated_smoke_failed",
      detail: error instanceof Error ? error.message : String(error),
      cleanup,
      cleanup_verified: cleanupVerified,
    });
  }
}

async function executeCommands(controller: WorkspaceController, commands: AerospaceCommand[]): Promise<void> {
  if (!controller.executeRestorePlan) {
    throw new Error("workspace controller cannot execute restore plan");
  }
  await controller.executeRestorePlan({ commands, skipped: [] });
}

async function executeSmokeWindowCommand(
  controller: WorkspaceController,
  input: {
    target: AerospaceWindow;
    handle: SmokeWindowHandle;
    baseline: Map<number, AerospaceWindow>;
    waitTimeoutMs: number;
    pollIntervalMs: number;
    buildCommand: (windowId: number) => AerospaceCommand;
  },
): Promise<{ target: AerospaceWindow; command: AerospaceCommand }> {
  const firstCommand = input.buildCommand(input.target.id);
  assertOnlyTargetsSmokeWindow([firstCommand], input.target.id);
  try {
    await executeCommands(controller, [firstCommand]);
    return { target: input.target, command: firstCommand };
  } catch (error) {
    if (!isInvalidAerospaceWindowIdError(error)) throw error;
    const replacement = await waitForSmokeWindow(controller, input.handle.title, {
      timeoutMs: input.waitTimeoutMs,
      pollIntervalMs: input.pollIntervalMs,
      excludedWindowIds: input.baseline,
      fallbackAppName: input.handle.appName,
    });
    const retryCommand = input.buildCommand(replacement.target.id);
    assertOnlyTargetsSmokeWindow([retryCommand], replacement.target.id);
    await executeCommands(controller, [retryCommand]);
    return { target: replacement.target, command: retryCommand };
  }
}

async function waitForSmokeWindow(
  controller: WorkspaceController,
  title: string,
  options: { timeoutMs: number; pollIntervalMs: number; excludedWindowIds: Map<number, AerospaceWindow>; fallbackAppName?: string },
): Promise<{ snapshot: WorkspaceSnapshot; target: AerospaceWindow }> {
  const deadline = Date.now() + options.timeoutMs;
  let lastTitles = "";
  let lastFallbackCandidates: AerospaceWindow[] = [];
  while (Date.now() < deadline) {
    const snapshot = await controller.capture();
    const target = snapshot.windows.find((window) => !options.excludedWindowIds.has(window.id) && titleMatches(window, title));
    if (target) {
      return { snapshot, target };
    }
    if (options.fallbackAppName) {
      lastFallbackCandidates = snapshot.windows.filter((window) => !options.excludedWindowIds.has(window.id) && window.app === options.fallbackAppName);
      if (lastFallbackCandidates.length === 1) {
        return { snapshot, target: lastFallbackCandidates[0] };
      }
    }
    lastTitles = snapshot.windows.map((window) => window.title).filter(Boolean).join(", ");
    await sleep(options.pollIntervalMs);
  }
  const fallbackDetail = options.fallbackAppName
    ? ` New ${options.fallbackAppName} candidates: ${JSON.stringify(lastFallbackCandidates.map((window) => ({ id: window.id, title: window.title, workspace: window.workspace })))}`
    : "";
  throw new Error(`timed out waiting for smoke window "${title}". Captured titles: ${lastTitles}.${fallbackDetail}`);
}

async function waitForWindowGone(
  controller: WorkspaceController,
  windowId: number,
  options: { timeoutMs: number; pollIntervalMs: number },
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await controller.capture();
    if (!snapshot.windows.some((window) => window.id === windowId)) {
      return true;
    }
    await sleep(options.pollIntervalMs);
  }
  return false;
}

function baselineWindowMap(windows: AerospaceWindow[]): Map<number, AerospaceWindow> {
  return new Map(windows.map((window) => [window.id, { ...window }]));
}

function changedNonTestWindows(
  baseline: Map<number, AerospaceWindow>,
  currentWindows: AerospaceWindow[],
  smokeWindowId: number,
): NonTestWindowChange[] {
  const current = new Map(currentWindows.map((window) => [window.id, window]));
  const changes: NonTestWindowChange[] = [];
  for (const [windowId, before] of baseline) {
    if (windowId === smokeWindowId) {
      continue;
    }
    const after = current.get(windowId);
    if (after && after.workspace !== before.workspace) {
      changes.push({
        window_id: windowId,
        app: before.app,
        title: before.title,
        before_workspace: before.workspace,
        after_workspace: after.workspace,
      });
    }
  }
  return changes;
}

async function failWithCleanup(input: {
  runId: string;
  reason: string;
  detail: string;
  changes: NonTestWindowChange[];
  handle: SmokeWindowHandle;
  status: WorkspaceCapabilityStatus;
  controller: WorkspaceController;
  smokeWindowId: number;
  waitTimeoutMs: number;
  pollIntervalMs: number;
}): Promise<IsolatedAerospaceSmokeResult> {
  const cleanup = await input.handle.cleanup();
  return {
    ok: false,
    skipped: false,
    status: input.status,
    run_id: input.runId,
    reason: input.reason,
    detail: input.detail,
    non_test_changed_windows: input.changes,
    cleanup,
    cleanup_verified: cleanup.ok
      ? await waitForWindowGone(input.controller, input.smokeWindowId, {
          timeoutMs: input.waitTimeoutMs,
          pollIntervalMs: input.pollIntervalMs,
        })
      : false,
  };
}

async function writeResultManifest<Result extends IsolatedAerospaceSmokeResult>(
  result: Result,
  manifestPath?: string,
  artifactDir?: string,
): Promise<Result> {
  if (!manifestPath || !artifactDir || result.skipped) {
    return result;
  }
  await mkdir(artifactDir, { recursive: true });
  const resultWithManifest = {
    ...result,
    artifact_dir: artifactDir,
    manifest_path: manifestPath,
  };
  await writeFile(manifestPath, `${JSON.stringify(resultWithManifest, null, 2)}\n`, "utf8");
  return resultWithManifest as Result;
}

function assertOnlyTargetsSmokeWindow(commands: AerospaceCommand[], smokeWindowId: number): void {
  for (const command of commands) {
    if (command.command !== "aerospace") {
      throw new Error(`isolated proof refused non-AeroSpace command: ${command.command}`);
    }
    const [subcommand, flag, windowId] = command.args;
    const isSafeMove = subcommand === "move-node-to-workspace" && flag === "--window-id" && Number(windowId) === smokeWindowId;
    const isSafeLayout =
      subcommand === "layout" &&
      flag === "--window-id" &&
      Number(windowId) === smokeWindowId &&
      ["h_tiles", "v_tiles", "h_accordion", "v_accordion", "tiles", "accordion", "floating"].includes(command.args[3] ?? "");
    if (!isSafeMove && !isSafeLayout) {
      throw new Error(`isolated proof refused command outside smoke window ${smokeWindowId}: ${command.args.join(" ")}`);
    }
  }
}

async function readAerospaceWindowLayout(exec: ExecFunction, windowId: number): Promise<string | undefined> {
  const result = await exec("aerospace", ["list-windows", "--all", "--json", "--format", "%{window-id}%{window-layout}"]);
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("aerospace window layout response must be an array");
  }
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record["window-id"] === windowId || record.window_id === windowId || record.id === windowId) {
        const layout = record["window-layout"] ?? record.window_layout ?? record.layout;
        return typeof layout === "string" ? layout : undefined;
      }
    }
  }
  return undefined;
}

function isNonTilingLayoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("The window is non-tiling") || (
    /^Command failed: aerospace layout --window-id \d+ .*\nexit: 2$/m.test(message)
    && !isInvalidAerospaceWindowIdError(error)
  );
}

function isInvalidAerospaceWindowIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Invalid <window-id> \d+ passed to --window-id/.test(message);
}

async function launchDefaultSmokeWindow(runId: string): Promise<SmokeWindowHandle> {
  const requestedApp = process.env.EVENTLOOPOS_ISOLATED_AEROSPACE_SMOKE_APP?.trim().toLowerCase();
  if (requestedApp === "native" || requestedApp === "swift") {
    return await launchNativeSmokeWindow(runId);
  }
  if (requestedApp === "textedit") {
    return await launchTextEditSmokeWindow(runId);
  }
  if (requestedApp === "ghostty") {
    return await launchGhosttySmokeWindow(runId);
  }
  if (requestedApp && requestedApp !== "auto") {
    throw new Error(`unsupported isolated AeroSpace smoke app: ${requestedApp}`);
  }
  if (await canRunCommand("swiftc", ["--version"])) {
    return await launchNativeSmokeWindow(runId);
  }
  if (await canOpenApp("Ghostty")) {
    return await launchGhosttySmokeWindow(runId);
  }
  return await launchTextEditSmokeWindow(runId);
}

async function canRunCommand(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function canOpenApp(appName: string): Promise<boolean> {
  try {
    await execFileAsync("open", ["-Ra", appName], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function launchGhosttySmokeWindow(runId: string): Promise<SmokeWindowHandle> {
  const dir = await mkdtemp(join(tmpdir(), "eventloopos-isolated-aerospace-"));
  const title = `eventloopOS-isolated-smoke-${runId}`;
  const scriptPath = join(dir, "ghostty-smoke.zsh");
  await writeFile(
    scriptPath,
    [
      "#!/bin/zsh",
      `printf '\\033]0;${escapeShellSingleQuoted(title)}\\007'`,
      "while true; do sleep 60; done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  await execFileAsync("open", ["-F", "-na", "Ghostty", "--args", "-e", scriptPath], { timeout: 5_000 });

  return {
    title,
    appName: "Ghostty",
    cleanup: async () => {
      try {
        await execFileAsync("pkill", ["-f", scriptPath], { timeout: 5_000 });
      } catch {
        // Process may already be gone.
      }
      try {
        await rm(dir, { recursive: true, force: true });
        return { attempted: true, ok: true };
      } catch (error) {
        return {
          attempted: true,
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function launchTextEditSmokeWindow(runId: string): Promise<SmokeWindowHandle> {
  const dir = await mkdtemp(join(tmpdir(), "eventloopos-isolated-aerospace-"));
  const fileName = `eventloopOS-isolated-smoke-${runId}.txt`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, `eventloopOS isolated AeroSpace smoke ${runId}\n`, "utf8");
  await execFileAsync("open", ["-a", "TextEdit", filePath], { timeout: 5_000 });

  return {
    title: fileName,
    appName: "TextEdit",
    cleanup: async () => {
      try {
        await execFileAsync(
          "osascript",
          ["-e", `tell application "TextEdit" to close (documents whose name is "${escapeAppleScriptString(fileName)}") saving no`],
          { timeout: 5_000 },
        );
        await rm(dir, { recursive: true, force: true });
        return { attempted: true, ok: true };
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        return {
          attempted: true,
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function launchNativeSmokeWindow(runId: string): Promise<SmokeWindowHandle> {
  const dir = await mkdtemp(join(tmpdir(), "eventloopos-isolated-aerospace-"));
  const title = `eventloopOS-isolated-smoke-${runId}`;
  const appName = "eventloopOS Smoke Window";
  const appBundle = join(dir, `${appName}.app`);
  const contentsDir = join(appBundle, "Contents");
  const macosDir = join(contentsDir, "MacOS");
  const sourcePath = join(dir, "SmokeWindow.swift");
  const binaryPath = join(macosDir, "eventloopos-aerospace-smoke");
  await mkdir(macosDir, { recursive: true });
  await writeFile(sourcePath, nativeSmokeWindowSource(title), "utf8");
  await writeFile(join(contentsDir, "Info.plist"), nativeSmokeWindowInfoPlist(appName, runId), "utf8");
  await execFileAsync("swiftc", [sourcePath, "-o", binaryPath], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  await execFileAsync("open", ["-n", appBundle], { timeout: 5_000 });

  return {
    title,
    appName,
    cleanup: async () => await cleanupNativeSmokeWindow(binaryPath, dir),
  };
}

async function cleanupNativeSmokeWindow(binaryPath: string, dir: string): Promise<SmokeWindowCleanupResult> {
  try {
    try {
      await execFileAsync("pkill", ["-TERM", "-f", binaryPath], { timeout: 2_000 });
    } catch {
      // Process may already be gone.
    }
    await rm(dir, { recursive: true, force: true });
    return { attempted: true, ok: true };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    return {
      attempted: true,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function nativeSmokeWindowSource(title: string): string {
  return `
import AppKit

final class SmokeDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let frame = NSRect(x: 120, y: 120, width: 640, height: 360)
    let style: NSWindow.StyleMask = [.titled, .closable, .resizable, .miniaturizable]
    let window = NSWindow(contentRect: frame, styleMask: style, backing: .buffered, defer: false)
    window.title = ${JSON.stringify(title)}
    window.isReleasedWhenClosed = false
    window.center()
    window.makeKeyAndOrderFront(nil)
    self.window = window
    NSApp.activate(ignoringOtherApps: true)
  }
}

let app = NSApplication.shared
let delegate = SmokeDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
`;
}

function nativeSmokeWindowInfoPlist(appName: string, runId: string): string {
  const bundleId = `dev.eventloopos.aerospace-smoke.${runId.replace(/[^A-Za-z0-9-]/g, "-")}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>eventloopos-aerospace-smoke</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
</dict>
</plist>
`;
}

function titleMatches(window: AerospaceWindow, title: string): boolean {
  return window.title === title || window.title.includes(title);
}

function findWindow(windows: AerospaceWindow[], windowId: number): AerospaceWindow | undefined {
  return windows.find((window) => window.id === windowId);
}

async function execAerospace(command: string, args: string[]): Promise<{ stdout: string; stderr?: string }> {
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(command, args, {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    throw new Error(formatExecError(command, args, error));
  }

  return {
    stdout,
    stderr,
  };
}

function maybeInjectAerospaceRestoreFailure(exec: ExecFunction): ExecFunction {
  if (process.env.EVENTLOOPOS_INJECT_AEROSPACE_RESTORE_FAILURE !== "1") {
    return exec;
  }

  let moveNodeToWorkspaceCount = 0;
  return async (command, args) => {
    if (command === "aerospace" && args[0] === "move-node-to-workspace") {
      moveNodeToWorkspaceCount += 1;
      if (moveNodeToWorkspaceCount >= 2) {
        throw new Error(
          "AeroSpace server unavailable during restore: injected lab fault. Restart AeroSpace, grant Accessibility, then rerun workspace restore proof.",
        );
      }
    }
    return await exec(command, args);
  };
}

function formatExecError(command: string, args: string[], error: unknown): string {
  const parts = [`Command failed: ${[command, ...args].join(" ")}`];
  if (isExecError(error)) {
    if (typeof error.code === "number" || typeof error.code === "string") parts.push(`exit: ${error.code}`);
    if (typeof error.signal === "string") parts.push(`signal: ${error.signal}`);
    if (typeof error.stdout === "string" && error.stdout.trim()) parts.push(`stdout: ${error.stdout.trim()}`);
    if (typeof error.stderr === "string" && error.stderr.trim()) parts.push(`stderr: ${error.stderr.trim()}`);
  } else if (error instanceof Error && error.message) {
    parts.push(error.message);
  } else {
    parts.push(String(error));
  }
  return parts.join("\n");
}

function isExecError(error: unknown): error is {
  code?: number | string;
  signal?: string;
  stdout?: string;
  stderr?: string;
} {
  return typeof error === "object" && error !== null;
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeShellSingleQuoted(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function defaultRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

function defaultArtifactDir(runId: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), "artifacts", "live-aerospace-isolated", runId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const runId = defaultRunId();
  const result = await runIsolatedAerospaceSmoke({
    enabled: process.env.EVENTLOOPOS_ENABLE_ISOLATED_AEROSPACE === "1",
    scratchWorkspace: process.env.EVENTLOOPOS_AEROSPACE_SMOKE_WORKSPACE,
    runId,
    artifactDir: process.env.EVENTLOOPOS_ISOLATED_AEROSPACE_ARTIFACT_DIR ?? defaultArtifactDir(runId),
    proveForceFloating: process.env.EVENTLOOPOS_PROVE_FORCE_FLOATING !== "0",
    exec: maybeInjectAerospaceRestoreFailure(execAerospace),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
