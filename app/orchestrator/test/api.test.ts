import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createSeededDevelopmentMcpSourceRegistry } from "../src/integrations/mcp_poll/development_registry.js";
import { createGatewayServer } from "../src/server.js";
import { buildReviewArtifactsFromEvent, createSeededStore } from "../src/store.js";

describe("orchestrator gateway API", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    server = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns health with request id middleware header", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        "x-request-id": "req_contract_health",
      },
    });
    const body = await response.json() as {
      ok: boolean;
      service: string;
      time: string;
      request_id: string;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "req_contract_health");
    assert.deepEqual(body, {
      ok: true,
      service: "eventloop-orchestrator",
      time: "2026-05-06T12:00:00.000Z",
      request_id: "req_contract_health",
    });
  });

  it("lists seeded queue items with attached review packets", async () => {
    const response = await fetch(`${baseUrl}/queue`, {
      headers: {
        "idempotency-key": "idem_queue_list",
      },
    });
    const body = await response.json() as {
      count: number;
      items: Array<{
        id: string;
        review_packet: {
          id: string;
          recommended_action: {
            type: string;
          };
        };
      }>;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("idempotency-key"), "idem_queue_list");
    assert.equal(body.count, 1);
    assert.equal(body.items[0].id, "qit_seed_review");
    assert.equal(body.items[0].review_packet.id, "pkt_seed_review");
    assert.equal(body.items[0].review_packet.recommended_action.type, "approve");
  });

  it("returns seeded next queue item", async () => {
    const response = await fetch(`${baseUrl}/queue/next`);
    const body = await response.json() as {
      item: {
        id: string;
        review_packet_id: string;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.item.id, "qit_seed_review");
    assert.equal(body.item.review_packet_id, "pkt_seed_review");
  });

  it("leases next queue item and hides it from unleased next until done", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const leaseServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });
    await new Promise<void>((resolve) => leaseServer.listen(0, "127.0.0.1", resolve));
    const address = leaseServer.address() as AddressInfo;
    const leaseBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const leaseResponse = await fetch(`${leaseBaseUrl}/queue/lease-next`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lease_owner: "mac_queue_app",
          lease_ms: 30_000,
        }),
      });
      const leaseBody = await leaseResponse.json() as {
        item: {
          id: string;
          state: string;
          lease_owner: string;
          lease_expires_at: string;
        };
      };

      assert.equal(leaseResponse.status, 200);
      assert.equal(leaseBody.item.id, "qit_seed_review");
      assert.equal(leaseBody.item.state, "leased");
      assert.equal(leaseBody.item.lease_owner, "mac_queue_app");
      assert.equal(leaseBody.item.lease_expires_at, "2026-05-06T12:00:30.000Z");

      const renewResponse = await fetch(`${leaseBaseUrl}/queue/qit_seed_review/lease/renew`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lease_owner: "mac_queue_app",
          lease_ms: 45_000,
        }),
      });
      const renewBody = await renewResponse.json() as {
        ok: boolean;
        item: {
          id: string;
          lease_owner: string;
          lease_expires_at: string;
        };
      };

      assert.equal(renewResponse.status, 200);
      assert.equal(renewBody.ok, true);
      assert.equal(renewBody.item.id, "qit_seed_review");
      assert.equal(renewBody.item.lease_owner, "mac_queue_app");
      assert.equal(renewBody.item.lease_expires_at, "2026-05-06T12:00:45.000Z");

      const wrongOwnerRenewResponse = await fetch(`${leaseBaseUrl}/queue/qit_seed_review/lease/renew`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lease_owner: "other_owner",
          lease_ms: 45_000,
        }),
      });
      assert.equal(wrongOwnerRenewResponse.status, 409);

      const nextResponse = await fetch(`${leaseBaseUrl}/queue/next`);
      const nextBody = await nextResponse.json() as { item: unknown };
      assert.equal(nextBody.item, null);

      const doneResponse = await fetch(`${leaseBaseUrl}/queue/qit_seed_review/done`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "done",
          actor_id: "mac_queue_app",
        }),
      });
      const doneBody = await doneResponse.json() as {
        item: {
          state: string;
          lease_owner?: string;
        };
      };

      assert.equal(doneResponse.status, 200);
      assert.equal(doneBody.item.state, "done");
      assert.equal(doneBody.item.lease_owner, undefined);
    } finally {
      await new Promise<void>((resolve, reject) => {
        leaseServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("marks queue item done and advances queue", async () => {
    const response = await fetch(`${baseUrl}/queue/qit_seed_review/done`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_done",
      },
      body: JSON.stringify({
        action: "done",
        actor_id: "user_jason",
      }),
    });
    const body = await response.json() as {
      ok: boolean;
      item: {
        id: string;
        state: string;
      };
      decision: {
        queue_item_id: string;
        action: string;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.item.id, "qit_seed_review");
    assert.equal(body.item.state, "done");
    assert.equal(body.decision.queue_item_id, "qit_seed_review");
    assert.equal(body.decision.action, "done");

    const nextResponse = await fetch(`${baseUrl}/queue/next`);
    const nextBody = await nextResponse.json() as { item: unknown };
    assert.equal(nextBody.item, null);
  });

  it("ingests an event and creates a review queue item idempotently", async () => {
    const event = {
      id: "evt_slack_t123_c123_456",
      source: "slack",
      source_id: "slack:T123:C123:456.000",
      idempotency_key: "slack:T123:C123:456.000",
      occurred_at: "2026-05-06T16:58:00.000Z",
      received_at: "2026-05-06T16:59:00.000Z",
      actor: {
        id: "actor_slack_U123",
        type: "human",
        name: "Malis",
      },
      project_hint: "pagerfree",
      task_hint: "blog feedback",
      type: "slack.message",
      title: "Slack message from Malis",
      summary: "Customer says pgrust copy needs clearer Postgres version support.",
      raw_ref: {
        id: "raw_slack_T123_C123_456",
        uri: "artifact://raw/slack/T123/C123/456.json",
        media_type: "application/json",
      },
      links: [
        {
          label: "Slack thread",
          url: "https://slack.example.com/archives/C123/p456000",
        },
      ],
      resources: [
        {
          id: "ctx_slack_T123_C123_456",
          kind: "slack_thread",
          title: "Slack thread",
          url: "https://slack.example.com/archives/C123/p456000",
          source: "slack",
          captured_at: "2026-05-06T16:59:00.000Z",
          restore_confidence: "high",
          workspace_id: "T123",
          channel_id: "C123",
          thread_ts: "456.000",
        },
      ],
    };

    const firstResponse = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_event",
      },
      body: JSON.stringify({ event }),
    });
    const firstBody = await firstResponse.json() as {
      ok: boolean;
      route_decision: {
        action: string;
        target_task_id: string;
      };
      review_packet: {
        id: string;
        task_id: string;
        summary: string;
      };
      queue_item: {
        id: string;
        review_packet_id: string;
        priority_reasons: string[];
      };
    };

    assert.equal(firstResponse.status, 202);
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.route_decision.action, "ask_human_now");
    assert.equal(firstBody.route_decision.target_task_id, "task_blog_feedback");
    assert.equal(firstBody.review_packet.id, "pkt_evt_slack_t123_c123_456");
    assert.equal(firstBody.review_packet.task_id, "task_blog_feedback");
    assert.match(firstBody.review_packet.summary, /pgrust copy/);
    assert.equal(firstBody.queue_item.id, "qit_evt_slack_t123_c123_456");
    assert.equal(firstBody.queue_item.review_packet_id, firstBody.review_packet.id);
    assert.deepEqual(firstBody.queue_item.priority_reasons, [
      "new_background_event",
      "slack_message",
      "task_hint_present",
    ]);

    const duplicateResponse = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ event }),
    });
    const duplicateBody = await duplicateResponse.json() as {
      queue_item: {
        id: string;
      };
    };

    assert.equal(duplicateResponse.status, 202);
    assert.equal(duplicateBody.queue_item.id, firstBody.queue_item.id);
  });

  it("stores passive browser context without interrupting human queue", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const routeServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });
    await new Promise<void>((resolve) => routeServer.listen(0, "127.0.0.1", resolve));
    const address = routeServer.address() as AddressInfo;
    const routeBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_browser_ctx_123",
        source: "browser",
        source_id: "browser:ctx_123",
        idempotency_key: "browser:ctx_123",
        occurred_at: "2026-05-06T16:58:00.000Z",
        received_at: "2026-05-06T16:59:00.000Z",
        actor: {
          id: "actor_browser_extension",
          type: "system",
          name: "Chrome Extension",
        },
        type: "browser.context_captured",
        title: "Browser context: Launch doc",
        summary: "https://example.test/launch",
        raw_ref: {
          id: "raw_browser_ctx_123",
          uri: "native-host://context/ctx_123",
          media_type: "application/json",
        },
        links: [
          {
            label: "Browser tab",
            url: "https://example.test/launch",
          },
        ],
        resources: [
          {
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            captured_at: "2026-05-06T16:59:00.000Z",
            restore_confidence: "high",
            text_quote: "Launch paragraph needs pricing note",
          },
        ],
      };

      const response = await fetch(`${routeBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
      });
      const body = await response.json() as {
        ok: boolean;
        route_decision: {
          action: string;
          confidence: string;
        };
        review_packet?: unknown;
        queue_item?: unknown;
      };

      assert.equal(response.status, 202);
      assert.equal(body.ok, true);
      assert.equal(body.route_decision.action, "store_only");
      assert.equal(body.route_decision.confidence, "high");
      assert.equal(body.review_packet, undefined);
      assert.equal(body.queue_item, undefined);

      const queueResponse = await fetch(`${routeBaseUrl}/queue`);
      const queueBody = await queueResponse.json() as { items: Array<{ id: string }> };
      assert.equal(queueBody.items.some((item) => item.id === "qit_evt_browser_ctx_123"), false);

      const eventResponse = await fetch(`${routeBaseUrl}/events/evt_browser_ctx_123`);
      const eventBody = await eventResponse.json() as {
        event: {
          id: string;
        };
        route_decision: {
          action: string;
        };
        queue_item?: unknown;
      };
      assert.equal(eventResponse.status, 200);
      assert.equal(eventBody.event.id, "evt_browser_ctx_123");
      assert.equal(eventBody.route_decision.action, "store_only");
      assert.equal(eventBody.queue_item, undefined);

      const contextsResponse = await fetch(`${routeBaseUrl}/contexts?source=browser`);
      const contextsBody = await contextsResponse.json() as {
        count: number;
        entries: Array<{
          event_id: string;
          event_source: string;
          route_decision: {
            action: string;
          };
          resource: {
            kind: string;
            url: string;
          };
        }>;
      };
      assert.equal(contextsResponse.status, 200);
      assert.equal(contextsBody.count, 1);
      assert.equal(contextsBody.entries[0].event_id, "evt_browser_ctx_123");
      assert.equal(contextsBody.entries[0].event_source, "browser");
      assert.equal(contextsBody.entries[0].route_decision.action, "store_only");
      assert.equal(contextsBody.entries[0].resource.kind, "browser_tab");
      assert.equal(contextsBody.entries[0].resource.url, "https://example.test/launch");

      const searchResponse = await fetch(`${routeBaseUrl}/contexts?source=browser&q=pricing%20note&limit=5`);
      const searchBody = await searchResponse.json() as {
        count: number;
        entries: Array<{ event_id: string }>;
      };
      assert.equal(searchResponse.status, 200);
      assert.equal(searchBody.count, 1);
      assert.equal(searchBody.entries[0].event_id, "evt_browser_ctx_123");

      const attachEvent = {
        ...event,
        id: "evt_browser_ctx_blog",
        source_id: "browser:ctx_blog",
        idempotency_key: "browser:ctx_blog",
        task_hint: "blog feedback",
        title: "Browser context: Blog draft",
        resources: [
          {
            id: "ctx_browser_blog",
            kind: "browser_tab",
            title: "Blog launch draft",
            url: "https://example.test/blog-draft",
            source: "chrome-extension",
            captured_at: "2026-05-06T17:01:00.000Z",
            restore_confidence: "high",
          },
        ],
      };
      const attachResponse = await fetch(`${routeBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: attachEvent }),
      });
      const attachBody = await attachResponse.json() as {
        route_decision: {
          action: string;
          target_task_id: string;
        };
        queue_item?: unknown;
      };
      assert.equal(attachResponse.status, 202);
      assert.equal(attachBody.route_decision.action, "attach_to_task");
      assert.equal(attachBody.route_decision.target_task_id, "task_blog_feedback");
      assert.equal(attachBody.queue_item, undefined);

      const taskContextResponse = await fetch(`${routeBaseUrl}/contexts?task_id=task_blog_feedback&q=draft`);
      const taskContextBody = await taskContextResponse.json() as {
        count: number;
        entries: Array<{
          event_id: string;
          task_id: string;
        }>;
      };
      assert.equal(taskContextResponse.status, 200);
      assert.equal(taskContextBody.count, 1);
      assert.equal(taskContextBody.entries[0].event_id, "evt_browser_ctx_blog");
      assert.equal(taskContextBody.entries[0].task_id, "task_blog_feedback");
    } finally {
      await new Promise<void>((resolve, reject) => {
        routeServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("exposes workspace status, capture, and restore planning without executing commands", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    let restorePlanCalls = 0;
    const workspaceServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      workspace: {
        status() {
          return {
            available: true,
            backend: "aerospace",
          };
        },
        capture() {
          return {
            backend: "aerospace",
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 9,
            windows: [
              {
                id: 9,
                app: "Ghostty",
                title: "codex",
                workspace: "eventloop-blog",
              },
            ],
          };
        },
        planRestore(snapshot, currentWindows) {
          restorePlanCalls += 1;
          assert.equal(snapshot.activeWorkspace, "eventloop-blog");
          assert.equal(currentWindows?.[0]?.workspace, "manual");
          return {
            commands: [
              {
                command: "aerospace",
                args: ["workspace", "eventloop-blog"],
              },
            ],
            skipped: [],
          };
        },
      },
    });
    await new Promise<void>((resolve) => workspaceServer.listen(0, "127.0.0.1", resolve));
    const address = workspaceServer.address() as AddressInfo;
    const workspaceBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const statusResponse = await fetch(`${workspaceBaseUrl}/workspace/status`);
      const statusBody = await statusResponse.json() as {
        status: {
          available: boolean;
          backend: string;
        };
        execute_supported: boolean;
      };
      assert.equal(statusResponse.status, 200);
      assert.equal(statusBody.status.available, true);
      assert.equal(statusBody.status.backend, "aerospace");
      assert.equal(statusBody.execute_supported, false);

      const captureResponse = await fetch(`${workspaceBaseUrl}/workspace/capture`, { method: "POST" });
      const captureBody = await captureResponse.json() as {
        snapshot: {
          backend: string;
          activeWorkspace: string;
          focusedWindowId: number;
          windows: Array<{ id: number }>;
        };
      };
      assert.equal(captureResponse.status, 200);
      assert.equal(captureBody.snapshot.backend, "aerospace");
      assert.equal(captureBody.snapshot.activeWorkspace, "eventloop-blog");
      assert.equal(captureBody.snapshot.focusedWindowId, 9);
      assert.equal(captureBody.snapshot.windows[0].id, 9);

      const planResponse = await fetch(`${workspaceBaseUrl}/workspace/restore-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          snapshot: {
            backend: "aerospace",
            active_workspace: "eventloop-blog",
            focused_window_id: 9,
            windows: [
              {
                id: 9,
                app: "Ghostty",
                title: "codex",
                workspace: "eventloop-blog",
              },
            ],
          },
          current_windows: [
            {
              id: 9,
              app: "Ghostty",
              title: "codex",
              workspace: "manual",
            },
          ],
        }),
      });
      const planBody = await planResponse.json() as {
        execute_supported: boolean;
        plan: {
          commands: Array<{
            command: string;
            args: string[];
          }>;
        };
      };
      assert.equal(planResponse.status, 200);
      assert.equal(planBody.execute_supported, false);
      assert.deepEqual(planBody.plan.commands, [
        {
          command: "aerospace",
          args: ["workspace", "eventloop-blog"],
        },
      ]);
      assert.equal(restorePlanCalls, 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        workspaceServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("executes workspace restore only when enabled, confirmed, and idempotent", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const executedPlans: unknown[] = [];
    const workspaceServer = createGatewayServer({
      store,
      workspaceExecuteEnabled: true,
      workspace: {
        status() {
          return {
            available: true,
            backend: "aerospace",
          };
        },
        capture() {
          return {
            backend: "aerospace",
            windows: [],
          };
        },
        planRestore() {
          return {
            commands: [
              {
                command: "aerospace",
                args: ["workspace", "eventloop-blog"],
              },
            ],
            skipped: [],
          };
        },
        executeRestorePlan(plan) {
          executedPlans.push(plan);
          return {
            commands: [
              {
                command: "aerospace",
                args: ["workspace", "eventloop-blog"],
                stdout: "ok",
              },
            ],
            skipped: [],
          };
        },
      },
    });
    await new Promise<void>((resolve) => workspaceServer.listen(0, "127.0.0.1", resolve));
    const address = workspaceServer.address() as AddressInfo;
    const workspaceBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const missingKeyResponse = await fetch(`${workspaceBaseUrl}/workspace/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm_execute: true,
          snapshot: { backend: "aerospace", windows: [] },
        }),
      });
      assert.equal(missingKeyResponse.status, 400);

      const restoreResponse = await fetch(`${workspaceBaseUrl}/workspace/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_workspace_restore_001",
        },
        body: JSON.stringify({
          confirm_execute: true,
          snapshot: { backend: "aerospace", windows: [] },
        }),
      });
      const restoreBody = await restoreResponse.json() as {
        ok: boolean;
        execute_supported: boolean;
        idempotency_key: string;
        receipt: {
          commands: Array<{
            stdout: string;
          }>;
        };
      };
      assert.equal(restoreResponse.status, 200);
      assert.equal(restoreBody.ok, true);
      assert.equal(restoreBody.execute_supported, true);
      assert.equal(restoreBody.idempotency_key, "idem_workspace_restore_001");
      assert.equal(restoreBody.receipt.commands[0]?.stdout, "ok");
      assert.equal(executedPlans.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        workspaceServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("keeps workspace restore execution disabled by default", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const workspaceServer = createGatewayServer({
      store,
      workspace: {
        status() {
          return {
            available: true,
            backend: "aerospace",
          };
        },
        capture() {
          return {
            backend: "aerospace",
            windows: [],
          };
        },
        planRestore() {
          return { commands: [], skipped: [] };
        },
        executeRestorePlan() {
          throw new Error("must not execute when disabled");
        },
      },
    });
    await new Promise<void>((resolve) => workspaceServer.listen(0, "127.0.0.1", resolve));
    const address = workspaceServer.address() as AddressInfo;
    const workspaceBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const statusResponse = await fetch(`${workspaceBaseUrl}/workspace/status`);
      const statusBody = await statusResponse.json() as { execute_supported: boolean };
      assert.equal(statusBody.execute_supported, false);

      const restoreResponse = await fetch(`${workspaceBaseUrl}/workspace/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_workspace_restore_disabled",
        },
        body: JSON.stringify({
          confirm_execute: true,
          snapshot: { backend: "aerospace", windows: [] },
        }),
      });
      assert.equal(restoreResponse.status, 403);
    } finally {
      await new Promise<void>((resolve, reject) => {
        workspaceServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("sends idempotent followup into configured task session controller", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const messages = new Map<string, Record<string, unknown>>();
    const taskServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      taskSessions: {
        listSessions() {
          return [
            {
              id: "task_session_blog",
              task_id: "task_blog_feedback",
              status: "idle",
            },
          ];
        },
        getSession(taskSessionId) {
          if (taskSessionId !== "task_session_blog") return undefined;
          return {
            id: "task_session_blog",
            task_id: "task_blog_feedback",
            status: "idle",
          };
        },
        sendFollowupMessage(input) {
          const existing = messages.get(input.idempotency_key);
          if (existing) return existing;
          const message = {
            id: `task_msg_${messages.size + 1}`,
            task_session_id: input.task_session_id,
            mode: "followup",
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
          messages.set(input.idempotency_key, message);
          return message;
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const listResponse = await fetch(`${taskBaseUrl}/task-sessions`);
      const listBody = await listResponse.json() as {
        count: number;
        sessions: Array<{
          id: string;
          task_id: string;
        }>;
      };
      assert.equal(listResponse.status, 200);
      assert.equal(listBody.count, 1);
      assert.equal(listBody.sessions[0].id, "task_session_blog");
      assert.equal(listBody.sessions[0].task_id, "task_blog_feedback");

      const getResponse = await fetch(`${taskBaseUrl}/task-sessions/task_session_blog`);
      const getBody = await getResponse.json() as {
        session: {
          id: string;
          task_id: string;
        };
      };
      assert.equal(getResponse.status, 200);
      assert.equal(getBody.session.id, "task_session_blog");
      assert.equal(getBody.session.task_id, "task_blog_feedback");

      const missingResponse = await fetch(`${taskBaseUrl}/task-sessions/task_session_missing`);
      assert.equal(missingResponse.status, 404);

      const requestBody = {
        text: "Launch context changed. Include pricing note before next draft.",
        event_ids: ["evt_browser_ctx_123"],
      };
      const firstResponse = await fetch(`${taskBaseUrl}/task-sessions/task_session_blog/followup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_task_followup_1",
        },
        body: JSON.stringify(requestBody),
      });
      const firstBody = await firstResponse.json() as {
        ok: boolean;
        message: {
          id: string;
          task_session_id: string;
          status: string;
          event_ids: string[];
          idempotency_key: string;
        };
      };

      assert.equal(firstResponse.status, 202);
      assert.equal(firstBody.ok, true);
      assert.equal(firstBody.message.id, "task_msg_1");
      assert.equal(firstBody.message.task_session_id, "task_session_blog");
      assert.equal(firstBody.message.status, "sent");
      assert.deepEqual(firstBody.message.event_ids, ["evt_browser_ctx_123"]);
      assert.equal(firstBody.message.idempotency_key, "idem_task_followup_1");

      const duplicateResponse = await fetch(`${taskBaseUrl}/task-sessions/task_session_blog/followup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_task_followup_1",
        },
        body: JSON.stringify(requestBody),
      });
      const duplicateBody = await duplicateResponse.json() as {
        message: {
          id: string;
        };
      };

      assert.equal(duplicateResponse.status, 202);
      assert.equal(duplicateBody.message.id, "task_msg_1");
      assert.equal(messages.size, 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("routes task-hinted events into existing task sessions without queueing humans", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const messages = new Map<string, Record<string, unknown>>();
    const taskServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      taskSessions: {
        listSessions() {
          return [
            {
              id: "task_session_blog",
              task_id: "task_blog_feedback",
              status: "idle",
            },
          ];
        },
        sendFollowupMessage(input) {
          const existing = messages.get(input.idempotency_key);
          if (existing) return existing;
          const message = {
            id: `task_msg_${messages.size + 1}`,
            task_session_id: input.task_session_id,
            mode: "followup",
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
          messages.set(input.idempotency_key, message);
          return message;
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_slack_task_inject",
        source: "slack",
        source_id: "slack:T123:C123:999",
        idempotency_key: "slack:T123:C123:999",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        task_hint: "blog feedback",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Blog needs launch date note before next draft.",
        raw_ref: {
          id: "raw_slack_T123_C123_999",
          uri: "artifact://raw/slack/T123/C123/999.json",
          media_type: "application/json",
        },
        links: [
          {
            label: "Slack thread",
            url: "https://slack.example.com/archives/C123/p999000",
          },
        ],
        resources: [],
      };

      const response = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
      });
      const body = await response.json() as {
        ok: boolean;
        route_decision: {
          action: string;
          target_task_id: string;
          target_task_session_id: string;
        };
        review_packet?: unknown;
        queue_item?: unknown;
        task_message: {
          task_session_id: string;
          event_ids: string[];
          text: string;
          idempotency_key: string;
        };
      };

      assert.equal(response.status, 202);
      assert.equal(body.ok, true);
      assert.equal(body.route_decision.action, "inject_into_agent_thread");
      assert.equal(body.route_decision.target_task_id, "task_blog_feedback");
      assert.equal(body.route_decision.target_task_session_id, "task_session_blog");
      assert.equal(body.review_packet, undefined);
      assert.equal(body.queue_item, undefined);
      assert.equal(body.task_message.task_session_id, "task_session_blog");
      assert.deepEqual(body.task_message.event_ids, ["evt_slack_task_inject"]);
      assert.match(body.task_message.text, /Blog needs launch date note/);
      assert.equal(body.task_message.idempotency_key, "inject_slack:T123:C123:999");

      const duplicateResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
      });
      const duplicateBody = await duplicateResponse.json() as {
        task_message: {
          idempotency_key: string;
        };
      };
      assert.equal(duplicateResponse.status, 202);
      assert.equal(duplicateBody.task_message.idempotency_key, body.task_message.idempotency_key);
      assert.equal(messages.size, 1);

      const storedResponse = await fetch(`${taskBaseUrl}/events/evt_slack_task_inject`);
      const storedBody = await storedResponse.json() as {
        route_decision: {
          action: string;
        };
        queue_item?: unknown;
      };
      assert.equal(storedResponse.status, 200);
      assert.equal(storedBody.route_decision.action, "inject_into_agent_thread");
      assert.equal(storedBody.queue_item, undefined);
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("normalizes voice commands into task-session followups", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const messages = new Map<string, Record<string, unknown>>();
    const voiceServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      taskSessions: {
        listSessions() {
          return [
            {
              id: "task_session_blog",
              task_id: "task_blog_feedback",
              status: "idle",
            },
          ];
        },
        sendFollowupMessage(input) {
          const existing = messages.get(input.idempotency_key);
          if (existing) return existing;
          const message = {
            id: `task_msg_${messages.size + 1}`,
            task_session_id: input.task_session_id,
            mode: "followup",
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
          messages.set(input.idempotency_key, message);
          return message;
        },
      },
    });
    await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
    const address = voiceServer.address() as AddressInfo;
    const voiceBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${voiceBaseUrl}/voice/commands`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_voice_blog_priority",
        },
        body: JSON.stringify({
          transcript: "Blog post is priority and should include launch date in two weeks.",
          task_hint: "blog feedback",
          project_hint: "pagerfree",
        }),
      });
      const body = await response.json() as {
        ok: boolean;
        event: {
          id: string;
          source: string;
          type: string;
          summary: string;
          resources: Array<{
            kind: string;
            details?: {
              transcript?: string;
            };
          }>;
        };
        route_decision: {
          action: string;
          target_task_id: string;
          target_task_session_id: string;
        };
        task_message: {
          task_session_id: string;
          event_ids: string[];
          text: string;
          idempotency_key: string;
        };
        queue_item?: unknown;
      };

      assert.equal(response.status, 202);
      assert.equal(body.ok, true);
      assert.equal(body.event.source, "voice");
      assert.equal(body.event.type, "voice.command");
      assert.equal(body.event.summary, "Blog post is priority and should include launch date in two weeks.");
      assert.equal(body.event.resources[0]?.kind, "voice_command");
      assert.equal(body.event.resources[0]?.details?.transcript, body.event.summary);
      assert.equal(body.route_decision.action, "inject_into_agent_thread");
      assert.equal(body.route_decision.target_task_id, "task_blog_feedback");
      assert.equal(body.route_decision.target_task_session_id, "task_session_blog");
      assert.equal(body.task_message.task_session_id, "task_session_blog");
      assert.deepEqual(body.task_message.event_ids, [body.event.id]);
      assert.match(body.task_message.text, /Blog post is priority/);
      assert.equal(body.task_message.idempotency_key, "inject_idem_voice_blog_priority");
      assert.equal(body.queue_item, undefined);

      const storedResponse = await fetch(`${voiceBaseUrl}/events/${body.event.id}`);
      const storedBody = await storedResponse.json() as {
        event: {
          source: string;
        };
        route_decision: {
          action: string;
        };
      };
      assert.equal(storedResponse.status, 200);
      assert.equal(storedBody.event.source, "voice");
      assert.equal(storedBody.route_decision.action, "inject_into_agent_thread");
    } finally {
      await new Promise<void>((resolve, reject) => {
        voiceServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("lists configured MCP sources and polls a source by id", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const mcpServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T17:00:00.000Z"),
      mcpSources: createSeededDevelopmentMcpSourceRegistry(),
    });
    await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
    const address = mcpServer.address() as AddressInfo;
    const mcpBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const listResponse = await fetch(`${mcpBaseUrl}/mcp-sources`);
      const listBody = await listResponse.json() as {
        count: number;
        sources: Array<{
          id: string;
          server_name: string;
          risk_policy: {
            allowWriteTools: boolean;
          };
        }>;
      };
      assert.equal(listResponse.status, 200);
      assert.equal(listBody.count, 3);
      assert.deepEqual(listBody.sources.map((source) => source.id), [
        "generic_mcp_source",
        "github_update_source",
        "slack_dm_source",
      ]);
      assert.equal(listBody.sources[2].server_name, "fake-slack-mcp");
      assert.equal(listBody.sources[2].risk_policy.allowWriteTools, false);

      const getResponse = await fetch(`${mcpBaseUrl}/mcp-sources/slack_dm_source`);
      const getBody = await getResponse.json() as {
        source: {
          id: string;
          poll_tool: string;
        };
      };
      assert.equal(getResponse.status, 200);
      assert.equal(getBody.source.id, "slack_dm_source");
      assert.equal(getBody.source.poll_tool, "search_messages");

      const pollResponse = await fetch(`${mcpBaseUrl}/mcp-sources/slack_dm_source/poll`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              team_id: "T123",
              channel_id: "C123",
              ts: "456.000",
              thread_ts: "456.000",
              user_id: "U123",
              user_name: "Malis",
              text: "Customer says pgrust copy needs clearer Postgres version support.",
              occurred_at: "2026-05-06T16:58:00Z",
              permalink: "https://slack.example.com/archives/C123/p456000",
              project_hint: "pagerfree",
              task_hint: "blog feedback",
            },
          ],
          nextCursor: "456.000",
        }),
      });
      const pollBody = await pollResponse.json() as {
        source_id: string;
        events: Array<{
          id: string;
          source: string;
          task_hint: string;
        }>;
        duplicates_ignored: number;
        cursor: string;
      };
      assert.equal(pollResponse.status, 200);
      assert.equal(pollBody.source_id, "slack_dm_source");
      assert.equal(pollBody.events.length, 1);
      assert.equal(pollBody.events[0].source, "slack");
      assert.equal(pollBody.events[0].task_hint, "blog feedback");
      assert.equal(pollBody.duplicates_ignored, 0);
      assert.equal(pollBody.cursor, "456.000");

      const missingResponse = await fetch(`${mcpBaseUrl}/mcp-sources/missing_source/poll`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ items: [] }),
      });
      assert.equal(missingResponse.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        mcpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("polls a configured MCP source and routes events into the human queue", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const mcpServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T17:00:00.000Z"),
      mcpSources: createSeededDevelopmentMcpSourceRegistry(),
    });
    await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
    const address = mcpServer.address() as AddressInfo;
    const mcpBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${mcpBaseUrl}/mcp-sources/slack_dm_source/poll-and-route`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              team_id: "T123",
              channel_id: "C123",
              ts: "456.001",
              thread_ts: "456.001",
              user_id: "U123",
              user_name: "Malis",
              text: "Launch blog needs pricing note.",
              occurred_at: "2026-05-06T16:58:00Z",
              permalink: "https://slack.example.com/archives/C123/p456001",
              project_hint: "pagerfree",
              task_hint: "blog feedback",
            },
          ],
          nextCursor: "456.001",
        }),
      });
      const body = await response.json() as {
        source_id: string;
        events_seen: number;
        routed: Array<{
          event: {
            id: string;
            source: string;
          };
          route_decision: {
            action: string;
            target_task_id: string;
          };
          queue_item: {
            id: string;
            review_packet_id: string;
          };
        }>;
        duplicates_ignored: number;
        cursor: string;
      };

      assert.equal(response.status, 200);
      assert.equal(body.source_id, "slack_dm_source");
      assert.equal(body.events_seen, 1);
      assert.equal(body.routed.length, 1);
      assert.equal(body.routed[0].event.source, "slack");
      assert.equal(body.routed[0].route_decision.action, "ask_human_now");
      assert.equal(body.routed[0].route_decision.target_task_id, "task_blog_feedback");
      assert.equal(body.routed[0].queue_item.id, "qit_evt_slack_t123_c123_456_001");
      assert.equal(body.duplicates_ignored, 0);
      assert.equal(body.cursor, "456.001");

      const queueResponse = await fetch(`${mcpBaseUrl}/queue`);
      const queueBody = await queueResponse.json() as {
        items: Array<{
          id: string;
        }>;
      };
      assert.equal(queueResponse.status, 200);
      assert.equal(queueBody.items.some((item) => item.id === "qit_evt_slack_t123_c123_456_001"), true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        mcpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("builds review artifacts from event once for memory and Postgres paths", () => {
    const artifacts = buildReviewArtifactsFromEvent({
      id: "evt_shared_builder",
      source: "browser",
      source_id: "browser:tab",
      idempotency_key: "browser:tab",
      occurred_at: "2026-05-06T12:00:00.000Z",
      received_at: "2026-05-06T12:00:01.000Z",
      actor: {
        id: "actor_browser",
        type: "system",
      },
      task_hint: "browser review",
      type: "browser.context_captured",
      title: "Browser context",
      summary: "Captured context should become a review packet.",
      raw_ref: {
        id: "raw_browser",
        uri: "native-host://context/browser",
        media_type: "application/json",
      },
      links: [],
      resources: [
        {
          id: "ctx_browser",
          kind: "browser_tab",
          title: "Browser tab",
          url: "https://example.test",
          restore_confidence: "high",
        },
        {
          id: "ctx_workspace",
          kind: "workspace_snapshot",
          title: "Browser review workspace",
          restore_confidence: "medium",
          snapshot: {
            backend: "aerospace",
            windows: [
              {
                id: 9,
                app: "Ghostty",
                title: "codex",
                workspace: "eventloop-blog",
              },
            ],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 9,
          },
        },
      ],
    }, new Date("2026-05-06T12:00:02.000Z"));

    assert.equal(artifacts.route_decision.id, "rte_evt_shared_builder");
    assert.equal(artifacts.route_decision.target_task_id, "task_browser_review");
    assert.equal(artifacts.review_packet.id, "pkt_evt_shared_builder");
    assert.equal(artifacts.review_packet.context[0].kind, "browser_tab");
    assert.equal(artifacts.review_packet.context[1]?.kind, "workspace_snapshot");
    assert.equal(artifacts.review_packet.context[1]?.snapshot?.windows[0]?.workspace, "eventloop-blog");
    assert.equal(artifacts.queue_item.id, "qit_evt_shared_builder");
    assert.equal(artifacts.queue_item.review_packet_id, artifacts.review_packet.id);
  });

  it("returns review packet by id", async () => {
    const response = await fetch(`${baseUrl}/review-packets/pkt_seed_review`);
    const body = await response.json() as {
      packet: {
        id: string;
        title: string;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.packet.id, "pkt_seed_review");
    assert.equal(body.packet.title, "Review seeded agent change");
  });

  it("returns schema error for malformed queue request", async () => {
    const response = await fetch(`${baseUrl}/queue?state=bogus`, {
      headers: {
        "x-request-id": "req_bad_schema",
      },
    });
    const body = await response.json() as {
      error: {
        code: string;
        message: string;
      };
      request_id: string;
    };

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("x-request-id"), "req_bad_schema");
    assert.equal(body.error.code, "schema_error");
    assert.match(body.error.message, /state must be one of/);
    assert.equal(body.request_id, "req_bad_schema");
  });

  it("returns schema error for malformed JSON body", async () => {
    const response = await fetch(`${baseUrl}/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_bad_json",
      },
      body: "{not-json",
    });
    const body = await response.json() as {
      error: {
        code: string;
        message: string;
      };
      request_id: string;
    };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, "schema_error");
    assert.equal(body.error.message, "request body must be valid JSON");
    assert.equal(body.request_id, "req_bad_json");
  });
});
