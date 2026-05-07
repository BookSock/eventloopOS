import type { ContextResource } from "../contracts.js";

export type DeeplinkProvider = "slack" | "github" | "notion" | "google_docs" | "figma" | "browser";

export type DeeplinkInput = {
  id: string;
  title: string;
  url?: string;
  source?: string;
  captured_at?: string;
  kind?: string;
  restore_confidence?: "high" | "medium" | "low";
  details?: Record<string, unknown>;
  fields?: Record<string, unknown>;
};

export function normalizeDeeplinkResource(input: DeeplinkInput): ContextResource {
  const base: ContextResource = {
    id: input.id,
    kind: input.kind ?? "url",
    title: input.title,
    url: input.url,
    source: input.source,
    captured_at: input.captured_at,
    restore_confidence: input.restore_confidence ?? "medium",
    details: input.details,
  };
  const fields = input.fields ?? {};
  const url = parseUrl(input.url);

  return (
    normalizeSlackResource(base, fields, url)
    ?? normalizeGitHubResource(base, fields, url)
    ?? normalizeNotionResource(base, fields, url)
    ?? normalizeGoogleDocsResource(base, fields, url)
    ?? normalizeFigmaResource(base, fields, url)
    ?? normalizeBrowserResource(base, url)
  );
}

export function normalizeUnknownResource(
  resource: Record<string, unknown>,
  fallback: { id: string; title: string; source?: string; captured_at?: string },
): ContextResource {
  const normalized = normalizeDeeplinkResource({
    id: stringOr(resource.id, fallback.id),
    kind: optionalString(resource.kind),
    title: stringOr(resource.title, fallback.title),
    url: optionalString(resource.url),
    source: optionalString(resource.source) ?? fallback.source,
    captured_at: optionalString(resource.captured_at) ?? fallback.captured_at,
    restore_confidence: confidenceOr(resource.restore_confidence, undefined),
    details: recordOr(resource.details),
    fields: resource,
  });
  return {
    ...resource,
    ...normalized,
  } as ContextResource;
}

function normalizeSlackResource(base: ContextResource, fields: Record<string, unknown>, url: URL | undefined): ContextResource | undefined {
  const channelId = optionalString(fields.channel_id) ?? channelFromSlackUrl(url);
  const messageTs = optionalString(fields.message_ts) ?? optionalString(fields.ts) ?? messageTsFromSlackUrl(url);
  const threadTs = optionalString(fields.thread_ts) ?? messageTs;
  const teamId = optionalString(fields.team_id) ?? optionalString(fields.workspace_id);
  if (base.source !== "slack" && base.kind !== "slack_thread" && !channelId) return undefined;

  return withDetails({
    ...base,
    kind: "slack_thread",
    restore_confidence: base.url ? "high" : "medium",
  }, {
    provider: "slack",
    confidence_reason: base.url ? "slack_permalink" : "slack_ids",
    team_id: teamId,
    channel_id: channelId,
    message_ts: messageTs,
    thread_ts: threadTs,
  });
}

function normalizeGitHubResource(base: ContextResource, fields: Record<string, unknown>, url: URL | undefined): ContextResource | undefined {
  const parsed = parseGitHubUrl(url);
  const repoText = optionalString(fields.repo);
  const [fieldOwner, fieldRepo] = repoText?.split("/") ?? [];
  const owner = parsed?.owner ?? optionalString(fields.owner) ?? fieldOwner;
  const repo = parsed?.repo ?? optionalString(fields.repo_name) ?? fieldRepo;
  if (base.source !== "github" && base.kind !== "github" && !parsed) return undefined;

  return withDetails({
    ...base,
    kind: "github",
    restore_confidence: base.url ? "high" : "medium",
  }, {
    provider: "github",
    confidence_reason: parsed?.confidenceReason ?? "github_ids",
    owner,
    repo,
    resource_type: parsed?.resourceType ?? optionalString(fields.resource_type),
    number: parsed?.number ?? numberOr(fields.number),
    commit_sha: parsed?.commitSha ?? optionalString(fields.commit_sha),
    file_path: parsed?.filePath ?? optionalString(fields.file_path),
    line_start: parsed?.lineStart ?? numberOr(fields.line_start),
    line_end: parsed?.lineEnd ?? numberOr(fields.line_end),
  });
}

function normalizeNotionResource(base: ContextResource, fields: Record<string, unknown>, url: URL | undefined): ContextResource | undefined {
  if (base.source !== "notion" && !isNotionHost(url)) return undefined;
  const ids = notionIdsFromUrl(url);
  return withDetails({
    ...base,
    kind: "notion_page",
    restore_confidence: ids.blockId ? "medium" : "medium",
  }, {
    provider: "notion",
    confidence_reason: ids.blockId ? "notion_block_link" : "notion_page_link",
    page_id: optionalString(fields.page_id) ?? ids.pageId,
    block_id: optionalString(fields.block_id) ?? ids.blockId,
    text_quote: optionalString(fields.text_quote),
  });
}

function normalizeGoogleDocsResource(base: ContextResource, fields: Record<string, unknown>, url: URL | undefined): ContextResource | undefined {
  const docId = googleDocIdFromUrl(url);
  if (base.source !== "google_docs" && !docId) return undefined;
  return withDetails({
    ...base,
    kind: "google_doc",
    restore_confidence: url?.hash ? "medium" : "medium",
  }, {
    provider: "google_docs",
    confidence_reason: url?.hash ? "google_doc_anchor" : "google_doc_url",
    doc_id: optionalString(fields.doc_id) ?? docId,
    anchor: url?.hash ? url.hash.slice(1) : optionalString(fields.anchor),
    text_quote: optionalString(fields.text_quote),
  });
}

