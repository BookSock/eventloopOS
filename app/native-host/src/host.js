import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  decodeNativeMessages,
  encodeNativeMessage,
  nativeHostError,
  nativeHostOk,
  validateEnvelope
} from "./protocol.js";

const DEFAULT_CONTEXT_LOG = resolve(process.cwd(), "artifacts", "native-host", "context-captures.jsonl");

export async function handleNativeEnvelope(envelope, options = {}) {
  const validation = validateEnvelope(envelope);
  if (!validation.ok) return validation;

  if (envelope.type !== "eventloop.contextCaptured") {
    return nativeHostError(
      envelope.request_id,
      envelope.idempotency_key,
      "unsupported_message_type",
      `unsupported native message type: ${envelope.type}`
    );
  }

  const resource = envelope.payload?.resource;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    return nativeHostError(envelope.request_id, envelope.idempotency_key, "invalid_payload", "resource required");
  }

  const sink = options.sink ?? appendContextCapture;
  const artifact = await sink({
    request_id: envelope.request_id,
    idempotency_key: envelope.idempotency_key,
    received_at: (options.now ?? (() => new Date()))().toISOString(),
    resource
  }, options);

  const forwarded = await maybeForwardContextEvent(envelope, resource, options);

  return nativeHostOk(envelope, {
    stored: true,
    artifact,
    forwarded: forwarded !== false,
    forward_result: forwarded || undefined
  });
}

export async function appendContextCapture(record, options = {}) {
  const logPath = options.contextLogPath ?? process.env.EVENTLOOPOS_CONTEXT_LOG ?? DEFAULT_CONTEXT_LOG;
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  return {
    kind: "jsonl",
    path: logPath
  };
}

export async function maybeForwardContextEvent(envelope, resource, options = {}) {
  const orchestratorUrl = options.orchestratorUrl ?? process.env.EVENTLOOPOS_ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    return false;
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch unavailable for orchestrator forwarding");
  }

  const now = (options.now ?? (() => new Date()))().toISOString();
  const event = contextResourceToEvent(envelope, resource, now);
  const response = await fetchFn(new URL("/events", orchestratorUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": envelope.idempotency_key
    },
    body: JSON.stringify({ event })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`orchestrator forward failed: HTTP ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : true;
}

export function contextResourceToEvent(envelope, resource, receivedAt) {
  const resourceId = String(resource.id ?? envelope.idempotency_key);
  const title = String(resource.title ?? resource.url ?? "Browser context captured");
  const sourceId = `browser:${resourceId}`;

  return {
    id: `evt_${stableId(sourceId)}`,
    source: "browser",
    source_id: sourceId,
    idempotency_key: envelope.idempotency_key,
    occurred_at: resource.captured_at ?? receivedAt,
    received_at: receivedAt,
    actor: {
      id: "actor_browser_extension",
      type: "system",
      name: "Chrome Extension"
    },
    project_hint: readRouteHint(envelope, resource, "project_hint"),
    task_hint: readRouteHint(envelope, resource, "task_hint"),
    type: "browser.context_captured",
    title: `Browser context: ${title}`,
    summary: String(resource.url ?? title),
    raw_ref: {
      id: `raw_${stableId(sourceId)}`,
      uri: `native-host://context/${encodeURIComponent(resourceId)}`,
      media_type: "application/json"
    },
    links: resource.url ? [{ label: "Browser tab", url: resource.url }] : [],
    resources: [resource]
  };
}

function readRouteHint(envelope, resource, key) {
  const payloadValue = envelope.payload?.[key];
  if (typeof payloadValue === "string" && payloadValue.trim()) {
    return payloadValue.trim();
  }

  const resourceValue = resource[key];
  if (typeof resourceValue === "string" && resourceValue.trim()) {
    return resourceValue.trim();
  }

  return undefined;
}

export async function runNativeHost({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let buffer = Buffer.alloc(0);

  stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeNativeMessages(buffer);
    buffer = decoded.rest;

    for (const message of decoded.messages) {
      void handleNativeEnvelope(message)
        .then((response) => stdout.write(encodeNativeMessage(response)))
        .catch((error) => {
          const response = nativeHostError(null, null, "native_host_failed", error.message ?? String(error));
          stdout.write(encodeNativeMessage(response));
        });
    }
  });

  stdin.on("error", (error) => {
    stderr.write(`eventloop native host stdin error: ${error.message}\n`);
  });
}

function stableId(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
