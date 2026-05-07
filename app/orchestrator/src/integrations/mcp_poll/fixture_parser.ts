import { readFile } from "node:fs/promises";
import { normalizeUnknownResource } from "../../context/deeplink_normalizers.js";
import type { McpEvent, McpPollResult, McpPollSourceConfig } from "./types.js";

export async function readMcpPollFixture(path: string): Promise<McpPollResult> {
  const text = await readFile(path, "utf8");
  return parseMcpPollFixture(JSON.parse(text));
}

export function parseMcpPollFixture(input: unknown): McpPollResult {
  if (!isRecord(input) || !Array.isArray(input.items)) {
    throw new Error("MCP poll fixture must contain items array");
  }
  if (!input.items.every(isRecord)) {
    throw new Error("MCP poll fixture items must be objects");
  }
  if (input.nextCursor !== undefined && typeof input.nextCursor !== "string") {
    throw new Error("MCP poll fixture nextCursor must be a string");
  }
  return {
    items: input.items,
    nextCursor: input.nextCursor,
  };
}

export function mapMcpPollItemToEvent(
  config: McpPollSourceConfig,
  item: Record<string, unknown>,
  receivedAt: string,
): McpEvent {
  switch (config.eventMapper) {
    case "slack_message_to_event":
      return slackMessageToEvent(item, receivedAt);
    case "github_update_to_event":
      return githubUpdateToEvent(item, receivedAt);
    case "generic_item_to_event":
      return genericItemToEvent(config, item, receivedAt);
  }
}

function slackMessageToEvent(item: Record<string, unknown>, receivedAt: string): McpEvent {
  const workspaceId = requireString(item, "team_id");
  const channelId = requireString(item, "channel_id");
  const ts = requireString(item, "ts");
  const text = requireString(item, "text");
  const permalink = optionalString(item, "permalink") ?? `slack://channel/${channelId}/${ts}`;
  const userId = optionalString(item, "user_id") ?? "unknown";
  const userName = optionalString(item, "user_name") ?? userId;
  const threadTs = optionalString(item, "thread_ts") ?? ts;
  const sourceId = `slack:${workspaceId}:${channelId}:${ts}`;

  return {
    id: eventId("slack", workspaceId, channelId, ts),
    source: "slack",
    source_id: sourceId,
    idempotency_key: sourceId,
    occurred_at: requireString(item, "occurred_at"),
    received_at: receivedAt,
    actor: {
      id: `actor_slack_${userId}`,
      type: "human",
      name: userName,
    },
    project_hint: optionalString(item, "project_hint"),
    task_hint: optionalString(item, "task_hint"),
    type: "slack.message",
    title: optionalString(item, "title") ?? `Slack message from ${userName}`,
    summary: text,
    raw_ref: {
      id: `raw_${sourceId.replaceAll(":", "_")}`,
      uri: `artifact://raw/${sourceId}.json`,
      media_type: "application/json",
    },
    links: [
      {
        label: "Slack thread",
        url: permalink,
      },
    ],
    resources: [
      normalizeUnknownResource({
        id: `ctx_${sourceId.replaceAll(":", "_")}`,
        kind: "slack_thread",
        title: optionalString(item, "resource_title") ?? "Slack thread",
        url: permalink,
        source: "slack",
        captured_at: receivedAt,
        restore_confidence: "high",
        workspace_id: workspaceId,
        channel_id: channelId,
        thread_ts: threadTs,
      }, {
        id: `ctx_${sourceId.replaceAll(":", "_")}`,
        title: optionalString(item, "resource_title") ?? "Slack thread",
        source: "slack",
        captured_at: receivedAt,
      }),
    ],
  };
}

function githubUpdateToEvent(item: Record<string, unknown>, receivedAt: string): McpEvent {
  const repo = requireString(item, "repo");
  const updateId = requireString(item, "id");
  const url = requireString(item, "url");
  const title = requireString(item, "title");
  const body = requireString(item, "body");
  const actor = optionalString(item, "actor") ?? "unknown";
  const sourceId = `github:${repo}:${updateId}`;

  return {
    id: eventId("github", repo, updateId),
    source: "github",
    source_id: sourceId,
    idempotency_key: sourceId,
    occurred_at: requireString(item, "occurred_at"),
    received_at: receivedAt,
    actor: {
      id: `actor_github_${actor}`,
      type: "human",
      name: actor,
    },
    project_hint: optionalString(item, "project_hint"),
    task_hint: optionalString(item, "task_hint"),
    type: optionalString(item, "type") ?? "github.update",
    title,
    summary: body,
    raw_ref: {
      id: `raw_${sourceId.replaceAll(":", "_").replaceAll("/", "_")}`,
      uri: `artifact://raw/${sourceId}.json`,
      media_type: "application/json",
    },
    links: [
      {
        label: "GitHub update",
        url,
      },
    ],
    resources: [
      normalizeUnknownResource({
        id: `ctx_${sourceId.replaceAll(":", "_").replaceAll("/", "_")}`,
        kind: "github",
        title,
        url,
        source: "github",
        captured_at: receivedAt,
        restore_confidence: "high",
        repo,
      }, {
        id: `ctx_${sourceId.replaceAll(":", "_").replaceAll("/", "_")}`,
        title,
        source: "github",
        captured_at: receivedAt,
      }),
    ],
  };
}

