import {
  AerospaceWorkspaceAdapter,
  parseAerospaceWindows,
  restoreWorkspacePlan,
  type AerospaceWindow,
  type ExecFunction,
  type RestoreExecutionReceipt,
  type RestorePlan,
  type WorkspaceCapabilityStatus,
  type WorkspaceSnapshot,
} from "./aerospace.js";

export type WorkspaceController = {
  status(): Promise<WorkspaceCapabilityStatus> | WorkspaceCapabilityStatus;
  capture(): Promise<WorkspaceSnapshot> | WorkspaceSnapshot;
  planRestore(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<RestorePlan> | RestorePlan;
  executeRestorePlan?(plan: RestorePlan): Promise<RestoreExecutionReceipt> | RestoreExecutionReceipt;
};

export class AerospaceWorkspaceController implements WorkspaceController {
  private readonly adapter: AerospaceWorkspaceAdapter;

  constructor(exec: ExecFunction) {
    this.adapter = new AerospaceWorkspaceAdapter(exec);
  }

  async status(): Promise<WorkspaceCapabilityStatus> {
    return await this.adapter.capabilityStatus();
  }

  async capture(): Promise<WorkspaceSnapshot> {
    return await this.adapter.capture();
  }

  async planRestore(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<RestorePlan> {
    const windows = currentWindows ?? (await this.adapter.capture()).windows;
    return restoreWorkspacePlan(snapshot, windows);
  }

  async executeRestorePlan(plan: RestorePlan): Promise<RestoreExecutionReceipt> {
    return await this.adapter.executeRestorePlan(plan);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
