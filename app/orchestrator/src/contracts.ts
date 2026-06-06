export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type QueueState = "ready" | "leased" | "deferred" | "done" | "dead";

export type EvidenceRef = {
  id: string;
  kind: string;
  title: string;
  url?: string;
  ref?: string;
  captured_at?: string;
};

export type RawRef = {
  id: string;
  uri: string;
  mime_type?: string;
  media_type?: string;
};

export type ContextResource = {
  id: string;
  kind: string;
  title: string;
  url?: string;
  source?: string;
  captured_at?: string;
  restore_confidence: "high" | "medium" | "low";
  snapshot?: WorkspaceSnapshot;
  details?: Record<string, unknown>;
};

export type WorkspaceSnapshot = {
  backend: string;
  windows: WorkspaceWindow[];
  activeWorkspace?: string;
  focusedWindowId?: number;
};

export type WorkspaceWindow = {
  id: number;
  app: string;
  title: string;
  workspace: string;
  monitorId?: number;
  pid?: number;
  appBundleId?: string;
  layout?: "h_tiles" | "v_tiles" | "h_accordion" | "v_accordion" | "tiles" | "accordion" | "floating";
  frame?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type Action = {
  id: string;
  type: "approve" | "reject" | "edit" | "defer" | "open_context" | "resume_agent" | "mark_done";
  label: string;
  requires_confirmation: boolean;
  side_effect: "none" | "local" | "external" | "production" | "sensitive";
  payload: Record<string, unknown>;
};

export type ReviewPacket = {
  id: string;
  task_id?: string;
  agent_run_id?: string;
  title: string;
  summary: string;
  decision_needed: string;
  risk_level: RiskLevel;
  confidence: Confidence;
  risk_tags: string[];
  evidence: EvidenceRef[];
  context: ContextResource[];
  recommended_action: Action;
  alternate_actions: Action[];
  created_at: string;
  updated_at: string;
};

export type AgentRun = {
  id: string;
  provider: "codex" | "claude" | "openai" | "manual" | "fake";
  task_id?: string;
  thread_id?: string;
  status: AgentRunStatus;
  started_at?: string;
  updated_at: string;
  completed_at?: string;
  blocked_reason?: string;
  risk_tags: string[];
  evidence: EvidenceRef[];
  output_refs: RawRef[];
  resume_actions: Action[];
};

export const agentRunStatuses = [
  "queued",
  "running",
  "blocked",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = typeof agentRunStatuses[number];

const agentRunBlockedStatusAliases = new Set([
  "agent_stuck",
  "human_blocked",
  "needs_unblock",
  "needs_unblocking",
  "requires_unblock",
  "stuck",
]);

const agentRunWaitingStatusAliases = new Set([
  "action_required",
  "approval_pending",
  "approval_required",
  "awaiting_answer",
  "awaiting_approval",
  "awaiting_human",
  "awaiting_human_input",
  "awaiting_input",
  "awaiting_review",
  "awaiting_user",
  "awaiting_user_input",
  "human_input_required",
  "human_question",
  "human_review",
  "human_review_required",
  "input_required",
  "needs_action",
  "needs_answer",
  "needs_approval",
  "needs_human",
  "needs_human_input",
  "needs_input",
  "needs_review",
  "needs_user",
  "needs_user_input",
  "paused_for_input",
  "pending_approval",
  "pending_human",
  "pending_human_input",
  "pending_review",
  "question_for_human",
  "question_for_user",
  "ready_for_review",
  "requires_action",
  "requires_approval",
  "requires_human",
  "requires_human_input",
  "requires_input",
  "requires_review",
  "requires_user_input",
  "review_needed",
  "review_requested",
  "review_required",
  "user_input_required",
  "user_question",
  "waiting_for_approval",
  "waiting_for_human",
  "waiting_for_human_input",
  "waiting_for_input",
  "waiting_for_user",
  "waiting_for_user_input",
  "waiting_input",
  "waiting_on_human",
  "waiting_on_user",
]);

const agentRunTerminalStatusAliases = new Map<string, AgentRunStatus>([
  ["canceled", "cancelled"],
  ["done", "completed"],
  ["errored", "failed"],
  ["error", "failed"],
  ["finished", "completed"],
  ["success", "completed"],
  ["succeeded", "completed"],
]);

export const agentRunUpsertStatuses = [
  ...agentRunStatuses,
  ...Array.from(agentRunBlockedStatusAliases),
  ...Array.from(agentRunWaitingStatusAliases),
  ...Array.from(agentRunTerminalStatusAliases.keys()),
] as const;

export type AgentRunUpsertStatus = typeof agentRunUpsertStatuses[number];

export function normalizeAgentRunStatus(status: string): AgentRunStatus | undefined {
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((agentRunStatuses as readonly string[]).includes(normalized)) return normalized as AgentRunStatus;
  if (agentRunBlockedStatusAliases.has(normalized)) return "blocked";
  if (agentRunWaitingStatusAliases.has(normalized)) return "waiting_approval";
  return agentRunTerminalStatusAliases.get(normalized);
}

export type AgentRunQueueResult = {
  agent_run: AgentRun;
  review_packet?: ReviewPacket;
  queue_item?: QueueItemWithPacket;
  queue_item_created?: boolean;
};

export type QueueItem = {
  id: string;
  review_packet_id: string;
  task_id?: string;
  state: QueueState;
  priority_score: number;
  priority_reasons: string[];
  due_at?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  created_at: string;
  updated_at: string;
};

export type QueueItemWithPacket = QueueItem & {
  review_packet: ReviewPacket;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  request_id: string;
};

export const queueStates: QueueState[] = ["ready", "leased", "deferred", "done", "dead"];
