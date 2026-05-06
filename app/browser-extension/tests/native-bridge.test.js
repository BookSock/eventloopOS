import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_BRIDGE_SCHEMA_VERSION,
  createChromeNativeBridge
} from "../src/native-bridge.js";

test("wraps native messages in envelope fields", async () => {
  const chromeApi = fakeNativeChrome({
    response: { ok: true, payload: { stored: true }, capabilities: ["eventloop.contextCaptured.v1"] }
  });
  const bridge = createChromeNativeBridge(chromeApi);

  const result = await bridge.send({
    type: "eventloop.contextCaptured",
    resource: { id: "resource-1" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.stored, true);
  assert.equal(chromeApi.calls.length, 1);
  assert.equal(chromeApi.calls[0].host, "com.eventloopos.browser_context");
  assert.equal(chromeApi.calls[0].message.schemaVersion, NATIVE_BRIDGE_SCHEMA_VERSION);
  assert.equal(typeof chromeApi.calls[0].message.request_id, "string");
  assert.equal(typeof chromeApi.calls[0].message.idempotency_key, "string");
  assert.equal(chromeApi.calls[0].message.type, "eventloop.contextCaptured");
  assert.deepEqual(chromeApi.calls[0].message.capabilities, ["eventloop.contextCaptured.v1"]);
  assert.deepEqual(chromeApi.calls[0].message.payload, { resource: { id: "resource-1" } });
});

test("normalizes unavailable native host errors", async () => {
  const chromeApi = fakeNativeChrome({
    error: new Error("Specified native messaging host not found.")
  });
  const bridge = createChromeNativeBridge(chromeApi);

  const result = await bridge.send({ type: "eventloop.contextCaptured", resource: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "native_host_unavailable");
});

test("normalizes malformed native host responses", async () => {
  const chromeApi = fakeNativeChrome({ response: { stored: true } });
  const bridge = createChromeNativeBridge(chromeApi);

  const result = await bridge.send({ type: "eventloop.contextCaptured", resource: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "malformed_native_response");
});

test("rejects unsupported requested capability before native call", async () => {
  const chromeApi = fakeNativeChrome({ response: { ok: true } });
  const bridge = createChromeNativeBridge(chromeApi);

  const result = await bridge.send({
    type: "eventloop.contextCaptured",
    capabilities: ["eventloop.notSupported.v1"],
    payload: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unsupported_capability");
  assert.equal(chromeApi.calls.length, 0);
});

test("rejects duplicate idempotency_key before second native call", async () => {
  const chromeApi = fakeNativeChrome({ response: { ok: true } });
  const bridge = createChromeNativeBridge(chromeApi);
  const message = {
    type: "eventloop.contextCaptured",
    idempotency_key: "capture-key-1",
    payload: {}
  };

  const first = await bridge.send(message);
  const second = await bridge.send(message);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "duplicate_idempotency_key");
  assert.equal(chromeApi.calls.length, 1);
});

test("normalizes native bridge timeout", async () => {
  const chromeApi = fakeNativeChrome({ neverResolve: true });
  const bridge = createChromeNativeBridge(chromeApi, "com.eventloopos.browser_context", { timeoutMs: 1 });

  const result = await bridge.send({ type: "eventloop.contextCaptured", payload: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "native_messaging_timeout");
});

function fakeNativeChrome({ response, error, neverResolve = false }) {
  const calls = [];
  return {
    calls,
    runtime: {
      sendNativeMessage(host, message, callback) {
        calls.push({ host, message });
        if (neverResolve) {
          return new Promise(() => {});
        }
        if (error) {
          return Promise.reject(error);
        }
        if (callback) {
          queueMicrotask(() => callback(response));
          return undefined;
        }
        return Promise.resolve(response);
      }
    }
  };
}
