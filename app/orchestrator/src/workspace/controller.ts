import {
  AerospaceWorkspaceAdapter,
  parseAerospaceWindows,
  restoreWorkspacePlan,
  type AerospaceWindow,
  type ExecFunction,
  type RestorePlan,
  type WorkspaceCapabilityStatus,
  type WorkspaceSnapshot,
} from "./aerospace.js";

export type WorkspaceController = {
  status(): Promise<WorkspaceCapabilityStatus> | WorkspaceCapabilityStatus;
  capture(): Promise<WorkspaceSnapshot> | WorkspaceSnapshot;
  planRestore(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<RestorePlan> | RestorePlan;
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
}

export function parseWorkspaceSnapshot(input: unknown): WorkspaceSnapshot {
  if (!isRecord(input)) {
    throw new Error("workspace snapshot must be an object");
  }
  if (input.backend !== "aerospace") {
    throw new Error("workspace snapshot backend must be aerospace");
  }

  return {
    backend: "aerospace",
    windows: parseAerospaceWindows(input.windows),
    activeWorkspace: readOptionalString(input, "activeWorkspace", "active_workspace"),
    focusedWindowId: readOptionalInteger(input, "focusedWindowId", "focused_window_id"),
  };
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
