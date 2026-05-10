import { autoBindCodexFromWindows } from "../agents/codex/auto_bind.js";
import { inspectCodexSession } from "../agents/codex/session_inspector.js";
import { inspectClaudeSession } from "../agents/claude/session_inspector.js";
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
  const { workspace, taskSessions, observability } = input.runtime;
  if (input.method === "POST" && input.pathname === "/agents/codex/auto-bind") {
    const result = await autoBindCodexFromWindows({
      workspace,
      taskSessions,
      observability,
      now: input.now,
    });
    return ok(200, { ok: true, ...result, request_id: input.requestId });
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
