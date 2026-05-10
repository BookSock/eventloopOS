import type { WorkspaceSnapshot } from "../contracts.js";
import type { Runtime } from "../runtime.js";
import type { TaskAnchorKind, TaskRecord } from "../store.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleTasksRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  const { store } = input.runtime;

  if (input.method === "GET" && input.pathname === "/tasks/current") {
    const state = await store.getCurrentTaskState();
    const task = state.current_task_id ? await store.getTask(state.current_task_id) : undefined;
    return ok(200, {
      task: task ?? null,
      entered_at: state.entered_at,
      updated_at: state.updated_at,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/tasks/current") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("current task request must be an object");
    const taskIdRaw = parsed.value.task_id;
    let nextTaskId: string | null;
    if (taskIdRaw === null) {
      nextTaskId = null;
    } else if (typeof taskIdRaw === "string" && taskIdRaw.trim()) {
      nextTaskId = taskIdRaw.trim();
    } else {
      return schemaError("task_id must be a non-empty string or null");
    }
    if (nextTaskId !== null) {
      const exists = await store.getTask(nextTaskId);
      if (!exists) return notFound(`task ${nextTaskId} not found`);
    }
    const next = await store.setCurrentTaskId(nextTaskId, input.now);
    const task = next.current_task_id ? await store.getTask(next.current_task_id) : undefined;
    return ok(200, {
      ok: true,
      task: task ?? null,
      entered_at: next.entered_at,
      updated_at: next.updated_at,
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/tasks") {
    const tasks = await store.listTasks();
    return ok(200, {
      tasks,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/tasks") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const validated = validateCreateTaskRequest(parsed.value);
    if (!validated.ok) return schemaError(validated.message);

    const result = await store.createTask({
      primaryAnchor: validated.primaryAnchor,
      capturedLayout: validated.capturedLayout,
      autoPaperIdleSeconds: validated.autoPaperIdleSeconds,
      now: input.now,
    });
    const current = await store.getCurrentTaskState();
    return ok(200, {
      task: result.task,
      layout: result.layout,
      created: result.created,
      current: current.current_task_id === result.task.task_id,
      request_id: input.requestId,
    });
  }

  const taskIdMatch = matchTaskPath(input.pathname);
  if (taskIdMatch) {
    if (input.method === "GET" && taskIdMatch.suffix === "") {
      const record = await store.getTask(taskIdMatch.taskId);
      if (!record) return notFound(`task ${taskIdMatch.taskId} not found`);
      const layout = await store.getTaskLayout(record.task_id);
      return ok(200, { task: record, layout: layout ?? null, request_id: input.requestId });
    }

    if (input.method === "PUT" && taskIdMatch.suffix === "/layout") {
      const parsed = await input.readJsonBody();
      if (!parsed.ok) return schemaError(parsed.message);
      const layout = validateWorkspaceSnapshot(parsed.value);
      if (!layout.ok) return schemaError(layout.message);

      const updated = await store.updateTaskLayout(taskIdMatch.taskId, layout.snapshot, input.now);
      if (!updated) return notFound(`task ${taskIdMatch.taskId} not found`);
      const layoutRecord = await store.getTaskLayout(updated.task_id);
      return ok(200, {
        ok: true,
        task: updated,
        layout: layoutRecord ?? null,
        request_id: input.requestId,
      });
    }
  }

  return undefined;
}

type ValidatedCreateTaskRequest = {
  ok: true;
  primaryAnchor: { kind: TaskAnchorKind; id: string };
  capturedLayout: WorkspaceSnapshot;
  autoPaperIdleSeconds?: number;
};

function validateCreateTaskRequest(value: unknown): ValidatedCreateTaskRequest | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "create task request must be an object" };
  const anchor = value.primary_anchor;
  if (!isRecord(anchor)) return { ok: false, message: "primary_anchor must be an object" };
  const kind = anchor.kind;
  if (kind !== "codex_thread" && kind !== "ghostty_window") {
    return { ok: false, message: "primary_anchor.kind must be 'codex_thread' or 'ghostty_window'" };
  }
  const id = anchor.id;
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, message: "primary_anchor.id must be a non-empty string" };
  }
  const layout = validateWorkspaceSnapshot(value.captured_layout);
  if (!layout.ok) return layout;
  let autoPaperIdleSeconds: number | undefined;
  if (value.auto_paper_idle_seconds !== undefined && value.auto_paper_idle_seconds !== null) {
    if (typeof value.auto_paper_idle_seconds !== "number" || !Number.isFinite(value.auto_paper_idle_seconds)) {
      return { ok: false, message: "auto_paper_idle_seconds must be a finite number" };
    }
    autoPaperIdleSeconds = value.auto_paper_idle_seconds;
  }
  return {
    ok: true,
    primaryAnchor: { kind, id: id.trim() },
    capturedLayout: layout.snapshot,
    autoPaperIdleSeconds,
  };
}

function validateWorkspaceSnapshot(value: unknown): { ok: true; snapshot: WorkspaceSnapshot } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "workspace snapshot must be an object" };
  if (value.backend !== "aerospace") return { ok: false, message: "workspace snapshot backend must be 'aerospace'" };
  if (!Array.isArray(value.windows)) return { ok: false, message: "workspace snapshot windows must be an array" };
  for (const [index, window] of value.windows.entries()) {
    if (!isRecord(window)) return { ok: false, message: `windows[${index}] must be an object` };
    if (typeof window.id !== "number") return { ok: false, message: `windows[${index}].id must be a number` };
    if (typeof window.app !== "string") return { ok: false, message: `windows[${index}].app must be a string` };
    if (typeof window.title !== "string") return { ok: false, message: `windows[${index}].title must be a string` };
    if (typeof window.workspace !== "string") return { ok: false, message: `windows[${index}].workspace must be a string` };
  }
  return { ok: true, snapshot: value as WorkspaceSnapshot };
}

function matchTaskPath(pathname: string): { taskId: string; suffix: string } | undefined {
  if (!pathname.startsWith("/tasks/")) return undefined;
  const remainder = pathname.slice("/tasks/".length);
  if (!remainder) return undefined;
  if (remainder === "current") return undefined;
  const slashIndex = remainder.indexOf("/");
  if (slashIndex === -1) {
    return { taskId: remainder, suffix: "" };
  }
  const taskId = remainder.slice(0, slashIndex);
  if (!taskId) return undefined;
  return { taskId, suffix: remainder.slice(slashIndex) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}

function notFound(message: string): RouteResult {
  return { ok: false, status: 404, code: "not_found", message };
}

export type { TaskRecord };
