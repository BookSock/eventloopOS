import type { RestorePlanBuilder } from "./registry.js";
import { isRecord, readUrl, stringFromRecord } from "./helpers.js";

export const buildPaperPlan: RestorePlanBuilder = (resource) => {
  const fileUri = paperFileUri(resource);
  const url = fileUri ?? readUrl(resource);
  const bodyMarkdown = paperBodyMarkdown(resource);
  const sourceKind = paperSourceKind(resource);
  const title = stringFromRecord(resource, "title");

  if (url) {
    return {
      kind: "open_url",
      side_effect: "local",
      execute_supported: false,
      url,
      paper: compact({
        title,
        source_kind: sourceKind,
        body_markdown: bodyMarkdown,
      }),
    };
  }

  if (bodyMarkdown) {
    return {
      kind: "show_paper",
      side_effect: "local",
      execute_supported: false,
      paper: compact({
        title,
        source_kind: sourceKind ?? "note",
        body_markdown: bodyMarkdown,
      }),
    };
  }

  return undefined;
};

function paperFileUri(resource: Record<string, unknown>): string | undefined {
  const direct = stringFromRecord(resource, "file_uri");
  if (direct) return direct;
  const details = isRecord(resource.details) ? resource.details : undefined;
  if (details) {
    const fromDetails = stringFromRecord(details, "file_uri");
    if (fromDetails) return fromDetails;
  }
  return undefined;
}

function paperBodyMarkdown(resource: Record<string, unknown>): string | undefined {
  const direct = stringFromRecord(resource, "body_markdown");
  if (direct) return direct;
  const details = isRecord(resource.details) ? resource.details : undefined;
  if (details) {
    const fromDetails = stringFromRecord(details, "body_markdown");
    if (fromDetails) return fromDetails;
  }
  return undefined;
}

function paperSourceKind(resource: Record<string, unknown>): string | undefined {
  const direct = stringFromRecord(resource, "source_kind");
  if (direct) return direct;
  const details = isRecord(resource.details) ? resource.details : undefined;
  if (details) {
    const fromDetails = stringFromRecord(details, "source_kind");
    if (fromDetails) return fromDetails;
  }
  return undefined;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
