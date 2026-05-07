import type { InMemoryStore, RouteDecision, StoredEventResult } from "../store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import { taskIdForHint } from "./ids.js";

export type ContextEntry = {
  event_id: string;
  event_title: string;
  event_source: string;
  task_id?: string;
  route_decision: RouteDecision;
  resource: Record<string, unknown>;
  captured_at: string;
  relevance_score: number;
  match_reasons: string[];
};

export type ContextQuery = {
  source?: string;
  task_id?: string;
  q?: string;
  limit?: number;
};

export function listContextEntries(store: InMemoryStore, query: ContextQuery = {}): ContextEntry[] {
  const limit = query.limit ?? 100;
  return rankContextEntries(
    [...store.eventsById.values()]
      .filter((result) => eventMatchesContextQuery(result.event, query))
      .flatMap(contextEntriesForResult)
      .filter((entry) => contextEntryMatchesQuery(entry, query)),
    query,
  )
    .slice(0, limit);
}

export function contextEntryMatchesQuery(entry: ContextEntry, query: ContextQuery): boolean {
  if (!query.q) return true;
  const needle = query.q.toLowerCase();
  const searchText = contextEntrySearchText(entry).toLowerCase();
  if (searchText.includes(needle)) return true;
  const terms = contextQueryTerms(needle);
  return terms.length > 0 && terms.every((term) => searchText.includes(term));
}

export function rankContextEntries(entries: ContextEntry[], query: ContextQuery = {}): ContextEntry[] {
  return entries
    .map((entry) => scoreContextEntry(entry, query))
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }
      return right.captured_at.localeCompare(left.captured_at);
    });
}

export function contextEntriesForResult(result: StoredEventResult): ContextEntry[] {
  return result.event.resources.map((resource): ContextEntry => {
    const capturedAt = typeof resource.captured_at === "string" && resource.captured_at
      ? resource.captured_at
      : result.event.received_at;

    return {
      event_id: result.event.id,
      event_title: result.event.title,
      event_source: result.event.source,
      task_id: taskIdForHint(result.event.task_hint),
      route_decision: result.route_decision,
      resource,
      captured_at: capturedAt,
      relevance_score: 0,
      match_reasons: [],
    };
  });
}

export function resourceSearchParts(resource: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const key of ["id", "kind", "title", "url", "source", "text_quote", "selector_hint"]) {
    const value = resource[key];
    if (typeof value === "string") parts.push(value);
  }
  const details = resource.details;
  if (details && typeof details === "object") {
    parts.push(JSON.stringify(details));
  }
  return parts;
}

function eventMatchesContextQuery(event: McpEvent, query: ContextQuery): boolean {
  if (query.source && event.source !== query.source) return false;
  if (query.task_id && taskIdForHint(event.task_hint) !== query.task_id) return false;
  return true;
}

function scoreContextEntry(entry: ContextEntry, query: ContextQuery): ContextEntry {
  const reasons: string[] = [];
  let score = 0;

  if (query.task_id && entry.task_id === query.task_id) {
    score += 100;
    reasons.push("task_match");
  }

  const normalizedQuery = query.q?.toLowerCase();
  if (normalizedQuery) {
    const resource = entry.resource;
    const title = `${entry.event_title}\n${typeof resource.title === "string" ? resource.title : ""}`.toLowerCase();
    const url = typeof resource.url === "string" ? resource.url.toLowerCase() : "";
    const textQuote = typeof resource.text_quote === "string" ? resource.text_quote.toLowerCase() : "";
    const searchText = contextEntrySearchText(entry).toLowerCase();
    const terms = contextQueryTerms(normalizedQuery);

    if (title.includes(normalizedQuery)) {
      score += 60;
      reasons.push("title_phrase");
    }
    if (textQuote.includes(normalizedQuery)) {
      score += 40;
      reasons.push("quote_phrase");
    }
    if (url.includes(normalizedQuery)) {
      score += 30;
      reasons.push("url_phrase");
    }

    const matchingTerms = terms.filter((term) => searchText.includes(term));
    if (matchingTerms.length > 0) {
      score += matchingTerms.length * 10;
      reasons.push("term_match");
    }
  } else {
    reasons.push("recent");
  }

  return {
    ...entry,
    relevance_score: score,
    match_reasons: [...new Set(reasons)],
  };
}

function contextEntrySearchText(entry: ContextEntry): string {
  return [
    entry.event_id,
    entry.event_title,
    entry.event_source,
    entry.task_id,
    ...resourceSearchParts(entry.resource),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
}

function contextQueryTerms(normalizedQuery: string): string[] {
  return normalizedQuery.split(/\s+/).filter(Boolean);
}
