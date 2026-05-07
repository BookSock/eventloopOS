import assert from "node:assert/strict";
import test from "node:test";
import { handleRuntimeMessage } from "../src/message-router.js";

test("runtime message router restores a context resource through controller", async () => {
  const resource = { id: "browser_tab:7", kind: "browser_tab", url: "https://example.test" };
  const responses = [];
  const controller = {
    restore: async (input) => {
      assert.deepEqual(input, resource);
      return { ok: true, tabId: 7, url: resource.url, restoredScroll: true };
    }
  };

  const handled = handleRuntimeMessage(controller, { type: "eventloop.restore", resource }, (response) => {
    responses.push(response);
  });
  await flushMicrotasks();

  assert.equal(handled, true);
  assert.deepEqual(responses, [{ ok: true, tabId: 7, url: resource.url, restoredScroll: true }]);
});

test("runtime message router captures active tab with route hints", async () => {
  const routeHints = { task_hint: "blog feedback" };
  const responses = [];
  const controller = {
    captureActiveTab: async (input) => {
      assert.deepEqual(input, routeHints);
      return { resource: { id: "browser_tab:9" }, nativeResponse: { ok: true } };
    }
  };

  const handled = handleRuntimeMessage(
    controller,
    { type: "eventloop.captureActiveTab", route_hints: routeHints },
    (response) => {
      responses.push(response);
    }
  );
  await flushMicrotasks();

  assert.equal(handled, true);
  assert.deepEqual(responses, [{ resource: { id: "browser_tab:9" }, nativeResponse: { ok: true } }]);
});

test("runtime message router returns false for unknown messages", () => {
  const handled = handleRuntimeMessage({}, { type: "eventloop.unknown" }, () => {});

  assert.equal(handled, false);
});

test("runtime message router reads extension config", async () => {
  const responses = [];
  const handled = handleRuntimeMessage(
    {},
    { type: "eventloop.getConfig" },
    (response) => {
      responses.push(response);
    },
    {
      configStore: {
        get: async () => ({ orchestratorUrl: "http://127.0.0.1:4377" })
      }
    }
  );
  await flushMicrotasks();

  assert.equal(handled, true);
  assert.deepEqual(responses, [{ orchestratorUrl: "http://127.0.0.1:4377" }]);
});

test("runtime message router writes extension config", async () => {
  const responses = [];
  const handled = handleRuntimeMessage(
    {},
    { type: "eventloop.setConfig", config: { orchestratorUrl: "http://127.0.0.1:9999/" } },
    (response) => {
      responses.push(response);
    },
    {
      configStore: {
        set: async (config) => ({ orchestratorUrl: config.orchestratorUrl.replace(/\/+$/, "") })
      }
    }
  );
  await flushMicrotasks();

  assert.equal(handled, true);
  assert.deepEqual(responses, [{ orchestratorUrl: "http://127.0.0.1:9999" }]);
});

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}
