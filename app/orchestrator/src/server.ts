import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { queueStates, type Action, type ApiErrorBody, type QueueItemWithPacket, type QueueState } from "./contracts.js";
import type { GatewayStore } from "./gateway_store.js";
import type { McpEvent } from "./integrations/mcp_poll/types.js";
import type { McpSourcePollOutput } from "./integrations/mcp_poll/development_registry.js";
import type { ContextRestoreRequestRecord, RouteDecision } from "./store.js";
import type { TaskSessionController } from "./task_sessions/types.js";
import { parseRestoreExecuteRequest, parseRestorePlanRequest, type WorkspaceController } from "./workspace/controller.js";

export type GatewayServerOptions = {
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  mcpSources?: McpSourceRegistry;
  workspace?: WorkspaceController;
  workspaceExecuteEnabled?: boolean;
  now?: () => Date;
};

export type McpSourceRegistry = {
  listSources: () => Promise<unknown[]> | unknown[];
  getSource?: (sourceId: string) => Promise<unknown | undefined> | unknown | undefined;
  pollSource: (sourceId: string, input: unknown, receivedAt: string) => Promise<McpSourcePollOutput | undefined> | McpSourcePollOutput | undefined;
};

type RequestContext = {
  requestId: string;
  idempotencyKey?: string;
  url: URL;
};

