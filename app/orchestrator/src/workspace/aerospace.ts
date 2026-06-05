export type ExecResult = {
  stdout: string;
  stderr?: string;
};

export type ExecFunction = (command: string, args: string[], options?: { timeoutMs?: number; cwd?: string }) => Promise<ExecResult>;
export type SleepFunction = (ms: number) => Promise<void>;

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
      backend: string;
      reason?: undefined;
      detail?: string;
      monitorCount?: number;
    }
  | {
      available: false;
      backend: string;
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
  backend: string;
  windows: AerospaceWindow[];
  activeWorkspace?: string;
  focusedWindowId?: number;
  frameCapture?: WorkspaceFrameCaptureStatus;
};

export type WorkspaceFrameCaptureStatus = {
  status: "captured" | "failed" | "skipped";
  timeoutMs: number;
  observed: number;
  error?: string;
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

  private readonly frameCaptureTimeoutMs: number;
  private readonly workspaceFocusSettleMs: number;
  private readonly sleep: SleepFunction;

  constructor(
    private readonly exec: ExecFunction,
    options: { frameCaptureTimeoutMs?: number; workspaceFocusSettleMs?: number; sleep?: SleepFunction } = {},
  ) {
    this.frameCaptureTimeoutMs = options.frameCaptureTimeoutMs ?? readFrameCaptureTimeoutMs();
    this.workspaceFocusSettleMs = options.workspaceFocusSettleMs ?? readWorkspaceFocusSettleMs();
    this.sleep = options.sleep ?? sleep;
  }

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
    const resultPromise = this.exec("aerospace", captureWorkspacePlan().args);
    const activeWorkspacePromise = this.captureFocusedWorkspace().catch(() => undefined);
    const focusedWindowIdPromise = this.captureFocusedWindowId().catch(() => undefined);
    const [result, activeWorkspace, focusedWindowId] = await Promise.all([
      resultPromise,
      activeWorkspacePromise,
      focusedWindowIdPromise,
    ]);
    const windows = parseAerospaceWindows(result.stdout);
    const frameCapture = await this.captureWindowFrames(windows);

    return {
      backend: this.backend,
      windows: attachWindowFrames(windows, frameCapture.observations),
      activeWorkspace,
      focusedWindowId,
      frameCapture: frameCapture.status,
    };
  }

  async executeRestorePlan(plan: RestorePlan): Promise<RestoreExecutionReceipt> {
    const commands: RestoreExecutionReceipt["commands"] = [];
    for (let index = 0; index < plan.commands.length; index += 1) {
      const command = plan.commands[index];
      if (!command) continue;
      assertSafeAerospaceCommand(command);
      const result = await this.exec(command.command, command.args);
      commands.push({ ...command, ...result });
      if (this.workspaceFocusSettleMs > 0 && shouldSettleAfterWorkspaceFocus(command, plan.commands.slice(index + 1))) {
        await this.sleep(this.workspaceFocusSettleMs);
      }
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

  private async captureWindowFrames(windows: AerospaceWindow[]): Promise<{
    observations: MacOSWindowFrameObservation[];
    status: WorkspaceFrameCaptureStatus;
  }> {
    const candidates = windows.filter(hasWindowIdentityForFrameRestore);
    if (candidates.length === 0) {
      return {
        observations: [],
        status: { status: "skipped", timeoutMs: this.frameCaptureTimeoutMs, observed: 0 },
      };
    }
    try {
      const result = await this.exec("osascript", ["-e", captureWindowFramesAppleScript(candidates)], {
        timeoutMs: this.frameCaptureTimeoutMs,
      });
      const observations = parseWindowFrameObservations(result.stdout);
      return {
        observations,
        status: { status: "captured", timeoutMs: this.frameCaptureTimeoutMs, observed: observations.length },
      };
    } catch (error) {
      return {
        observations: [],
        status: {
          status: "failed",
          timeoutMs: this.frameCaptureTimeoutMs,
          observed: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
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
  if (snapshot.backend !== "aerospace") {
    throw new Error(`aerospace restore planner cannot restore ${snapshot.backend} snapshots`);
  }

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

    if (current.workspace !== window.workspace) {
      commands.push(moveToWorkspacePlan(window.id, window.workspace));
    }
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

export function restoreWorkspaceResidualPlan(snapshot: WorkspaceSnapshot, currentSnapshot: WorkspaceSnapshot): RestorePlan {
  if (snapshot.backend !== "aerospace") {
    throw new Error(`aerospace restore planner cannot restore ${snapshot.backend} snapshots`);
  }

  const currentWindowsById = new Map(currentSnapshot.windows.map((window) => [window.id, window]));
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

    if (current.workspace !== window.workspace) {
      commands.push(moveToWorkspacePlan(window.id, window.workspace));
    }
    if (window.layout !== undefined && window.layout !== current.layout) {
      commands.push(layoutWindowPlan(window.id, window.layout));
    } else if (window.frame !== undefined && current.layout !== "floating") {
      commands.push(layoutWindowPlan(window.id, "floating"));
    }
    if (needsFrameRestore(window, current)) {
      const framePlan = restoreWindowFramePlan(window);
      if (framePlan) frameCommands.push(framePlan);
    }
  }

  if (snapshot.activeWorkspace !== undefined && currentSnapshot.activeWorkspace !== snapshot.activeWorkspace) {
    commands.push(focusWorkspacePlan(snapshot.activeWorkspace));
  }

  commands.push(...frameCommands);

  if (
    snapshot.focusedWindowId !== undefined &&
    currentWindowsById.has(snapshot.focusedWindowId) &&
    currentSnapshot.focusedWindowId !== snapshot.focusedWindowId
  ) {
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

function captureWindowFramesAppleScript(windows: AerospaceWindow[]): string {
  const bundleIds = uniqueStrings(windows.map((window) => window.appBundleId).filter((value): value is string => Boolean(value)));
  const appNames = uniqueStrings(
    windows
      .filter((window) => !window.appBundleId)
      .map((window) => window.app)
      .filter((value) => value.length > 0),
  );
  const titles = uniqueStrings(windows.flatMap(windowFrameTitleCandidates));
  const titleCondition = appleScriptOrCondition("windowName", titles);
  const processLoops = [
    ...bundleIds.map((bundleId) =>
      captureWindowFramesProcessLoop(`application processes whose bundle identifier is ${appleScriptString(bundleId)}`, titleCondition),
    ),
    ...appNames.map((appName) =>
      captureWindowFramesProcessLoop(`application processes whose name is ${appleScriptString(appName)}`, titleCondition),
    ),
  ];

  return `
set outputRows to {}
tell application "System Events"
${processLoops.join("\n")}
end tell
set AppleScript's text item delimiters to linefeed
return outputRows as text
`.trim();
}

function captureWindowFramesProcessLoop(processQuery: string, titleCondition: string): string {
  return `
  repeat with candidateProcess in (${processQuery})
    try
      set appName to name of candidateProcess as text
      set bundleId to bundle identifier of candidateProcess as text
      repeat with candidateWindow in windows of candidateProcess
        try
          set windowName to name of candidateWindow as text
          if windowName is not "" and (${titleCondition}) then
            set windowPosition to position of candidateWindow
            set windowSize to size of candidateWindow
            set end of outputRows to appName & tab & bundleId & tab & windowName & tab & (item 1 of windowPosition as text) & tab & (item 2 of windowPosition as text) & tab & (item 1 of windowSize as text) & tab & (item 2 of windowSize as text)
          end if
        end try
      end repeat
    end try
  end repeat`.trimEnd();
}

function restoreWindowFrameAppleScript(window: AerospaceWindow): string {
  const frame = window.frame;
  if (!frame) throw new Error("window frame is required");
  const processQuery = window.appBundleId
    ? `application processes whose bundle identifier is ${appleScriptString(window.appBundleId)}`
    : `application processes whose name is ${appleScriptString(window.app)}`;
  const titleMatcher = appleScriptOrCondition("windowName", windowFrameTitleCandidates(window));

  return `
-- eventloopOS generated frame restore
tell application "System Events"
  repeat with candidateProcess in (${processQuery})
    try
      repeat with candidateWindow in windows of candidateProcess
        try
          set windowName to name of candidateWindow as text
          if (${titleMatcher}) then
            set position of candidateWindow to {${frame.x}, ${frame.y}}
            set size of candidateWindow to {${frame.width}, ${frame.height}}
            return "ok"
          end if
        end try
      end repeat
    end try
  end repeat
end tell
return "not_found"
`.trim();
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function appleScriptOrCondition(primaryVariable: string, primaryValues: string[], secondaryVariable?: string, secondaryValues: string[] = []): string {
  const secondaryName = secondaryVariable ?? primaryVariable;
  const terms = [
    ...primaryValues.map((value) => `${primaryVariable} is ${appleScriptString(value)}`),
    ...secondaryValues.map((value) => `${secondaryName} is ${appleScriptString(value)}`),
  ];
  return terms.length > 0 ? terms.join(" or ") : "true";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function readFrameCaptureTimeoutMs(): number {
  const raw = process.env.EVENTLOOPOS_FRAME_CAPTURE_TIMEOUT_MS;
  if (!raw) return 2_500;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 15_000) return 2_500;
  return parsed;
}

function readWorkspaceFocusSettleMs(): number {
  const raw = process.env.EVENTLOOPOS_WORKSPACE_FOCUS_SETTLE_MS;
  if (!raw) return 350;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5_000) return 350;
  return parsed;
}

function needsFrameRestore(target: AerospaceWindow, current: AerospaceWindow): boolean {
  if (target.frame === undefined) return false;
  if (current.frame === undefined) return true;
  return !framesNear(current.frame, target.frame, 8);
}

function framesNear(actual: WindowFrame, expected: WindowFrame, tolerance: number): boolean {
  return ["x", "y", "width", "height"].every((key) => {
    const field = key as keyof WindowFrame;
    const delta = Math.abs(actual[field] - expected[field]);
    return Number.isFinite(delta) && delta <= tolerance;
  });
}

function shouldSettleAfterWorkspaceFocus(command: AerospaceCommand, remaining: AerospaceCommand[]): boolean {
  return command.command === "aerospace" &&
    command.args[0] === "workspace" &&
    remaining.some((candidate) => candidate.command === "osascript");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasWindowIdentityForFrameRestore(window: AerospaceWindow): boolean {
  return window.title.length > 0 && (window.app.length > 0 || (window.appBundleId?.length ?? 0) > 0);
}

function windowFrameObservationMatches(window: AerospaceWindow, observation: MacOSWindowFrameObservation): boolean {
  if (!windowFrameTitleCandidates(window).includes(observation.title)) return false;
  if (window.appBundleId && observation.appBundleId) {
    return window.appBundleId === observation.appBundleId;
  }
  return window.app === observation.app;
}

function windowFrameTitleCandidates(window: Pick<AerospaceWindow, "title" | "app">): string[] {
  const titles = [window.title];
  const appSuffix = ` - ${window.app}`;
  if (window.app && window.title.endsWith(appSuffix)) {
    titles.push(window.title.slice(0, -appSuffix.length));
  }
  return uniqueStrings(titles.filter((title) => title.length > 0));
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
