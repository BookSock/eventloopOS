import { buildOnboardingScan } from "../onboarding/task_grouping.js";
import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import type { Runtime } from "../runtime.js";
import type { RouteDecision, TaskAnchorKind } from "../store.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { WorkspaceSnapshot } from "../workspace/aerospace.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleOnboardingRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  const { store, workspace, taskSessions, observability } = input.runtime;
  if (input.method === "GET" && input.pathname === "/onboarding/scan") {
    const scan = await runOnboardingScan(input, []);
    return {
      ok: true,
      status: 200,
      body: {
        ...scan.body,
        request_id: input.requestId,
      },
    };
  }

  if (input.method === "POST" && input.pathname === "/onboarding/rejections") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("rejection request must be an object");
    const proposalKey = readOptionalString(parsed.value.proposal_key);
    if (!proposalKey) return schemaError("proposal_key is required");
    const reason = readOptionalString(parsed.value.reason);
    const record = await store.recordOnboardingRejection(proposalKey, reason, input.now);
    await observability?.incrementCounter("onboarding_rejections_total");
    await observability?.recordActivity({
      type: "onboarding_proposal_rejected",
      occurred_at: input.now.toISOString(),
      actor: "human",
      status: "ok",
      summary: `Onboarding proposal rejected: ${proposalKey}`,
      details: sanitizeActivityDetails({ proposal_key: proposalKey, reason }),
    });
    return {
      ok: true,
      status: 200,
      body: { ok: true, rejection: record, request_id: input.requestId },
    };
  }

  if (input.method === "POST" && input.pathname === "/onboarding/approvals") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    const result = await processOnboardingApproval(input, parsed.value);
    if (!result.ok) return result.error;
    return { ok: true, status: 200, body: { ...result.body, request_id: input.requestId } };
  }

  if (input.method === "POST" && input.pathname === "/onboarding/approvals/batch") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);
    if (!isRecord(parsed.value)) return schemaError("batch approval request must be an object");
    const approvalsRaw = parsed.value.approvals;
    if (!Array.isArray(approvalsRaw)) return schemaError("approvals must be an array");
    if (approvalsRaw.length === 0) return schemaError("approvals must contain at least one item");

    const idempotencyKey = readOptionalString(parsed.value.idempotency_key) ?? input.idempotencyKey;
    if (idempotencyKey) {
      const cached = await store.getOnboardingApprovalBatch(idempotencyKey);
      if (cached) {
        return {
          ok: true,
          status: 200,
          body: {
            ok: true,
            results: cached.results,
            idempotent_replay: true,
            request_id: input.requestId,
          },
        };
      }
    }

    const results: Array<Record<string, unknown>> = [];
    for (const candidate of approvalsRaw) {
      if (!isRecord(candidate)) {
        results.push({ ok: false, error: { code: "schema_error", message: "approval entry must be an object" } });
        continue;
      }
      const proposalId = readOptionalString(candidate.proposal_id);
      const result = await processOnboardingApproval(input, candidate);
      if (!result.ok) {
        results.push({
          ok: false,
          proposal_id: proposalId,
          error: { code: result.error.code, message: result.error.message, details: result.error.details },
        });
        continue;
      }
      results.push({
        ok: true,
        proposal_id: result.body.proposal_id ?? proposalId,
        task_id: result.body.task_id,
        queue_item: result.body.queue_item,
        review_packet: result.body.review_packet,
      });
    }

    if (idempotencyKey) {
      await store.recordOnboardingApprovalBatch({
        idempotencyKey,
        results,
        now: input.now,
      });
    }

    await observability?.incrementCounter("onboarding_approval_batches_total");
    await observability?.recordActivity({
      type: "onboarding_approval_batch",
      occurred_at: input.now.toISOString(),
      actor: "human",
      status: "ok",
      summary: `Onboarding approval batch: ${results.length} entries`,
      details: sanitizeActivityDetails({
        idempotency_key: idempotencyKey,
        ok_count: results.filter((entry) => entry.ok === true).length,
        error_count: results.filter((entry) => entry.ok !== true).length,
      }),
    });

    return {
      ok: true,
      status: 200,
      body: { ok: true, results, request_id: input.requestId },
    };
  }

  return undefined;
}

