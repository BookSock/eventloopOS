export type ExecResult = {
  stdout: string;
  stderr?: string;
};

export type ExecFunction = (command: string, args: string[]) => Promise<ExecResult>;

export type AerospaceCommand = {
  command: "aerospace";
  args: string[];
};

export type WorkspaceCapabilityStatus =
  | {
      available: true;
      backend: "aerospace";
      reason?: undefined;
      detail?: string;
    }
  | {
      available: false;
      backend: "aerospace";
      reason: "binary_missing" | "permission_denied" | "server_unavailable" | "invalid_response" | "unknown_error";
      detail?: string;
    };

export type AerospaceWindow = {
  id: number;
  app: string;
  title: string;
  workspace: string;
  monitorId?: number;
  pid?: number;
};

export type WorkspaceSnapshot = {
  backend: "aerospace";
  windows: AerospaceWindow[];
  activeWorkspace?: string;
  focusedWindowId?: number;
};

export type RestorePlan = {
  commands: AerospaceCommand[];
  skipped: RestoreSkip[];
};

export type RestoreExecutionReceipt = {
  commands: Array<AerospaceCommand & ExecResult>;
  skipped: RestoreSkip[];
};

export type RestoreSkip = {
  reason: "stale_window_id";
  windowId: number;
  workspace: string;
};

export class AerospaceWorkspaceAdapter {
  readonly backend = "aerospace" as const;

  constructor(private readonly exec: ExecFunction) {}

  async capabilityStatus(): Promise<WorkspaceCapabilityStatus> {
    try {
      const result = await this.exec("aerospace", captureWorkspacePlan().args);
      parseAerospaceWindows(result.stdout);

      return {
        available: true,
        backend: this.backend,
      };
    } catch (error) {
      return capabilityStatusFromError(error);
    }
  }

  async capture(): Promise<WorkspaceSnapshot> {
    const result = await this.exec("aerospace", captureWorkspacePlan().args);

    return {
      backend: this.backend,
      windows: parseAerospaceWindows(result.stdout),
    };
  }

  async executeRestorePlan(plan: RestorePlan): Promise<RestoreExecutionReceipt> {
    const commands: RestoreExecutionReceipt["commands"] = [];
    for (const command of plan.commands) {
      assertSafeAerospaceCommand(command);
      const result = await this.exec(command.command, command.args);
      commands.push({ ...command, ...result });
    }

    return {
      commands,
      skipped: plan.skipped,
    };
  }
}

export function captureWorkspacePlan(): AerospaceCommand {
  return {
    command: "aerospace",
    args: ["list-windows", "--all", "--json"],
  };
}

export function moveToWorkspacePlan(windowId: number, workspace: string): AerospaceCommand {
  assertSafeWindowId(windowId);
  assertSafeWorkspace(workspace);

  return {
    command: "aerospace",
    args: ["move-node-to-workspace", "--window-id", String(windowId), workspace],
  };
}

export function focusWindowPlan(windowId: number): AerospaceCommand {
  assertSafeWindowId(windowId);

  return {
    command: "aerospace",
    args: ["focus", "--window-id", String(windowId)],
  };
}

export function focusWorkspacePlan(workspace: string): AerospaceCommand {
  assertSafeWorkspace(workspace);

  return {
    command: "aerospace",
    args: ["workspace", workspace],
  };
}

export function restoreWorkspacePlan(snapshot: WorkspaceSnapshot, currentWindows: AerospaceWindow[]): RestorePlan {
  const currentWindowIds = new Set(currentWindows.map((window) => window.id));
  const commands: AerospaceCommand[] = [];
  const skipped: RestoreSkip[] = [];

  for (const window of snapshot.windows) {
    if (!currentWindowIds.has(window.id)) {
      skipped.push({
        reason: "stale_window_id",
        windowId: window.id,
        workspace: window.workspace,
      });
      continue;
    }

    commands.push(moveToWorkspacePlan(window.id, window.workspace));
  }

  if (snapshot.activeWorkspace !== undefined) {
    commands.push(focusWorkspacePlan(snapshot.activeWorkspace));
  }

  if (snapshot.focusedWindowId !== undefined && currentWindowIds.has(snapshot.focusedWindowId)) {
    commands.push(focusWindowPlan(snapshot.focusedWindowId));
  }

  return {
    commands,
    skipped,
  };
}

