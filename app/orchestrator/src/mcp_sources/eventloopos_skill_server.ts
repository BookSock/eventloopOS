import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpEvent } from "../integrations/mcp_poll/types.js";

// Phase 7a — eventloopos.enqueue_paper MCP skill.
//
// Exposes one stdio MCP tool to coding agents (Codex / Claude). When an agent
// determines it is waiting on a human, it invokes the tool with a body and
// optional task scope. The tool synthesizes an `eventloopos.skill_paper_enqueued`
// McpEvent and POSTs it to the orchestrator's /events endpoint, taking the
// same path Phase 5's auto-paper watcher uses (ingestEventAsReviewPacket).
//
// The MCP server is intentionally thin: it only validates input, builds an
// event, and forwards it. Task resolution (task_id vs task_hint), idempotency,
// and ingestion live server-side so agents cannot bypass them.

export const SKILL_TOOL_NAME = "eventloopos.enqueue_paper";
export const SKILL_EVENT_TYPE = "eventloopos.skill_paper_enqueued";
export const SKILL_EVENT_SOURCE = "eventloopos_skill";

const URGENCY_VALUES = ["low", "medium", "high"] as const;
const SOURCE_KIND_VALUES = ["agent_done", "agent_blocked", "agent_question"] as const;

export type SkillUrgency = (typeof URGENCY_VALUES)[number];
export type SkillSourceKind = (typeof SOURCE_KIND_VALUES)[number];

export type EnqueuePaperInput = {
  task_id?: string;
  task_hint?: string;
  body_markdown: string;
  urgency?: SkillUrgency;
  source_kind?: SkillSourceKind;
  idempotency_key?: string;
  title?: string;
};

export type EnqueuePaperResponse = {
  ok: true;
  queue_item_id?: string;
  event_id: string;
  idempotency_key: string;
};

export type SkillFetchFn = typeof fetch;

export type SkillServerDeps = {
  env?: NodeJS.ProcessEnv;
  fetchFn?: SkillFetchFn;
  now?: () => Date;
  randomId?: () => string;
};

export function createEventloopOsSkillServer(deps: SkillServerDeps = {}): McpServer {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => randomUUID());

  const server = new McpServer({
    name: "eventloopos-skill",
    version: "0.0.0",
  });

  server.registerTool(
    SKILL_TOOL_NAME,
    {
      title: "Enqueue eventloopOS paper",
      description:
        "Self-report that this agent is waiting on a human. Posts a paper into the eventloopOS queue scoped to a task.",
      inputSchema: {
        task_id: z.string().min(1).optional(),
        task_hint: z.string().min(1).optional(),
        body_markdown: z.string().min(1),
        urgency: z.enum(URGENCY_VALUES).optional(),
        source_kind: z.enum(SOURCE_KIND_VALUES).optional(),
        idempotency_key: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async (args): Promise<CallToolResult> => {
      const result = await enqueuePaperFromArgs(args, { env, fetchFn, now, randomId });
      return {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  return server;
}

export async function enqueuePaperFromArgs(
  input: EnqueuePaperInput,
  context: {
    env: NodeJS.ProcessEnv;
    fetchFn: SkillFetchFn;
    now: () => Date;
    randomId: () => string;
  },
): Promise<EnqueuePaperResponse> {
  const baseUrl = (context.env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377").replace(/\/+$/, "");
  const token = context.env.EVENTLOOPOS_SKILL_TOKEN?.trim();

  if (!input.task_id && !input.task_hint) {
    throw new Error("eventloopos.enqueue_paper requires task_id or task_hint");
  }

  const occurredAt = context.now().toISOString();
  const event = buildSkillEvent({
    input,
    occurredAt,
    randomId: context.randomId,
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": event.idempotency_key,
  };
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }

  const response = await context.fetchFn(`${baseUrl}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({ event }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`orchestrator rejected enqueue_paper: ${response.status} ${bodyText}`);
  }
  const parsed = parseJsonResponse(bodyText);
  return {
    ok: true,
    event_id: event.id,
    idempotency_key: event.idempotency_key,
    queue_item_id: extractQueueItemId(parsed),
  };
}

export function buildSkillEvent(input: {
  input: EnqueuePaperInput;
  occurredAt: string;
  randomId: () => string;
}): McpEvent {
  const { input: args, occurredAt, randomId } = input;
  const taskHint = resolveTaskHint(args);
  const idempotencyKey = args.idempotency_key?.trim() ?? defaultIdempotencyKey(args, occurredAt);
  const eventId = `evt_skill_${stableHash([idempotencyKey, randomId()])}`;
  const urgency: SkillUrgency = args.urgency ?? "medium";
  const sourceKind: SkillSourceKind = args.source_kind ?? "agent_done";
  const title = args.title?.trim() || defaultTitle(sourceKind, taskHint);

  return {
    id: eventId,
    source: SKILL_EVENT_SOURCE,
    source_id: args.task_id ?? `hint:${taskHint}`,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt,
    received_at: occurredAt,
    actor: {
      id: "agent_skill",
      type: "agent",
      name: "eventloopOS skill caller",
    },
    task_hint: taskHint,
    type: SKILL_EVENT_TYPE,
    title,
    summary: args.body_markdown,
    raw_ref: {
      id: `raw_${eventId}`,
      uri: `eventloopos://skill/${idempotencyKey}`,
      media_type: "text/markdown",
    },
    links: [],
    resources: [
      {
        id: `ctx_${eventId}`,
        kind: "skill_self_report",
        title,
        source: SKILL_EVENT_SOURCE,
        captured_at: occurredAt,
        restore_confidence: "low",
        details: {
          urgency,
          source_kind: sourceKind,
          task_id: args.task_id,
          task_hint: args.task_hint,
        },
      },
    ],
  };
}

function resolveTaskHint(args: EnqueuePaperInput): string {
  if (args.task_id) {
    return args.task_id.startsWith("task_") ? args.task_id.slice("task_".length) : args.task_id;
  }
  return args.task_hint!;
}

function defaultIdempotencyKey(args: EnqueuePaperInput, occurredAt: string): string {
  const scope = args.task_id ?? args.task_hint ?? "unscoped";
  const digest = stableHash([scope, args.body_markdown, args.source_kind ?? "agent_done", occurredAt]);
  return `eventloopos_skill:${digest}`;
}

function defaultTitle(sourceKind: SkillSourceKind, taskHint: string): string {
  switch (sourceKind) {
    case "agent_blocked":
      return `Agent blocked on ${taskHint}`;
    case "agent_question":
      return `Agent question for ${taskHint}`;
    default:
      return `Agent done on ${taskHint}`;
  }
}

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function parseJsonResponse(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function extractQueueItemId(parsed: unknown): string | undefined {
  if (!isRecord(parsed)) return undefined;
  const queueItem = parsed.queue_item;
  if (isRecord(queueItem) && typeof queueItem.id === "string") return queueItem.id;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createEventloopOsSkillServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
