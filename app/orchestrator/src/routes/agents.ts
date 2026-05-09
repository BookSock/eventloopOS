import { autoBindCodexFromWindows } from "../agents/codex/auto_bind.js";
import { inspectCodexSession } from "../agents/codex/session_inspector.js";
import type { Observability } from "../observability.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleAgentsRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  workspace?: WorkspaceController;
  taskSessions?: TaskSessionController;
  observability: Observability;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "POST" && input.pathname === "/agents/codex/auto-bind") {
    const result = await autoBindCodexFromWindows({
      workspace: input.workspace,
      taskSessions: input.taskSessions,
      observability: input.observability,
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

  return undefined;
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}
