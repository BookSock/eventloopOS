export const NATIVE_BRIDGE_SCHEMA_VERSION = "eventloop.nativeBridgeEnvelope.v1";
export const NATIVE_HOST_CAPABILITIES = ["eventloop.contextCaptured.v1"];

export function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function decodeNativeMessages(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset);
    const bodyStart = offset + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) break;

    const raw = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    messages.push(JSON.parse(raw));
    offset = bodyEnd;
  }

  return {
    messages,
    rest: buffer.subarray(offset)
  };
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return nativeHostError(null, null, "invalid_envelope", "native envelope must be object");
  }
  if (envelope.schemaVersion !== NATIVE_BRIDGE_SCHEMA_VERSION) {
    return nativeHostError(
      envelope.request_id,
      envelope.idempotency_key,
      "unsupported_schema_version",
      `unsupported native envelope schemaVersion: ${String(envelope.schemaVersion)}`
    );
  }
  for (const field of ["request_id", "idempotency_key", "type"]) {
    if (typeof envelope[field] !== "string" || envelope[field].length === 0) {
      return nativeHostError(envelope.request_id, envelope.idempotency_key, "invalid_envelope", `${field} required`);
    }
  }
  if (!Array.isArray(envelope.capabilities)) {
    return nativeHostError(envelope.request_id, envelope.idempotency_key, "invalid_envelope", "capabilities required");
  }

  const unsupported = envelope.capabilities.find((capability) => !NATIVE_HOST_CAPABILITIES.includes(capability));
  if (unsupported) {
    return nativeHostError(
      envelope.request_id,
      envelope.idempotency_key,
      "unsupported_capability",
      `unsupported capability: ${unsupported}`
    );
  }

  return { ok: true, envelope };
}

export function nativeHostOk(envelope, payload = {}) {
  return {
    ok: true,
    request_id: envelope.request_id,
    idempotency_key: envelope.idempotency_key,
    capabilities: NATIVE_HOST_CAPABILITIES,
    payload,
    error: null
  };
}

export function nativeHostError(requestId, idempotencyKey, code, message) {
  return {
    ok: false,
    request_id: requestId ?? null,
    idempotency_key: idempotencyKey ?? null,
    capabilities: NATIVE_HOST_CAPABILITIES,
    payload: null,
    error: { code, message }
  };
}
