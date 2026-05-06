import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeMessages, encodeNativeMessage, validateEnvelope } from "../src/protocol.js";

test("encodes and decodes Chrome native messaging frames", () => {
  const first = { ok: true, payload: { id: 1 } };
  const second = { ok: false, error: { code: "x" } };
  const framed = Buffer.concat([encodeNativeMessage(first), encodeNativeMessage(second)]);

  const decoded = decodeNativeMessages(framed);

  assert.deepEqual(decoded.messages, [first, second]);
  assert.equal(decoded.rest.length, 0);
});

test("keeps incomplete native messaging frame as rest", () => {
  const framed = encodeNativeMessage({ ok: true });
  const partial = framed.subarray(0, framed.length - 2);

  const decoded = decodeNativeMessages(partial);

  assert.deepEqual(decoded.messages, []);
  assert.equal(decoded.rest.length, partial.length);
});

test("validates native bridge envelope schema and capability", () => {
  const result = validateEnvelope({
    schemaVersion: "eventloop.nativeBridgeEnvelope.v1",
    request_id: "req_1",
    idempotency_key: "idem_1",
    type: "eventloop.contextCaptured",
    capabilities: ["eventloop.contextCaptured.v1"],
    payload: {}
  });

  assert.equal(result.ok, true);

  const bad = validateEnvelope({
    schemaVersion: "eventloop.nativeBridgeEnvelope.v1",
    request_id: "req_1",
    idempotency_key: "idem_1",
    type: "eventloop.contextCaptured",
    capabilities: ["unknown"],
    payload: {}
  });

  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "unsupported_capability");
});
