import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observability } from "../../observability.js";
import { sanitizeActivityDetails } from "../../observability/activity_sanitizer.js";
import type { TaskRuntimeSession, TaskSessionController } from "../../task_sessions/types.js";
import type { WorkspaceController } from "../../workspace/controller.js";
import { resolveGhosttyWindowId, type RunOsascript } from "./ghostty_window_resolver.js";

const execFileAsync = promisify(execFile);

export type GhosttyWindowResolver = (input: { taskSlug: string }) => Promise<{
  ghosttyTextId: string | null;
  matched: number;
  ambiguous: boolean;
}>;

export type AutoBindFromWindowsOptions = {
  workspace?: WorkspaceController;
  taskSessions?: TaskSessionController;
  observability?: Observability;
  defaultTerminalRef?: string;
  now?: Date;
  ghosttyResolver?: GhosttyWindowResolver;
};

export type AutoBindResult = {
  scanned_window_count: number;
  matched_count: number;
  bound: Array<{ task_id: string; task_session_id: string; terminal_ref: string; window_id: number; window_app: string }>;
  skipped: Array<{ task_id?: string; window_id?: number; window_title?: string; reason: string }>;
};

const TASK_TAG_PATTERN = /\[task:([^\]]+)\]/i;
const TERMINAL_APP_PATTERN = /(ghostty|terminal|iterm|iterm2|kitty|wezterm|alacritty|warp)/i;

export async function autoBindCodexFromWindows(options: AutoBindFromWindowsOptions): Promise<AutoBindResult> {
  const result: AutoBindResult = {
    scanned_window_count: 0,
    matched_count: 0,
    bound: [],
    skipped: [],
  };

  if (!options.workspace) {
    result.skipped.push({ reason: "workspace_not_configured" });
    return result;
  }
  if (!options.taskSessions?.bindTaskSession || !options.taskSessions?.listSessions) {
    result.skipped.push({ reason: "task_session_controller_not_configured" });
    return result;
  }

  const snapshot = await options.workspace.capture();
  result.scanned_window_count = snapshot.windows.length;
  const sessions = await Promise.resolve(options.taskSessions.listSessions()).catch(() => [] as TaskRuntimeSession[]);

  const fallbackTerminalRef = options.defaultTerminalRef ?? "ghostty:front";
  const ghosttyResolver = options.ghosttyResolver ?? defaultGhosttyResolver;

  const ambiguousSlugs: string[] = [];

  for (const window of snapshot.windows) {
    if (!TERMINAL_APP_PATTERN.test(window.app)) continue;
    const tagMatch = window.title.match(TASK_TAG_PATTERN);
    if (!tagMatch) continue;
    result.matched_count += 1;
    const rawSlug = tagMatch[1].trim();
    const slug = `task_${rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
    const candidates = sessions.filter((session) => isRecord(session) && typeof session.task_id === "string" && session.task_id === slug);
    if (candidates.length === 0) {
      result.skipped.push({ task_id: slug, window_id: window.id, window_title: window.title, reason: "no_session_for_task" });
      continue;
    }
    if (candidates.length > 1) {
      result.skipped.push({ task_id: slug, window_id: window.id, window_title: window.title, reason: "multiple_sessions_for_task" });
      continue;
    }
    const session = candidates[0];
    const sessionId = isRecord(session) && typeof session.id === "string" ? session.id : undefined;
    if (!sessionId) {
      result.skipped.push({ task_id: slug, window_id: window.id, window_title: window.title, reason: "session_missing_id" });
      continue;
    }

    let perWindowTerminalRef: string;
    if (window.app.toLowerCase().includes("ghostty")) {
      const resolution = await ghosttyResolver({ taskSlug: rawSlug }).catch(() => ({ ghosttyTextId: null, matched: 0, ambiguous: false }));
      if (resolution.ambiguous) {
        ambiguousSlugs.push(rawSlug);
      }
      if (resolution.ghosttyTextId) {
        perWindowTerminalRef = `ghostty:win-${resolution.ghosttyTextId}`;
      } else {
        // Ghostty not running, no window matches the [task:<slug>] title, or
        // resolver errored — fall back to ghostty:front so single-Ghostty
        // dogfood keeps working byte-identical to V10a.
        perWindowTerminalRef = fallbackTerminalRef;
      }
    } else if (Number.isFinite(window.id)) {
      perWindowTerminalRef = `ghostty:win-${window.id}`;
    } else {
      perWindowTerminalRef = fallbackTerminalRef;
    }

    const existingTerminalRef = isRecord(session) && typeof session.terminal_ref === "string" ? session.terminal_ref : undefined;
    if (existingTerminalRef === perWindowTerminalRef) {
      result.skipped.push({ task_id: slug, window_id: window.id, window_title: window.title, reason: "already_bound" });
      continue;
    }

    try {
      const binding = await Promise.resolve(options.taskSessions.bindTaskSession({
        task_session_id: sessionId,
        task_id: slug,
        terminal_ref: perWindowTerminalRef,
      }));
      if (isRecord(binding) && binding.ok === false) {
        result.skipped.push({ task_id: slug, window_id: window.id, reason: typeof binding.error === "string" ? binding.error : "binding_failed" });
        continue;
      }
      result.bound.push({
        task_id: slug,
        task_session_id: sessionId,
        terminal_ref: perWindowTerminalRef,
        window_id: window.id,
        window_app: window.app,
      });
    } catch (caught) {
      result.skipped.push({ task_id: slug, window_id: window.id, reason: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  if (options.observability && (result.bound.length > 0 || result.matched_count > 0)) {
    await options.observability.incrementCounter("codex_auto_bind_runs_total");
    await options.observability.incrementCounter("codex_auto_bound_total", result.bound.length || undefined);
    await options.observability.recordActivity({
      type: "codex_auto_bind",
      occurred_at: (options.now ?? new Date()).toISOString(),
      actor: "system",
      status: "ok",
      summary: `Auto-bound ${result.bound.length} session(s) from window titles.`,
      details: sanitizeActivityDetails({
        scanned: result.scanned_window_count,
        matched: result.matched_count,
        bound_task_ids: result.bound.map((entry) => entry.task_id),
        skipped: result.skipped,
      }),
    });
    if (ambiguousSlugs.length > 0) {
      await options.observability.recordActivity({
        type: "multiple_ghostty_windows_for_task",
        occurred_at: (options.now ?? new Date()).toISOString(),
        actor: "system",
        status: "ok",
        summary: `Multiple Ghostty windows match [task:<slug>] for ${ambiguousSlugs.length} slug(s); first id picked.`,
        details: sanitizeActivityDetails({ slugs: ambiguousSlugs }),
      });
    }
  }

  return result;
}

const defaultRunOsascript: RunOsascript = async (args) => {
  const { stdout, stderr } = await execFileAsync("osascript", args, { timeout: 5_000 });
  return { stdout, stderr };
};

const defaultGhosttyResolver: GhosttyWindowResolver = async ({ taskSlug }) => {
  if (process.platform !== "darwin") {
    return { ghosttyTextId: null, matched: 0, ambiguous: false };
  }
  const resolution = await resolveGhosttyWindowId({ taskSlug, runOsascript: defaultRunOsascript });
  return {
    ghosttyTextId: resolution.ghosttyTextId,
    matched: resolution.matched,
    ambiguous: resolution.ambiguous,
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
