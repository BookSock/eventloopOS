import type { McpSourcePollOutput } from "../integrations/mcp_poll/development_registry.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { Observability } from "../observability.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export type McpSourceRegistry = {
  listSources: () => Promise<unknown[]> | unknown[];
  getSource?: (sourceId: string) => Promise<unknown | undefined> | unknown | undefined;
  pollSource: (sourceId: string, input: unknown, receivedAt: string) => Promise<McpSourcePollOutput | undefined> | McpSourcePollOutput | undefined;
};

export type McpEventRouter = (event: McpEvent, now: Date) => Promise<unknown>;

export async function handleMcpSourcesRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  mcpSources?: McpSourceRegistry;
  observability: Observability;
  now: Date;
  requestId: string;
  routeEvent: McpEventRouter;
}): Promise<RouteResult | undefined> {
  if (input.method === "POST" && input.pathname === "/mcp/poll") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    const pollValidation = validateMcpPollRequest(parsed.value, input.now.toISOString());
    if (!pollValidation.ok) return schemaError(pollValidation.message);

    return ok(200, {
      source_id: pollValidation.sourceId,
      events: pollValidation.events,
      duplicates_ignored: 0,
      cursor: pollValidation.cursor,
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname === "/mcp-sources") {
    if (!input.mcpSources) {
      return error(501, "mcp_sources_unavailable", "MCP source registry is not configured");
    }

    const sources = await input.mcpSources.listSources();
    return ok(200, {
      sources,
      count: Array.isArray(sources) ? sources.length : 0,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/mcp-sources/poll-all-and-route") {
    if (!input.mcpSources) {
      return error(501, "mcp_sources_unavailable", "MCP source registry is not configured");
    }

    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    const requestBody = parseMcpPollAllRequest(parsed.value);
    if (!requestBody.ok) return schemaError(requestBody.message);

    const sources = await input.mcpSources.listSources();
    const sourceIds = sourceIdsForPollAll(sources, requestBody.sourceIds);
    if (!sourceIds.ok) return schemaError(sourceIds.message);

    const polled = [];
    let eventsSeen = 0;
    let routedCount = 0;
    let duplicatesIgnored = 0;
    let errors = 0;

    for (const sourceId of sourceIds.value) {
      try {
        const sourceInput = requestBody.inputsBySourceId[sourceId] ?? { items: [] };
        const pollResult = await input.mcpSources.pollSource(sourceId, sourceInput, input.now.toISOString());
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
          routed.push(await input.routeEvent(event, input.now));
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
      } catch (caught) {
        errors += 1;
        polled.push({
          source_id: sourceId,
          ok: false,
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }

    await input.observability.incrementCounter("mcp_poll_cycles_total");
    await input.observability.incrementCounter("mcp_poll_errors_total", errors);
    await input.observability.recordActivity({
      type: "mcp_poll_cycle",
      occurred_at: input.now.toISOString(),
      actor: "system",
      status: errors === 0 ? "ok" : "failed",
      summary: `MCP poll cycle saw ${eventsSeen} event(s) from ${sourceIds.value.length} source(s)`,
      details: {
        sources_seen: sourceIds.value.length,
        events_seen: eventsSeen,
        routed_count: routedCount,
        duplicates_ignored: duplicatesIgnored,
        errors,
      },
    });

    return ok(200, {
      ok: errors === 0,
      sources_seen: sourceIds.value.length,
      events_seen: eventsSeen,
      routed_count: routedCount,
      duplicates_ignored: duplicatesIgnored,
      errors,
      polled,
      request_id: input.requestId,
    });
  }

  const getMcpSourceMatch = input.pathname.match(/^\/mcp-sources\/([^/]+)$/);
  if (input.method === "GET" && getMcpSourceMatch) {
    if (!input.mcpSources?.getSource) {
      return error(501, "mcp_sources_unavailable", "MCP source lookup is not configured");
    }

    const sourceId = decodeURIComponent(getMcpSourceMatch[1] ?? "");
    const source = await input.mcpSources.getSource(sourceId);
    if (!source) return error(404, "not_found", `MCP source ${sourceId} was not found`);

    return ok(200, {
      source,
      request_id: input.requestId,
    });
  }

  const pollMcpSourceMatch = input.pathname.match(/^\/mcp-sources\/([^/]+)\/poll$/);
  if (input.method === "POST" && pollMcpSourceMatch) {
    if (!input.mcpSources) {
      return error(501, "mcp_sources_unavailable", "MCP source registry is not configured");
    }

    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    const sourceId = decodeURIComponent(pollMcpSourceMatch[1] ?? "");
    try {
      const result = await input.mcpSources.pollSource(sourceId, parsed.value, input.now.toISOString());
      if (!result) return error(404, "not_found", `MCP source ${sourceId} was not found`);

      return ok(200, {
        source_id: sourceId,
        events: result.events,
        duplicates_ignored: result.duplicates_ignored,
        cursor: result.cursor,
        request_id: input.requestId,
      });
    } catch (caught) {
      return schemaError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const pollAndRouteMcpSourceMatch = input.pathname.match(/^\/mcp-sources\/([^/]+)\/poll-and-route$/);
  if (input.method === "POST" && pollAndRouteMcpSourceMatch) {
    if (!input.mcpSources) {
      return error(501, "mcp_sources_unavailable", "MCP source registry is not configured");
    }

    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    const sourceId = decodeURIComponent(pollAndRouteMcpSourceMatch[1] ?? "");
    try {
      const pollResult = await input.mcpSources.pollSource(sourceId, parsed.value, input.now.toISOString());
      if (!pollResult) return error(404, "not_found", `MCP source ${sourceId} was not found`);

      const routed = [];
      for (const event of pollResult.events) {
        routed.push(await input.routeEvent(event, input.now));
      }

      return ok(200, {
        source_id: sourceId,
        events_seen: pollResult.events.length,
        routed,
        duplicates_ignored: pollResult.duplicates_ignored,
        cursor: pollResult.cursor,
        request_id: input.requestId,
      });
    } catch (caught) {
      return schemaError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return undefined;
}

export function validateMcpPollRequest(
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

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