function normalizeFigmaResource(base: ContextResource, fields: Record<string, unknown>, url: URL | undefined): ContextResource | undefined {
  const figma = figmaIdsFromUrl(url);
  if (base.source !== "figma" && !figma.fileKey) return undefined;
  return withDetails({
    ...base,
    kind: "figma_node",
    restore_confidence: figma.nodeId ? "high" : "medium",
  }, {
    provider: "figma",
    confidence_reason: figma.nodeId ? "figma_node_url" : "figma_file_url",
    file_key: optionalString(fields.file_key) ?? figma.fileKey,
    node_id: optionalString(fields.node_id) ?? figma.nodeId,
  });
}

function normalizeBrowserResource(base: ContextResource, url: URL | undefined): ContextResource {
  if (!url) return base;
  return withDetails({
    ...base,
    kind: base.kind === "external_resource" ? "url" : base.kind,
    restore_confidence: base.restore_confidence ?? "medium",
  }, {
    provider: "browser",
    confidence_reason: "generic_url",
  });
}

function parseGitHubUrl(url: URL | undefined): {
  owner: string;
  repo: string;
  resourceType?: string;
  number?: number;
  commitSha?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  confidenceReason: string;
} | undefined {
  if (!url || url.hostname !== "github.com") return undefined;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repo, section, value] = parts;
  if (!owner || !repo) return undefined;
  const lines = githubLinesFromHash(url.hash);
  if (section === "pull" || section === "issues") {
    return {
      owner,
      repo,
      resourceType: section === "pull" ? "pull_request" : "issue",
      number: numberOr(value),
      ...lines,
      confidenceReason: "github_issue_or_pr_permalink",
    };
  }
  if (section === "commit" && value) {
    return { owner, repo, resourceType: "commit", commitSha: value, ...lines, confidenceReason: "github_commit_permalink" };
  }
  if (section === "blob" && value) {
    return {
      owner,
      repo,
      resourceType: "code",
      commitSha: value,
      filePath: parts.slice(4).join("/"),
      ...lines,
      confidenceReason: lines.lineStart ? "github_code_line_permalink" : "github_code_permalink",
    };
  }
  if (section === "actions" && value === "runs") {
    return { owner, repo, resourceType: "workflow_run", number: numberOr(parts[4]), confidenceReason: "github_workflow_run" };
  }
  return { owner, repo, confidenceReason: "github_repo_url" };
}

function githubLinesFromHash(hash: string): { lineStart?: number; lineEnd?: number } {
  const match = hash.match(/^#L(\d+)(?:-L(\d+))?$/);
  if (!match) return {};
  return {
    lineStart: Number(match[1]),
    lineEnd: match[2] ? Number(match[2]) : undefined,
  };
}

function channelFromSlackUrl(url: URL | undefined): string | undefined {
  if (!url || !url.hostname.includes("slack.com")) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const archiveIndex = parts.indexOf("archives");
  return archiveIndex >= 0 ? parts[archiveIndex + 1] : undefined;
}

function messageTsFromSlackUrl(url: URL | undefined): string | undefined {
  if (!url || !url.hostname.includes("slack.com")) return undefined;
  const match = url.pathname.match(/\/p(\d{10})(\d{1,6})/);
  if (!match) return undefined;
  return `${match[1]}.${match[2].padEnd(6, "0")}`;
}

function isNotionHost(url: URL | undefined): boolean {
  return Boolean(url && (url.hostname === "notion.so" || url.hostname.endsWith(".notion.site") || url.hostname.endsWith(".notion.so")));
}

function notionIdsFromUrl(url: URL | undefined): { pageId?: string; blockId?: string } {
  if (!url || !isNotionHost(url)) return {};
  const compactIds = `${url.pathname} ${url.hash}`.match(/[0-9a-f]{32}/gi) ?? [];
  return {
    pageId: compactIds[0],
    blockId: compactIds[1] ?? (url.hash ? url.hash.replace(/^#/, "") : undefined),
  };
}

function googleDocIdFromUrl(url: URL | undefined): string | undefined {
  if (!url || url.hostname !== "docs.google.com") return undefined;
  const match = url.pathname.match(/\/document\/d\/([^/]+)/);
  return match?.[1];
}

function figmaIdsFromUrl(url: URL | undefined): { fileKey?: string; nodeId?: string } {
  if (!url || !url.hostname.endsWith("figma.com")) return {};
  const match = url.pathname.match(/\/(?:file|design)\/([^/]+)/);
  return {
    fileKey: match?.[1],
    nodeId: url.searchParams.get("node-id") ?? undefined,
  };
}

function withDetails(resource: ContextResource, details: Record<string, unknown>): ContextResource {
  return {
    ...resource,
    details: compactRecord({
      ...resource.details,
      ...details,
    }),
  };
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

function parseUrl(url: string | undefined): URL | undefined {
  if (!url) return undefined;
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function numberOr(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function confidenceOr(value: unknown, fallback: "high" | "medium" | "low" | undefined): "high" | "medium" | "low" | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

function recordOr(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
