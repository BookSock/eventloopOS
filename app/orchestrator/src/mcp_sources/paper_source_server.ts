import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpPollResult } from "../integrations/mcp_poll/types.js";

export type PaperSourceKind = "doc" | "pdf" | "image" | "note";

export type PaperInput = {
  id: string;
  title: string;
  body_markdown: string;
  task_hint: string;
  file_uri?: string;
  source_kind?: PaperSourceKind;
  occurred_at?: string;
};

const KNOWN_SOURCE_KINDS: ReadonlySet<PaperSourceKind> = new Set(["doc", "pdf", "image", "note"]);

export function createPaperSourceServer(): McpServer {
  const server = new McpServer({
    name: "eventloopos-paper-source",
    version: "0.0.0",
  });

  server.registerTool(
    "list_papers",
    {
      title: "List paper intake items",
      description: "Accept note/doc/pdf/image-style intake papers and return them as eventloopOS MCP poll items.",
      inputSchema: {
        cursor: z.string().optional(),
        papers: z
          .union([
            z.record(z.string(), z.unknown()),
            z.array(z.record(z.string(), z.unknown())),
          ])
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      const result = listPaperItems(args.papers);
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

export function listPaperItems(input: unknown): McpPollResult {
  const papers = parsePaperInputs(input);
  const items = papers.map(paperInputToPollItem);
  return { items };
}

export function parsePaperInputs(input: unknown): PaperInput[] {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) {
    return input.map((entry, index) => parsePaperInput(entry, `papers[${index}]`));
  }
  if (isRecord(input)) {
    if (Array.isArray(input.papers)) {
      return input.papers.map((entry, index) => parsePaperInput(entry, `papers[${index}]`));
    }
    if (isRecord(input.papers)) {
      return [parsePaperInput(input.papers, "papers")];
    }
    if (input.id !== undefined || input.title !== undefined || input.body_markdown !== undefined) {
      return [parsePaperInput(input, "paper")];
    }
    return [];
  }
  throw new Error("paper source input must be an object, array, or omitted");
}

export function parsePaperInput(input: unknown, label: string): PaperInput {
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object`);
  }
  const id = requireString(input, "id", label);
  const title = requireString(input, "title", label);
  const bodyMarkdown = requireString(input, "body_markdown", label);
  const taskHint = requireString(input, "task_hint", label);
  const fileUri = optionalString(input, "file_uri");
  const sourceKind = optionalSourceKind(input.source_kind, label);
  const occurredAt = optionalString(input, "occurred_at");
  return {
    id,
    title,
    body_markdown: bodyMarkdown,
    task_hint: taskHint,
    file_uri: fileUri,
    source_kind: sourceKind,
    occurred_at: occurredAt,
  };
}

export function paperInputToPollItem(paper: PaperInput): Record<string, unknown> {
  const sourceKind: PaperSourceKind = paper.source_kind ?? (paper.file_uri ? inferSourceKindFromUri(paper.file_uri) : "note");
  const sourceId = `paper:${paper.id}`;
  const idempotencyKey = `${sourceId}:${stableHash([paper.id, paper.title, paper.body_markdown, paper.file_uri ?? ""])}`;
  return {
    id: paper.id,
    source_id: sourceId,
    idempotency_key: idempotencyKey,
    type: `paper.${sourceKind}`,
    title: paper.title,
    summary: paper.body_markdown,
    task_hint: paper.task_hint,
    occurred_at: paper.occurred_at,
    url: paper.file_uri,
    resource_kind: "paper",
    resource_title: paper.title,
    body_markdown: paper.body_markdown,
    file_uri: paper.file_uri,
    source_kind: sourceKind,
  };
}

function inferSourceKindFromUri(uri: string): PaperSourceKind {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|heic|tiff?|bmp|svg)(\?|#|$)/.test(lower)) return "image";
  if (/\.(md|markdown|txt|rtf|docx?|pages|odt)(\?|#|$)/.test(lower)) return "doc";
  return "note";
}

function optionalSourceKind(value: unknown, label: string): PaperSourceKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${label}.source_kind must be a string`);
  }
  if (!KNOWN_SOURCE_KINDS.has(value as PaperSourceKind)) {
    throw new Error(`${label}.source_kind must be one of doc, pdf, image, note`);
  }
  return value as PaperSourceKind;
}

function requireString(input: Record<string, unknown>, key: string, label: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createPaperSourceServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
