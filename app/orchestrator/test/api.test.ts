import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createSeededDevelopmentMcpSourceRegistry } from "../src/integrations/mcp_poll/development_registry.js";
import { createInMemoryObservability } from "../src/observability.js";
import { createGatewayServer } from "../src/server.js";
import { buildReviewArtifactsFromEvent, createSeededStore } from "../src/store.js";
import { createSeededDevelopmentTaskSessions } from "../src/task_sessions/development_task_session_controller.js";

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

  it("does not return or lease queue items before due_at", async () => {
    const seededStore = await createSeededStore();
    seededStore.queue[0].due_at = "2026-05-06T12:05:00.000Z";
    const store = createInMemoryGatewayStore(seededStore);
    const dueServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });
    await new Promise<void>((resolve) => dueServer.listen(0, "127.0.0.1", resolve));
    const address = dueServer.address() as AddressInfo;
    const dueBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const nextResponse = await fetch(`${dueBaseUrl}/queue/next`);
      const nextBody = await nextResponse.json() as { item: unknown };
      assert.equal(nextResponse.status, 200);
      assert.equal(nextBody.item, null);

      const leaseResponse = await fetch(`${dueBaseUrl}/queue/lease-next`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lease_owner: "mac_queue_app",
          lease_ms: 30_000,
        }),
      });
      const leaseBody = await leaseResponse.json() as { item: unknown };
      assert.equal(leaseResponse.status, 200);
      assert.equal(leaseBody.item, null);
    } finally {
      await new Promise<void>((resolve, reject) => {
        dueServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
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

  it("defers and ignores queue items with visible activity", async () => {
    const seededStore = await createSeededStore();
    const observability = createInMemoryObservability();
    let currentNow = new Date("2026-05-06T12:00:00.000Z");
    const queueServer = createGatewayServer({
      store: createInMemoryGatewayStore(seededStore),
      observability,
      now: () => currentNow,
    });
    await new Promise<void>((resolve) => queueServer.listen(0, "127.0.0.1", resolve));
    const address = queueServer.address() as AddressInfo;
    const queueBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const deferResponse = await fetch(`${queueBaseUrl}/queue/qit_seed_review/defer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "defer",
          actor_id: "user_jason",
          due_at: "2026-05-06T12:05:00.000Z",
        }),
      });
      const deferBody = await deferResponse.json() as {
        item: { id: string; state: string; due_at?: string };
      };
      assert.equal(deferResponse.status, 200);
      assert.equal(deferBody.item.state, "deferred");
      assert.equal(deferBody.item.due_at, "2026-05-06T12:05:00.000Z");

      const deferredQueueResponse = await fetch(`${queueBaseUrl}/queue?state=deferred`);
      const deferredQueueBody = await deferredQueueResponse.json() as { count: number };
      assert.equal(deferredQueueBody.count, 1);

      const beforeDueResponse = await fetch(`${queueBaseUrl}/queue/next`);
      const beforeDueBody = await beforeDueResponse.json() as { item: unknown };
      assert.equal(beforeDueBody.item, null);

      currentNow = new Date("2026-05-06T12:06:00.000Z");
      const afterDueResponse = await fetch(`${queueBaseUrl}/queue/next`);
      const afterDueBody = await afterDueResponse.json() as {
        item: { id: string; state: string };
      };
      assert.equal(afterDueBody.item.id, "qit_seed_review");
      assert.equal(afterDueBody.item.state, "ready");

      const ignoreResponse = await fetch(`${queueBaseUrl}/queue/qit_seed_review/ignore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ignore",
          actor_id: "user_jason",
        }),
      });
      const ignoreBody = await ignoreResponse.json() as {
        item: { id: string; state: string };
      };
      assert.equal(ignoreResponse.status, 200);
      assert.equal(ignoreBody.item.state, "dead");

      const metrics = await observability.snapshot();
      assert.equal(metrics.counters.queue_items_deferred_total, 1);
      assert.equal(metrics.counters.queue_items_ignored_total, 1);
      assert.deepEqual((await observability.listActivity(2)).map((event) => event.type), [
        "queue_item_ignored",
        "queue_item_deferred",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        queueServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
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

  it("records local activity and metrics for routed events and done decisions", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const observability = createInMemoryObservability();
    const metricsServer = createGatewayServer({
      store,
      observability,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });
    await new Promise<void>((resolve) => metricsServer.listen(0, "127.0.0.1", resolve));
    const address = metricsServer.address() as AddressInfo;
    const metricsBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_metrics_local_1",
        source: "local",
        source_id: "local:metrics:1",
        idempotency_key: "local:metrics:1",
        occurred_at: "2026-05-06T11:59:00.000Z",
        received_at: "2026-05-06T12:00:00.000Z",
        actor: {
          id: "actor_local_system",
          type: "system",
          name: "Local event source",
        },
        type: "local.event",
        title: "Metrics proof event",
        summary: "This should produce local metrics.",
        raw_ref: {
          id: "raw_metrics_1",
          uri: "artifact://raw/metrics/1.json",
          media_type: "application/json",
        },
        links: [],
        resources: [],
      };

      const routeResponse = await fetch(`${metricsBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
      });
      const routeBody = await routeResponse.json() as {
        queue_item: {
          id: string;
        };
      };

      assert.equal(routeResponse.status, 202);
      assert.ok(routeBody.queue_item.id);

      const doneResponse = await fetch(`${metricsBaseUrl}/queue/${routeBody.queue_item.id}/done`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "done",
          actor_id: "user_jason",
        }),
      });
      assert.equal(doneResponse.status, 200);

      const metricsResponse = await fetch(`${metricsBaseUrl}/metrics`);
      const metricsBody = await metricsResponse.json() as {
        metrics: {
          counters: Record<string, number>;
          activity_count: number;
        };
      };

      assert.equal(metricsResponse.status, 200);
      assert.equal(metricsBody.metrics.counters.events_ingested_total, 1);
      assert.equal(metricsBody.metrics.counters.queue_items_created_total, 1);
      assert.equal(metricsBody.metrics.counters.queue_items_done_total, 1);
      assert.equal(metricsBody.metrics.activity_count, 2);

      const activityResponse = await fetch(`${metricsBaseUrl}/activity?limit=1`);
      const activityBody = await activityResponse.json() as {
        count: number;
        events: Array<{
          type: string;
          queue_item_id: string;
        }>;
      };

      assert.equal(activityResponse.status, 200);
      assert.equal(activityBody.count, 1);
      assert.equal(activityBody.events[0].type, "queue_item_done");
      assert.equal(activityBody.events[0].queue_item_id, routeBody.queue_item.id);
    } finally {
      await new Promise<void>((resolve, reject) => {
        metricsServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
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

      const restorePlanResponse = await fetch(`${routeBaseUrl}/contexts/restore-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ resource: contextsBody.entries[0].resource }),
      });
      const restorePlanBody = await restorePlanResponse.json() as {
        restore_plan: {
          kind: string;
          side_effect: string;
          execute_supported: boolean;
          message: {
            type: string;
            resource: {
              url: string;
            };
          };
        };
      };
      assert.equal(restorePlanResponse.status, 200);
      assert.equal(restorePlanBody.restore_plan.kind, "browser_extension_message");
      assert.equal(restorePlanBody.restore_plan.side_effect, "local");
      assert.equal(restorePlanBody.restore_plan.execute_supported, false);
      assert.equal(restorePlanBody.restore_plan.message.type, "eventloop.restore");
      assert.equal(restorePlanBody.restore_plan.message.resource.url, "https://example.test/launch");

      const restoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_browser_restore_launch",
        },
        body: JSON.stringify({ resource: contextsBody.entries[0].resource }),
      });
      const restoreRequestBody = await restoreRequestResponse.json() as {
        restore_request: {
          id: string;
          status: string;
          restore_plan: {
            kind: string;
            message: {
              type: string;
              resource: {
                url: string;
              };
            };
          };
        };
      };
      assert.equal(restoreRequestResponse.status, 202);
      assert.equal(restoreRequestBody.restore_request.status, "pending");
      assert.equal(restoreRequestBody.restore_request.restore_plan.kind, "browser_extension_message");
      assert.equal(restoreRequestBody.restore_request.restore_plan.message.type, "eventloop.restore");

      const duplicateRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_browser_restore_launch",
        },
        body: JSON.stringify({ resource: contextsBody.entries[0].resource }),
      });
      const duplicateRestoreRequestBody = await duplicateRestoreRequestResponse.json() as {
        restore_request: { id: string };
      };
      assert.equal(duplicateRestoreRequestResponse.status, 200);
      assert.equal(duplicateRestoreRequestBody.restore_request.id, restoreRequestBody.restore_request.id);

      const nextRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests/next`);
      const nextRestoreRequestBody = await nextRestoreRequestResponse.json() as {
        restore_request: {
          id: string;
          restore_plan: {
            message: {
              resource: {
                url: string;
              };
            };
          };
        };
      };
      assert.equal(nextRestoreRequestResponse.status, 200);
      assert.equal(nextRestoreRequestBody.restore_request.id, restoreRequestBody.restore_request.id);
      assert.equal(
        nextRestoreRequestBody.restore_request.restore_plan.message.resource.url,
        "https://example.test/launch",
      );

      const claimRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests/claim-next`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ lease_owner: "browser_extension_test", lease_ms: 60_000 }),
      });
      const claimRestoreRequestBody = await claimRestoreRequestResponse.json() as {
        restore_request: {
          id: string;
          status: string;
          lease_owner: string;
          lease_expires_at: string;
        };
      };
      assert.equal(claimRestoreRequestResponse.status, 200);
      assert.equal(claimRestoreRequestBody.restore_request.id, restoreRequestBody.restore_request.id);
      assert.equal(claimRestoreRequestBody.restore_request.status, "leased");
      assert.equal(claimRestoreRequestBody.restore_request.lease_owner, "browser_extension_test");
      assert.equal(typeof claimRestoreRequestBody.restore_request.lease_expires_at, "string");

      const duplicateClaimRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests/claim-next`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ lease_owner: "browser_extension_other", lease_ms: 60_000 }),
      });
      const duplicateClaimRestoreRequestBody = await duplicateClaimRestoreRequestResponse.json() as {
        restore_request: unknown;
      };
      assert.equal(duplicateClaimRestoreRequestResponse.status, 200);
      assert.equal(duplicateClaimRestoreRequestBody.restore_request, null);

      const failedRestoreRequestResponse = await fetch(
        `${routeBaseUrl}/contexts/restore-requests/${restoreRequestBody.restore_request.id}/failed`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ result: { ok: false, error: "tab not found" } }),
        },
      );
      const failedRestoreRequestBody = await failedRestoreRequestResponse.json() as {
        restore_request: {
          status: string;
          result: {
            ok: boolean;
            error: string;
          };
        };
      };
      assert.equal(failedRestoreRequestResponse.status, 200);
      assert.equal(failedRestoreRequestBody.restore_request.status, "failed");
      assert.deepEqual(failedRestoreRequestBody.restore_request.result, { ok: false, error: "tab not found" });

      const retryRestoreRequestResponse = await fetch(
        `${routeBaseUrl}/contexts/restore-requests/${restoreRequestBody.restore_request.id}/retry`,
        {
          method: "POST",
        },
      );
      const retryRestoreRequestBody = await retryRestoreRequestResponse.json() as {
        restore_request: {
          id: string;
          status: string;
          result?: unknown;
        };
      };
      assert.equal(retryRestoreRequestResponse.status, 200);
      assert.equal(retryRestoreRequestBody.restore_request.id, restoreRequestBody.restore_request.id);
      assert.equal(retryRestoreRequestBody.restore_request.status, "pending");
      assert.equal(retryRestoreRequestBody.restore_request.result, undefined);

      const retriedClaimRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests/claim-next`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ lease_owner: "browser_extension_retry", lease_ms: 60_000 }),
      });
      const retriedClaimRestoreRequestBody = await retriedClaimRestoreRequestResponse.json() as {
        restore_request: {
          id: string;
          status: string;
          lease_owner: string;
        };
      };
      assert.equal(retriedClaimRestoreRequestResponse.status, 200);
      assert.equal(retriedClaimRestoreRequestBody.restore_request.id, restoreRequestBody.restore_request.id);
      assert.equal(retriedClaimRestoreRequestBody.restore_request.status, "leased");
      assert.equal(retriedClaimRestoreRequestBody.restore_request.lease_owner, "browser_extension_retry");

      const doneRestoreRequestResponse = await fetch(
        `${routeBaseUrl}/contexts/restore-requests/${restoreRequestBody.restore_request.id}/done`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ result: { ok: true, tabId: 7, restoredScroll: true } }),
        },
      );
      const doneRestoreRequestBody = await doneRestoreRequestResponse.json() as {
        restore_request: {
          status: string;
          result: {
            ok: boolean;
            tabId: number;
            restoredScroll: boolean;
          };
        };
      };
      assert.equal(doneRestoreRequestResponse.status, 200);
      assert.equal(doneRestoreRequestBody.restore_request.status, "done");
      assert.deepEqual(doneRestoreRequestBody.restore_request.result, { ok: true, tabId: 7, restoredScroll: true });

      const fetchedRestoreRequestResponse = await fetch(
        `${routeBaseUrl}/contexts/restore-requests/${restoreRequestBody.restore_request.id}`,
      );
      const fetchedRestoreRequestBody = await fetchedRestoreRequestResponse.json() as {
        restore_request: {
          id: string;
          status: string;
          result: {
            ok: boolean;
            tabId: number;
            restoredScroll: boolean;
          };
        };
      };
      assert.equal(fetchedRestoreRequestResponse.status, 200);
      assert.equal(fetchedRestoreRequestBody.restore_request.id, restoreRequestBody.restore_request.id);
      assert.equal(fetchedRestoreRequestBody.restore_request.status, "done");
      assert.deepEqual(fetchedRestoreRequestBody.restore_request.result, { ok: true, tabId: 7, restoredScroll: true });

      const restoreMetricsResponse = await fetch(`${routeBaseUrl}/metrics`);
      const restoreMetricsBody = await restoreMetricsResponse.json() as {
        metrics: {
          counters: Record<string, number>;
        };
      };
      assert.equal(restoreMetricsResponse.status, 200);
      assert.equal(restoreMetricsBody.metrics.counters.restore_requests_created_provider_chrome_extension, 1);
      assert.equal(restoreMetricsBody.metrics.counters.restore_requests_failed_provider_chrome_extension, 1);
      assert.equal(restoreMetricsBody.metrics.counters.restore_requests_retried_provider_chrome_extension, 1);
      assert.equal(restoreMetricsBody.metrics.counters.restore_requests_done_provider_chrome_extension, 1);

      const restoreActivityResponse = await fetch(`${routeBaseUrl}/activity?limit=10`);
      const restoreActivityBody = await restoreActivityResponse.json() as {
        events: Array<{
          type: string;
          details: Record<string, unknown>;
        }>;
      };
      assert.equal(restoreActivityResponse.status, 200);
      const restoreDoneActivity = restoreActivityBody.events.find((event) => event.type === "context_restore_done");
      assert.equal(restoreDoneActivity?.details.resource_provider, "chrome-extension");

      const missingRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests/ctx_restore_missing`);
      assert.equal(missingRestoreRequestResponse.status, 404);

      const emptyRestoreRequestResponse = await fetch(`${routeBaseUrl}/contexts/restore-requests/next`);
      const emptyRestoreRequestBody = await emptyRestoreRequestResponse.json() as {
        restore_request: unknown;
      };
      assert.equal(emptyRestoreRequestResponse.status, 200);
      assert.equal(emptyRestoreRequestBody.restore_request, null);

      const urlRestorePlanResponse = await fetch(`${routeBaseUrl}/contexts/restore-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resource: {
            id: "ctx_url_1",
            kind: "url",
            title: "Launch doc",
            url: "https://example.test/launch",
            restore_confidence: "medium",
          },
        }),
      });
      const urlRestorePlanBody = await urlRestorePlanResponse.json() as {
        restore_plan: { kind: string; url: string };
      };
      assert.equal(urlRestorePlanResponse.status, 200);
      assert.equal(urlRestorePlanBody.restore_plan.kind, "open_url");
      assert.equal(urlRestorePlanBody.restore_plan.url, "https://example.test/launch");

      const fileRestorePlanResponse = await fetch(`${routeBaseUrl}/contexts/restore-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resource: {
            id: "ctx_file_1",
            kind: "file",
            title: "Plan",
            path: "/tmp/eventloop-plan.md",
            line: 12,
            column: 4,
            restore_confidence: "medium",
          },
        }),
      });
      const fileRestorePlanBody = await fileRestorePlanResponse.json() as {
        restore_plan: { kind: string; path: string; line: number; column: number };
      };
      assert.equal(fileRestorePlanResponse.status, 200);
      assert.equal(fileRestorePlanBody.restore_plan.kind, "open_file");
      assert.equal(fileRestorePlanBody.restore_plan.path, "/tmp/eventloop-plan.md");
      assert.equal(fileRestorePlanBody.restore_plan.line, 12);
      assert.equal(fileRestorePlanBody.restore_plan.column, 4);

      const unsupportedRestorePlanResponse = await fetch(`${routeBaseUrl}/contexts/restore-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ resource: { id: "ctx_unknown", kind: "note", title: "Missing URL" } }),
      });
      assert.equal(unsupportedRestorePlanResponse.status, 422);

      const olderTitleMatchEvent = {
        ...event,
        id: "evt_browser_ctx_pricing_note",
        source_id: "browser:ctx_pricing_note",
        idempotency_key: "browser:ctx_pricing_note",
        occurred_at: "2026-05-06T16:29:00.000Z",
        received_at: "2026-05-06T16:30:00.000Z",
        title: "Browser context: Pricing note checklist",
        resources: [
          {
            id: "ctx_browser_pricing_note",
            kind: "browser_tab",
            title: "Pricing note checklist",
            url: "https://example.test/pricing-note",
            source: "chrome-extension",
            captured_at: "2026-05-06T16:30:00.000Z",
            restore_confidence: "medium",
            text_quote: "Old checklist for launch page.",
          },
        ],
      };
      const olderTitleMatchResponse = await fetch(`${routeBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: olderTitleMatchEvent }),
      });
      assert.equal(olderTitleMatchResponse.status, 202);

      const searchResponse = await fetch(`${routeBaseUrl}/contexts?source=browser&q=pricing%20note&limit=5`);
      const searchBody = await searchResponse.json() as {
        count: number;
        entries: Array<{
          event_id: string;
          relevance_score: number;
          match_reasons: string[];
        }>;
      };
      assert.equal(searchResponse.status, 200);
      assert.equal(searchBody.count, 2);
      assert.equal(searchBody.entries[0].event_id, "evt_browser_ctx_pricing_note");
      assert.equal(searchBody.entries[0].relevance_score > searchBody.entries[1].relevance_score, true);
      assert.deepEqual(searchBody.entries[0].match_reasons, ["title_phrase", "term_match"]);
      assert.deepEqual(searchBody.entries[1].match_reasons, ["quote_phrase", "term_match"]);

      const termSearchResponse = await fetch(`${routeBaseUrl}/contexts?source=browser&q=pricing%20launch&limit=5`);
      const termSearchBody = await termSearchResponse.json() as {
        count: number;
        entries: Array<{ event_id: string; match_reasons: string[] }>;
      };
      assert.equal(termSearchResponse.status, 200);
      assert.equal(termSearchBody.count, 2);
      assert.deepEqual(
        termSearchBody.entries.map((entry) => entry.event_id).sort(),
        ["evt_browser_ctx_123", "evt_browser_ctx_pricing_note"],
      );
      assert.equal(termSearchBody.entries.every((entry) => entry.match_reasons.includes("term_match")), true);

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
    let restorePlanCalls = 0;
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
          restorePlanCalls += 1;
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
        idempotency_replayed: boolean;
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
      assert.equal(restoreBody.idempotency_replayed, false);
      assert.equal(restoreBody.receipt.commands[0]?.stdout, "ok");
      assert.equal(executedPlans.length, 1);

      const duplicateRestoreResponse = await fetch(`${workspaceBaseUrl}/workspace/restore`, {
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
      const duplicateRestoreBody = await duplicateRestoreResponse.json() as {
        ok: boolean;
        idempotency_replayed: boolean;
        receipt: {
          commands: Array<{
            stdout: string;
          }>;
        };
      };
      assert.equal(duplicateRestoreResponse.status, 200);
      assert.equal(duplicateRestoreBody.ok, true);
      assert.equal(duplicateRestoreBody.idempotency_replayed, true);
      assert.equal(duplicateRestoreBody.receipt.commands[0]?.stdout, "ok");
      assert.equal(restorePlanCalls, 1);
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
    const observability = createInMemoryObservability();
    const messages = new Map<string, Record<string, unknown>>();
    const taskServer = createGatewayServer({
      store,
      observability,
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

      const metricsResponse = await fetch(`${taskBaseUrl}/metrics`);
      const metricsBody = await metricsResponse.json() as {
        metrics: {
          counters: Record<string, number>;
          activity_count: number;
        };
      };
      assert.equal(metricsBody.metrics.counters.task_followups_attempted_total, 2);
      assert.equal(metricsBody.metrics.counters.task_followups_sent_total, 2);
      assert.equal(metricsBody.metrics.activity_count, 4);

      const activityResponse = await fetch(`${taskBaseUrl}/activity?limit=4`);
      const activityBody = await activityResponse.json() as {
        events: Array<{
          type: string;
          task_session_id?: string;
          status?: string;
          details: Record<string, unknown>;
        }>;
      };
      assert.deepEqual(activityBody.events.map((event) => event.type), [
        "task_followup_sent",
        "task_followup_attempted",
        "task_followup_sent",
        "task_followup_attempted",
      ]);
      assert.equal(activityBody.events[0].task_session_id, "task_session_blog");
      assert.equal(activityBody.events[0].details.idempotency_key, "idem_task_followup_1");

      const filteredActivityResponse = await fetch(`${taskBaseUrl}/activity?task_session_id=task_session_blog&status=ok&since=2026-05-06T11:59:00.000Z`);
      const filteredActivityBody = await filteredActivityResponse.json() as {
        count: number;
        events: Array<{ task_session_id?: string; status?: string }>;
      };
      assert.equal(filteredActivityResponse.status, 200);
      assert.equal(filteredActivityBody.count, 4);
      assert.ok(filteredActivityBody.events.every((event) => event.task_session_id === "task_session_blog"));
      assert.ok(filteredActivityBody.events.every((event) => event.status === "ok"));
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("records failed task followups for after-the-fact debugging", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const observability = createInMemoryObservability();
    const taskServer = createGatewayServer({
      store,
      observability,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      taskSessions: {
        sendFollowupMessage() {
          throw new Error("task runtime offline");
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${taskBaseUrl}/task-sessions/task_session_missing/followup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_task_followup_failed",
        },
        body: JSON.stringify({
          text: "Try to resume.",
          event_ids: ["evt_failed_followup"],
        }),
      });
      assert.equal(response.status, 500);

      const metricsResponse = await fetch(`${taskBaseUrl}/metrics`);
      const metricsBody = await metricsResponse.json() as {
        metrics: {
          counters: Record<string, number>;
        };
      };
      assert.equal(metricsBody.metrics.counters.task_followups_attempted_total, 1);
      assert.equal(metricsBody.metrics.counters.task_followups_failed_total, 1);

      const activityResponse = await fetch(`${taskBaseUrl}/activity?limit=2`);
      const activityBody = await activityResponse.json() as {
        events: Array<{
          type: string;
          status?: string;
          summary: string;
          details: Record<string, unknown>;
        }>;
      };
      assert.deepEqual(activityBody.events.map((event) => event.type), [
        "task_followup_failed",
        "task_followup_attempted",
      ]);
      assert.equal(activityBody.events[0].status, "failed");
      assert.equal(activityBody.events[0].details.error, "task runtime offline");

      const failedOnlyResponse = await fetch(`${taskBaseUrl}/activity?status=failed&since=2026-05-06T11:59:00.000Z`);
      const failedOnlyBody = await failedOnlyResponse.json() as {
        count: number;
        events: Array<{ status?: string }>;
      };
      assert.equal(failedOnlyResponse.status, 200);
      assert.equal(failedOnlyBody.count, 1);
      assert.equal(failedOnlyBody.events[0]?.status, "failed");
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("records blocked direct task followups for after-the-fact debugging", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const observability = createInMemoryObservability();
    const taskServer = createGatewayServer({
      store,
      observability,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      taskSessions: {
        sendFollowupMessage(input) {
          return {
            id: "task_msg_blocked",
            task_session_id: input.task_session_id,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "blocked",
          };
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${taskBaseUrl}/task-sessions/task_session_blog/followup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_task_followup_blocked",
        },
        body: JSON.stringify({
          text: "Try to resume.",
          event_ids: ["evt_blocked_followup"],
        }),
      });
      const body = await response.json() as {
        message: { status: string; idempotency_key: string };
      };
      assert.equal(response.status, 202);
      assert.equal(body.message.status, "blocked");
      assert.equal(body.message.idempotency_key, "idem_task_followup_blocked");

      const metricsResponse = await fetch(`${taskBaseUrl}/metrics`);
      const metricsBody = await metricsResponse.json() as {
        metrics: { counters: Record<string, number> };
      };
      assert.equal(metricsBody.metrics.counters.task_followups_attempted_total, 1);
      assert.equal(metricsBody.metrics.counters.task_followups_blocked_total, 1);

      const activityResponse = await fetch(`${taskBaseUrl}/activity?limit=2`);
      const activityBody = await activityResponse.json() as {
        events: Array<{
          type: string;
          status?: string;
          details: Record<string, unknown>;
        }>;
      };
      assert.deepEqual(activityBody.events.map((event) => event.type), [
        "task_followup_blocked",
        "task_followup_attempted",
      ]);
      assert.equal(activityBody.events[0].status, "blocked");
      assert.equal(activityBody.events[0].details.idempotency_key, "idem_task_followup_blocked");
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("binds a task session to a task through the task-session API", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const bindings: unknown[] = [];
    const taskServer = createGatewayServer({
      store,
      taskSessions: {
        sendFollowupMessage() {
          throw new Error("not used");
        },
        bindTaskSession(input) {
          bindings.push(input);
          return {
            ok: true,
            task_session_id: input.task_session_id,
            task_id: input.task_id,
            native_thread_id: "thread_blog_123",
          };
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${taskBaseUrl}/task-sessions/codex_thread_abc/task-binding`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ task_id: "task_blog_feedback" }),
      });
      const body = await response.json() as {
        ok: boolean;
        binding: {
          task_session_id: string;
          task_id: string;
          native_thread_id: string;
        };
      };

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.binding.task_session_id, "codex_thread_abc");
      assert.equal(body.binding.task_id, "task_blog_feedback");
      assert.equal(body.binding.native_thread_id, "thread_blog_123");
      assert.deepEqual(bindings, [{ task_session_id: "codex_thread_abc", task_id: "task_blog_feedback" }]);

      const malformed = await fetch(`${taskBaseUrl}/task-sessions/codex_thread_abc/task-binding`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ task_id: "blog feedback" }),
      });
      assert.equal(malformed.status, 400);
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
        route_decision: {
          action: string;
        };
        task_message?: unknown;
      };
      assert.equal(duplicateResponse.status, 202);
      assert.equal(duplicateBody.route_decision.action, "inject_into_agent_thread");
      assert.equal(duplicateBody.task_message, undefined);
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

  it("falls back to the human queue when event-route task followup fails and dedupes retry", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const observability = createInMemoryObservability();
    let attempts = 0;
    const taskServer = createGatewayServer({
      store,
      observability,
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
        sendFollowupMessage() {
          attempts += 1;
          throw new Error("task runtime offline");
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_slack_task_inject_failed",
        source: "slack",
        source_id: "slack:T123:C123:failed",
        idempotency_key: "slack:T123:C123:failed",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        task_hint: "blog feedback",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Blog needs launch date note before next draft.",
        raw_ref: {
          id: "raw_slack_T123_C123_failed",
          uri: "artifact://raw/slack/T123/C123/failed.json",
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

      const firstResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const firstBody = await firstResponse.json() as {
        ok: boolean;
        route_decision: { action: string };
        queue_item?: { id: string; state: string };
        task_message?: unknown;
      };

      assert.equal(firstResponse.status, 202);
      assert.equal(firstBody.ok, true);
      assert.equal(firstBody.route_decision.action, "ask_human_now");
      assert.equal(firstBody.queue_item?.state, "ready");
      assert.equal(firstBody.task_message, undefined);
      assert.equal(attempts, 1);

      const duplicateResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const duplicateBody = await duplicateResponse.json() as {
        route_decision: { action: string };
        queue_item?: { id: string };
        task_message?: unknown;
      };

      assert.equal(duplicateResponse.status, 202);
      assert.equal(duplicateBody.route_decision.action, "ask_human_now");
      assert.equal(duplicateBody.queue_item?.id, firstBody.queue_item?.id);
      assert.equal(duplicateBody.task_message, undefined);
      assert.equal(attempts, 1);

      const metricsResponse = await fetch(`${taskBaseUrl}/metrics`);
      const metricsBody = await metricsResponse.json() as {
        metrics: { counters: Record<string, number> };
      };
      assert.equal(metricsBody.metrics.counters.task_followups_attempted_total, 1);
      assert.equal(metricsBody.metrics.counters.task_followups_failed_total, 1);
      assert.equal(metricsBody.metrics.counters.queue_items_created_total, 1);

      const activityResponse = await fetch(`${taskBaseUrl}/activity?limit=3`);
      const activityBody = await activityResponse.json() as {
        events: Array<{
          type: string;
          details: Record<string, unknown>;
        }>;
      };
      assert.deepEqual(activityBody.events.map((entry) => entry.type), [
        "event_routed",
        "task_followup_failed",
        "task_followup_attempted",
      ]);
      assert.equal(activityBody.events[0].details.task_message_error, "task runtime offline");
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("falls back to the human queue when event-route task followup is blocked", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const observability = createInMemoryObservability();
    let attempts = 0;
    const taskServer = createGatewayServer({
      store,
      observability,
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
          attempts += 1;
          return {
            id: "task_msg_blocked",
            task_session_id: input.task_session_id,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "blocked",
          };
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_slack_task_inject_blocked",
        source: "slack",
        source_id: "slack:T123:C123:blocked",
        idempotency_key: "slack:T123:C123:blocked",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        task_hint: "blog feedback",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Blog needs launch date note before next draft.",
        raw_ref: {
          id: "raw_slack_T123_C123_blocked",
          uri: "artifact://raw/slack/T123/C123/blocked.json",
          media_type: "application/json",
        },
        links: [],
        resources: [],
      };

      const response = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const body = await response.json() as {
        route_decision: { action: string };
        queue_item?: { state: string };
        task_message?: unknown;
      };

      assert.equal(response.status, 202);
      assert.equal(body.route_decision.action, "ask_human_now");
      assert.equal(body.queue_item?.state, "ready");
      assert.equal(body.task_message, undefined);
      assert.equal(attempts, 1);

      const duplicateResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      assert.equal(duplicateResponse.status, 202);
      assert.equal(attempts, 1);

      const metricsResponse = await fetch(`${taskBaseUrl}/metrics`);
      const metricsBody = await metricsResponse.json() as {
        metrics: { counters: Record<string, number> };
      };
      assert.equal(metricsBody.metrics.counters.task_followups_attempted_total, 1);
      assert.equal(metricsBody.metrics.counters.task_followups_blocked_total, 1);
      assert.equal(metricsBody.metrics.counters.queue_items_created_total, 1);

      const activityResponse = await fetch(`${taskBaseUrl}/activity?limit=3`);
      const activityBody = await activityResponse.json() as {
        events: Array<{ type: string; details: Record<string, unknown> }>;
      };
      assert.deepEqual(activityBody.events.map((entry) => entry.type), [
        "event_routed",
        "task_followup_blocked",
        "task_followup_attempted",
      ]);
      assert.equal(activityBody.events[0].details.task_message_error, "task followup blocked");
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("routes unhinted Slack events into task sessions using stored task context", async () => {
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
      const contextEvent = {
        id: "evt_browser_ctx_unhinted_slack_blog",
        source: "browser",
        source_id: "browser:ctx_unhinted_slack_blog",
        idempotency_key: "browser:ctx_unhinted_slack_blog",
        occurred_at: "2026-05-06T16:50:00.000Z",
        received_at: "2026-05-06T16:50:00.000Z",
        task_hint: "blog feedback",
        type: "browser.context_captured",
        title: "Browser context: Blog launch draft",
        summary: "Blog launch draft includes launch date paragraph.",
        raw_ref: {
          id: "raw_browser_ctx_unhinted_slack_blog",
          uri: "artifact://raw/browser/ctx-unhinted-slack-blog.json",
          media_type: "application/json",
        },
        links: [],
        resources: [
          {
            id: "ctx_browser_unhinted_slack_blog",
            kind: "browser_tab",
            title: "Blog launch draft",
            url: "https://example.test/blog-launch-draft",
            source: "chrome-extension",
            text_quote: "Launch date paragraph in blog draft.",
            captured_at: "2026-05-06T16:50:00.000Z",
            restore_confidence: "high",
          },
        ],
      };
      const contextResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: contextEvent }),
      });
      const contextBody = await contextResponse.json() as {
        route_decision: {
          action: string;
          target_task_id: string;
        };
      };
      assert.equal(contextResponse.status, 202);
      assert.equal(contextBody.route_decision.action, "attach_to_task");
      assert.equal(contextBody.route_decision.target_task_id, "task_blog_feedback");

      const event = {
        id: "evt_slack_unhinted_blog_context_match",
        source: "slack",
        source_id: "slack:T123:C123:unhinted-context",
        idempotency_key: "slack:T123:C123:unhinted-context",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Launch date feedback belongs in the blog draft before next pass.",
        raw_ref: {
          id: "raw_slack_T123_C123_unhinted_context",
          uri: "artifact://raw/slack/T123/C123/unhinted-context.json",
          media_type: "application/json",
        },
        links: [
          {
            label: "Blog draft",
            url: "https://example.test/blog-launch-draft",
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
          confidence: string;
          evidence: Array<{
            kind: string;
          }>;
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
      assert.equal(body.route_decision.confidence, "high");
      assert.equal(body.route_decision.evidence.some((evidence) => evidence.kind === "context_match"), true);
      assert.equal(body.review_packet, undefined);
      assert.equal(body.queue_item, undefined);
      assert.equal(body.task_message.task_session_id, "task_session_blog");
      assert.deepEqual(body.task_message.event_ids, ["evt_slack_unhinted_blog_context_match"]);
      assert.match(body.task_message.text, /Launch date feedback/);
      assert.match(body.task_message.text, /Matched context: Browser context: Blog launch draft/);
      assert.match(body.task_message.text, /Matched context URL: https:\/\/example\.test\/blog-launch-draft/);
      assert.equal(body.task_message.idempotency_key, "inject_slack:T123:C123:unhinted-context");
      assert.equal(messages.size, 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("keeps unmatched unhinted ambient events in the human queue", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const messages: Record<string, unknown>[] = [];
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
          const message = {
            id: `task_msg_${messages.length + 1}`,
            task_session_id: input.task_session_id,
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
          messages.push(message);
          return message;
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_slack_unmatched_ambient",
        source: "slack",
        source_id: "slack:T123:C999:unmatched",
        idempotency_key: "slack:T123:C999:unmatched",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Can you check the office lease invoice this afternoon?",
        raw_ref: {
          id: "raw_slack_T123_C999_unmatched",
          uri: "artifact://raw/slack/T123/C999/unmatched.json",
          media_type: "application/json",
        },
        links: [],
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
        route_decision: {
          action: string;
          target_task_id?: string;
        };
        queue_item?: unknown;
        task_message?: unknown;
      };

      assert.equal(response.status, 202);
      assert.equal(body.route_decision.action, "ask_human_now");
      assert.equal(body.route_decision.target_task_id, undefined);
      assert.notEqual(body.queue_item, undefined);
      assert.equal(body.task_message, undefined);
      assert.equal(messages.length, 0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("keeps ambiguous unhinted ambient events in the human queue", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const messages: Record<string, unknown>[] = [];
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
            {
              id: "task_session_launch_email",
              task_id: "task_launch_email",
              status: "idle",
            },
          ];
        },
        sendFollowupMessage(input) {
          const message = {
            id: `task_msg_${messages.length + 1}`,
            task_session_id: input.task_session_id,
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
          messages.push(message);
          return message;
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      for (const contextEvent of [
        {
          id: "evt_browser_ctx_ambiguous_blog",
          source: "browser",
          source_id: "browser:ctx_ambiguous_blog",
          idempotency_key: "browser:ctx_ambiguous_blog",
          occurred_at: "2026-05-06T16:50:00.000Z",
          received_at: "2026-05-06T16:50:00.000Z",
          task_hint: "blog feedback",
          type: "browser.context_captured",
          title: "Browser context: Blog launch draft",
          summary: "Launch date draft needs review.",
          raw_ref: {
            id: "raw_browser_ctx_ambiguous_blog",
            uri: "artifact://raw/browser/ctx-ambiguous-blog.json",
            media_type: "application/json",
          },
          links: [],
          resources: [
            {
              id: "ctx_browser_ambiguous_blog",
              kind: "browser_tab",
              title: "Launch date draft",
              text_quote: "Launch date draft needs review.",
              captured_at: "2026-05-06T16:50:00.000Z",
              restore_confidence: "high",
            },
          ],
        },
        {
          id: "evt_browser_ctx_ambiguous_email",
          source: "browser",
          source_id: "browser:ctx_ambiguous_email",
          idempotency_key: "browser:ctx_ambiguous_email",
          occurred_at: "2026-05-06T16:51:00.000Z",
          received_at: "2026-05-06T16:51:00.000Z",
          task_hint: "launch email",
          type: "browser.context_captured",
          title: "Browser context: Launch email draft",
          summary: "Launch date draft needs review.",
          raw_ref: {
            id: "raw_browser_ctx_ambiguous_email",
            uri: "artifact://raw/browser/ctx-ambiguous-email.json",
            media_type: "application/json",
          },
          links: [],
          resources: [
            {
              id: "ctx_browser_ambiguous_email",
              kind: "browser_tab",
              title: "Launch date draft",
              text_quote: "Launch date draft needs review.",
              captured_at: "2026-05-06T16:51:00.000Z",
              restore_confidence: "high",
            },
          ],
        },
      ]) {
        const contextResponse = await fetch(`${taskBaseUrl}/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ event: contextEvent }),
        });
        assert.equal(contextResponse.status, 202);
      }

      const event = {
        id: "evt_slack_ambiguous_ambient",
        source: "slack",
        source_id: "slack:T123:C999:ambiguous",
        idempotency_key: "slack:T123:C999:ambiguous",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Launch date draft needs review.",
        raw_ref: {
          id: "raw_slack_T123_C999_ambiguous",
          uri: "artifact://raw/slack/T123/C999/ambiguous.json",
          media_type: "application/json",
        },
        links: [],
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
        route_decision: {
          action: string;
          target_task_id?: string;
        };
        queue_item?: unknown;
        task_message?: unknown;
      };

      assert.equal(response.status, 202);
      assert.equal(body.route_decision.action, "ask_human_now");
      assert.equal(body.route_decision.target_task_id, undefined);
      assert.notEqual(body.queue_item, undefined);
      assert.equal(body.task_message, undefined);
      assert.equal(messages.length, 0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("does not inject a duplicate event into a task session after it already queued human review", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    let sessions: Array<Record<string, unknown>> = [];
    const messages: Record<string, unknown>[] = [];
    const taskServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      taskSessions: {
        listSessions() {
          return sessions;
        },
        sendFollowupMessage(input) {
          const message = {
            id: `task_msg_${messages.length + 1}`,
            task_session_id: input.task_session_id,
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
          messages.push(message);
          return message;
        },
      },
    });
    await new Promise<void>((resolve) => taskServer.listen(0, "127.0.0.1", resolve));
    const address = taskServer.address() as AddressInfo;
    const taskBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_slack_late_duplicate",
        source: "slack",
        source_id: "slack:T123:C123:late-duplicate",
        idempotency_key: "slack:T123:C123:late-duplicate",
        occurred_at: "2026-05-06T16:59:00.000Z",
        received_at: "2026-05-06T17:00:00.000Z",
        task_hint: "blog feedback",
        type: "slack.message",
        title: "Slack message from Malis",
        summary: "Blog needs launch date note before next draft.",
        raw_ref: {
          id: "raw_slack_T123_C123_late_duplicate",
          uri: "artifact://raw/slack/T123/C123/late-duplicate.json",
          media_type: "application/json",
        },
        links: [],
        resources: [],
      };

      const firstResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
      });
      const firstBody = await firstResponse.json() as {
        route_decision: {
          action: string;
        };
        queue_item?: unknown;
        task_message?: unknown;
      };

      assert.equal(firstResponse.status, 202);
      assert.equal(firstBody.route_decision.action, "ask_human_now");
      assert.notEqual(firstBody.queue_item, undefined);
      assert.equal(firstBody.task_message, undefined);

      const firstQueueResponse = await fetch(`${taskBaseUrl}/queue`);
      const firstQueueBody = await firstQueueResponse.json() as { items: unknown[] };

      sessions = [
        {
          id: "task_session_blog",
          task_id: "task_blog_feedback",
          status: "idle",
        },
      ];

      const duplicateResponse = await fetch(`${taskBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          event: {
            ...event,
            id: "evt_slack_late_duplicate_retry",
            title: "Retry after task session appears",
          },
        }),
      });
      const duplicateBody = await duplicateResponse.json() as {
        event: {
          id: string;
        };
        route_decision: {
          action: string;
        };
        queue_item?: unknown;
        task_message?: unknown;
      };

      assert.equal(duplicateResponse.status, 202);
      assert.equal(duplicateBody.event.id, "evt_slack_late_duplicate");
      assert.equal(duplicateBody.route_decision.action, "ask_human_now");
      assert.notEqual(duplicateBody.queue_item, undefined);
      assert.equal(duplicateBody.task_message, undefined);
      assert.equal(messages.length, 0);

      const queueResponse = await fetch(`${taskBaseUrl}/queue`);
      const queueBody = await queueResponse.json() as { items: unknown[] };
      assert.equal(queueBody.items.length, firstQueueBody.items.length);
    } finally {
      await new Promise<void>((resolve, reject) => {
        taskServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("executes recommended resume-agent queue action and marks the item done", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const taskSessions = createSeededDevelopmentTaskSessions(() => new Date("2026-05-06T18:00:00.000Z"));
    const actionServer = createGatewayServer({
      store,
      taskSessions,
      now: () => new Date("2026-05-06T18:00:00.000Z"),
    });
    await new Promise<void>((resolve) => actionServer.listen(0, "127.0.0.1", resolve));
    const address = actionServer.address() as AddressInfo;
    const actionBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const event = {
        id: "evt_manual_blog_action",
        source: "manual",
        source_id: "manual:blog-action",
        idempotency_key: "manual:blog-action",
        occurred_at: "2026-05-06T17:59:00.000Z",
        received_at: "2026-05-06T18:00:00.000Z",
        actor: {
          id: "actor_manual_jason",
          type: "human",
          name: "Jason",
        },
        project_hint: "eventloopOS",
        task_hint: "blog feedback",
        type: "manual.review_requested",
        title: "Launch blog final paragraph",
        summary: "Check final paragraph before sending.",
        raw_ref: {
          id: "raw_manual_blog_action",
          uri: "manual://reviews/blog-action",
          media_type: "text/plain",
        },
        links: [
          {
            label: "Draft",
            url: "https://docs.example.test/blog",
          },
        ],
        resources: [
          {
            id: "ctx_manual_blog_action",
            kind: "manual_note",
            title: "Launch blog final paragraph",
            url: "https://docs.example.test/blog",
            source: "manual",
            captured_at: "2026-05-06T18:00:00.000Z",
            restore_confidence: "medium",
          },
        ],
      };

      const eventResponse = await fetch(`${actionBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
      });
      const eventBody = await eventResponse.json() as {
        queue_item: {
          id: string;
        };
      };

      assert.equal(eventResponse.status, 202);
      const actionResponse = await fetch(`${actionBaseUrl}/queue/${eventBody.queue_item.id}/actions/recommended`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ actor_id: "mac_queue_app" }),
      });
      const actionBody = await actionResponse.json() as {
        ok: boolean;
        action_result: {
          task_id: string;
          task_session_id: string;
          task_message: {
            status: string;
            text: string;
            event_ids: string[];
          };
        };
        item: {
          id: string;
          state: string;
        };
      };

      assert.equal(actionResponse.status, 200);
      assert.equal(actionBody.ok, true);
      assert.equal(actionBody.action_result.task_id, "task_blog_feedback");
      assert.equal(actionBody.action_result.task_session_id, "task_session_blog");
      assert.equal(actionBody.action_result.task_message.status, "sent");
      assert.match(actionBody.action_result.task_message.text, /Human approved this queue item/);
      assert.deepEqual(actionBody.action_result.task_message.event_ids, ["evt_manual_blog_action"]);
      assert.equal(actionBody.item.id, eventBody.queue_item.id);
      assert.equal(actionBody.item.state, "done");

      const queueResponse = await fetch(`${actionBaseUrl}/queue/next`);
      const queueBody = await queueResponse.json() as { item: unknown };
      assert.equal(queueBody.item, null);
    } finally {
      await new Promise<void>((resolve, reject) => {
        actionServer.close((error) => (error ? reject(error) : resolve()));
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

  it("normalizes unhinted voice commands into inferred task-session followups", async () => {
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
      const contextEvent = {
        id: "evt_browser_ctx_unhinted_voice_blog",
        source: "browser",
        source_id: "browser:ctx_unhinted_voice_blog",
        idempotency_key: "browser:ctx_unhinted_voice_blog",
        occurred_at: "2026-05-06T16:50:00.000Z",
        received_at: "2026-05-06T16:50:00.000Z",
        task_hint: "blog feedback",
        type: "browser.context_captured",
        title: "Browser context: Blog launch draft",
        summary: "Blog launch draft includes launch date paragraph.",
        raw_ref: {
          id: "raw_browser_ctx_unhinted_voice_blog",
          uri: "artifact://raw/browser/ctx-unhinted-voice-blog.json",
          media_type: "application/json",
        },
        links: [],
        resources: [
          {
            id: "ctx_browser_unhinted_voice_blog",
            kind: "browser_tab",
            title: "Blog launch draft",
            url: "https://example.test/blog-launch-draft",
            source: "chrome-extension",
            text_quote: "Launch date paragraph in blog draft.",
            captured_at: "2026-05-06T16:50:00.000Z",
            restore_confidence: "high",
          },
        ],
      };
      const contextResponse = await fetch(`${voiceBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: contextEvent }),
      });
      assert.equal(contextResponse.status, 202);

      const response = await fetch(`${voiceBaseUrl}/voice/commands`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem_voice_unhinted_blog_priority",
        },
        body: JSON.stringify({
          transcript: "Blog draft is priority and should include launch date in two weeks.",
        }),
      });
      const body = await response.json() as {
        ok: boolean;
        event: {
          id: string;
          task_hint?: string;
        };
        route_decision: {
          action: string;
          target_task_id: string;
          target_task_session_id: string;
          evidence: Array<{
            kind: string;
          }>;
        };
        task_message: {
          task_session_id: string;
          event_ids: string[];
          text: string;
        };
        queue_item?: unknown;
      };

      assert.equal(response.status, 202);
      assert.equal(body.ok, true);
      assert.equal(body.event.task_hint, undefined);
      assert.equal(body.route_decision.action, "inject_into_agent_thread");
      assert.equal(body.route_decision.target_task_id, "task_blog_feedback");
      assert.equal(body.route_decision.target_task_session_id, "task_session_blog");
      assert.equal(body.route_decision.evidence.some((evidence) => evidence.kind === "context_match"), true);
      assert.equal(body.task_message.task_session_id, "task_session_blog");
      assert.deepEqual(body.task_message.event_ids, [body.event.id]);
      assert.match(body.task_message.text, /Blog draft is priority/);
      assert.match(body.task_message.text, /Matched context: Browser context: Blog launch draft/);
      assert.equal(body.queue_item, undefined);

      const storedResponse = await fetch(`${voiceBaseUrl}/events/${body.event.id}`);
      const storedBody = await storedResponse.json() as {
        route_decision: {
          action: string;
        };
      };
      assert.equal(storedResponse.status, 200);
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

  it("routes unhinted MCP-polled events into task sessions using stored context", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const messages = new Map<string, Record<string, unknown>>();
    const mcpServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T17:00:00.000Z"),
      mcpSources: createSeededDevelopmentMcpSourceRegistry(),
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
    await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
    const address = mcpServer.address() as AddressInfo;
    const mcpBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const contextEvent = {
        id: "evt_browser_ctx_unhinted_mcp_blog",
        source: "browser",
        source_id: "browser:ctx_unhinted_mcp_blog",
        idempotency_key: "browser:ctx_unhinted_mcp_blog",
        occurred_at: "2026-05-06T16:50:00.000Z",
        received_at: "2026-05-06T16:50:00.000Z",
        task_hint: "blog feedback",
        type: "browser.context_captured",
        title: "Browser context: Blog launch draft",
        summary: "Blog launch draft includes launch date paragraph.",
        raw_ref: {
          id: "raw_browser_ctx_unhinted_mcp_blog",
          uri: "artifact://raw/browser/ctx-unhinted-mcp-blog.json",
          media_type: "application/json",
        },
        links: [],
        resources: [
          {
            id: "ctx_browser_unhinted_mcp_blog",
            kind: "browser_tab",
            title: "Blog launch draft",
            url: "https://example.test/blog-launch-draft",
            source: "chrome-extension",
            text_quote: "Launch date paragraph in blog draft.",
            captured_at: "2026-05-06T16:50:00.000Z",
            restore_confidence: "high",
          },
        ],
      };
      const contextResponse = await fetch(`${mcpBaseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: contextEvent }),
      });
      assert.equal(contextResponse.status, 202);

      const response = await fetch(`${mcpBaseUrl}/mcp-sources/generic_mcp_source/poll-and-route`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              id: "office-priority-unhinted",
              source: "mcp_poll",
              type: "office.priority_hint",
              title: "Launch date feedback",
              summary: "Launch date feedback belongs in the blog draft before next pass.",
              occurred_at: "2026-05-06T16:58:00Z",
              actor: {
                id: "actor_mcp_office",
                type: "human",
                name: "Office",
              },
              links: [
                {
                  label: "Blog draft",
                  url: "https://example.test/blog-launch-draft",
                },
              ],
              resources: [],
            },
          ],
          nextCursor: "office-priority-unhinted",
        }),
      });
      const body = await response.json() as {
        source_id: string;
        events_seen: number;
        routed: Array<{
          event: {
            id: string;
            task_hint?: string;
          };
          route_decision: {
            action: string;
            target_task_id: string;
            target_task_session_id: string;
            evidence: Array<{
              kind: string;
            }>;
          };
          task_message: {
            task_session_id: string;
            text: string;
          };
          queue_item?: unknown;
        }>;
      };

      assert.equal(response.status, 200);
      assert.equal(body.source_id, "generic_mcp_source");
      assert.equal(body.events_seen, 1);
      assert.equal(body.routed.length, 1);
      assert.equal(body.routed[0].event.task_hint, undefined);
      assert.equal(body.routed[0].route_decision.action, "inject_into_agent_thread");
      assert.equal(body.routed[0].route_decision.target_task_id, "task_blog_feedback");
      assert.equal(body.routed[0].route_decision.target_task_session_id, "task_session_blog");
      assert.equal(body.routed[0].route_decision.evidence.some((evidence) => evidence.kind === "context_match"), true);
      assert.equal(body.routed[0].task_message.task_session_id, "task_session_blog");
      assert.match(body.routed[0].task_message.text, /Matched context: Browser context: Blog launch draft/);
      assert.equal(body.routed[0].queue_item, undefined);
      assert.equal(messages.size, 1);
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

  it("polls selected MCP sources and routes each event without blocking on empty sources", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const mcpServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T17:03:05.000Z"),
      mcpSources: createSeededDevelopmentMcpSourceRegistry(),
    });
    await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
    const address = mcpServer.address() as AddressInfo;
    const mcpBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${mcpBaseUrl}/mcp-sources/poll-all-and-route`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source_ids: ["github_update_source", "generic_mcp_source"],
          inputs_by_source_id: {
            generic_mcp_source: {
              items: [
                {
                  id: "office-priority-1",
                  source: "voice_note",
                  type: "voice.priority_hint",
                  title: "Blog launch detail now matters",
                  summary: "Blog post should mention launch in two weeks.",
                  occurred_at: "2026-05-06T17:03:00Z",
                  actor: {
                    id: "actor_voice_jason",
                    type: "human",
                    name: "Jason",
                  },
                  project_hint: "pagerfree",
                  task_hint: "blog feedback",
                  links: [
                    {
                      label: "Voice note",
                      url: "eventloop://voice/office-priority-1",
                    },
                  ],
                  resources: [],
                },
              ],
            },
          },
        }),
      });
      const body = await response.json() as {
        ok: boolean;
        sources_seen: number;
        events_seen: number;
        routed_count: number;
        errors: number;
        polled: Array<{
          source_id: string;
          ok: boolean;
          events_seen?: number;
          routed?: Array<{
            event: {
              source: string;
              title: string;
            };
            route_decision: {
              action: string;
              target_task_id: string;
            };
            queue_item?: {
              review_packet_id: string;
            };
          }>;
        }>;
      };

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.sources_seen, 2);
      assert.equal(body.events_seen, 1);
      assert.equal(body.routed_count, 1);
      assert.equal(body.errors, 0);
      assert.equal(body.polled[0].source_id, "github_update_source");
      assert.equal(body.polled[0].events_seen, 0);
      assert.equal(body.polled[1].source_id, "generic_mcp_source");
      assert.equal(body.polled[1].events_seen, 1);
      assert.equal(body.polled[1].routed?.[0]?.event.source, "voice_note");
      assert.equal(body.polled[1].routed?.[0]?.route_decision.action, "ask_human_now");
      assert.equal(body.polled[1].routed?.[0]?.route_decision.target_task_id, "task_blog_feedback");
      assert.ok(body.polled[1].routed?.[0]?.queue_item?.review_packet_id);
    } finally {
      await new Promise<void>((resolve, reject) => {
        mcpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("continues poll-all routing when one MCP source fails", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore());
    const mcpServer = createGatewayServer({
      store,
      now: () => new Date("2026-05-06T17:05:00.000Z"),
      mcpSources: {
        listSources() {
          return [
            { id: "broken_source" },
            { id: "working_source" },
          ];
        },
        pollSource(sourceId) {
          if (sourceId === "broken_source") {
            throw new Error("broken MCP source timed out");
          }
          return {
            events: [
              {
                id: "evt_poll_all_working",
                source: "mcp_poll",
                source_id: "working:item:1",
                idempotency_key: "working:item:1",
                occurred_at: "2026-05-06T17:04:00.000Z",
                received_at: "2026-05-06T17:05:00.000Z",
                actor: {
                  id: "actor_mcp_working",
                  type: "system",
                },
                type: "mcp.update",
                title: "Working source event",
                summary: "One source failed but this source should still route.",
                raw_ref: {
                  id: "raw_working_item_1",
                  uri: "artifact://raw/working-item-1.json",
                  media_type: "application/json",
                },
                links: [],
                resources: [],
              },
            ],
            duplicates_ignored: 0,
          };
        },
      },
    });
    await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
    const address = mcpServer.address() as AddressInfo;
    const mcpBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${mcpBaseUrl}/mcp-sources/poll-all-and-route`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const body = await response.json() as {
        ok: boolean;
        sources_seen: number;
        events_seen: number;
        routed_count: number;
        errors: number;
        polled: Array<{
          source_id: string;
          ok: boolean;
          error?: string;
          routed?: Array<{
            event: {
              id: string;
            };
          }>;
        }>;
      };

      assert.equal(response.status, 200);
      assert.equal(body.ok, false);
      assert.equal(body.sources_seen, 2);
      assert.equal(body.events_seen, 1);
      assert.equal(body.routed_count, 1);
      assert.equal(body.errors, 1);
      assert.deepEqual(body.polled.map((result) => result.ok), [false, true]);
      assert.equal(body.polled[0].source_id, "broken_source");
      assert.equal(body.polled[0].error, "broken MCP source timed out");
      assert.equal(body.polled[1].source_id, "working_source");
      assert.equal(body.polled[1].routed?.[0]?.event.id, "evt_poll_all_working");
    } finally {
      await new Promise<void>((resolve, reject) => {
        mcpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
