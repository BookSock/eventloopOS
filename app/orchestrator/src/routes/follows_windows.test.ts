import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import type { Runtime } from "../runtime.js";
import type { InMemoryStore } from "../store.js";
import { handleFollowsWindowsRoute } from "./follows_windows.js";

describe("follows windows route", () => {
  it("lists follows-window candidates with threshold query params", async () => {
    const runtime = makeRuntime();
    const now = new Date("2026-06-04T08:00:00.000Z");
    await runtime.store.recordWindowWorkspaceObservation({
      windowId: "win-slack-a",
      workspaceId: "ws-a",
      isTaskWorkspace: true,
      observedAt: new Date(now.getTime() - 60_000),
      appBundle: "com.tinyspeck.slackmacgap",
      titlePrefix: "Team Slack",
    });
    await runtime.store.recordWindowWorkspaceObservation({
      windowId: "win-slack-b",
      workspaceId: "ws-b",
      isTaskWorkspace: true,
      observedAt: new Date(now.getTime() - 30_000),
      appBundle: "com.tinyspeck.slackmacgap",
      titlePrefix: "Team Slack",
    });
    await runtime.store.recordWindowWorkspaceObservation({
      windowId: "win-terminal",
      workspaceId: "ws-a",
      isTaskWorkspace: true,
      observedAt: now,
      appBundle: "com.mitchellh.ghostty",
      titlePrefix: "codex",
    });

    const result = await handleFollowsWindowsRoute({
      method: "GET",
      pathname: "/follows-windows",
      url: new URL("http://127.0.0.1/follows-windows?min_workspace_count=2"),
      readJsonBody: async () => ({ ok: false, message: "unused" }),
      runtime,
      now,
      requestId: "req_follow_list_windows",
    });

    assert.equal(result?.ok, true);
    if (!result?.ok) throw new Error("expected successful follows list");
    assert.equal(result.body.count, 1);
    assert.equal(result.body.ttl_ms, 24 * 60 * 60 * 1_000);
    const windows = result.body.windows as Array<Record<string, unknown>>;
    assert.equal(windows[0]?.window_id, "win-slack-b");
    assert.deepEqual(windows[0]?.known_workspaces, ["ws-a", "ws-b"]);
    assert.equal(windows[0]?.app_bundle, "com.tinyspeck.slackmacgap");
    assert.equal(windows[0]?.title_prefix, "Team Slack");
    assert.deepEqual(windows[0]?.slot_window_ids, ["win-slack-a", "win-slack-b"]);
  });

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
