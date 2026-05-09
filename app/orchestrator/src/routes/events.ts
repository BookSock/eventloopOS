import type { GatewayStore } from "../gateway_store.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { Observability } from "../observability.js";
import { sanitizeActivityDetails } from "../observability/activity_sanitizer.js";
import { injectEventIntoTaskSessionIfPossible } from "../routing/task_session_injection.js";
import type { RouteDecision } from "../store.js";
import { sendTaskFollowupWithActivity } from "../task_sessions/task_followup_audit.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import { classifyVoiceIntent, pickRerankCandidate } from "../voice/intent_classifier.js";
import type { JsonBodyReader } from "./context_restore.js";
import type { RouteResult } from "./types.js";

export type EventGatewayOptions = {
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  observability?: Observability;
};

export async function handleEventsRoute(input: {
  method: string | undefined;
  pathname: string;
  readJsonBody: JsonBodyReader;
  store: GatewayStore;
  taskSessions?: TaskSessionController;
  observability: Observability;
  now: Date;
  requestId: string;
  idempotencyKey?: string;
}): Promise<RouteResult | undefined> {
  if (input.method === "POST" && input.pathname === "/events") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    const eventValidation = validateEventRequest(parsed.value);
    if (!eventValidation.ok) return schemaError(eventValidation.message);

    const routed = await routeEventThroughGateway(input, eventValidation.event, input.now);

    return ok(202, {
      ok: true,
      ...routed,
      request_id: input.requestId,
    });
  }

  if (input.method === "POST" && input.pathname === "/voice/commands") {
    const parsed = await input.readJsonBody();
    if (!parsed.ok) return schemaError(parsed.message);

    const voiceValidation = validateVoiceCommandRequest(parsed.value, input.idempotencyKey, input.now.toISOString());
    if (!voiceValidation.ok) return schemaError(voiceValidation.message);

    const transcriptValue = isRecord(parsed.value) && typeof parsed.value.transcript === "string" ? parsed.value.transcript : "";
    const intent = classifyVoiceIntent(transcriptValue);
    if (intent.kind === "fan_out") {
      await input.observability.incrementCounter("voice_fan_out_detected_total");
      await input.observability.recordActivity({
        type: "voice_fan_out_detected",
        occurred_at: input.now.toISOString(),
        actor: "human",
        status: "ok",
        summary: `Voice fan-out detected for selector "${intent.selector}".`,
        details: sanitizeActivityDetails({
          transcript: intent.transcript,
          selector: intent.selector,
          message_preview: intent.message.slice(0, 80),
        }),
      });
      return ok(200, {
        ok: true,
        intent: "fan_out",
        selector: intent.selector,
        message: intent.message,
        next_action: {
          method: "POST",
          path: "/master/fan-out",
          body: {
            message: intent.message,
            selector: { task_hint_substring: intent.selector },
          },
        },
        request_id: input.requestId,
      });
    }
    if (intent.kind === "rerank") {
      const queue = await input.store.listQueue("ready", input.now);
      const match = pickRerankCandidate(intent, queue);
      if (match) {
        const updated = await input.store.bumpQueueItemPriority(match.item.id, {
          delta: intent.delta,
          score: intent.score,
          reason: `voice_rerank_${intent.direction}`,
        }, input.now);
        if (updated) {
          await input.observability.incrementCounter("voice_rerank_total");
          await input.observability.recordActivity({
            type: "voice_rerank",
            occurred_at: input.now.toISOString(),
            actor: "human",
            task_id: updated.task_id,
            queue_item_id: updated.id,
            status: "ok",
            summary: `Voice rerank ${intent.direction}: ${updated.review_packet.title}`,
            details: sanitizeActivityDetails({
              transcript: intent.transcript,
              target: intent.target,
              direction: intent.direction,
              delta: intent.delta,
              score: intent.score,
              priority_score: updated.priority_score,
              match_score: match.score,
            }),
          });
          return ok(200, {
            ok: true,
            intent: "rerank",
            direction: intent.direction,
            target: intent.target,
            queue_item_id: updated.id,
            priority_score: updated.priority_score,
            item: updated,
            request_id: input.requestId,
          });
        }
      }
      // Fall through to note routing if no match found, but record telemetry.
      await input.observability.incrementCounter("voice_rerank_no_match_total");
      await input.observability.recordActivity({
        type: "voice_rerank_no_match",
        occurred_at: input.now.toISOString(),
        actor: "human",
        status: "ok",
        summary: `Voice rerank had no matching paper for "${intent.target}".`,
        details: sanitizeActivityDetails({
          transcript: intent.transcript,
          target: intent.target,
          direction: intent.direction,
        }),
      });
    }

    const routed = await routeEventThroughGateway(input, voiceValidation.event, input.now);

    return ok(202, {
      ok: true,
      ...routed,
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname.startsWith("/events/")) {
    const id = decodeURIComponent(input.pathname.slice("/events/".length));
    if (!id) return schemaError("event id is required");

    const result = await input.store.getEvent(id);
    if (!result) return error(404, "not_found", `event ${id} was not found`);

    return ok(200, {
      event: result.event,
      route_decision: result.route_decision,
      review_packet: result.review_packet,
      queue_item: result.queue_item,
      request_id: input.requestId,
    });
  }

  if (input.method === "GET" && input.pathname.startsWith("/review-packets/")) {
    const id = decodeURIComponent(input.pathname.slice("/review-packets/".length));
    if (!id) return schemaError("review packet id is required");

    const packet = await input.store.getReviewPacket(id);
    if (!packet) return error(404, "not_found", `review packet ${id} was not found`);

    return ok(200, {
      packet,
      request_id: input.requestId,
    });
  }

  return undefined;
}

export function validateEventRequest(input: unknown): { ok: true; event: McpEvent } | { ok: false; message: string } {
  const event = isRecord(input) && isRecord(input.event) ? input.event : input;
  if (!isRecord(event)) {
    return { ok: false, message: "event request must be an object or { event }" };
  }

  const requiredStrings = [
    "id",
    "source",
    "source_id",
    "idempotency_key",
    "occurred_at",
    "received_at",
    "type",
    "title",
  ];
  for (const field of requiredStrings) {
    if (typeof event[field] !== "string" || !event[field]) {
      return { ok: false, message: `event.${field} must be a non-empty string` };
    }
  }

  if (!isRecord(event.raw_ref)) {
    return { ok: false, message: "event.raw_ref must be an object" };
  }
  if (!Array.isArray(event.links)) {
    return { ok: false, message: "event.links must be an array" };
  }
  if (!Array.isArray(event.resources)) {
    return { ok: false, message: "event.resources must be an array" };
  }

  return { ok: true, event: event as McpEvent };
}

export async function routeEventThroughGateway(
  options: EventGatewayOptions,
  event: McpEvent,
  now: Date,
): Promise<{
  event: McpEvent;
  route_decision: RouteDecision;
  review_packet?: unknown;
  queue_item?: unknown;
  task_message?: unknown;
}> {
  const existing = await options.store.getEventByIdempotencyKey(event.source, event.idempotency_key);
  if (existing) {
    return {
      event: existing.event,
      route_decision: existing.route_decision,
      review_packet: existing.review_packet,
      queue_item: existing.queue_item,
    };
  }

  let injected: Awaited<ReturnType<typeof injectEventIntoTaskSessionIfPossible>>;
  let taskMessageError: string | undefined;
  try {
    injected = await injectEventIntoTaskSessionIfPossible(
      event,
      options.taskSessions,
      options.store,
      now,
      (followupInput) => sendTaskFollowupWithActivity({
        taskSessions: options.taskSessions,
        observability: options.observability,
        taskMessageStore: options.store,
      }, followupInput, {
        origin: "event_route",
        occurredAt: now.toISOString(),
        taskId: taskIdFromFollowupPolicy(followupInput.policy),
        eventId: event.id,
        sourceId: event.source_id,
      }),
    );
  } catch (caught) {
    taskMessageError = caught instanceof Error ? caught.message : String(caught);
  }
  if (injected) {
    if (isRecord(injected.taskMessage) && injected.taskMessage.status === "blocked") {
      taskMessageError = "task followup blocked";
    } else {
      const result = await options.store.recordEventRoute(event, injected.routeDecision, now);
      await recordRoutedEventActivity(options, event, result.route_decision, {
        taskMessage: injected.taskMessage,
        queueItemId: undefined,
      });
      return {
        event,
        route_decision: result.route_decision,
        task_message: injected.taskMessage,
      };
    }
  }

  const result = await options.store.ingestEventAsReviewPacket(event, now);
  await recordRoutedEventActivity(options, event, result.route_decision, {
    queueItemId: result.queue_item?.id,
    taskMessage: injected?.taskMessage,
    taskMessageError,
  });
  return {
    event,
    route_decision: result.route_decision,
    review_packet: result.review_packet,
    queue_item: result.queue_item,
  };
}

async function recordRoutedEventActivity(
  options: EventGatewayOptions,
  event: McpEvent,
  routeDecision: RouteDecision,
  input: { taskMessage?: unknown; queueItemId?: string | undefined; taskMessageError?: string | undefined },
): Promise<void> {
  const observability = options.observability;
  if (!observability) return;

  await observability.incrementCounter("events_ingested_total");
  if (routeDecision.action === "inject_into_agent_thread") {
    await observability.incrementCounter("events_routed_to_task_session_total");
  }
  if (input.queueItemId) {
    await observability.incrementCounter("queue_items_created_total");
  }
  await observability.recordActivity({
    type: "event_routed",
    occurred_at: routeDecision.created_at,
    actor: "system",
    task_id: routeDecision.target_task_id,
    queue_item_id: input.queueItemId,
    event_id: event.id,
    task_session_id: routeDecision.target_task_session_id,
    source_id: event.source_id,
    status: "ok",
    summary: `Event routed: ${event.title}`,
    details: sanitizeActivityDetails({
      source: event.source,
      type: event.type,
      route_action: routeDecision.action,
      confidence: routeDecision.confidence,
      human_queue_reason: routeDecision.human_queue_reason,
      task_message: input.taskMessage,
      task_message_error: input.taskMessageError,
    }),
  });
}

function taskIdFromFollowupPolicy(policy: { scope_kind?: string; scope_id?: string } | undefined): string | undefined {
  return policy?.scope_kind === "task" && typeof policy.scope_id === "string" ? policy.scope_id : undefined;
}

function validateVoiceCommandRequest(
  input: unknown,
  headerIdempotencyKey: string | undefined,
  receivedAt: string,
): { ok: true; event: McpEvent } | { ok: false; message: string } {
  if (!isRecord(input)) {
    return { ok: false, message: "voice command request must be an object" };
  }

  const transcript = typeof input.transcript === "string" ? input.transcript.trim() : "";
  if (!transcript) {
    return { ok: false, message: "transcript must be a non-empty string" };
  }

  const bodyIdempotencyKey = typeof input.idempotency_key === "string" && input.idempotency_key
    ? input.idempotency_key
    : undefined;
  const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey ?? `voice:${stableId(transcript)}`;
  const sourceId = typeof input.source_id === "string" && input.source_id
    ? input.source_id
    : idempotencyKey;
  const occurredAt = typeof input.occurred_at === "string" && input.occurred_at
    ? input.occurred_at
    : receivedAt;
  const projectHint = readOptionalString(input, "project_hint");
  const taskHint = readOptionalString(input, "task_hint");
  const stableVoiceId = stableId(sourceId);

  return {
    ok: true,
    event: {
      id: `evt_voice_${stableVoiceId}`,
      source: "voice",
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt,
      received_at: receivedAt,
      actor: {
        id: "user_voice",
        type: "human",
      },
      project_hint: projectHint,
      task_hint: taskHint,
      type: "voice.command",
      title: "Voice command",
      summary: transcript,
      raw_ref: {
        id: `raw_voice_${stableVoiceId}`,
        uri: `voice://commands/${stableVoiceId}`,
        media_type: "text/plain",
      },
      links: [],
      resources: [
        {
          id: `ctx_voice_${stableVoiceId}`,
          kind: "voice_command",
          title: "Voice command transcript",
          source: "voice",
          captured_at: receivedAt,
          restore_confidence: "low",
          details: {
            transcript,
          },
        },
      ],
    },
  };
}

function ok(status: number, body: Record<string, unknown>): RouteResult {
  return { ok: true, status, body };
}

function error(status: number, code: string, message: string): RouteResult {
  return { ok: false, status, code, message };
}

function schemaError(message: string): RouteResult {
  return error(400, "schema_error", message);
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value ? value : undefined;
}

function stableId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
