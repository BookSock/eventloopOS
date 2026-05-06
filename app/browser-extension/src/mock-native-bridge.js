import {
  DEFAULT_NATIVE_CAPABILITIES,
  buildNativeBridgeEnvelope,
  nativeBridgeError,
  normalizeNativeBridgeResponse
} from "./native-bridge.js";

export function createMockNativeBridge({ responses = [] } = {}) {
  const sent = [];
  const sentIdempotencyKeys = new Set();

  return {
    sent,
    async send(message, options = {}) {
      const envelopeResult = buildNativeBridgeEnvelope(message, {
        ...options,
        supportedCapabilities: options.supportedCapabilities ?? DEFAULT_NATIVE_CAPABILITIES,
        sentIdempotencyKeys
      });

      if (!envelopeResult.ok) {
        return envelopeResult;
      }

      sent.push(envelopeResult.payload);
      if (options.timeoutMs === 0) {
        return nativeBridgeError("native_messaging_timeout", "native_messaging_timeout", envelopeResult.payload);
      }

      return normalizeNativeBridgeResponse(
        responses.length > 0 ? responses.shift() : { ok: true },
        envelopeResult.payload
      );
    }
  };
}