async function runOnboardingScan(
  input: { runtime: Runtime; now: Date },
  extraWarnings: string[],
): Promise<{ body: Record<string, unknown>; rejections: Set<string> }> {
  const { store, workspace, taskSessions } = input.runtime;
  const warnings: string[] = [...extraWarnings];
  let snapshot;
  if (workspace) {
    try {
      snapshot = await workspace.capture();
    } catch (error) {
      warnings.push(`workspace capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!workspace) {
    warnings.push("workspace controller is not configured");
  }

  const sessions = taskSessions?.listSessions ? await Promise.resolve(taskSessions.listSessions()).catch((error) => {
    warnings.push(`task session listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }) : [];
  if (!taskSessions?.listSessions) {
    warnings.push("task session listing is not configured");
  }

  const browserContexts = await store.listContextEntries({ limit: 100 }).catch((error) => {
    warnings.push(`browser context listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });

  const rejections = await store.listOnboardingRejections().catch((error) => {
    warnings.push(`onboarding rejections listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [] as Awaited<ReturnType<typeof store.listOnboardingRejections>>;
  });
  const rejectedKeys = new Set(rejections.map((rejection) => rejection.proposal_key));

  const built = buildOnboardingScan({
    snapshot,
    taskSessions: sessions,
    browserContexts,
    capturedAt: input.now.toISOString(),
    warnings,
  });

  const filteredProposals = built.proposals.filter((proposal) => !rejectedKeys.has(proposal.task_id) && !rejectedKeys.has(proposal.id));
  const groupedWindowIds = new Set(filteredProposals.flatMap((proposal) => proposal.windows.map((window) => window.id)));

  const body: Record<string, unknown> = {
    ...built,
    proposals: filteredProposals,
    summary: {
      ...built.summary,
      proposal_count: filteredProposals.length,
      grouped_window_count: groupedWindowIds.size,
      ungrouped_window_count: built.summary.window_count - groupedWindowIds.size,
    },
    rejected_proposal_keys: Array.from(rejectedKeys),
  };
  return { body, rejections: rejectedKeys };
}

type ApprovalSuccess = {
  ok: true;
  body: {
    ok: true;
    task_id: string;
    proposal_id?: string;
    workspace_snapshot?: unknown;
    bindings: unknown[];
    browser_context_bindings: unknown[];
    task?: unknown;
    task_layout?: unknown;
    task_created?: boolean;
    task_window_claims?: unknown[];
    queue_item?: unknown;
    review_packet?: unknown;
    warnings: string[];
  };
};

type ApprovalFailure = {
  ok: false;
  error: RouteFailure;
};

async function processOnboardingApproval(
  input: { runtime: Runtime; now: Date },
  rawValue: unknown,
): Promise<ApprovalSuccess | ApprovalFailure> {
  const { store, workspace, taskSessions, observability } = input.runtime;
  const resolved = await resolveProposalApprovalIfNeeded(input, rawValue);
  if (!resolved.ok) return { ok: false, error: resolved.result };
  const validation = validateOnboardingApprovalRequest(resolved.value);
  if (!validation.ok) return { ok: false, error: schemaError(validation.message) };

  const warnings: string[] = [];
  let selectedSnapshot: WorkspaceSnapshot | undefined;
  let workspaceRecord;
  if (validation.windowIds.length > 0) {
    if (!workspace) return { ok: false, error: error(409, "workspace_not_configured", "workspace controller is not configured") };
    const snapshot = await workspace.capture();
    const selected = snapshot.windows.filter((window) => validation.windowIds.includes(window.id));
    const missingWindowIds = validation.windowIds.filter((id) => !selected.some((window) => window.id === id));
    if (missingWindowIds.length > 0) {
      return { ok: false, error: error(404, "window_not_found", "one or more requested windows were not found", { missing_window_ids: missingWindowIds }) };
    }

    selectedSnapshot = {
      backend: "aerospace",
      windows: selected,
      activeWorkspace: preferredWorkspaceForWindows(selected, snapshot.focusedWindowId) ?? snapshot.activeWorkspace,
      focusedWindowId: selected.some((window) => window.id === snapshot.focusedWindowId) ? snapshot.focusedWindowId : undefined,
    };
    workspaceRecord = await store.saveTaskWorkspaceSnapshot({
      taskId: validation.taskId,
      snapshot: selectedSnapshot,
      capturedAt: input.now,
      actorId: validation.actorId,
    });
  }

  const bindings = [];
  if (validation.taskSessionIds.length > 0) {
    if (!taskSessions?.bindTaskSession) {
      return { ok: false, error: error(409, "task_binding_unavailable", "task session binding is not configured") };
    }
    for (const taskSessionId of validation.taskSessionIds) {
      const binding = await Promise.resolve(taskSessions.bindTaskSession({
        task_session_id: taskSessionId,
        task_id: validation.taskId,
      }));
      if (binding.ok === false) {
        return { ok: false, error: error(409, "task_binding_failed", binding.error ?? "task session binding failed", binding) };
      }
      bindings.push(binding);
    }
  }

  const taskCreation = await createOnboardingTaskIfPossible({
    runtime: input.runtime,
    validation,
    bindings,
    selectedSnapshot,
    now: input.now,
  });
  const taskWindowClaims = selectedSnapshot
    ? await claimApprovedTaskWindows(input, validation.taskId, selectedSnapshot)
    : [];
  const browserContextBindings = await bindBrowserContextsToTask(input, validation, resolved.browserContexts);
  const queuedPaper = validation.queuePaper
    ? await queueOnboardingPaper(input, validation, resolved.proposalTitle)
    : undefined;

  if (!workspaceRecord && bindings.length === 0 && browserContextBindings.length === 0 && !queuedPaper?.queue_item && !taskCreation) {
    warnings.push("approval accepted but no windows or task sessions were provided");
  }

  await observability?.incrementCounter("onboarding_task_approvals_total");
  await observability?.recordActivity({
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
      task_created: taskCreation?.created,
      workspace_snapshot_saved: Boolean(workspaceRecord),
      binding_count: bindings.length,
      browser_context_binding_count: browserContextBindings.length,
    }),
  });

  return {
    ok: true,
    body: {
      ok: true,
      task_id: validation.taskId,
      proposal_id: resolved.proposalId,
      workspace_snapshot: workspaceRecord,
      bindings,
      browser_context_bindings: browserContextBindings,
      task: taskCreation?.task,
      task_layout: taskCreation?.layout,
      task_created: taskCreation?.created,
      task_window_claims: taskWindowClaims,
      queue_item: queuedPaper?.queue_item,
      review_packet: queuedPaper?.review_packet,
      warnings,
    },
  };
}

