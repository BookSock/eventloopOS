import type { Runtime } from "../runtime.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export async function handleFollowsWindowsRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  runtime: Runtime;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(message: string): RouteResult {
  return { ok: false, status: 400, code: "schema_error", message };
}