function genericItemToEvent(config: McpPollSourceConfig, item: Record<string, unknown>, receivedAt: string): McpEvent {
  const itemId = optionalString(item, "id") ?? optionalString(item, "source_id") ?? optionalString(item, "url");
  if (!itemId) {
    throw new Error("MCP poll item id, source_id, or url must be a non-empty string");
  }

  const source = optionalString(item, "source") ?? "mcp_poll";
  const sourceId = optionalString(item, "source_id") ?? `${config.id}:${itemId}`;
  const title = optionalString(item, "title") ?? optionalString(item, "name") ?? `MCP item ${itemId}`;
  const summary = optionalString(item, "summary") ?? optionalString(item, "text") ?? title;
  const occurredAt = optionalString(item, "occurred_at") ?? receivedAt;

  return {
    id: optionalString(item, "event_id") ?? eventId(source, sourceId),
    source,
    source_id: sourceId,
    idempotency_key: optionalString(item, "idempotency_key") ?? sourceId,
    occurred_at: occurredAt,
    received_at: receivedAt,
    actor: genericActor(config, item),
    project_hint: optionalString(item, "project_hint"),
    task_hint: optionalString(item, "task_hint"),
    type: optionalString(item, "type") ?? "mcp.item",
    title,
    summary,
    raw_ref: genericRawRef(sourceId, item),
    links: genericLinks(item),
    resources: genericResources(config, item, sourceId, title, receivedAt),
  };
}

function genericActor(config: McpPollSourceConfig, item: Record<string, unknown>): McpEvent["actor"] {
  const actor = item.actor;
  if (isRecord(actor)) {
    const id = optionalString(actor, "id");
    const type = optionalString(actor, "type");
    if (!id) {
      throw new Error("MCP poll item actor.id must be a non-empty string");
    }
    if (type !== "human" && type !== "agent" && type !== "system") {
      throw new Error("MCP poll item actor.type must be one of human, agent, system");
    }
    return {
      id,
      type,
      name: optionalString(actor, "name"),
    };
  }

  const actorId = optionalString(item, "actor_id");
  const actorName = optionalString(item, "actor_name") ?? actorId;
  if (actorId) {
    return {
      id: `actor_mcp_${safeId(actorId)}`,
      type: "human",
      name: actorName,
    };
  }

  return {
    id: `actor_mcp_${safeId(config.id)}`,
    type: "system",
    name: config.server.name,
  };
}

function genericRawRef(sourceId: string, item: Record<string, unknown>): McpEvent["raw_ref"] {
  const rawRef = item.raw_ref;
  if (isRecord(rawRef)) {
    return {
      id: requireString(rawRef, "id"),
      uri: requireString(rawRef, "uri"),
      media_type: requireString(rawRef, "media_type"),
    };
  }

  return {
    id: `raw_${safeId(sourceId)}`,
    uri: `artifact://raw/${sourceId}.json`,
    media_type: "application/json",
  };
}

function genericLinks(item: Record<string, unknown>): McpEvent["links"] {
  const links = item.links;
  if (Array.isArray(links)) {
    return links.map((link, index) => {
      if (!isRecord(link)) {
        throw new Error("MCP poll item links must be objects");
      }
      return {
        label: optionalString(link, "label") ?? `Link ${index + 1}`,
        url: requireString(link, "url"),
      };
    });
  }

  const url = optionalString(item, "url");
  return url ? [{ label: optionalString(item, "url_label") ?? "Source", url }] : [];
}

function genericResources(
  config: McpPollSourceConfig,
  item: Record<string, unknown>,
  sourceId: string,
  title: string,
  receivedAt: string,
): Array<Record<string, unknown>> {
  const resources = item.resources;
  if (Array.isArray(resources)) {
    if (!resources.every(isRecord)) {
      throw new Error("MCP poll item resources must be objects");
    }
    return resources.map((resource, index) => normalizeUnknownResource(resource, {
      id: `ctx_${safeId(sourceId)}_${index + 1}`,
      title,
      source: config.id,
      captured_at: receivedAt,
    }));
  }

  const url = optionalString(item, "url");
  if (!url) {
    return [];
  }

  return [
    normalizeUnknownResource({
      id: `ctx_${safeId(sourceId)}`,
      kind: optionalString(item, "resource_kind") ?? "external_resource",
      title,
      url,
      source: config.id,
      captured_at: receivedAt,
      restore_confidence: optionalString(item, "restore_confidence") ?? "medium",
    }, {
      id: `ctx_${safeId(sourceId)}`,
      title,
      source: config.id,
      captured_at: receivedAt,
    }),
  ];
}

function eventId(...parts: string[]): string {
  return `evt_${parts.join("_").replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function safeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MCP poll item ${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
