export type ExecResult = {
  stdout: string;
  stderr?: string;
};

export type ExecFunction = (command: string, args: string[]) => Promise<ExecResult>;

export type AerospaceCommand =
  | {
      command: "aerospace";
      args: string[];
    }
  | {
      command: "osascript";
      args: string[];
    };

export const AEROSPACE_WINDOW_CAPTURE_FORMAT =
  "%{window-id}%{app-name}%{app-bundle-id}%{window-title}%{workspace}%{monitor-id}%{app-pid}%{window-layout}";

export type WorkspaceCapabilityStatus =
  | {
      available: true;
      backend: "aerospace";
      reason?: undefined;
      detail?: string;
      monitorCount?: number;
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
  appBundleId?: string;
  layout?: AerospaceLayout;
  frame?: WindowFrame;
};

export type WindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
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
      const windows = parseAerospaceWindows(result.stdout);

      return {
        available: true,
        backend: this.backend,
        monitorCount: countDistinctMonitors(windows),
      };
    } catch (error) {
      return capabilityStatusFromError(error);
    }
  }

  async capture(): Promise<WorkspaceSnapshot> {
    const result = await this.exec("aerospace", captureWorkspacePlan().args);
    const activeWorkspace = await this.captureFocusedWorkspace().catch(() => undefined);
    const focusedWindowId = await this.captureFocusedWindowId().catch(() => undefined);
    const frames = await this.captureWindowFrames().catch(() => []);

    return {
      backend: this.backend,
      windows: attachWindowFrames(parseAerospaceWindows(result.stdout), frames),
      activeWorkspace,
      focusedWindowId,
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

  private async captureFocusedWorkspace(): Promise<string | undefined> {
    const result = await this.exec("aerospace", captureFocusedWorkspacePlan().args);
    const workspace = result.stdout.trim();
    return workspace.length > 0 ? workspace : undefined;
  }

  private async captureFocusedWindowId(): Promise<number | undefined> {
    const result = await this.exec("aerospace", captureFocusedWindowPlan().args);
    const focused = parseAerospaceWindows(result.stdout)[0];
    return focused?.id;
  }

  private async captureWindowFrames(): Promise<MacOSWindowFrameObservation[]> {
    const result = await this.exec("osascript", ["-e", captureWindowFramesAppleScript()]);
    return parseWindowFrameObservations(result.stdout);
  }
}

export function captureWorkspacePlan(): AerospaceCommand {
  return {
    command: "aerospace",
    args: ["list-windows", "--all", "--json", "--format", AEROSPACE_WINDOW_CAPTURE_FORMAT],
  };
}

export function captureFocusedWorkspacePlan(): AerospaceCommand {
  return {
    command: "aerospace",
    args: ["list-workspaces", "--focused"],
  };
}

export function captureFocusedWindowPlan(): AerospaceCommand {
  return {
    command: "aerospace",
    args: ["list-windows", "--focused", "--json", "--format", "%{window-id}%{workspace}"],
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

export function moveToMonitorPlan(windowId: number, monitorId: number): AerospaceCommand {
  assertSafeWindowId(windowId);
  assertSafeMonitorId(monitorId);

  return {
    command: "aerospace",
    args: ["move-node-to-monitor", "--window-id", String(windowId), String(monitorId)],
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

export type AerospaceLayout = "h_tiles" | "v_tiles" | "h_accordion" | "v_accordion" | "tiles" | "accordion" | "floating";

export function layoutWindowPlan(windowId: number, layout: AerospaceLayout): AerospaceCommand {
  assertSafeWindowId(windowId);
  assertSafeLayout(layout);

  return {
    command: "aerospace",
    args: ["layout", "--window-id", String(windowId), layout],
  };
}

export function restoreWindowFramePlan(window: AerospaceWindow): AerospaceCommand | undefined {
  if (!window.frame || !hasWindowIdentityForFrameRestore(window)) {
    return undefined;
  }
  assertSafeFrame(window.frame);
  return {
    command: "osascript",
    args: ["-e", restoreWindowFrameAppleScript(window)],
  };
}

export function restoreWorkspacePlan(snapshot: WorkspaceSnapshot, currentWindows: AerospaceWindow[]): RestorePlan {
  const currentWindowsById = new Map(currentWindows.map((window) => [window.id, window]));
  const commands: AerospaceCommand[] = [];
  const frameCommands: AerospaceCommand[] = [];
  const skipped: RestoreSkip[] = [];

  for (const window of snapshot.windows) {
    const current = currentWindowsById.get(window.id);
    if (!current) {
      skipped.push({
        reason: "stale_window_id",
        windowId: window.id,
        workspace: window.workspace,
      });
      continue;
    }

    if (
      typeof window.monitorId === "number" &&
      typeof current.monitorId === "number" &&
      window.monitorId !== current.monitorId
    ) {
      commands.push(moveToMonitorPlan(window.id, window.monitorId));
    }

    commands.push(moveToWorkspacePlan(window.id, window.workspace));
    if (window.layout !== undefined && window.layout !== current.layout) {
      commands.push(layoutWindowPlan(window.id, window.layout));
    } else if (window.frame !== undefined && current.layout !== "floating") {
      commands.push(layoutWindowPlan(window.id, "floating"));
    }
    const framePlan = restoreWindowFramePlan(window);
    if (framePlan) frameCommands.push(framePlan);
  }

  if (snapshot.activeWorkspace !== undefined) {
    commands.push(focusWorkspacePlan(snapshot.activeWorkspace));
  }

  commands.push(...frameCommands);

  if (snapshot.focusedWindowId !== undefined && currentWindowsById.has(snapshot.focusedWindowId)) {
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
    appBundleId: readOptionalString(record, ["app-bundle-id", "app_bundle_id"]),
    layout: readOptionalLayout(record, ["window-layout", "window_layout", "layout"]),
    frame: readOptionalFrame(record),
  };
}

export type MacOSWindowFrameObservation = {
  app: string;
  title: string;
  appBundleId?: string;
  frame: WindowFrame;
};

export function attachWindowFrames(
  windows: AerospaceWindow[],
  observations: MacOSWindowFrameObservation[],
): AerospaceWindow[] {
  const available = [...observations];
  return windows.map((window) => {
    const index = available.findIndex((candidate) => windowFrameObservationMatches(window, candidate));
    if (index < 0) return window;
    const [match] = available.splice(index, 1);
    return match ? { ...window, frame: match.frame } : window;
  });
}

export function parseWindowFrameObservations(stdout: string): MacOSWindowFrameObservation[] {
  const rows: MacOSWindowFrameObservation[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [app, appBundleId, title, x, y, width, height] = line.split("\t");
    const frame = {
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    };
    if (
      !app ||
      !title ||
      !Number.isInteger(frame.x) ||
      !Number.isInteger(frame.y) ||
      !Number.isInteger(frame.width) ||
      !Number.isInteger(frame.height)
    ) {
      continue;
    }
    rows.push({
      app,
      title,
      appBundleId: appBundleId || undefined,
      frame,
    });
  }
  return rows;
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

function readOptionalLayout(record: Record<string, unknown>, keys: string[]): AerospaceLayout | undefined {
  const value = readOptionalString(record, keys);
  if (value === undefined) return undefined;
  assertSafeLayout(value);
  return value;
}

function readOptionalFrame(record: Record<string, unknown>): WindowFrame | undefined {
  const raw = readByKeys(record, ["frame", "bounds"]);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const frame = raw as Record<string, unknown>;
  const x = readOptionalNumber(frame, ["x", "X"]);
  const y = readOptionalNumber(frame, ["y", "Y"]);
  const width = readOptionalNumber(frame, ["width", "Width", "w"]);
  const height = readOptionalNumber(frame, ["height", "Height", "h"]);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  const parsed = { x, y, width, height };
  assertSafeFrame(parsed);
  return parsed;
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

function assertSafeMonitorId(monitorId: number): void {
  if (!Number.isInteger(monitorId) || monitorId <= 0) {
    throw new Error(`unsafe aerospace monitor id: ${monitorId}`);
  }
}

function assertSafeFrame(frame: WindowFrame): void {
  for (const [key, value] of Object.entries(frame)) {
    if (!Number.isInteger(value)) {
      throw new Error(`unsafe window frame ${key}: ${value}`);
    }
  }
  if (frame.width <= 0 || frame.height <= 0) {
    throw new Error(`unsafe window frame size: ${frame.width}x${frame.height}`);
  }
  if (frame.width > 20_000 || frame.height > 20_000 || Math.abs(frame.x) > 50_000 || Math.abs(frame.y) > 50_000) {
    throw new Error(`unsafe window frame: ${JSON.stringify(frame)}`);
  }
}

function countDistinctMonitors(windows: AerospaceWindow[]): number {
  const monitors = new Set<number>();
  for (const window of windows) {
    if (typeof window.monitorId === "number") {
      monitors.add(window.monitorId);
    }
  }
  return monitors.size;
}

function assertSafeAerospaceCommand(command: AerospaceCommand): void {
  if (command.command === "osascript") {
    if (command.args.length !== 2 || command.args[0] !== "-e" || !command.args[1].includes("-- eventloopOS generated frame restore")) {
      throw new Error("unsafe osascript restore command");
    }
    return;
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
  if (subcommand === "move-node-to-monitor" && rest.length === 3 && rest[0] === "--window-id") {
    assertSafeWindowId(Number(rest[1]));
    assertSafeMonitorId(Number(rest[2]));
    return;
  }
  if (subcommand === "layout" && rest.length === 3 && rest[0] === "--window-id") {
    assertSafeWindowId(Number(rest[1]));
    assertSafeLayout(rest[2] ?? "");
    return;
  }

  throw new Error(`unsafe aerospace args: ${command.args.join(" ")}`);
}

function captureWindowFramesAppleScript(): string {
  return `
set outputRows to {}
tell application "System Events"
  repeat with candidateProcess in (application processes whose visible is true)
    try
      set appName to name of candidateProcess as text
      set bundleId to bundle identifier of candidateProcess as text
      repeat with candidateWindow in windows of candidateProcess
        try
          set windowName to name of candidateWindow as text
          if windowName is not "" then
            set windowPosition to position of candidateWindow
            set windowSize to size of candidateWindow
            set end of outputRows to appName & tab & bundleId & tab & windowName & tab & (item 1 of windowPosition as text) & tab & (item 2 of windowPosition as text) & tab & (item 1 of windowSize as text) & tab & (item 2 of windowSize as text)
          end if
        end try
      end repeat
    end try
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return outputRows as text
`.trim();
}

function restoreWindowFrameAppleScript(window: AerospaceWindow): string {
  const frame = window.frame;
  if (!frame) throw new Error("window frame is required");
  const appMatcher = window.appBundleId
    ? `bundle identifier of candidateProcess as text is ${appleScriptString(window.appBundleId)}`
    : `name of candidateProcess as text is ${appleScriptString(window.app)}`;

  return `
-- eventloopOS generated frame restore
tell application "System Events"
  repeat with candidateProcess in (application processes whose visible is true)
    try
      if ${appMatcher} then
        repeat with candidateWindow in windows of candidateProcess
          try
            if name of candidateWindow as text is ${appleScriptString(window.title)} then
              set position of candidateWindow to {${frame.x}, ${frame.y}}
              set size of candidateWindow to {${frame.width}, ${frame.height}}
              return "ok"
            end if
          end try
        end repeat
      end if
    end try
  end repeat
end tell
return "not_found"
`.trim();
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hasWindowIdentityForFrameRestore(window: AerospaceWindow): boolean {
  return window.title.length > 0 && (window.app.length > 0 || (window.appBundleId?.length ?? 0) > 0);
}

function windowFrameObservationMatches(window: AerospaceWindow, observation: MacOSWindowFrameObservation): boolean {
  if (window.title !== observation.title) return false;
  if (window.appBundleId && observation.appBundleId) {
    return window.appBundleId === observation.appBundleId;
  }
  return window.app === observation.app;
}

function assertSafeLayout(layout: string): asserts layout is AerospaceLayout {
  if (!["h_tiles", "v_tiles", "h_accordion", "v_accordion", "tiles", "accordion", "floating"].includes(layout)) {
    throw new Error(`unsafe aerospace layout: ${layout}`);
  }
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
