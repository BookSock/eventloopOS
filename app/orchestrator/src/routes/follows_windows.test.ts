import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import type { Runtime } from "../runtime.js";
import type { InMemoryStore } from "../store.js";
import { handleFollowsWindowsRoute } from "./follows_windows.js";

describe("follows windows route", () => {
  it("accepts camelCase public aliases for exclusion creation", async () => {
    const runtime = makeRuntime();
    const created = await handleFollowsWindowsRoute({
      method: "POST",
      pathname: "/follows-windows/exclude",
      readJsonBody: async () => ({
        ok: true,
        value: {
          appBundle: "com.google.Chrome",
          titleSubstring: "Playwright",
          ignored_future_field: true,
        },
      }),
      runtime,
      now: new Date("2026-06-04T08:00:00.000Z"),
      requestId: "req_follow_alias",
    });

    assert.equal(created?.ok, true);
    if (!created?.ok) throw new Error("expected successful exclusion");
    const exclusion = created.body.exclusion as Record<string, unknown>;
    assert.equal(exclusion.app_bundle, "com.google.chrome");
    assert.equal(exclusion.title_substring, "playwright");

    const listed = await handleFollowsWindowsRoute({
      method: "GET",
      pathname: "/follows-windows/exclusions",
      readJsonBody: async () => ({ ok: false, message: "unused" }),
      runtime,
      now: new Date("2026-06-04T08:00:10.000Z"),
      requestId: "req_follow_list",
    });

    assert.equal(listed?.ok, true);
    if (!listed?.ok) throw new Error("expected successful exclusion list");
    assert.equal(listed.body.count, 1);
    assert.equal((listed.body.exclusions as Array<Record<string, unknown>>)[0]?.exclusion_id, exclusion.exclusion_id);
  });

  it("rejects exclusion creation without an app bundle or title substring", async () => {
    const result = await handleFollowsWindowsRoute({
      method: "POST",
      pathname: "/follows-windows/exclude",
      readJsonBody: async () => ({ ok: true, value: {} }),
      runtime: makeRuntime(),
      now: new Date("2026-06-04T08:00:00.000Z"),
      requestId: "req_follow_invalid",
    });

    assert.equal(result?.ok, false);
    if (result?.ok !== false) throw new Error("expected schema error");
    assert.equal(result.code, "schema_error");
  });
});

function makeRuntime(): Runtime {
  const store = createInMemoryGatewayStore({
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  } satisfies InMemoryStore);
  return {
    store,
    observability: {
      async incrementCounter() {},
      async recordActivity(input: Record<string, unknown>) {
        return { id: "actv_test", ...input };
      },
      async listActivity() {
        return [];
      },
      async snapshot() {
        return { counters: {}, activity_count: 0 };
      },
    },
    now: () => new Date("2026-06-04T08:00:00.000Z"),
  } as unknown as Runtime;
}
