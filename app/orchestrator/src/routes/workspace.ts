import type { GatewayStore } from "../gateway_store.js";
import { parseRestoreExecuteRequest, parseRestorePlanRequest, type WorkspaceController } from "../workspace/controller.js";
import type { RouteResult } from "./types.js";

export type JsonBodyReader = () => Promise<{ ok: true; value: unknown } | { ok: false; message: string }>;

export async function handleWorkspaceRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  workspace?: WorkspaceController;
  workspaceExecuteEnabled?: boolean;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/workspace/status") {
    if (!input.workspace) {
      return error(501, "workspace_unavailable", "workspace controller is not configured");
    }

    return ok(200, {
      status: await input.workspace.status(),
      execute_supported: input.workspaceExecuteEnabled === true,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/workspace/capture") {
    if (!input.workspace) {
      return error(501, "workspace_unavailable", "workspace controller is not configured");
    }

    return ok(200, {
      snapshot: await input.workspace.capture(),
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/workspace/restore-plan") {
    if (!input.workspace) {
      return error(501, "workspace_unavailable", "workspace controller is not configured");
    }

    const parsed = await input.readJsonBody();
    if (parsed.ok === false) return schemaError(parsed.message);

    try {
      const requestBody = parseRestorePlanRequest(parsed.value);
      const plan = await input.workspace.planRestore(requestBody.snapshot, requestBody.currentWindows);
      return ok(200, {
        plan,
        execute_supported: input.workspaceExecuteEnabled === true,
        request_id: input.requestId,
      });
    } catch (caught) {
      return schemaError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (input.method === "POST" && input.pathname === "/workspace/restore") {
    if (!input.workspace) {
      return error(501, "workspace_unavailable", "workspace controller is not configured");
    }
    if (input.workspaceExecuteEnabled !== true || !input.workspace.executeRestorePlan) {
      return error(403, "workspace_execute_disabled", "workspace restore execution is disabled");
    }
    if (!input.idempotencyKey) {
      return error(400, "missing_idempotency_key", "workspace restore requires idempotency-key header");
    }

    const existingReceipt = await input.store.getWorkspaceRestoreReceipt(input.idempotencyKey);
    if (existingReceipt) {
      return ok(200, {
        ok: true,
        plan: existingReceipt.plan,
        receipt: existingReceipt.receipt,
        execute_supported: true,
        idempotency_key: input.idempotencyKey,
        idempotency_replayed: true,
        request_id: input.requestId,
      });
    }

    const parsed = await input.readJsonBody();
    if (parsed.ok === false) return schemaError(parsed.message);

    try {
      const requestBody = parseRestoreExecuteRequest(parsed.value);
      const plan = await input.workspace.planRestore(requestBody.snapshot, requestBody.currentWindows);
      const receipt = await input.workspace.executeRestorePlan(plan);
      await input.store.recordWorkspaceRestoreReceipt({
        idempotencyKey: input.idempotencyKey,
        plan,
        receipt,
        now: input.now,
      });

      return ok(200, {
        ok: true,
        plan,
        receipt,
        execute_supported: true,
        idempotency_key: input.idempotencyKey,
        idempotency_replayed: false,
        request_id: input.requestId,
      });
    } catch (caught) {
      return schemaError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return undefined;
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
}