export function parseAerospaceWindows(json: string | unknown): AerospaceWindow[] {
  const parsed = typeof json === "string" ? parseJson(json) : json;

  if (!Array.isArray(parsed)) {
    throw new Error("aerospace list-windows --json response must be an array");
  }

  return parsed.map((item, index) => parseWindow(item, index)).sort((left, right) => left.id - right.id);
}

function parseWindow(item: unknown, index: number): AerospaceWindow {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`aerospace window at index ${index} must be an object`);
  }

  const record = item as Record<string, unknown>;
  const id = readRequiredNumber(record, ["window-id", "window_id", "id"], index);
  const workspace = readRequiredString(record, ["workspace"], index);

  assertSafeWindowId(id);
  assertSafeWorkspace(workspace);

  return {
    id,
    app: readOptionalString(record, ["app-name", "app_name", "app"]) ?? "",
    title: readOptionalString(record, ["window-title", "window_title", "title"]) ?? "",
    workspace,
    monitorId: readOptionalNumber(record, ["monitor-id", "monitor_id"]),
    pid: readOptionalNumber(record, ["app-pid", "app_pid", "pid"]),
  };
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`invalid aerospace JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRequiredNumber(record: Record<string, unknown>, keys: string[], index: number): number {
  const value = readByKeys(record, keys);

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`aerospace window at index ${index} missing numeric ${keys[0]}`);
  }

  return value;
}

function readOptionalNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readByKeys(record, keys);

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function readRequiredString(record: Record<string, unknown>, keys: string[], index: number): string {
  const value = readByKeys(record, keys);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`aerospace window at index ${index} missing string ${keys[0]}`);
  }

  return value;
}

function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readByKeys(record, keys);

  return typeof value === "string" ? value : undefined;
}

function readByKeys(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function assertSafeWindowId(windowId: number): void {
  if (!Number.isInteger(windowId) || windowId <= 0) {
    throw new Error(`unsafe aerospace window id: ${windowId}`);
  }
}

function assertSafeWorkspace(workspace: string): void {
  if (!/^[A-Za-z0-9._:-]+$/.test(workspace)) {
    throw new Error(`unsafe aerospace workspace: ${workspace}`);
  }
}

function assertSafeAerospaceCommand(command: AerospaceCommand): void {
  if (command.command !== "aerospace") {
    throw new Error(`unsafe aerospace command: ${command.command}`);
  }

  const [subcommand, ...rest] = command.args;
  if (subcommand === "workspace" && rest.length === 1) {
    assertSafeWorkspace(rest[0] ?? "");
    return;
  }
  if (subcommand === "focus" && rest.length === 2 && rest[0] === "--window-id") {
    assertSafeWindowId(Number(rest[1]));
    return;
  }
  if (subcommand === "move-node-to-workspace" && rest.length === 3 && rest[0] === "--window-id") {
    assertSafeWindowId(Number(rest[1]));
    assertSafeWorkspace(rest[2] ?? "");
    return;
  }

  throw new Error(`unsafe aerospace args: ${command.args.join(" ")}`);
}

function capabilityStatusFromError(error: unknown): WorkspaceCapabilityStatus {
  const code = readErrorCode(error);
  const detail = error instanceof Error ? error.message : String(error);

  if (code === "ENOENT") {
    return {
      available: false,
      backend: "aerospace",
      reason: "binary_missing",
      detail,
    };
  }

  if (code === "EACCES" || /permission denied/i.test(detail)) {
    return {
      available: false,
      backend: "aerospace",
      reason: "permission_denied",
      detail,
    };
  }

  if (/can't connect to aerospace server|socket/i.test(detail)) {
    return {
      available: false,
      backend: "aerospace",
      reason: "server_unavailable",
      detail,
    };
  }

  if (/aerospace|json|response|window/i.test(detail)) {
    return {
      available: false,
      backend: "aerospace",
      reason: "invalid_response",
      detail,
    };
  }

  return {
    available: false,
    backend: "aerospace",
    reason: "unknown_error",
    detail,
  };
}

function readErrorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
