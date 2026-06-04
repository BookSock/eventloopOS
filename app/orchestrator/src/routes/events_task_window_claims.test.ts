import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import { createInMemoryObservability } from "../observability.js";
import type { InMemoryStore } from "../store.js";
import { routeEventThroughGateway } from "./events.js";

describe("event routing task-window claims", () => {
  it("auto-claims browser windows when browser context attaches to a task", async () => {
    const store = createInMemoryGatewayStore(makeStore());
    const now = new Date("2026-06-04T09:00:00.000Z");
    await store.createTask({
      taskId: "task_blog_feedback",
      primaryAnchor: { kind: "codex_thread", id: "thread-blog" },
      capturedLayout: { backend: "aerospace", windows: [] },
      now,
    });

    const event: McpEvent = {
      id: "evt_browser_ctx_blog_auto_claim",
      source: "browser",
      source_id: "browser:ctx-blog-auto-claim",
      idempotency_key: "browser:ctx-blog-auto-claim",
      occurred_at: now.toISOString(),
      received_at: now.toISOString(),
      actor: { id: "actor_browser_extension", type: "system", name: "Chrome Extension" },
      task_hint: "blog feedback",
      type: "browser.context_captured",
      title: "Browser context: Blog launch draft",
      summary: "https://example.test/blog-launch-draft",
      raw_ref: {
        id: "raw_browser_ctx_blog_auto_claim",
        uri: "native-host://context/browser_tab%3A123",
        media_type: "application/json",
      },
      links: [{ label: "Browser tab", url: "https://example.test/blog-launch-draft" }],
      resources: [
        {
          id: "browser_tab:123",
          kind: "browser_tab",
          title: "Blog launch draft",
          url: "https://example.test/blog-launch-draft",
          source: "chrome-extension",
          captured_at: now.toISOString(),
          restore_confidence: "high",
          window_id: "99",
          tab_id: "123",
        },
      ],
    };

    const routed = await routeEventThroughGateway({
      store,
      observability: createInMemoryObservability(),
    }, event, now);

    assert.equal(routed.route_decision.action, "attach_to_task");
    const claims = await store.listTaskWindowClaims({ taskId: "task_blog_feedback", now });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.task_id, "task_blog_feedback");
    assert.equal(claims[0]?.window_id, "99");
    assert.equal(claims[0]?.app_bundle, "com.google.chrome");
    assert.equal(claims[0]?.title_prefix, "blog launch draft");
    assert.equal(claims[0]?.source, "browser.context_captured");
    assert.equal(claims[0]?.expires_at, "2026-06-04T09:30:00.000Z");
  });

  it("does not claim browser windows when target task does not exist", async () => {
    const store = createInMemoryGatewayStore(makeStore());
    const now = new Date("2026-06-04T09:00:00.000Z");
    await routeEventThroughGateway({
      store,
      observability: createInMemoryObservability(),
    }, {
      id: "evt_browser_ctx_missing_task",
      source: "browser",
      source_id: "browser:ctx-missing-task",
      idempotency_key: "browser:ctx-missing-task",
      occurred_at: now.toISOString(),
      received_at: now.toISOString(),
      actor: { id: "actor_browser_extension", type: "system" },
      task_hint: "missing task",
      type: "browser.context_captured",
      title: "Browser context: Missing task",
      summary: "https://example.test/missing",
      raw_ref: { id: "raw_missing", uri: "native-host://context/missing", media_type: "application/json" },
      links: [],
      resources: [{ id: "browser_tab:missing", kind: "browser_tab", title: "Missing", window_id: "10" }],
    }, now);

    assert.deepEqual(await store.listTaskWindowClaims({ now }), []);
  });

  it("auto-claims agent-spawned app windows when routed to a task", async () => {
    const store = createInMemoryGatewayStore(makeStore());
    const now = new Date("2026-06-04T10:00:00.000Z");
    await store.createTask({
      taskId: "task_checkout_test",
      primaryAnchor: { kind: "codex_thread", id: "thread-checkout" },
      capturedLayout: { backend: "aerospace", windows: [] },
      now,
    });

    const routed = await routeEventThroughGateway({
      store,
      observability: createInMemoryObservability(),
    }, {
      id: "evt_codex_spawned_checkout_chrome",
      source: "codex",
      source_id: "codex:run-checkout",
      idempotency_key: "codex:run-checkout:spawned-window",
      occurred_at: now.toISOString(),
      received_at: now.toISOString(),
      actor: { id: "codex_checkout_agent", type: "agent" },
      task_hint: "checkout test",
      type: "agent.window_spawned",
      title: "Codex spawned Chrome for checkout test",
      summary: "Agent opened a local Chrome test window.",
      raw_ref: { id: "raw_codex_spawned_checkout_chrome", uri: "codex://runs/run-checkout", media_type: "application/json" },
      links: [],
      resources: [
        {
          id: "aerospace_window:1207",
          kind: "spawned_window",
          window_id: "1207",
          app_bundle: "com.google.Chrome",
          title: "Checkout smoke test - Google Chrome",
          source: "codex",
          captured_at: now.toISOString(),
        },
      ],
    }, now);

    assert.equal(routed.route_decision.action, "attach_to_task");
    const claims = await store.listTaskWindowClaims({ taskId: "task_checkout_test", now });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.task_id, "task_checkout_test");
    assert.equal(claims[0]?.window_id, "1207");
    assert.equal(claims[0]?.app_bundle, "com.google.chrome");
    assert.equal(claims[0]?.title_prefix, "checkout smoke test - google chrome");
    assert.equal(claims[0]?.source, "agent.window_spawned");
    assert.equal(claims[0]?.expires_at, "2026-06-04T10:30:00.000Z");
  });

  it("does not auto-claim non-window resources", async () => {
    const store = createInMemoryGatewayStore(makeStore());
    const now = new Date("2026-06-04T11:00:00.000Z");
    await store.createTask({
      taskId: "task_notes",
      primaryAnchor: { kind: "codex_thread", id: "thread-notes" },
      capturedLayout: { backend: "aerospace", windows: [] },
      now,
    });

    await routeEventThroughGateway({
      store,
      observability: createInMemoryObservability(),
    }, {
      id: "evt_notes_file_context",
      source: "codex",
      source_id: "codex:notes",
      idempotency_key: "codex:notes:file-context",
      occurred_at: now.toISOString(),
      received_at: now.toISOString(),
      actor: { id: "codex_notes_agent", type: "agent" },
      task_hint: "notes",
      type: "agent.context",
      title: "Notes file context",
      summary: "Agent attached a file context.",
      raw_ref: { id: "raw_notes", uri: "codex://runs/notes", media_type: "application/json" },
      links: [],
      resources: [{ id: "file:notes", kind: "file", title: "notes.md", path: "notes.md" }],
    }, now);

    assert.deepEqual(await store.listTaskWindowClaims({ now }), []);
  });
});

function makeStore(): InMemoryStore {
  return {
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}
