import type { QueryResultRow } from "pg";
import type {
  Action,
  AgentRun,
  Confidence,
  ContextResource,
  EvidenceRef,
  QueueItem,
  QueueItemWithPacket,
  ReviewPacket,
  RiskLevel,
} from "../contracts.js";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { McpPollStateSnapshot } from "../integrations/mcp_poll/persistent_cursor_store.js";
import type { DurableTaskMessageRecord } from "../task_sessions/task_message_history.js";
import type { RestoreExecutionReceipt, RestorePlan } from "../workspace/aerospace.js";
import type { WorkspaceRestoreReceiptRecord } from "../workspace/restore_receipts.js";
import { stableId } from "../store/ids.js";
import type { ContextRestoreRequestRecord, RouteDecision } from "../store.js";

export type EventRecord = {
  id: string;
  source: string;
  source_id: string;
  idempotency_key: string;
  occurred_at: string;
  received_at: string;
  actor?: Record<string, unknown>;
  project_hint?: string;
  task_hint?: string;
  type: string;
  title: string;
  summary?: string;
  raw_ref: Record<string, unknown>;
  links: Array<Record<string, unknown>>;
  resources: ContextResource[];
};

export type NewQueueItem = Omit<QueueItem, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export function normalizeNewQueueItem(item: NewQueueItem, fallbackNow: string): QueueItem {
  return {
    ...item,
    created_at: item.created_at ?? fallbackNow,
    updated_at: item.updated_at ?? fallbackNow,
  };
}

export function eventToRecord(event: McpEvent): EventRecord {
  return {
    id: event.id,
    source: event.source,
    source_id: event.source_id,
    idempotency_key: event.idempotency_key,
    occurred_at: event.occurred_at,
    received_at: event.received_at,
    actor: event.actor,
    project_hint: event.project_hint,
    task_hint: event.task_hint,
    type: event.type,
    title: event.title,
    summary: event.summary,
    raw_ref: event.raw_ref,
    links: event.links,
    resources: event.resources as ContextResource[],
  };
}

export function queueSelectColumns(alias: string): string {
  return [
    `${alias}.id AS q_id`,
    `${alias}.review_packet_id AS q_review_packet_id`,
    `${alias}.task_id AS q_task_id`,
    `${alias}.state AS q_state`,
    `${alias}.priority_score AS q_priority_score`,
    `${alias}.priority_reasons AS q_priority_reasons`,
    `${alias}.due_at AS q_due_at`,
    `${alias}.lease_owner AS q_lease_owner`,
    `${alias}.lease_expires_at AS q_lease_expires_at`,
    `${alias}.created_at AS q_created_at`,
    `${alias}.updated_at AS q_updated_at`,
  ].join(", ");
}

export function reviewPacketSelectColumns(alias: string): string {
  return [
    `${alias}.id AS p_id`,
    `${alias}.task_id AS p_task_id`,
    `${alias}.agent_run_id AS p_agent_run_id`,
    `${alias}.title AS p_title`,
    `${alias}.summary AS p_summary`,
    `${alias}.decision_needed AS p_decision_needed`,
    `${alias}.risk_level AS p_risk_level`,
    `${alias}.confidence AS p_confidence`,
    `${alias}.risk_tags AS p_risk_tags`,
    `${alias}.evidence AS p_evidence`,
    `${alias}.context AS p_context`,
    `${alias}.recommended_action AS p_recommended_action`,
    `${alias}.alternate_actions AS p_alternate_actions`,
    `${alias}.created_at AS p_created_at`,
    `${alias}.updated_at AS p_updated_at`,
  ].join(", ");
}

export function rowToQueueItemWithPacket(row: QueryResultRow): QueueItemWithPacket {
  return {
    id: row.q_id,
    review_packet_id: row.q_review_packet_id,
    task_id: row.q_task_id ?? undefined,
    state: row.q_state,
    priority_score: Number(row.q_priority_score),
    priority_reasons: row.q_priority_reasons,
    due_at: dateToIso(row.q_due_at),
    lease_owner: row.q_lease_owner ?? undefined,
    lease_expires_at: dateToIso(row.q_lease_expires_at),
    created_at: requiredDateToIso(row.q_created_at),
    updated_at: requiredDateToIso(row.q_updated_at),
    review_packet: rowToReviewPacket(row),
  };
}

