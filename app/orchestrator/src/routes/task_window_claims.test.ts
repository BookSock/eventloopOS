import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import type { Runtime } from "../runtime.js";
import type { InMemoryStore } from "../store.js";
import { handleTaskWindowClaimsRoute } from "./task_window_claims.js";

describe("task window claims route", () => {
  it("lets agents claim and list task-owned windows", async () => {
    const runtime = makeRuntime();
    await runtime.store.createTask({
      taskId: "task_paper_b",
      primaryAnchor: { kind: "codex_thread", id: "thread-b" },
      capturedLayout: { backend: "aerospace", windows: [] },
      now: new Date("2026-06-04T08:00:00.000Z"),
    });

    const created = await handleTaskWindowClaimsRoute({
      method: "POST",
      pathname: "/task-window-claims",
      url: new URL("http://eventloop.test/task-window-claims"),
      readJsonBody: async () => ({
        ok: true,
        value: {
          task_id: "task_paper_b",
          app_bundle: "com.google.Chrome",
          title_prefix: "Playwright report",
          source: "codex",
          ttl_ms: 60_000,
        },
      }),
      runtime,
      now: new Date("2026-06-04T08:00:00.000Z"),
      requestId: "req_claim",
    });

    assert.equal(created?.ok, true);
    if (!created?.ok) throw new Error("expected successful claim");
    const claim = created.body.claim as Record<string, unknown>;
    assert.equal(claim.task_id, "task_paper_b");
    assert.equal(claim.app_bundle, "com.google.chrome");
    assert.equal(claim.title_prefix, "playwright report");
    assert.equal(claim.expires_at, "2026-06-04T08:01:00.000Z");

    const listed = await handleTaskWindowClaimsRoute({
      method: "GET",
      pathname: "/task-window-claims",
      url: new URL("http://eventloop.test/task-window-claims?task_id=task_paper_b"),
      readJsonBody: async () => ({ ok: false, message: "unused" }),
      runtime,
      now: new Date("2026-06-04T08:00:10.000Z"),
      requestId: "req_list",
    });

    assert.equal(listed?.ok, true);
    if (!listed?.ok) throw new Error("expected successful list");
    assert.equal(listed.body.count, 1);
  });

  it("lets agents claim future descendant windows by process root pid", async () => {
    const runtime = makeRuntime();
    await runtime.store.createTask({
      taskId: "task_background_test",
      primaryAnchor: { kind: "codex_thread", id: "thread-background" },
      capturedLayout: { backend: "aerospace", windows: [] },
      now: new Date("2026-06-04T08:00:00.000Z"),
    });

    const created = await handleTaskWindowClaimsRoute({
      method: "POST",
      pathname: "/task-window-claims",
      url: new URL("http://eventloop.test/task-window-claims"),
      readJsonBody: async () => ({
        ok: true,
        value: {
          task_id: "task_background_test",
          process_root_pid: 4242,
          source: "codex_spawn_wrapper",
          ttl_ms: 60_000,
        },
      }),
      runtime,
      now: new Date("2026-06-04T08:00:00.000Z"),
      requestId: "req_pid_claim",
    });

    assert.equal(created?.ok, true);
    if (!created?.ok) throw new Error("expected successful claim");
    const claim = created.body.claim as Record<string, unknown>;
    assert.equal(claim.task_id, "task_background_test");
    assert.equal(claim.process_root_pid, 4242);
    assert.equal(claim.expires_at, "2026-06-04T08:01:00.000Z");

    const listed = await handleTaskWindowClaimsRoute({
      method: "GET",
      pathname: "/task-window-claims",
      url: new URL("http://eventloop.test/task-window-claims?task_id=task_background_test"),
      readJsonBody: async () => ({ ok: false, message: "unused" }),
      runtime,
      now: new Date("2026-06-04T08:00:10.000Z"),
      requestId: "req_pid_list",
    });

    assert.equal(listed?.ok, true);
    if (!listed?.ok) throw new Error("expected successful list");
    assert.equal(listed.body.count, 1);
    assert.equal((listed.body.claims as Array<Record<string, unknown>>)[0]?.process_root_pid, 4242);
  });

  it("rejects claims for unknown tasks", async () => {
    const result = await handleTaskWindowClaimsRoute({
      method: "POST",
      pathname: "/task-window-claims",
      url: new URL("http://eventloop.test/task-window-claims"),
      readJsonBody: async () => ({ ok: true, value: { task_id: "task_missing", window_id: "123" } }),
      runtime: makeRuntime(),
      now: new Date("2026-06-04T08:00:00.000Z"),
      requestId: "req_missing",
    });

    assert.equal(result?.ok, false);
    if (result?.ok !== false) throw new Error("expected failed claim");
    assert.equal(result.code, "task_not_found");
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
