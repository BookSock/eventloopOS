import { buildOnboardingScan } from "../onboarding/task_grouping.js";
import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { RouteDecision } from "../store.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleOnboardingRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  workspace?: WorkspaceController;
  taskSessions?: TaskSessionController;
  observability?: Observability;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/onboarding/scan") {
    const warnings: string[] = [];
    let snapshot;
    if (input.workspace) {
      try {
        snapshot = await input.workspace.capture();
      } catch (error) {
        warnings.push(`workspace capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!input.workspace) {
      warnings.push("workspace controller is not configured");
    }

    const taskSessions = input.taskSessions?.listSessions ? await Promise.resolve(input.taskSessions.listSessions()).catch((error) => {
      warnings.push(`task session listing failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }) : [];
    if (!input.taskSessions?.listSessions) {
      warnings.push("task session listing is not configured");
    }

    const browserContexts = await input.store.listContextEntries({ limit: 100 }).catch((error) => {
      warnings.push(`browser context listing failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });

    return {
      ok: true,
      status: 200,
      body: {
        ...buildOnboardingScan({
          snapshot,
          taskSessions,
          browserContexts,
          capturedAt: input.now.toISOString(),
          warnings,
        }),
        request_id: input.requestId,
      },
    };
  }

  if (input.method === "POST" && input.pathname === "/onboarding/approvals") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const resolved = await resolveProposalApprovalIfNeeded(input, parsed.value);
    if (!resolved.ok) return resolved.result;
    const validation = validateOnboardingApprovalRequest(resolved.value);
    if (!validation.ok) return schemaError(validation.message);

    const warnings: string[] = [];
    let workspaceRecord;
    if (validation.windowIds.length > 0) {
      if (!input.workspace) return error(409, "workspace_not_configured", "workspace controller is not configured");
      const snapshot = await input.workspace.capture();
      const selected = snapshot.windows.filter((window) => validation.windowIds.includes(window.id));
      const missingWindowIds = validation.windowIds.filter((id) => !selected.some((window) => window.id === id));
      if (missingWindowIds.length > 0) {
        return error(404, "window_not_found", "one or more requested windows were not found", { missing_window_ids: missingWindowIds });
      }

      workspaceRecord = await input.store.saveTaskWorkspaceSnapshot({
        taskId: validation.taskId,
        snapshot: {
          backend: "aerospace",
          windows: selected,
          activeWorkspace: snapshot.activeWorkspace,
          focusedWindowId: selected.some((window) => window.id === snapshot.focusedWindowId) ? snapshot.focusedWindowId : undefined,
        },
        capturedAt: input.now,
        actorId: validation.actorId,
      });
    }

    const bindings = [];
    if (validation.taskSessionIds.length > 0) {
      if (!input.taskSessions?.bindTaskSession) {
        return error(409, "task_binding_unavailable", "task session binding is not configured");
      }
      for (const taskSessionId of validation.taskSessionIds) {
        const binding = await Promise.resolve(input.taskSessions.bindTaskSession({
          task_session_id: taskSessionId,
          task_id: validation.taskId,
        }));
        if (binding.ok === false) {
          return error(409, "task_binding_failed", binding.error ?? "task session binding failed", binding);
        }
        bindings.push(binding);
      }
    }

    const browserContextBindings = await bindBrowserContextsToTask(input, validation, resolved.browserContexts);
    const queuedPaper = validation.queuePaper
      ? await queueOnboardingPaper(input, validation, resolved.proposalTitle)
      : undefined;

    if (!workspaceRecord && bindings.length === 0 && browserContextBindings.length === 0 && !queuedPaper?.queue_item) {
      warnings.push("approval accepted but no windows or task sessions were provided");
    }

    await input.observability?.incrementCounter("onboarding_task_approvals_total");
    await input.observability?.recordActivity({
      type: "onboarding_task_approved",
      occurred_at: input.now.toISOString(),
      actor: "human",
      task_id: validation.taskId,
      status: "ok",
      summary: `Onboarding task approved: ${validation.taskId}`,
      details: sanitizeActivityDetails({
        window_ids: validation.windowIds,
        task_session_ids: validation.taskSessionIds,
        browser_context_ids: browserContextBindings.map((binding) => binding.browser_context_id),
        queue_paper_created: Boolean(queuedPaper?.queue_item),
        workspace_snapshot_saved: Boolean(workspaceRecord),
        binding_count: bindings.length,
        browser_context_binding_count: browserContextBindings.length,
      }),
    });

    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        task_id: validation.taskId,
        proposal_id: resolved.proposalId,
        workspace_snapshot: workspaceRecord,
        bindings,
        browser_context_bindings: browserContextBindings,
        queue_item: queuedPaper?.queue_item,
        review_packet: queuedPaper?.review_packet,
        warnings,
        request_id: input.requestId,
      },
    };
  }

  return undefined;
}

async function resolveProposalApprovalIfNeeded(
  input: {
    workspace?: WorkspaceController;
    taskSessions?: TaskSessionController;
    store: GatewayStore;
    now: Date;
  },
  value: unknown,
): Promise<{ ok: true; value: unknown; proposalId?: string; proposalTitle?: string; browserContexts?: Array<{ id: string; title: string; url?: string; window_id?: string; tab_id?: string; restore_confidence: "high" | "medium" | "low"; captured_at: string }> } | { ok: false; result: RouteResult }> {
  if (!isRecord(value)) return { ok: true, value };
  const proposalId = readOptionalString(value.proposal_id);
  if (!proposalId) return { ok: true, value };

  const warnings: string[] = [];
  let snapshot;
  if (input.workspace) {
    try {
      snapshot = await input.workspace.capture();
    } catch (error) {
      warnings.push(`workspace capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const taskSessions = input.taskSessions?.listSessions ? await Promise.resolve(input.taskSessions.listSessions()).catch((error) => {
    warnings.push(`task session listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }) : [];
  const browserContexts = await input.store.listContextEntries({ limit: 100 }).catch((error) => {
    warnings.push(`browser context listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });

  const scan = buildOnboardingScan({
    snapshot,
    taskSessions,
    browserContexts,
    capturedAt: input.now.toISOString(),
    warnings,
  });
  const proposal = scan.proposals.find((candidate) => candidate.id === proposalId || candidate.task_id === proposalId);
  if (!proposal) {
    return {
      ok: false,
      result: error(404, "proposal_not_found", `onboarding proposal ${proposalId} was not found`, {
        proposal_id: proposalId,
        available_proposals: scan.proposals.map((candidate) => ({ id: candidate.id, task_id: candidate.task_id, title: candidate.title })),
        warnings,
      }),
    };
  }

  return {
    ok: true,
    value: {
      ...value,
      task_id: readOptionalString(value.task_id) ?? proposal.task_id,
      window_ids: hasProvided(value, "window_ids", "window_id") ? value.window_ids ?? value.window_id : proposal.windows.map((window) => window.id),
      task_session_ids: hasProvided(value, "task_session_ids", "task_session_id")
        ? value.task_session_ids ?? value.task_session_id
        : proposal.task_sessions.map((session) => session.id).filter((id): id is string => typeof id === "string" && id.length > 0),
      browser_context_ids: hasProvided(value, "browser_context_ids", "browser_context_id")
        ? value.browser_context_ids ?? value.browser_context_id
        : proposal.browser_contexts.map((context) => context.id),
    },
    proposalId,
    proposalTitle: proposal.title,
    browserContexts: proposal.browser_contexts,
  };
}

function validateOnboardingApprovalRequest(input: unknown): {
  ok: true;
  taskId: string;
  windowIds: number[];
  taskSessionIds: string[];
  browserContextIds: string[];
  queuePaper: boolean;
  actorId: string;
} | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "onboarding approval request must be an object" };
  const taskId = normalizeTaskId(readOptionalString(input.task_id) ?? readOptionalString(input.task_hint));
  if (!taskId) return { ok: false, message: "task_id or task_hint is required" };
  const windowIds = parseIdList(input.window_ids ?? input.window_id, "window_ids");
  if (!windowIds.ok) return windowIds;
  const taskSessionIds = parseStringList(input.task_session_ids ?? input.task_session_id, "task_session_ids");
  if (!taskSessionIds.ok) return taskSessionIds;
  const browserContextIds = parseStringList(input.browser_context_ids ?? input.browser_context_id, "browser_context_ids");
  if (!browserContextIds.ok) return browserContextIds;
  return {
    ok: true,
    taskId,
    windowIds: windowIds.values,
    taskSessionIds: taskSessionIds.values,
    browserContextIds: browserContextIds.values,
    queuePaper: input.queue_paper === true,
    actorId: readOptionalString(input.actor_id) ?? "onboarding",
  };
}

async function queueOnboardingPaper(
  input: {
    store: GatewayStore;
    now: Date;
  },
  validation: {
    taskId: string;
    actorId: string;
  },
  proposalTitle: string | undefined,
) {
  const title = proposalTitle ?? validation.taskId.replace(/^task_/, "").replaceAll("_", " ");
  const nowIso = input.now.toISOString();
  const event: McpEvent = {
    id: `evt_onboarding_queue_${stableSlug(validation.taskId)}`,
    source: "onboarding",
    source_id: `onboarding:queue:${validation.taskId}`,
    idempotency_key: `onboarding:queue:${validation.taskId}`,
    occurred_at: nowIso,
    received_at: nowIso,
    actor: { id: validation.actorId, type: "human" },
    task_hint: validation.taskId.replace(/^task_/, ""),
    type: "manual.review_requested",
    title: `${title} workbench`,
    summary: "Approved onboarding workbench is ready for human processing.",
    raw_ref: {
      id: `raw_onboarding_queue_${stableSlug(validation.taskId)}`,
      uri: `onboarding://queue/${validation.taskId}`,
      media_type: "text/plain",
    },
    links: [],
    resources: [{
      id: `ctx_onboarding_queue_${stableSlug(validation.taskId)}`,
      kind: "manual_note",
      title: `${title} onboarding paper`,
      source: "onboarding",
      captured_at: nowIso,
      restore_confidence: "medium",
      details: {
        task_id: validation.taskId,
      },
    }],
  };
  return input.store.ingestEventAsReviewPacket(event, input.now);
}

async function bindBrowserContextsToTask(
  input: {
    store: GatewayStore;
    now: Date;
  },
  validation: {
    taskId: string;
    browserContextIds: string[];
    actorId: string;
  },
  proposalBrowserContexts?: Array<{ id: string; title: string; url?: string; window_id?: string; tab_id?: string; restore_confidence: "high" | "medium" | "low"; captured_at: string }>,
): Promise<Array<{ browser_context_id: string; event_id: string; task_id: string }>> {
  if (validation.browserContextIds.length === 0) return [];
  const proposalById = new Map((proposalBrowserContexts ?? []).map((context) => [context.id, context]));
  const existingEntries = await input.store.listContextEntries({ limit: 200 });
  const existingById = new Map(existingEntries.map((entry) => [readOptionalString(entry.resource.id) ?? entry.event_id, entry]));
  const bindings: Array<{ browser_context_id: string; event_id: string; task_id: string }> = [];

  for (const contextId of validation.browserContextIds) {
    const proposalContext = proposalById.get(contextId);
    const entry = existingById.get(contextId);
    const resource = entry?.resource ?? browserContextResourceFromProposal(proposalContext);
    if (!resource) continue;

    const eventId = `evt_onboarding_context_bind_${stableSlug(validation.taskId)}_${stableSlug(contextId)}`;
    const nowIso = input.now.toISOString();
    const event: McpEvent = {
      id: eventId,
      source: "onboarding",
      source_id: `onboarding:context:${validation.taskId}:${contextId}`,
      idempotency_key: `onboarding:context:${validation.taskId}:${contextId}`,
      occurred_at: nowIso,
      received_at: nowIso,
      actor: { id: validation.actorId, type: "human" },
      task_hint: validation.taskId.replace(/^task_/, ""),
      type: "onboarding.browser_context_bound",
      title: `Bound browser tab: ${readOptionalString(resource.title) ?? proposalContext?.title ?? contextId}`,
      summary: `Approved browser context for ${validation.taskId}.`,
      raw_ref: {
        id: `raw_${eventId}`,
        uri: readOptionalString(resource.url) ?? `browser://context/${contextId}`,
        media_type: "application/json",
      },
      links: readOptionalString(resource.url) ? [{ label: "Open tab", url: readOptionalString(resource.url)! }] : [],
      resources: [{
        ...resource,
        id: readOptionalString(resource.id) ?? contextId,
        kind: readOptionalString(resource.kind) ?? "browser_tab",
        title: readOptionalString(resource.title) ?? proposalContext?.title ?? contextId,
        source: readOptionalString(resource.source) ?? "chrome-extension",
        captured_at: readOptionalString(resource.captured_at) ?? proposalContext?.captured_at ?? nowIso,
        restore_confidence: restoreConfidence(resource.restore_confidence),
      }],
    };
    const routeDecision: RouteDecision = {
      id: `rte_${eventId}`,
      event_id: event.id,
      action: "attach_to_task",
      target_task_id: validation.taskId,
      confidence: "high",
      evidence: [],
      created_at: nowIso,
    };
    await input.store.recordEventRoute(event, routeDecision, input.now);
    bindings.push({ browser_context_id: contextId, event_id: event.id, task_id: validation.taskId });
  }

  return bindings;
}

function browserContextResourceFromProposal(
  context: { id: string; title: string; url?: string; window_id?: string; tab_id?: string; restore_confidence: "high" | "medium" | "low"; captured_at: string } | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return {
    id: context.id,
    kind: "browser_tab",
    title: context.title,
    url: context.url,
    source: "chrome-extension",
    captured_at: context.captured_at,
    restore_confidence: context.restore_confidence,
    window_id: context.window_id,
    tab_id: context.tab_id,
  };
}

function restoreConfidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function stableSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "unknown";
}

function parseIdList(input: unknown, field: string): { ok: true; values: number[] } | { ok: false; message: string } {
  if (input === undefined || input === null) return { ok: true, values: [] };
  const values = Array.isArray(input) ? input : [input];
  const parsed = values.flatMap((value) => typeof value === "string" ? value.split(",") : [value])
    .map((value) => typeof value === "string" ? Number(value.trim()) : value);
  if (!parsed.every((value) => typeof value === "number" && Number.isInteger(value) && value > 0)) {
    return { ok: false, message: `${field} must contain positive integer window ids` };
  }
  return { ok: true, values: Array.from(new Set(parsed as number[])) };
}

function parseStringList(input: unknown, field: string): { ok: true; values: string[] } | { ok: false; message: string } {
  if (input === undefined || input === null) return { ok: true, values: [] };
  const values = Array.isArray(input) ? input : [input];
  const parsed = values.flatMap((value) => typeof value === "string" ? value.split(",") : [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (parsed.length !== values.flatMap((value) => typeof value === "string" ? value.split(",") : [undefined]).length) {
    return { ok: false, message: `${field} must contain non-empty strings` };
  }
  return { ok: true, values: Array.from(new Set(parsed)) };
}

function normalizeTaskId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase().replace(/^task_/, "");
  const slug = trimmed.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug ? `task_${slug}` : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasProvided(input: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => input[key] !== undefined && input[key] !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
}

function error(status: number, code: string, message: string, details?: unknown): RouteResult {
  return { ok: false, status, code, message, details };
}