export function rowToReviewPacket(row: QueryResultRow): ReviewPacket {
  return {
    id: row.p_id,
    task_id: row.p_task_id ?? undefined,
    agent_run_id: row.p_agent_run_id ?? undefined,
    title: row.p_title,
    summary: row.p_summary,
    decision_needed: row.p_decision_needed,
    risk_level: row.p_risk_level as RiskLevel,
    confidence: row.p_confidence as Confidence,
    risk_tags: row.p_risk_tags,
    evidence: row.p_evidence as EvidenceRef[],
    context: row.p_context as ContextResource[],
    recommended_action: row.p_recommended_action as Action,
    alternate_actions: row.p_alternate_actions as Action[],
    created_at: requiredDateToIso(row.p_created_at),
    updated_at: requiredDateToIso(row.p_updated_at),
  };
}

export function rowToAgentRun(row: QueryResultRow): AgentRun {
  return {
    id: row.id,
    provider: row.provider,
    task_id: row.task_id ?? undefined,
    thread_id: row.thread_id ?? undefined,
    status: row.status,
    started_at: dateToIso(row.started_at),
    updated_at: requiredDateToIso(row.updated_at),
    completed_at: dateToIso(row.completed_at),
    blocked_reason: row.blocked_reason ?? undefined,
    risk_tags: row.risk_tags,
    evidence: row.evidence,
    output_refs: row.output_refs,
    resume_actions: row.resume_actions,
  };
}

