import {
  AerospaceWorkspaceAdapter,
  parseAerospaceWindows,
  restoreWorkspaceResidualPlan,
  restoreWorkspacePlan,
  type AerospaceWindow,
  type ExecFunction,
  type RestoreExecutionReceipt,
  type RestorePlan,
  type WorkspaceCaptureOptions,
  type WorkspaceCapabilityStatus,
  type WorkspaceFrameCaptureStatus,
  type WorkspaceSnapshot,
} from "./aerospace.js";

export type WorkspaceController = {
  status(): Promise<WorkspaceCapabilityStatus> | WorkspaceCapabilityStatus;
  capture(options?: WorkspaceCaptureOptions): Promise<WorkspaceSnapshot> | WorkspaceSnapshot;
  planRestore(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<RestorePlan> | RestorePlan;
  executeRestorePlan?(plan: RestorePlan): Promise<RestoreExecutionReceipt> | RestoreExecutionReceipt;
  executeRestorePlanVerified?(
    snapshot: WorkspaceSnapshot,
    currentWindows?: AerospaceWindow[],
  ): Promise<VerifiedRestoreExecution> | VerifiedRestoreExecution;
};

export type VerifiedRestoreExecution = {
  plan: RestorePlan;
  receipt: RestoreExecutionReceipt;
  attempts: number;
  verified: boolean;
  residualPlan?: RestorePlan;
};

export class AerospaceWorkspaceController implements WorkspaceController {
  private readonly adapter: AerospaceWorkspaceAdapter;
  private readonly restoreVerifySettleMs: number;
  private readonly restoreVerifyRetries: number;

  constructor(exec: ExecFunction, options: { restoreVerifySettleMs?: number; restoreVerifyRetries?: number } = {}) {
    this.adapter = new AerospaceWorkspaceAdapter(exec);
    this.restoreVerifySettleMs = options.restoreVerifySettleMs ?? 350;
    this.restoreVerifyRetries = options.restoreVerifyRetries ?? 4;
  }

  async status(): Promise<WorkspaceCapabilityStatus> {
    return await this.adapter.capabilityStatus();
  }

  async capture(options: WorkspaceCaptureOptions = {}): Promise<WorkspaceSnapshot> {
    return await this.adapter.capture(options);
  }

  async planRestore(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<RestorePlan> {
    const windows = currentWindows ?? (await this.adapter.capture({ captureFrames: false })).windows;
    return restoreWorkspacePlan(snapshot, windows);
  }

  async executeRestorePlan(plan: RestorePlan): Promise<RestoreExecutionReceipt> {
    return await this.adapter.executeRestorePlan(plan);
  }

  async executeRestorePlanVerified(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<VerifiedRestoreExecution> {
    const plan = await this.planRestore(snapshot, currentWindows);
    let receipt = await this.executeRestorePlan(plan);
    let attempts = plan.commands.length > 0 ? 1 : 0;
    let residualPlan = await this.verifyRestorePlan(snapshot);

    for (let retry = 0; hasRestoreResidual(residualPlan) && retry < this.restoreVerifyRetries; retry += 1) {
      await sleep(this.restoreVerifySettleMs);
      if (residualPlan.commands.length > 0) {
        const retryReceipt = await this.executeRestorePlan(residualPlan);
        receipt = mergeRestoreReceipts(receipt, retryReceipt);
        attempts += 1;
      }
      residualPlan = await this.verifyRestorePlan(snapshot);
    }

    return {
      plan,
      receipt,
      attempts,
      verified: residualPlan.commands.length === 0 && residualPlan.skipped.length === 0,
      residualPlan: residualPlan.commands.length === 0 && residualPlan.skipped.length === 0 ? undefined : residualPlan,
    };
  }

  private async verifyRestorePlan(snapshot: WorkspaceSnapshot): Promise<RestorePlan> {
    await sleep(this.restoreVerifySettleMs);
    const frameWindowIds = snapshot.windows
      .filter((window) => window.frame !== undefined)
      .map((window) => window.id);
    return restoreWorkspaceResidualPlan(snapshot, await this.adapter.capture({
      frameWindowIds,
      focusFrameWorkspaces: true,
      restoreFrameCaptureFocus: true,
    }));
  }
}

function hasRestoreResidual(plan: RestorePlan): boolean {
  return plan.commands.length > 0 || plan.skipped.length > 0;
}

function mergeRestoreReceipts(left: RestoreExecutionReceipt, right: RestoreExecutionReceipt): RestoreExecutionReceipt {
  return {
    commands: [...left.commands, ...right.commands],
    skipped: [...left.skipped, ...right.skipped],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseWorkspaceSnapshot(input: unknown): WorkspaceSnapshot {
  if (!isRecord(input)) {
    throw new Error("workspace snapshot must be an object");
  }
  const backend = readWorkspaceBackend(input.backend);

  return {
    backend,
    windows: parseAerospaceWindows(input.windows),
    activeWorkspace: readOptionalString(input, "activeWorkspace", "active_workspace"),
    focusedWindowId: readOptionalInteger(input, "focusedWindowId", "focused_window_id"),
    frameCapture: readOptionalFrameCapture(input),
  };
}

export function parseWorkspaceCaptureRequest(input: unknown): WorkspaceCaptureOptions {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new Error("workspace capture request must be an object");
  }

  return {
    captureFrames: readOptionalBoolean(input, "captureFrames", "capture_frames"),
    frameWindowIds: readOptionalIntegerArray(input, "frameWindowIds", "frame_window_ids"),
    focusFrameWorkspaces: readOptionalBoolean(input, "focusFrameWorkspaces", "focus_frame_workspaces"),
    restoreFrameCaptureFocus: readOptionalBoolean(input, "restoreFrameCaptureFocus", "restore_frame_capture_focus"),
  };
}

export function readWorkspaceBackend(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("workspace snapshot backend must be a non-empty string");
  }
  const backend = value.trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(backend)) {
    throw new Error(`unsafe workspace backend: ${backend}`);
  }
  return backend;
}

export function parseRestorePlanRequest(input: unknown): {
  snapshot: WorkspaceSnapshot;
  currentWindows?: AerospaceWindow[];
} {
  if (!isRecord(input)) {
    throw new Error("workspace restore-plan request must be an object");
  }

  const snapshot = parseWorkspaceSnapshot(input.snapshot);
  const currentWindows = input.current_windows === undefined ? undefined : parseAerospaceWindows(input.current_windows);

  return {
    snapshot,
    currentWindows,
  };
}

export function parseRestoreExecuteRequest(input: unknown): {
  snapshot: WorkspaceSnapshot;
  currentWindows?: AerospaceWindow[];
} {
  if (!isRecord(input)) {
    throw new Error("workspace restore request must be an object");
  }
  if (input.confirm_execute !== true) {
    throw new Error("workspace restore requires confirm_execute true");
  }

  return parseRestorePlanRequest(input);
}

function readOptionalString(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function readOptionalInteger(input: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

function readOptionalIntegerArray(input: Record<string, unknown>, ...keys: string[]): number[] | undefined {
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isInteger(item))) {
      throw new Error(`${key} must be an array of integer window ids`);
    }
    return value;
  }
  return undefined;
}

function readOptionalBoolean(input: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
    return value;
  }
  return undefined;
}

function readOptionalFrameCapture(input: Record<string, unknown>): WorkspaceFrameCaptureStatus | undefined {
  const value = input.frameCapture ?? input.frame_capture;
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("workspace frame capture status must be an object");
  }

  const status = value.status;
  const timeoutMs = value.timeoutMs ?? value.timeout_ms;
  const observed = value.observed;
  const error = value.error;

  if (status !== "captured" && status !== "failed" && status !== "skipped") {
    throw new Error("workspace frame capture status must be captured, failed, or skipped");
  }
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error("workspace frame capture timeoutMs must be a non-negative integer");
  }
  if (typeof observed !== "number" || !Number.isInteger(observed) || observed < 0) {
    throw new Error("workspace frame capture observed must be a non-negative integer");
  }
  if (error !== undefined && typeof error !== "string") {
    throw new Error("workspace frame capture error must be a string");
  }

  return {
    status,
    timeoutMs,
    observed,
    error,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