export function createGatewayServer(options: GatewayServerOptions): Server {
  const now = options.now ?? (() => new Date());

  return createServer(async (request, response) => {
    const context = buildContext(request);
    applyResponseHeaders(response, context);

    try {
      if (request.method === "GET" && context.url.pathname === "/health") {
        return sendJson(response, 200, {
          ok: true,
          service: "eventloop-orchestrator",
          time: now().toISOString(),
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname === "/queue") {
        const validation = validateQueueQuery(context.url);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }

        const items = await options.store.listQueue(validation.state);

        return sendJson(response, 200, {
          items,
          count: items.length,
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname === "/queue/next") {
        return sendJson(response, 200, {
          item: await options.store.nextQueueItem(now()) ?? null,
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname === "/contexts") {
        const validation = validateContextQuery(context.url);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }

        const entries = await options.store.listContextEntries(validation.query);
        return sendJson(response, 200, {
          entries,
          count: entries.length,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/contexts/restore-plan") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const validation = validateContextRestorePlanRequest(parsed.value);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }
        const plan = buildContextRestorePlan(validation.resource);
        if (!plan) {
          return sendError(response, 422, context, "context_restore_unsupported", "context resource is not restorable");
        }

        return sendJson(response, 200, {
          restore_plan: plan,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/contexts/restore-requests") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const validation = validateContextRestorePlanRequest(parsed.value);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }
        const plan = buildContextRestorePlan(validation.resource);
        if (!plan) {
          return sendError(response, 422, context, "context_restore_unsupported", "context resource is not restorable");
        }
        if (plan.kind !== "browser_extension_message") {
          return sendError(
            response,
            422,
            context,
            "context_restore_not_browser_extension",
            "context restore request polling only supports browser extension messages",
          );
        }

        const created = await options.store.createContextRestoreRequest({
          id: `ctx_restore_${randomUUID()}`,
          idempotency_key: context.idempotencyKey,
          resource: validation.resource,
          restore_plan: plan,
        }, now());

        return sendJson(response, created.inserted ? 202 : 200, {
          restore_request: presentContextRestoreRequest(created.record),
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname === "/contexts/restore-requests/next") {
        const nextRequest = await options.store.peekNextContextRestoreRequest(now());
        return sendJson(response, 200, {
          restore_request: nextRequest ? presentContextRestoreRequest(nextRequest) : null,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/contexts/restore-requests/claim-next") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const claimRequest = parseContextRestoreClaimRequest(parsed.value);
        if (!claimRequest.ok) {
          return sendSchemaError(response, context, claimRequest.message);
        }
        const nextRequest = await options.store.claimNextContextRestoreRequest(
          claimRequest.leaseOwner,
          now(),
          claimRequest.leaseMs,
        );
        return sendJson(response, 200, {
          restore_request: nextRequest ? presentContextRestoreRequest(nextRequest) : null,
          request_id: context.requestId,
        });
      }

      const restoreGetMatch = context.url.pathname.match(/^\/contexts\/restore-requests\/([^/]+)$/);
      if (request.method === "GET" && restoreGetMatch) {
        const restoreRequestId = decodeURIComponent(restoreGetMatch[1]);
        const record = await options.store.getContextRestoreRequest(restoreRequestId);
        if (!record) {
          return sendError(response, 404, context, "not_found", `context restore request ${restoreRequestId} was not found`);
        }

        return sendJson(response, 200, {
          restore_request: presentContextRestoreRequest(record),
          request_id: context.requestId,
        });
      }

      const restoreDoneMatch = context.url.pathname.match(/^\/contexts\/restore-requests\/([^/]+)\/done$/);
      if (request.method === "POST" && restoreDoneMatch) {
        const restoreRequestId = decodeURIComponent(restoreDoneMatch[1]);
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const record = await options.store.markContextRestoreRequestDone(
          restoreRequestId,
          isRecord(parsed.value) && "result" in parsed.value ? parsed.value.result : parsed.value,
          now(),
        );
        if (!record) {
          return sendError(response, 404, context, "not_found", `context restore request ${restoreRequestId} was not found`);
        }

        return sendJson(response, 200, {
          restore_request: presentContextRestoreRequest(record),
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname === "/workspace/status") {
        if (!options.workspace) {
          return sendError(response, 501, context, "workspace_unavailable", "workspace controller is not configured");
        }

        return sendJson(response, 200, {
          status: await options.workspace.status(),
          execute_supported: options.workspaceExecuteEnabled === true,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/workspace/capture") {
        if (!options.workspace) {
          return sendError(response, 501, context, "workspace_unavailable", "workspace controller is not configured");
        }

        return sendJson(response, 200, {
          snapshot: await options.workspace.capture(),
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/workspace/restore-plan") {
        if (!options.workspace) {
          return sendError(response, 501, context, "workspace_unavailable", "workspace controller is not configured");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        try {
          const requestBody = parseRestorePlanRequest(parsed.value);
          const plan = await options.workspace.planRestore(requestBody.snapshot, requestBody.currentWindows);
          return sendJson(response, 200, {
            plan,
            execute_supported: options.workspaceExecuteEnabled === true,
            request_id: context.requestId,
          });
        } catch (error) {
          return sendSchemaError(response, context, error instanceof Error ? error.message : String(error));
        }
      }

      if (request.method === "POST" && context.url.pathname === "/workspace/restore") {
        if (!options.workspace) {
          return sendError(response, 501, context, "workspace_unavailable", "workspace controller is not configured");
        }
        if (options.workspaceExecuteEnabled !== true || !options.workspace.executeRestorePlan) {
          return sendError(response, 403, context, "workspace_execute_disabled", "workspace restore execution is disabled");
        }
        if (!context.idempotencyKey) {
          return sendError(response, 400, context, "missing_idempotency_key", "workspace restore requires idempotency-key header");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        try {
          const requestBody = parseRestoreExecuteRequest(parsed.value);
          const plan = await options.workspace.planRestore(requestBody.snapshot, requestBody.currentWindows);
          const receipt = await options.workspace.executeRestorePlan(plan);
          return sendJson(response, 200, {
            ok: true,
            plan,
            receipt,
            execute_supported: true,
            idempotency_key: context.idempotencyKey,
            request_id: context.requestId,
          });
        } catch (error) {
          return sendSchemaError(response, context, error instanceof Error ? error.message : String(error));
        }
      }

      if (request.method === "GET" && context.url.pathname === "/mcp-sources") {
        if (!options.mcpSources) {
          return sendError(response, 501, context, "mcp_sources_unavailable", "MCP source registry is not configured");
        }

        const sources = await options.mcpSources.listSources();
        return sendJson(response, 200, {
          sources,
          count: Array.isArray(sources) ? sources.length : 0,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/mcp-sources/poll-all-and-route") {
        if (!options.mcpSources) {
          return sendError(response, 501, context, "mcp_sources_unavailable", "MCP source registry is not configured");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const requestBody = parseMcpPollAllRequest(parsed.value);
        if (!requestBody.ok) {
          return sendSchemaError(response, context, requestBody.message);
        }

        const sources = await options.mcpSources.listSources();
        const sourceIds = sourceIdsForPollAll(sources, requestBody.sourceIds);
        if (!sourceIds.ok) {
          return sendSchemaError(response, context, sourceIds.message);
        }

        const polled = [];
        let eventsSeen = 0;
        let routedCount = 0;
        let duplicatesIgnored = 0;
        let errors = 0;

        for (const sourceId of sourceIds.value) {
          try {
            const input = requestBody.inputsBySourceId[sourceId] ?? { items: [] };
            const pollResult = await options.mcpSources.pollSource(sourceId, input, now().toISOString());
            if (!pollResult) {
              errors += 1;
              polled.push({
                source_id: sourceId,
                ok: false,
                error: `MCP source ${sourceId} was not found`,
              });
              continue;
            }

            const routed = [];
            for (const event of pollResult.events) {
              routed.push(await routeEventThroughGateway(options, event, now()));
            }

            eventsSeen += pollResult.events.length;
            routedCount += routed.length;
            duplicatesIgnored += pollResult.duplicates_ignored;
            polled.push({
              source_id: sourceId,
              ok: true,
              events_seen: pollResult.events.length,
              routed,
              duplicates_ignored: pollResult.duplicates_ignored,
              cursor: pollResult.cursor,
            });
          } catch (error) {
            errors += 1;
            polled.push({
              source_id: sourceId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return sendJson(response, 200, {
          ok: errors === 0,
          sources_seen: sourceIds.value.length,
          events_seen: eventsSeen,
          routed_count: routedCount,
          duplicates_ignored: duplicatesIgnored,
          errors,
          polled,
          request_id: context.requestId,
        });
      }

      const getMcpSourceMatch = context.url.pathname.match(/^\/mcp-sources\/([^/]+)$/);
      if (request.method === "GET" && getMcpSourceMatch) {
        if (!options.mcpSources?.getSource) {
          return sendError(response, 501, context, "mcp_sources_unavailable", "MCP source lookup is not configured");
        }

        const sourceId = decodeURIComponent(getMcpSourceMatch[1] ?? "");
        const source = await options.mcpSources.getSource(sourceId);
        if (!source) {
          return sendError(response, 404, context, "not_found", `MCP source ${sourceId} was not found`);
        }

        return sendJson(response, 200, {
          source,
          request_id: context.requestId,
        });
      }

      const pollMcpSourceMatch = context.url.pathname.match(/^\/mcp-sources\/([^/]+)\/poll$/);
      if (request.method === "POST" && pollMcpSourceMatch) {
        if (!options.mcpSources) {
          return sendError(response, 501, context, "mcp_sources_unavailable", "MCP source registry is not configured");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const sourceId = decodeURIComponent(pollMcpSourceMatch[1] ?? "");
        try {
          const result = await options.mcpSources.pollSource(sourceId, parsed.value, now().toISOString());
          if (!result) {
            return sendError(response, 404, context, "not_found", `MCP source ${sourceId} was not found`);
          }

          return sendJson(response, 200, {
            source_id: sourceId,
            events: result.events,
            duplicates_ignored: result.duplicates_ignored,
            cursor: result.cursor,
            request_id: context.requestId,
          });
        } catch (error) {
          return sendSchemaError(response, context, error instanceof Error ? error.message : String(error));
        }
      }

      const pollAndRouteMcpSourceMatch = context.url.pathname.match(/^\/mcp-sources\/([^/]+)\/poll-and-route$/);
      if (request.method === "POST" && pollAndRouteMcpSourceMatch) {
        if (!options.mcpSources) {
          return sendError(response, 501, context, "mcp_sources_unavailable", "MCP source registry is not configured");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const sourceId = decodeURIComponent(pollAndRouteMcpSourceMatch[1] ?? "");
        try {
          const pollResult = await options.mcpSources.pollSource(sourceId, parsed.value, now().toISOString());
          if (!pollResult) {
            return sendError(response, 404, context, "not_found", `MCP source ${sourceId} was not found`);
          }

          const routed = [];
          for (const event of pollResult.events) {
            routed.push(await routeEventThroughGateway(options, event, now()));
          }

          return sendJson(response, 200, {
            source_id: sourceId,
            events_seen: pollResult.events.length,
            routed,
            duplicates_ignored: pollResult.duplicates_ignored,
            cursor: pollResult.cursor,
            request_id: context.requestId,
          });
        } catch (error) {
          return sendSchemaError(response, context, error instanceof Error ? error.message : String(error));
        }
      }

      if (request.method === "GET" && context.url.pathname === "/task-sessions") {
        if (!options.taskSessions?.listSessions) {
          return sendError(response, 501, context, "task_sessions_unavailable", "task session listing is not configured");
        }

        const sessions = await options.taskSessions.listSessions();
        return sendJson(response, 200, {
          sessions,
          count: Array.isArray(sessions) ? sessions.length : 0,
          request_id: context.requestId,
        });
      }

      const getTaskSessionMatch = context.url.pathname.match(/^\/task-sessions\/([^/]+)$/);
      if (request.method === "GET" && getTaskSessionMatch) {
        if (!options.taskSessions?.getSession) {
          return sendError(response, 501, context, "task_sessions_unavailable", "task session lookup is not configured");
        }

        const taskSessionId = decodeURIComponent(getTaskSessionMatch[1] ?? "");
        const session = await options.taskSessions.getSession(taskSessionId);
        if (!session) {
          return sendError(response, 404, context, "not_found", `task session ${taskSessionId} was not found`);
        }

        return sendJson(response, 200, {
          session,
          request_id: context.requestId,
        });
      }

      const taskFollowupMatch = context.url.pathname.match(/^\/task-sessions\/([^/]+)\/followup$/);
      if (request.method === "POST" && taskFollowupMatch) {
        if (!options.taskSessions) {
          return sendError(response, 501, context, "task_sessions_unavailable", "task session controller is not configured");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const validation = validateTaskFollowupRequest(parsed.value, context.idempotencyKey);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }

        const taskSessionId = decodeURIComponent(taskFollowupMatch[1] ?? "");
        const message = await options.taskSessions.sendFollowupMessage({
          task_session_id: taskSessionId,
          text: validation.text,
          event_ids: validation.eventIds,
          idempotency_key: validation.idempotencyKey,
        });

        return sendJson(response, 202, {
          ok: true,
          message,
          request_id: context.requestId,
        });
      }

      const taskBindingMatch = context.url.pathname.match(/^\/task-sessions\/([^/]+)\/task-binding$/);
      if (request.method === "PUT" && taskBindingMatch) {
        if (!options.taskSessions?.bindTaskSession) {
          return sendError(response, 501, context, "task_binding_unavailable", "task session binding is not configured");
        }

        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const validation = validateTaskBindingRequest(parsed.value);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }

        const taskSessionId = decodeURIComponent(taskBindingMatch[1] ?? "");
        const binding = await options.taskSessions.bindTaskSession({
          task_session_id: taskSessionId,
          task_id: validation.taskId,
        });

        if (isRecord(binding) && binding.ok === false) {
          return sendError(
            response,
            typeof binding.error === "string" && binding.error.includes("was not found") ? 404 : 409,
            context,
            "task_binding_failed",
            typeof binding.error === "string" ? binding.error : "task session binding failed",
          );
        }

        return sendJson(response, 200, {
          ok: true,
          binding,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/queue/lease-next") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        if (!isRecord(parsed.value)) {
          return sendSchemaError(response, context, "lease request must be an object");
        }

        const leaseOwner = typeof parsed.value.lease_owner === "string" && parsed.value.lease_owner
          ? parsed.value.lease_owner
          : "unknown";
        const leaseMs = typeof parsed.value.lease_ms === "number" && Number.isInteger(parsed.value.lease_ms)
          ? parsed.value.lease_ms
          : 60_000;
        if (leaseMs <= 0 || leaseMs > 30 * 60_000) {
          return sendSchemaError(response, context, "lease_ms must be between 1 and 1800000");
        }

        return sendJson(response, 200, {
          item: await options.store.leaseNextQueueItem(leaseOwner, now(), leaseMs) ?? null,
          request_id: context.requestId,
        });
      }

      const renewLeaseMatch = context.url.pathname.match(/^\/queue\/([^/]+)\/lease\/renew$/);
      if (request.method === "POST" && renewLeaseMatch) {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        if (!isRecord(parsed.value)) {
          return sendSchemaError(response, context, "renew lease request must be an object");
        }

        const leaseOwner = typeof parsed.value.lease_owner === "string" && parsed.value.lease_owner
          ? parsed.value.lease_owner
          : "";
        if (!leaseOwner) {
          return sendSchemaError(response, context, "lease_owner is required");
        }

        const leaseMs = typeof parsed.value.lease_ms === "number" && Number.isInteger(parsed.value.lease_ms)
          ? parsed.value.lease_ms
          : 60_000;
        if (leaseMs <= 0 || leaseMs > 30 * 60_000) {
          return sendSchemaError(response, context, "lease_ms must be between 1 and 1800000");
        }

        const queueItemId = decodeURIComponent(renewLeaseMatch[1] ?? "");
        const item = await options.store.renewQueueLease(queueItemId, leaseOwner, now(), leaseMs);
        if (!item) {
          return sendError(
            response,
            409,
            context,
            "lease_not_renewed",
            `queue item ${queueItemId} lease was not renewed`,
          );
        }

        return sendJson(response, 200, {
          ok: true,
          item,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/mcp/poll") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const pollValidation = validateMcpPollRequest(parsed.value, now().toISOString());
        if (!pollValidation.ok) {
          return sendSchemaError(response, context, pollValidation.message);
        }

        return sendJson(response, 200, {
          source_id: pollValidation.sourceId,
          events: pollValidation.events,
          duplicates_ignored: 0,
          cursor: pollValidation.cursor,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/events") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const eventValidation = validateEventRequest(parsed.value);
        if (!eventValidation.ok) {
          return sendSchemaError(response, context, eventValidation.message);
        }

        const routed = await routeEventThroughGateway(options, eventValidation.event, now());

        return sendJson(response, 202, {
          ok: true,
          ...routed,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/voice/commands") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        const voiceValidation = validateVoiceCommandRequest(parsed.value, context.idempotencyKey, now().toISOString());
        if (!voiceValidation.ok) {
          return sendSchemaError(response, context, voiceValidation.message);
        }

        const routed = await routeEventThroughGateway(options, voiceValidation.event, now());

        return sendJson(response, 202, {
          ok: true,
          ...routed,
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname.startsWith("/events/")) {
        const id = decodeURIComponent(context.url.pathname.slice("/events/".length));

        if (!id) {
          return sendSchemaError(response, context, "event id is required");
        }

        const result = await options.store.getEvent(id);
        if (!result) {
          return sendError(response, 404, context, "not_found", `event ${id} was not found`);
        }

        return sendJson(response, 200, {
          event: result.event,
          route_decision: result.route_decision,
          review_packet: result.review_packet,
          queue_item: result.queue_item,
          request_id: context.requestId,
        });
      }

      const doneMatch = context.url.pathname.match(/^\/queue\/([^/]+)\/done$/);
      if (request.method === "POST" && doneMatch) {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        if (!isRecord(parsed.value) || parsed.value.action !== "done") {
          return sendSchemaError(response, context, "done request requires action=done");
        }

        const queueItemId = decodeURIComponent(doneMatch[1] ?? "");
        const item = await options.store.markQueueItemDone(
          queueItemId,
          typeof parsed.value.actor_id === "string" ? parsed.value.actor_id : "unknown",
          now(),
        );
        if (!item) {
          return sendError(response, 404, context, "not_found", `queue item ${queueItemId} was not found`);
        }

        return sendJson(response, 200, {
          ok: true,
          item,
          decision: {
            id: `dec_${queueItemId}`,
            queue_item_id: queueItemId,
            review_packet_id: item.review_packet_id,
            action: "done",
            actor_id: typeof parsed.value.actor_id === "string" ? parsed.value.actor_id : "unknown",
            decided_at: now().toISOString(),
          },
          request_id: context.requestId,
        });
      }

      const recommendedActionMatch = context.url.pathname.match(/^\/queue\/([^/]+)\/actions\/recommended$/);
      if (request.method === "POST" && recommendedActionMatch) {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }
        const validation = validateQueueActionRequest(parsed.value);
        if (!validation.ok) {
          return sendSchemaError(response, context, validation.message);
        }

        const queueItemId = decodeURIComponent(recommendedActionMatch[1] ?? "");
        const item = await findQueueItem(options.store, queueItemId);
        if (!item) {
          return sendError(response, 404, context, "not_found", `queue item ${queueItemId} was not found`);
        }

        const actionResult = await executeQueueAction(options, item, item.review_packet.recommended_action, now());
        if (!actionResult.ok) {
          return sendError(
            response,
            actionResult.status,
            context,
            actionResult.code,
            actionResult.message,
            actionResult.details,
          );
        }

        const completed = await options.store.markQueueItemDone(queueItemId, validation.actorId, now());
        return sendJson(response, 200, {
          ok: true,
          action_result: actionResult.result,
          item: completed,
          request_id: context.requestId,
        });
      }

      if (request.method === "GET" && context.url.pathname.startsWith("/review-packets/")) {
        const id = decodeURIComponent(context.url.pathname.slice("/review-packets/".length));

        if (!id) {
          return sendSchemaError(response, context, "review packet id is required");
        }

        const packet = await options.store.getReviewPacket(id);
        if (!packet) {
          return sendError(response, 404, context, "not_found", `review packet ${id} was not found`);
        }

        return sendJson(response, 200, {
          packet,
          request_id: context.requestId,
        });
      }

      if (request.method === "POST" && context.url.pathname === "/queue") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) {
          return sendSchemaError(response, context, parsed.message);
        }

        return sendSchemaError(response, context, "POST /queue request schema is not implemented in v0");
      }

      return sendError(response, 404, context, "not_found", "route not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return sendError(response, 500, context, "internal_error", message);
    }
  });
}

function buildContext(request: IncomingMessage): RequestContext {
  const requestId = headerString(request.headers["x-request-id"]) ?? `req_${randomUUID()}`;
  const idempotencyKey = headerString(request.headers["idempotency-key"]);
  const host = request.headers.host ?? "127.0.0.1";

  return {
    requestId,
    idempotencyKey,
    url: new URL(request.url ?? "/", `http://${host}`),
  };
}

function applyResponseHeaders(response: ServerResponse, context: RequestContext): void {
  response.setHeader("x-request-id", context.requestId);
  if (context.idempotencyKey) {
    response.setHeader("idempotency-key", context.idempotencyKey);
  }
}

function validateQueueQuery(url: URL): { ok: true; state?: QueueState } | { ok: false; message: string } {
  const state = url.searchParams.get("state");
  if (!state) {
    return { ok: true };
  }

  if (!queueStates.includes(state as QueueState)) {
    return { ok: false, message: `state must be one of: ${queueStates.join(", ")}` };
  }

  return { ok: true, state: state as QueueState };
}

function validateContextQuery(
  url: URL,
): { ok: true; query: { source?: string; task_id?: string; q?: string; limit?: number } } | { ok: false; message: string } {
  const source = url.searchParams.get("source") ?? undefined;
  const taskId = url.searchParams.get("task_id") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (source !== undefined && !source) {
    return { ok: false, message: "source must be non-empty when provided" };
  }
  if (taskId !== undefined && !taskId) {
    return { ok: false, message: "task_id must be non-empty when provided" };
  }
  if (q !== undefined && !q.trim()) {
    return { ok: false, message: "q must be non-empty when provided" };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 500)) {
    return { ok: false, message: "limit must be an integer between 1 and 500" };
  }

  return {
    ok: true,
    query: {
      source,
      task_id: taskId,
      q: q?.trim(),
      limit,
    },
  };
}

function validateContextRestorePlanRequest(
  input: unknown,
): { ok: true; resource: Record<string, unknown> } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "context restore-plan request must be an object" };
  }
  const resource = isRecord(input.resource) ? input.resource : input;
  if (!isRecord(resource)) {
    return { ok: false, message: "resource must be an object" };
  }
  if (typeof resource.kind !== "string" || !resource.kind) {
    return { ok: false, message: "resource.kind must be a non-empty string" };
  }
  return { ok: true, resource };
}

function parseContextRestoreClaimRequest(
  input: unknown,
): { ok: true; leaseOwner: string; leaseMs: number } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "context restore claim request must be an object" };
  }
  const leaseOwner = typeof input.lease_owner === "string" ? input.lease_owner.trim() : "";
  if (!leaseOwner) {
    return { ok: false, message: "lease_owner is required" };
  }
  const leaseMs = typeof input.lease_ms === "number" && Number.isInteger(input.lease_ms)
    ? input.lease_ms
    : 60_000;
  if (leaseMs <= 0 || leaseMs > 30 * 60_000) {
    return { ok: false, message: "lease_ms must be between 1 and 1800000" };
  }

  return { ok: true, leaseOwner, leaseMs };
}

function buildContextRestorePlan(resource: Record<string, unknown>): Record<string, unknown> | undefined {
  const url = typeof resource.url === "string" && resource.url ? resource.url : undefined;
  if (resource.kind === "browser_tab" && url) {
    return {
      kind: "browser_extension_message",
      side_effect: "local",
      execute_supported: false,
      target: "eventloopOS browser extension runtime",
      message: {
        type: "eventloop.restore",
        resource,
      },
    };
  }

  if (url) {
    return {
      kind: "open_url",
      side_effect: "local",
      execute_supported: false,
      url,
    };
  }

  const path = typeof resource.path === "string" && resource.path ? resource.path : undefined;
  if (resource.kind === "file" && path) {
    return {
      kind: "open_file",
      side_effect: "local",
      execute_supported: false,
      path,
      line: resource.line,
      column: resource.column,
    };
  }

  return undefined;
}

function presentContextRestoreRequest(record: ContextRestoreRequestRecord): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    idempotency_key: record.idempotency_key,
    resource: record.resource,
    restore_plan: record.restore_plan,
    result: record.result,
    lease_owner: record.lease_owner,
    lease_expires_at: record.lease_expires_at,
  };
}

function validateEventRequest(input: unknown): { ok: true; event: McpEvent } | { ok: false; message: string } {
  const event = isRecord(input) && isRecord(input.event) ? input.event : input;
  if (!isRecord(event)) {
    return { ok: false, message: "event request must be an object or { event }" };
  }

  const requiredStrings = [
    "id",
    "source",
    "source_id",
    "idempotency_key",
    "occurred_at",
    "received_at",
    "type",
    "title",
  ];
  for (const field of requiredStrings) {
    if (typeof event[field] !== "string" || !event[field]) {
      return { ok: false, message: `event.${field} must be a non-empty string` };
    }
  }

  if (!isRecord(event.raw_ref)) {
    return { ok: false, message: "event.raw_ref must be an object" };
  }
  if (!Array.isArray(event.links)) {
    return { ok: false, message: "event.links must be an array" };
  }
  if (!Array.isArray(event.resources)) {
    return { ok: false, message: "event.resources must be an array" };
  }

  return { ok: true, event: event as McpEvent };
}

async function routeEventThroughGateway(
  options: GatewayServerOptions,
  event: McpEvent,
  now: Date,
): Promise<{
  event: McpEvent;
  route_decision: RouteDecision;
  review_packet?: unknown;
  queue_item?: unknown;
  task_message?: unknown;
}> {
  const existing = await options.store.getEventByIdempotencyKey(event.source, event.idempotency_key);
  if (existing) {
    return {
      event: existing.event,
      route_decision: existing.route_decision,
      review_packet: existing.review_packet,
      queue_item: existing.queue_item,
    };
  }

  const injected = await injectEventIntoTaskSessionIfPossible(event, options.taskSessions, now);
  if (injected) {
    const result = await options.store.recordEventRoute(event, injected.routeDecision, now);
    return {
      event,
      route_decision: result.route_decision,
      task_message: injected.taskMessage,
    };
  }

  const result = await options.store.ingestEventAsReviewPacket(event, now);
  return {
    event,
    route_decision: result.route_decision,
    review_packet: result.review_packet,
    queue_item: result.queue_item,
  };
}

function validateVoiceCommandRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
  receivedAt: string,
): { ok: true; event: McpEvent } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "voice command request must be an object" };
  }

  const transcript = typeof input.transcript === "string" ? input.transcript.trim() : "";
  if (!transcript) {
    return { ok: false, message: "transcript must be a non-empty string" };
  }

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey ?? `voice:${stableId(transcript)}`;
  const sourceId = typeof input.source_id === "string" && input.source_id
    ? input.source_id
    : idempotencyKey;
  const occurredAt = typeof input.occurred_at === "string" && input.occurred_at
    ? input.occurred_at
    : receivedAt;
  const projectHint = readOptionalString(input, "project_hint");
  const taskHint = readOptionalString(input, "task_hint");
  const stableVoiceId = stableId(sourceId);

  return {
    ok: true,
    event: {
      id: `evt_voice_${stableVoiceId}`,
      source: "voice",
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt,
      received_at: receivedAt,
      actor: {
        id: "user_voice",
        type: "human",
      },
      project_hint: projectHint,
      task_hint: taskHint,
      type: "voice.command",
      title: "Voice command",
      summary: transcript,
      raw_ref: {
        id: `raw_voice_${stableVoiceId}`,
        uri: `voice://commands/${stableVoiceId}`,
        media_type: "text/plain",
      },
      links: [],
      resources: [
        {
          id: `ctx_voice_${stableVoiceId}`,
          kind: "voice_command",
          title: "Voice command transcript",
          source: "voice",
          captured_at: receivedAt,
          restore_confidence: "low",
          details: {
            transcript,
          },
        },
      ],
    },
  };
}

async function injectEventIntoTaskSessionIfPossible(
  event: McpEvent,
  taskSessions: TaskSessionController | undefined,
  now: Date,
): Promise<{ routeDecision: RouteDecision; taskMessage: unknown } | undefined> {
  if (!taskSessions?.listSessions) return undefined;
  if (!event.task_hint) return undefined;
  if (!shouldTryTaskSessionInjection(event)) return undefined;

  const targetTaskId = taskIdForHint(event.task_hint);
  const sessions = await taskSessions.listSessions();
  const session = sessions.find((candidate) => taskSessionMatchesTask(candidate, targetTaskId));
  if (!session) return undefined;

  const taskSessionId = String((session as Record<string, unknown>).id);
  const routeDecision: RouteDecision = {
    id: `rte_${stableId(event.id)}`,
    event_id: event.id,
    action: "inject_into_agent_thread",
    target_task_id: targetTaskId,
    target_task_session_id: taskSessionId,
    confidence: event.project_hint ? "high" : "medium",
    evidence: [
      {
        id: `ev_${stableId(event.id)}_raw`,
        kind: "raw",
        title: "Source event",
        url: event.raw_ref.uri,
      },
    ],
    created_at: now.toISOString(),
  };

  const taskMessage = await taskSessions.sendFollowupMessage({
    task_session_id: taskSessionId,
    text: taskFollowupTextForEvent(event),
    event_ids: [event.id],
    idempotency_key: `inject_${event.idempotency_key}`,
  });

  return { routeDecision, taskMessage };
}

function shouldTryTaskSessionInjection(event: McpEvent): boolean {
  if (event.type === "browser.context_captured") return false;
  if (event.type.endsWith(".review_requested")) return false;
  return event.source === "slack" || event.source === "github" || event.source === "mcp_poll" || event.source === "voice";
}

function taskSessionMatchesTask(candidate: unknown, taskId: string): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0 && record.task_id === taskId;
}

function taskFollowupTextForEvent(event: McpEvent): string {
  const lines = [
    `New ${event.source} event for this task.`,
    `Title: ${event.title}`,
  ];
  if (event.summary) lines.push(`Summary: ${event.summary}`);
  if (event.links.length > 0) {
    lines.push(`Links: ${event.links.map((link) => link.url).join(", ")}`);
  }
  lines.push(`Raw ref: ${event.raw_ref.uri}`);
  return lines.join("\n");
}

async function findQueueItem(store: GatewayStore, queueItemId: string): Promise<QueueItemWithPacket | undefined> {
  return (await store.listQueue()).find((item) => item.id === queueItemId);
}

async function executeQueueAction(
  options: GatewayServerOptions,
  item: QueueItemWithPacket,
  action: Action,
  now: Date,
): Promise<
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; details?: unknown }
> {
  if (action.type !== "resume_agent") {
    return {
      ok: false,
      status: 422,
      code: "unsupported_action",
      message: `recommended action ${action.type} is not executable yet`,
    };
  }

  if (!options.taskSessions?.listSessions) {
    return {
      ok: false,
      status: 501,
      code: "task_sessions_unavailable",
      message: "task session listing is not configured",
    };
  }

  const taskId = item.task_id ?? (typeof action.payload.task_id === "string" ? action.payload.task_id : undefined);
  if (!taskId) {
    return {
      ok: false,
      status: 409,
      code: "task_session_unmatched",
      message: `queue item ${item.id} has no task id`,
    };
  }

  const session = (await options.taskSessions.listSessions()).find((candidate) => taskSessionMatchesTask(candidate, taskId));
  if (!session || !isRecord(session) || typeof session.id !== "string") {
    return {
      ok: false,
      status: 409,
      code: "task_session_unmatched",
      message: `no task session is bound to ${taskId}`,
    };
  }

  const eventId = typeof action.payload.event_id === "string" ? action.payload.event_id : undefined;
  const eventResult = eventId ? await options.store.getEvent(eventId) : undefined;
  const taskMessage = await options.taskSessions.sendFollowupMessage({
    task_session_id: session.id,
    text: taskActionFollowupText(item, eventResult?.event),
    event_ids: eventId ? [eventId] : [],
    idempotency_key: `queue_action_${item.id}_${action.id}`,
  });

  if (isRecord(taskMessage) && taskMessage.status === "blocked") {
    return {
      ok: false,
      status: 409,
      code: "task_message_blocked",
      message: `task session ${session.id} did not accept followup`,
      details: taskMessage,
    };
  }

  return {
    ok: true,
    result: {
      type: "resume_agent",
      queue_item_id: item.id,
      review_packet_id: item.review_packet_id,
      task_id: taskId,
      task_session_id: session.id,
      task_message: taskMessage,
      executed_at: now.toISOString(),
    },
  };
}

function taskActionFollowupText(item: QueueItemWithPacket, event: McpEvent | undefined): string {
  const packet = item.review_packet;
  const lines = [
    "Human approved this queue item. Continue work with this context.",
    `Queue item: ${item.id}`,
    `Packet: ${packet.title}`,
    `Summary: ${packet.summary}`,
  ];
  if (packet.decision_needed) lines.push(`Decision: ${packet.decision_needed}`);
  if (event) {
    lines.push(`Source event: ${event.source} ${event.id}`);
    lines.push(`Raw ref: ${event.raw_ref.uri}`);
  }
  const links = [
    ...packet.context.flatMap((resource) => resource.url ? [resource.url] : []),
    ...packet.evidence.flatMap((evidence) => evidence.url ? [evidence.url] : []),
  ];
  if (links.length > 0) {
    lines.push(`Links: ${links.join(", ")}`);
  }
  return lines.join("\n");
}

function validateQueueActionRequest(input: unknown): { ok: true; actorId: string } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "queue action request must be an object" };
  }

  return {
    ok: true,
    actorId: typeof input.actor_id === "string" && input.actor_id ? input.actor_id : "unknown",
  };
}

function taskIdForHint(taskHint: string): string {
  return `task_${stableId(taskHint)}`;
}

function validateTaskFollowupRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
): { ok: true; text: string; eventIds: string[]; idempotencyKey: string } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task followup request must be an object" };
  }

  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    return { ok: false, message: "text must be a non-empty string" };
  }

  const eventIds = Array.isArray(input.event_ids) ? input.event_ids : [];
  if (!eventIds.every((eventId) => typeof eventId === "string" && eventId.length > 0)) {
    return { ok: false, message: "event_ids must be an array of non-empty strings" };
  }

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey;
  if (!idempotencyKey) {
    return { ok: false, message: "idempotency_key or Idempotency-Key header is required" };
  }

  return {
    ok: true,
    text,
    eventIds,
    idempotencyKey,
  };
}

function validateTaskBindingRequest(input: unknown): { ok: true; taskId: string } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "task binding request must be an object" };
  }

  const taskId = typeof input.task_id === "string" ? input.task_id.trim() : "";
  if (!taskId) {
    return { ok: false, message: "task_id must be a non-empty string" };
  }
  if (taskId.length > 200) {
    return { ok: false, message: "task_id must be 200 characters or fewer" };
  }
  if (!/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(taskId)) {
    return { ok: false, message: "task_id must start with task_ and contain only letters, numbers, underscores, or hyphens" };
  }

  return {
    ok: true,
    taskId,
  };
}

function validateMcpPollRequest(
  input: unknown,
  receivedAt: string,
): { ok: true; sourceId: string; events: McpEvent[]; cursor?: string } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "mcp poll request must be an object" };
  }

  const sourceId = typeof input.source_id === "string" && input.source_id ? input.source_id : "mcp_poll";
  if (!Array.isArray(input.items)) {
    return { ok: false, message: "mcp poll request items must be an array" };
  }

  const events: McpEvent[] = [];
  for (const [index, item] of input.items.entries()) {
    if (!isRecord(item)) {
      return { ok: false, message: `mcp poll item ${index} must be an object` };
    }
    const parsed = mcpPollItemToEvent(sourceId, item, receivedAt);
    if (!parsed.ok) {
      return { ok: false, message: `mcp poll item ${index}: ${parsed.message}` };
    }
    events.push(parsed.event);
  }

  const cursor = typeof input.next_cursor === "string" ? input.next_cursor : undefined;
  return { ok: true, sourceId, events, cursor };
}

function mcpPollItemToEvent(
  sourceId: string,
  item: Record<string, unknown>,
  receivedAt: string,
): { ok: true; event: McpEvent } | { ok: false; message: string } {
  const itemId = readNonEmptyString(item, "id");
  const occurredAt = readNonEmptyString(item, "occurred_at");
  const title = readNonEmptyString(item, "title");
  const summary = readNonEmptyString(item, "summary");
  const threadUrl = readNonEmptyString(item, "thread_url");
  const actorId = readNonEmptyString(item, "actor_id");
  const actorName = readNonEmptyString(item, "actor_name");
  const type = readNonEmptyString(item, "type");
  if (!itemId.ok) return itemId;
  if (!occurredAt.ok) return occurredAt;
  if (!title.ok) return title;
  if (!summary.ok) return summary;
  if (!threadUrl.ok) return threadUrl;
  if (!actorId.ok) return actorId;
  if (!actorName.ok) return actorName;
  if (!type.ok) return type;

  const workspaceId = readOptionalString(item, "workspace_id") ?? "unknown_workspace";
  const channelId = readOptionalString(item, "channel_id") ?? "unknown_channel";
  const threadTs = readOptionalString(item, "thread_ts") ?? itemId.value;
  const sourceKey = `${sourceId}:${itemId.value}`;

  return {
    ok: true,
    event: {
      id: `evt_${stableId(sourceKey)}`,
      source: "mcp_poll",
      source_id: sourceKey,
      idempotency_key: sourceKey,
      occurred_at: occurredAt.value,
      received_at: receivedAt,
      actor: {
        id: actorId.value,
        type: "human",
        name: actorName.value,
      },
      project_hint: readOptionalString(item, "project_hint"),
      task_hint: readOptionalString(item, "task_hint"),
      type: type.value,
      title: title.value,
      summary: summary.value,
      raw_ref: {
        id: `raw_${stableId(sourceKey)}`,
        uri: `artifact://raw/${sourceKey}.json`,
        media_type: "application/json",
      },
      links: [{ label: "Source thread", url: threadUrl.value }],
      resources: [
        {
          id: `ctx_${stableId(sourceKey)}`,
          kind: "slack_thread",
          title: "MCP source thread",
          url: threadUrl.value,
          source: "slack",
          captured_at: receivedAt,
          restore_confidence: "high",
          workspace_id: workspaceId,
          channel_id: channelId,
          thread_ts: threadTs,
        },
      ],
    },
  };
}

function parseMcpPollAllRequest(
  input: unknown,
): { ok: true; sourceIds?: string[]; inputsBySourceId: Record<string, unknown> } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "poll-all request must be an object" };
  }

  const sourceIds = input.source_ids;
  if (sourceIds !== undefined) {
    if (!Array.isArray(sourceIds) || sourceIds.some((sourceId) => typeof sourceId !== "string" || !sourceId)) {
      return { ok: false, message: "source_ids must be an array of non-empty strings" };
    }
  }

  const inputsBySourceId = input.inputs_by_source_id;
  if (inputsBySourceId !== undefined && !isRecord(inputsBySourceId)) {
    return { ok: false, message: "inputs_by_source_id must be an object" };
  }

  return {
    ok: true,
    sourceIds: sourceIds as string[] | undefined,
    inputsBySourceId: inputsBySourceId ?? {},
  };
}

function sourceIdsForPollAll(
  sources: unknown,
  requestedSourceIds: string[] | undefined,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (requestedSourceIds) {
    return { ok: true, value: requestedSourceIds };
  }

  if (!Array.isArray(sources)) {
    return { ok: false, message: "MCP source registry listSources must return an array" };
  }

  const ids: string[] = [];
  for (const source of sources) {
    if (!isRecord(source) || typeof source.id !== "string" || !source.id) {
      return { ok: false, message: "MCP source summaries must include non-empty id strings" };
    }
    ids.push(source.id);
  }
  return { ok: true, value: ids };
}

function readNonEmptyString(
  input: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = input[key];
  if (typeof value !== "string" || !value) {
    return { ok: false, message: `${key} must be a non-empty string` };
  }
  return { ok: true, value };
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value ? value : undefined;
}

function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

async function readJsonBody(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const contentType = request.headers["content-type"];
  if (contentType && !String(contentType).includes("application/json")) {
    return { ok: false, message: "content-type must be application/json" };
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }

  if (!body.trim()) {
    return { ok: false, message: "request body must be JSON" };
  }

  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, message: "request body must be valid JSON" };
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendSchemaError(response: ServerResponse, context: RequestContext, message: string): void {
  sendError(response, 400, context, "schema_error", message);
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  context: RequestContext,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      details,
    },
    request_id: context.requestId,
  };

  sendJson(response, statusCode, body);
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