export function buildReviewPacketFromAgentRunForPostgres(run: AgentRun, timestamp: string): ReviewPacket {
  const stableRunId = stableId(run.id);
  return {
    id: `pkt_${stableRunId}_agent_waiting`,
    task_id: run.task_id,
    agent_run_id: run.id,
    title: `${agentProviderLabel(run.provider)} needs human input`,
    summary: run.blocked_reason ?? `${agentProviderLabel(run.provider)} is ${run.status.replaceAll("_", " ")}.`,
    decision_needed: run.status === "blocked"
      ? run.blocked_reason ?? "Unblock this agent run or send followup instructions."
      : "Approve resume action or send followup instructions.",
    risk_level: inferAgentRunRiskLevel(run),
    confidence: "medium",
    risk_tags: run.risk_tags,
    evidence: run.evidence.length > 0 ? run.evidence : [
      {
        id: `ev_${stableRunId}_agent_run`,
        kind: "agent_run",
        title: `${agentProviderLabel(run.provider)} run state`,
        url: run.output_refs[0]?.uri,
      },
    ],
    context: [],
    recommended_action: run.resume_actions[0] ?? {
      id: `act_${stableRunId}_resume`,
      type: "resume_agent",
      label: "Resume agent run",
      requires_confirmation: true,
      side_effect: "local",
      payload: {
        agent_run_id: run.id,
        thread_id: run.thread_id,
      },
    },
    alternate_actions: [
      {
        id: `act_${stableRunId}_done`,
        type: "mark_done",
        label: "Mark handled",
        requires_confirmation: false,
        side_effect: "none",
        payload: {
          agent_run_id: run.id,
        },
      },
    ],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function buildQueueItemFromAgentRunForPostgres(run: AgentRun, packet: ReviewPacket, timestamp: string): NewQueueItem {
  const stableRunId = stableId(run.id);
  return {
    id: `qit_${stableRunId}_agent_waiting`,
    review_packet_id: packet.id,
    task_id: run.task_id,
    state: "ready",
    priority_score: run.status === "blocked" ? 850 : 800,
    priority_reasons: ["agent_run_waiting"],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function rowToEvent(row: QueryResultRow): McpEvent {
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    idempotency_key: row.idempotency_key,
    occurred_at: requiredDateToIso(row.occurred_at),
    received_at: requiredDateToIso(row.received_at),
    actor: row.actor ?? {
      id: "actor_unknown",
      type: "system",
    },
    project_hint: row.project_hint ?? undefined,
    task_hint: row.task_hint ?? undefined,
    type: row.type,
    title: row.title,
    summary: row.summary ?? "",
    raw_ref: row.raw_ref,
    links: row.links,
    resources: row.resources,
  };
}

export function rowToRouteDecision(row: QueryResultRow): RouteDecision {
  return {
    id: row.id,
    event_id: row.event_id,
    action: row.action,
    target_task_id: row.target_task_id ?? undefined,
    target_task_session_id: row.target_task_session_id ?? undefined,
    confidence: row.confidence,
    human_queue_reason: row.human_queue_reason ?? undefined,
    evidence: row.evidence,
    created_at: requiredDateToIso(row.created_at),
  };
}

export function rowToContextRestoreRequestRecord(row: QueryResultRow): ContextRestoreRequestRecord {
  return {
    id: row.id,
    status: row.status,
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
    idempotency_key: row.idempotency_key ?? undefined,
    resource: row.resource,
    restore_plan: row.restore_plan,
    result: row.result ?? undefined,
    lease_owner: row.lease_owner ?? undefined,
    lease_expires_at: dateToIso(row.lease_expires_at),
  };
}

export function rowToWorkspaceRestoreReceipt(row: QueryResultRow): WorkspaceRestoreReceiptRecord {
  const details = isRecord(row.details) ? row.details : {};
  return {
    id: String(row.id),
    idempotency_key: String(details.idempotency_key),
    plan: details.plan as RestorePlan,
    receipt: details.receipt as RestoreExecutionReceipt,
    created_at: requiredDateToIso(row.created_at),
  };
}

export function rowToMcpPollStateSnapshot(row: QueryResultRow): McpPollStateSnapshot {
  return {
    source_id: row.source_id,
    cursor: row.cursor ?? undefined,
    seen: Array.isArray(row.seen) ? row.seen.filter((item): item is string => typeof item === "string") : [],
    updated_at: requiredDateToIso(row.updated_at),
  };
}

export function rowToTaskMessageRecord(row: QueryResultRow): DurableTaskMessageRecord {
  return {
    id: String(row.id),
    idempotency_key: String(row.idempotency_key),
    task_session_id: String(row.task_session_id),
    task_id: row.task_id ?? undefined,
    queue_item_id: row.queue_item_id ?? undefined,
    event_ids: Array.isArray(row.event_ids) ? row.event_ids.filter((item): item is string => typeof item === "string") : [],
    origin: String(row.origin),
    source_id: row.source_id ?? undefined,
    mode: "followup",
    status: row.status,
    text_hash: String(row.text_hash),
    text_length: Number(row.text_length),
    provider: row.provider ?? undefined,
    native_thread_id: row.native_thread_id ?? undefined,
    native_turn_id: row.native_turn_id ?? undefined,
    native_session_id: row.native_session_id ?? undefined,
    native_result_session_id: row.native_result_session_id ?? undefined,
    error: row.error ?? undefined,
    message: isRecord(row.message) ? row.message : {},
    created_at: requiredDateToIso(row.created_at),
    updated_at: requiredDateToIso(row.updated_at),
    sent_at: dateToIso(row.sent_at),
  };
}

export function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function requiredDateToIso(value: unknown): string {
  const iso = dateToIso(value);
  if (!iso) {
    throw new Error("expected timestamp value");
  }

  return iso;
}

export function dateToIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

export function normalizeTaskMessageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

function agentProviderLabel(provider: AgentRun["provider"]): string {
  if (provider === "codex") return "Codex";
  if (provider === "claude") return "Claude Code";
  if (provider === "openai") return "OpenAI";
  if (provider === "manual") return "Manual agent";
  return "Fake agent";
}

function inferAgentRunRiskLevel(run: AgentRun): ReviewPacket["risk_level"] {
  if (run.risk_tags.includes("critical")) return "critical";
  if (run.risk_tags.some((tag) => tag === "external_send" || tag === "credential" || tag === "prod")) return "high";
  if (run.evidence.length === 0) return "medium";
  return run.status === "blocked" || run.risk_tags.length > 0 ? "medium" : "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