async function claimApprovedTaskWindows(
  input: { runtime: Runtime; now: Date },
  taskId: string,
  selectedSnapshot: WorkspaceSnapshot,
): Promise<unknown[]> {
  const claims = [];
  for (const window of selectedSnapshot.windows) {
    claims.push(await input.runtime.store.claimTaskWindow({
      taskId,
      windowId: String(window.id),
      appBundle: window.appBundleId || window.app,
      titlePrefix: window.title,
      source: "onboarding_approval",
      now: input.now,
    }));
  }
  return claims;
}

async function createOnboardingTaskIfPossible(input: {
  runtime: Runtime;
  validation: {
    taskId: string;
    windowIds: number[];
    taskSessionIds: string[];
  };
  bindings: unknown[];
  selectedSnapshot?: WorkspaceSnapshot;
  now: Date;
}): Promise<{ task: unknown; layout: unknown; created: boolean } | undefined> {
  const anchor = onboardingPrimaryAnchor(input.validation, input.bindings, input.selectedSnapshot);
  if (!anchor) return undefined;
  const capturedLayout = input.selectedSnapshot ?? { backend: "aerospace" as const, windows: [] };
  const result = await input.runtime.store.createTask({
    taskId: input.validation.taskId,
    primaryAnchor: anchor,
    capturedLayout,
    aerospaceWorkspaceId: input.selectedSnapshot?.activeWorkspace,
    now: input.now,
  });
  return result;
}

