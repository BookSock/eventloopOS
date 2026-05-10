import { autoBindCodexFromWindows } from "../agents/codex/auto_bind.js";
import { resolveForegroundCodex } from "../agents/codex/foreground_resolver.js";
import { inspectCodexSession } from "../agents/codex/session_inspector.js";
import { inspectClaudeSession } from "../agents/claude/session_inspector.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleAgentsRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  const { store, workspace, taskSessions, observability, ghosttyResolver } = input.runtime;
  if (input.method === "POST" && input.pathname === "/agents/codex/auto-bind") {
    const manualMode = await store.getManualModeState();
    if (manualMode.active) {
      await observability.recordActivity({
        type: "codex_auto_bind_skipped",
        occurred_at: input.now.toISOString(),
        actor: "system",
        status: "ok",
        summary: "Auto-bind tick skipped: manual mode active.",
        details: sanitizeActivityDetails({
          paused: true,
          reason: "paused: manual mode",
          manual_mode_entered_at: manualMode.entered_at,
        }),
      });
      return ok(200, {
        ok: true,
        paused: true,
        reason: "manual_mode_active",
        manual_mode: manualMode,
        scanned_window_count: 0,
        matched_count: 0,
        bound: [],
        skipped: [],
        request_id: input.requestId,
      });
    }

    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
      observability,
      ghosttyResolver,
      now: input.now,
    });
    return ok(200, { ok: true, ...result, request_id: input.requestId });
  }

  if (input.method === "POST" && input.pathname === "/agents/codex/resolve-foreground") {
    if (!input.runtime.runOsascript) {
      return ok(200, {
        codex_thread_id: null,
        ghostty_window_id: null,
        source: "none",
        request_id: input.requestId,
      });
    }
    const resolution = await resolveForegroundCodex({
      runOsascript: input.runtime.runOsascript,
      codexHome: input.runtime.codexHome,
      listRolloutFiles: input.runtime.listRolloutFiles,
    });
    return ok(200, { ...resolution, request_id: input.requestId });
  }

  const inspectMatch = input.pathname.match(/^\/agents\/codex\/inspect\/([^/]+)$/);
  if (input.method === "GET" && inspectMatch) {
    const threadId = decodeURIComponent(inspectMatch[1] ?? "");
    if (!threadId) return error(400, "schema_error", "thread_id is required");
    const inspection = await inspectCodexSession(threadId, { now: input.now });
    return ok(200, { ...inspection, request_id: input.requestId });
  }

  const claudeInspectMatch = input.pathname.match(/^\/agents\/claude\/inspect\/([^/]+)$/);
  if (input.method === "GET" && claudeInspectMatch) {
    const sessionId = decodeURIComponent(claudeInspectMatch[1] ?? "");
    if (!sessionId) return error(400, "schema_error", "session_id is required");
    const inspection = await inspectClaudeSession(sessionId, { now: input.now });
    return ok(200, { ...inspection, request_id: input.requestId });
  }

  return undefined;
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}
