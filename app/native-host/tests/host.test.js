import assert from "node:assert/strict";
import test from "node:test";
import { handleNativeEnvelope } from "../src/host.js";

const validEnvelope = {
  schemaVersion: "eventloop.nativeBridgeEnvelope.v1",
  request_id: "req_capture",
  idempotency_key: "idem_capture",
  type: "eventloop.contextCaptured",
  capabilities: ["eventloop.contextCaptured.v1"],
  payload: {
    resource: {
      id: "browser_tab:7",
      kind: "browser_tab",
      title: "Fixture",
      url: "https://example.test",
      restore_confidence: "high"
    }
  }
};

test("stores captured browser context through injectable sink", async () => {
  const records = [];
  const response = await handleNativeEnvelope(validEnvelope, {
    now: () => new Date("2026-05-06T20:00:00.000Z"),
    sink: async (record) => {
      records.push(record);
      return { kind: "memory", id: "artifact_1" };
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.payload.stored, true);
  assert.equal(response.payload.forwarded, false);
  assert.deepEqual(response.payload.artifact, { kind: "memory", id: "artifact_1" });
  assert.deepEqual(records, [
    {
      request_id: "req_capture",
      idempotency_key: "idem_capture",
      received_at: "2026-05-06T20:00:00.000Z",
      resource: validEnvelope.payload.resource
    }
  ]);
});

test("optionally forwards captured context to orchestrator events endpoint", async () => {
  const requests = [];
  const response = await handleNativeEnvelope(validEnvelope, {
    orchestratorUrl: "http://127.0.0.1:4377",
    now: () => new Date("2026-05-06T20:00:00.000Z"),
    sink: async () => ({ kind: "memory", id: "artifact_1" }),
    fetch: async (url, init) => {
      requests.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: JSON.parse(init.body)
      });
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({
          route_decision: {
            id: "rte_browser",
            action: "store_only"
          }
        })
      };
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.payload.forwarded, true);
  assert.equal(response.payload.forward_result.route_decision.action, "store_only");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:4377/events");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers["idempotency-key"], "idem_capture");
  assert.equal(requests[0].body.event.source, "browser");
  assert.equal(requests[0].body.event.type, "browser.context_captured");
  assert.equal(requests[0].body.event.resources[0].kind, "browser_tab");
});

test("forwards optional route hints for task attachment", async () => {
  const requests = [];
  const hintedEnvelope = {
    ...validEnvelope,
    idempotency_key: "idem_capture_with_task",
    payload: {
      task_hint: "blog feedback",
      project_hint: "launch",
      resource: {
        ...validEnvelope.payload.resource,
        id: "browser_tab:task"
      }
    }
  };

  const response = await handleNativeEnvelope(hintedEnvelope, {
    orchestratorUrl: "http://127.0.0.1:4377",
    now: () => new Date("2026-05-06T20:00:00.000Z"),
    sink: async () => ({ kind: "memory", id: "artifact_1" }),
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({
          route_decision: {
            id: "rte_browser_task",
            action: "attach_to_task",
            target_task_id: "task_blog_feedback"
          }
        })
      };
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.payload.forward_result.route_decision.action, "attach_to_task");
  assert.equal(requests[0].event.task_hint, "blog feedback");
  assert.equal(requests[0].event.project_hint, "launch");
});

test("rejects unknown message types and missing resource payload", async () => {
  const unknown = await handleNativeEnvelope({ ...validEnvelope, type: "eventloop.unknown" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "unsupported_message_type");

  const missingResource = await handleNativeEnvelope({ ...validEnvelope, payload: {} });
  assert.equal(missingResource.ok, false);
  assert.equal(missingResource.error.code, "invalid_payload");
});
