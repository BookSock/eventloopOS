import assert from "node:assert/strict";
import test from "node:test";
import {
  createRestoreRequestPoller,
  ensureRestorePollAlarm,
  RESTORE_REQUEST_ALARM
} from "../src/restore-request-poller.js";

test("restore request poller restores pending browser request and acknowledges result", async () => {
  const resource = {
    id: "ctx_browser_123",
    kind: "browser_tab",
    url: "https://example.test/launch",
    scroll_y: 120,
    text_quote: "Launch pricing note needs review later"
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/contexts/restore-requests/next")) {
      return jsonResponse({
        restore_request: {
          id: "ctx_restore_123",
          status: "pending",
          restore_plan: {
            kind: "browser_extension_message",
            message: {
              type: "eventloop.restore",
              resource
            }
          }
        }
      });
    }
    if (url.endsWith("/contexts/restore-requests/ctx_restore_123/done")) {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        result: {
          ok: true,
          tabId: 7,
          url: resource.url,
          restoredScroll: true
        }
      });
      return jsonResponse({ restore_request: { id: "ctx_restore_123", status: "done" } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const controller = {
    restore: async (input) => {
      assert.deepEqual(input, resource);
      return { ok: true, tabId: 7, url: resource.url, restoredScroll: true };
    }
  };
  const poller = createRestoreRequestPoller({
    controller,
    fetchImpl,
    orchestratorUrl: "http://127.0.0.1:4377/"
  });

  const result = await poller.pollOnce();

  assert.deepEqual(result, {
    ok: true,
    restored: true,
    restoreRequestId: "ctx_restore_123",
    result: {
      ok: true,
      tabId: 7,
      url: resource.url,
      restoredScroll: true
    }
  });
  assert.equal(calls.length, 2);
});

test("restore request poller is idle when no pending request exists", async () => {
  const poller = createRestoreRequestPoller({
    controller: {
      restore: async () => {
        throw new Error("restore should not run");
      }
    },
    fetchImpl: async () => jsonResponse({ restore_request: null })
  });

  assert.deepEqual(await poller.pollOnce(), { ok: true, restored: false });
});

test("restore request poller acknowledges unsupported pending request as failed", async () => {
  const doneBodies = [];
  const poller = createRestoreRequestPoller({
    controller: {
      restore: async () => {
        throw new Error("restore should not run");
      }
    },
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith("/contexts/restore-requests/next")) {
        return jsonResponse({
          restore_request: {
            id: "ctx_restore_bad",
            status: "pending",
            restore_plan: { kind: "browser_extension_message", message: { type: "eventloop.unknown" } }
          }
        });
      }
      doneBodies.push(JSON.parse(init.body));
      return jsonResponse({ restore_request: { id: "ctx_restore_bad", status: "done" } });
    }
  });

  const result = await poller.pollOnce();

  assert.equal(result.ok, false);
  assert.equal(result.restored, true);
  assert.deepEqual(doneBodies, [
    {
      result: {
        ok: false,
        error: {
          code: "unsupported_restore_request",
          message: "restore request missing eventloop.restore message"
        }
      }
    }
  ]);
});

test("restore request poller reads orchestrator URL at poll time", async () => {
  const requestedUrls = [];
  const poller = createRestoreRequestPoller({
    controller: {
      restore: async () => {
        throw new Error("restore should not run");
      }
    },
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return jsonResponse({ restore_request: null });
    },
    getOrchestratorUrl: async () => "http://127.0.0.1:9999/"
  });

  assert.deepEqual(await poller.pollOnce(), { ok: true, restored: false });
  assert.deepEqual(requestedUrls, ["http://127.0.0.1:9999/contexts/restore-requests/next"]);
});

test("ensureRestorePollAlarm creates missing MV3 alarm", async () => {
  const calls = [];
  const alarmsApi = {
    get: async (name) => {
      calls.push(["get", name]);
      return undefined;
    },
    create: async (name, info) => {
      calls.push(["create", name, info]);
    }
  };

  const didEnsure = await ensureRestorePollAlarm(alarmsApi);

  assert.equal(didEnsure, true);
  assert.deepEqual(calls, [
    ["get", RESTORE_REQUEST_ALARM],
    ["create", RESTORE_REQUEST_ALARM, { periodInMinutes: 0.5 }]
  ]);
});

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  };
}
