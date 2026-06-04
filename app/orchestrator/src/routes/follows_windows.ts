import type { Runtime } from "../runtime.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleFollowsWindowsRoute(input: {
  method: string | undefined;
  pathname: string;
  url?: URL;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "GET" && input.pathname === "/follows-windows") {
    const ttlMs = readPositiveInteger(input.url?.searchParams.get("ttl_ms")) ?? 24 * 60 * 60 * 1_000;
    const minWorkspaceCount = readPositiveInteger(input.url?.searchParams.get("min_workspace_count"));
    const windows = await input.runtime.store.listFollowsWindows({
      now: input.now,
      ttlMs,
      minWorkspaceCount,
    });
    return {
      ok: true,
      status: 200,
      body: { ok: true, windows, count: windows.length, ttl_ms: ttlMs, request_id: input.requestId },
    };
  }

  if (input.method === "GET" && input.pathname === "/follows-windows/exclusions") {
    const exclusions = await input.runtime.store.listFollowsWindowExclusions();
    return {
      ok: true,
      status: 200,
      body: { ok: true, exclusions, count: exclusions.length, request_id: input.requestId },
    };
  }

  const exclusionMatch = matchExclusionPath(input.pathname);
  if (input.method === "DELETE" && exclusionMatch) {
    const removed = await input.runtime.store.deleteFollowsWindowExclusion(exclusionMatch.exclusionId);
    if (!removed) return notFound(`follows-window exclusion ${exclusionMatch.exclusionId} was not found`);
    await input.runtime.observability.recordActivity({
      type: "follows_window_exclusion_deleted",
      occurred_at: input.now.toISOString(),
      actor: "human",
      status: "ok",
      summary: `Follows window exclusion removed: ${removed.title_substring ?? removed.app_bundle}`,
      details: {
        exclusion_id: removed.exclusion_id,
        app_bundle: removed.app_bundle,
        title_substring: removed.title_substring,
      },
    });
    return {
      ok: true,
      status: 200,
      body: { ok: true, exclusion: removed, request_id: input.requestId },
    };
  }

  if (input.method !== "POST" || input.pathname !== "/follows-windows/exclude") {
    return undefined;
  }

  const parsed = await input.readJsonBody();
  if (!parsed.ok) return schemaError(parsed.message);
  if (!isRecord(parsed.value)) return schemaError("follows-window exclusion request must be an object");

  const appBundle = readOptionalString(parsed.value.app_bundle) ?? readOptionalString(parsed.value.appBundle);
  const titleSubstring = readOptionalString(parsed.value.title_substring) ?? readOptionalString(parsed.value.titleSubstring);
  if (!appBundle && !titleSubstring) {
    return schemaError("app_bundle or title_substring is required");
  }

  const exclusion = await input.runtime.store.addFollowsWindowExclusion({
    appBundle,
    titleSubstring,
    now: input.now,
  });
  await input.runtime.observability.recordActivity({
    type: "follows_window_excluded",
    occurred_at: input.now.toISOString(),
    actor: "human",
    status: "ok",
    summary: `Follows window exclusion added: ${titleSubstring ?? appBundle}`,
    details: {
      exclusion_id: exclusion.exclusion_id,
      app_bundle: exclusion.app_bundle,
      title_substring: exclusion.title_substring,
    },
  });

  return {
    ok: true,
    status: 200,
    body: { ok: true, exclusion, request_id: input.requestId },
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInteger(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchExclusionPath(pathname: string): { exclusionId: string } | undefined {
  if (!pathname.startsWith("/follows-windows/exclusions/")) return undefined;
  const remainder = pathname.slice("/follows-windows/exclusions/".length);
  if (!remainder || remainder.includes("/")) return undefined;
  return { exclusionId: decodeURIComponent(remainder) };
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}

function notFound(message: string): RouteResult {
  return { ok: false, status: 404, code: "not_found", message };
}
