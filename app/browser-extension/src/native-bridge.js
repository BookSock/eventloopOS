export const DEFAULT_NATIVE_HOST = "com.eventloopos.browser_context";
export const NATIVE_BRIDGE_SCHEMA_VERSION = "eventloop.nativeBridgeEnvelope.v1";
export const DEFAULT_NATIVE_BRIDGE_TIMEOUT_MS = 5000;
export const DEFAULT_NATIVE_CAPABILITIES = ["eventloop.contextCaptured.v1"];

const TYPE_CAPABILITIES = new Map([["eventloop.contextCaptured", "eventloop.contextCaptured.v1"]]);

export function createChromeNativeBridge(
  chromeApi = globalThis.chrome,
  nativeHost = DEFAULT_NATIVE_HOST,
  { timeoutMs = DEFAULT_NATIVE_BRIDGE_TIMEOUT_MS, capabilities = DEFAULT_NATIVE_CAPABILITIES } = {}
) {
  const sentIdempotencyKeys = new Set();

  return {
    async send(message, options = {}) {
      if (!chromeApi?.runtime?.sendNativeMessage) {
        return nativeBridgeError("native_messaging_unavailable", "Chrome native messaging API unavailable");
      }

      const envelopeResult = buildNativeBridgeEnvelope(message, {
        ...options,
        supportedCapabilities: capabilities,
        sentIdempotencyKeys
      });

      if (!envelopeResult.ok) {
        return envelopeResult;
      }

      const envelope = envelopeResult.payload;

      try {
        const response = await withTimeout(sendNativeMessage(chromeApi, nativeHost, envelope), timeoutMs);
        return normalizeNativeBridgeResponse(response, envelope);
      } catch (error) {
        return nativeBridgeError(classifyNativeMessagingError(error), error?.message ?? String(error), envelope);
      }
    }
  };
}

export function buildNativeBridgeEnvelope(
  message,
  { requestId, idempotencyKey, supportedCapabilities = DEFAULT_NATIVE_CAPABILITIES, sentIdempotencyKeys } = {}
) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return nativeBridgeError("invalid_native_request", "native bridge message must be object");
  }

  const type = message.type;
  if (typeof type !== "string" || type.length === 0) {
    return nativeBridgeError("invalid_native_request", "native bridge message type must be non-empty string");
  }

  const capabilities = normalizeRequestedCapabilities(message);
  const unsupportedCapability = capabilities.find((capability) => !supportedCapabilities.includes(capability));
  if (unsupportedCapability) {
    return nativeBridgeError("unsupported_capability", `unsupported native bridge capability: ${unsupportedCapability}`);
  }

  const request_id = requestId ?? message.request_id ?? createRequestId();
  const idempotency_key = idempotencyKey ?? message.idempotency_key ?? `eventloop:${type}:${request_id}`;

  if (sentIdempotencyKeys?.has(idempotency_key)) {
    return nativeBridgeError("duplicate_idempotency_key", `duplicate native bridge idempotency_key: ${idempotency_key}`);
  }
  sentIdempotencyKeys?.add(idempotency_key);

  return {
    ok: true,
    payload: {
      schemaVersion: NATIVE_BRIDGE_SCHEMA_VERSION,
      request_id,
      idempotency_key,
      type,
      capabilities,
      payload: normalizePayload(message)
    }
  };
}

export function normalizeNativeBridgeResponse(response, envelope = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response) || typeof response.ok !== "boolean") {
    return nativeBridgeError("malformed_native_response", "native bridge response must be object with boolean ok", envelope);
  }

  if (!response.ok) {
    return nativeBridgeError(
      response.error?.code ?? "native_bridge_error",
      response.error?.message ?? "native bridge returned error",
      envelope
    );
  }

  return {
    ok: true,
    request_id: response.request_id ?? envelope.request_id ?? null,
    idempotency_key: response.idempotency_key ?? envelope.idempotency_key ?? null,
    capabilities: Array.isArray(response.capabilities) ? response.capabilities : [],
    payload: response.payload ?? null,
    error: null
  };
}

export function nativeBridgeError(code, message, envelope = {}) {
  return {
    ok: false,
    request_id: envelope.request_id ?? null,
    idempotency_key: envelope.idempotency_key ?? null,
    payload: null,
    error: { code, message }
  };
}

function sendNativeMessage(chromeApi, nativeHost, envelope) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };

    try {
      const maybePromise = chromeApi.runtime.sendNativeMessage(nativeHost, envelope, (response) => {
        const error = chromeApi.runtime.lastError;
        if (error) {
          settle(reject, new Error(error.message));
        } else {
          settle(resolve, response);
        }
      });

      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((response) => settle(resolve, response), (error) => settle(reject, error));
      }
    } catch (error) {
      settle(reject, error);
    }
  });
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("native_messaging_timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function normalizeRequestedCapabilities(message) {
  if (Array.isArray(message.capabilities)) {
    return message.capabilities;
  }

  const capability = TYPE_CAPABILITIES.get(message.type);
  return capability ? [capability] : [];
}

function normalizePayload(message) {
  if (Object.hasOwn(message, "payload")) {
    return message.payload;
  }

  const payload = {};
  for (const [key, value] of Object.entries(message)) {
    if (!["schemaVersion", "request_id", "idempotency_key", "type", "capabilities"].includes(key)) {
      payload[key] = value;
    }
  }
  return payload;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function classifyNativeMessagingError(error) {
  const message = error?.message ?? "";
  if (message === "native_messaging_timeout") {
    return "native_messaging_timeout";
  }
  if (/host.*not found|native.*host.*missing|no such native/i.test(message)) {
    return "native_host_unavailable";
  }
  return "native_messaging_failed";
}