function onboardingPrimaryAnchor(
  validation: { taskId: string; windowIds: number[] },
  bindings: unknown[],
  selectedSnapshot: WorkspaceSnapshot | undefined,
): { kind: TaskAnchorKind; id: string } | undefined {
  for (const binding of bindings) {
    if (!isRecord(binding)) continue;
    const session = isRecord(binding.session) ? binding.session : undefined;
    const nativeThreadId = readOptionalString(session?.native_thread_id);
    if (nativeThreadId) return { kind: "codex_thread", id: nativeThreadId };
    const sessionId = readOptionalString(binding.task_session_id);
    const provider = readOptionalString(session?.provider)?.toLowerCase();
    if (sessionId && provider?.includes("codex")) return { kind: "codex_thread", id: sessionId };
  }

  const focusedWindowId = selectedSnapshot?.focusedWindowId;
  if (focusedWindowId && validation.windowIds.includes(focusedWindowId)) {
    return { kind: "ghostty_window", id: String(focusedWindowId) };
  }
  const firstWindow = selectedSnapshot?.windows[0]?.id ?? validation.windowIds[0];
  if (firstWindow) return { kind: "ghostty_window", id: String(firstWindow) };
  return undefined;
}

function preferredWorkspaceForWindows(windows: WorkspaceSnapshot["windows"], focusedWindowId?: number): string | undefined {
  const focusedWindow = focusedWindowId === undefined ? undefined : windows.find((window) => window.id === focusedWindowId);
  if (focusedWindow?.workspace) return focusedWindow.workspace;

  const counts = new Map<string, number>();
  for (const window of windows) {
    if (!window.workspace) continue;
    counts.set(window.workspace, (counts.get(window.workspace) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

async function resolveProposalApprovalIfNeeded(
  input: {
    runtime: Runtime;
    now: Date;
  },
  value: unknown,
): Promise<{ ok: true; value: unknown; proposalId?: string; proposalTitle?: string; browserContexts?: Array<{ id: string; title: string; url?: string; window_id?: string; tab_id?: string; restore_confidence: "high" | "medium" | "low"; captured_at: string }> } | { ok: false; result: RouteFailure }> {
  const { workspace, taskSessions, store } = input.runtime;
  if (!isRecord(value)) return { ok: true, value };
  const proposalId = readOptionalString(value.proposal_id);
  if (!proposalId) return { ok: true, value };

  const warnings: string[] = [];
  let snapshot;
  if (workspace) {
    try {
      snapshot = await workspace.capture();
    } catch (error) {
      warnings.push(`workspace capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sessions = taskSessions?.listSessions ? await Promise.resolve(taskSessions.listSessions()).catch((error) => {
    warnings.push(`task session listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }) : [];
  const browserContexts = await store.listContextEntries({ limit: 100 }).catch((error) => {
    warnings.push(`browser context listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });

  const scan = buildOnboardingScan({
    snapshot,
    taskSessions: sessions,
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
    runtime: Runtime;
    now: Date;
  },
  validation: {
    taskId: string;
    actorId: string;
  },
  proposalTitle: string | undefined,
) {
  const { store } = input.runtime;
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
  return store.ingestEventAsReviewPacket(event, input.now);
}

async function bindBrowserContextsToTask(
  input: {
    runtime: Runtime;
    now: Date;
  },
  validation: {
    taskId: string;
    browserContextIds: string[];
    actorId: string;
  },
  proposalBrowserContexts?: Array<{ id: string; title: string; url?: string; window_id?: string; tab_id?: string; restore_confidence: "high" | "medium" | "low"; captured_at: string }>,
): Promise<Array<{ browser_context_id: string; event_id: string; task_id: string }>> {
  const { store } = input.runtime;
  if (validation.browserContextIds.length === 0) return [];
  const proposalById = new Map((proposalBrowserContexts ?? []).map((context) => [context.id, context]));
  const existingEntries = await store.listContextEntries({ limit: 200 });
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
    await store.recordEventRoute(event, routeDecision, input.now);
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

type RouteFailure = Extract<RouteResult, { ok: false }>;

function schemaError(message: string): RouteFailure {
  return error(400, "schema_error", message);
}

function error(status: number, code: string, message: string, details?: unknown): RouteFailure {
  return { ok: false, status, code, message, details };
}
