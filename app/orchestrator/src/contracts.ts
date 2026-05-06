export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type QueueState = "ready" | "leased" | "deferred" | "done" | "dead";

export type EvidenceRef = {
  id: string;
  kind: string;
  title: string;
  url?: string;
};

export type ContextResource = {
  id: string;
  kind: string;
  title: string;
  url?: string;
  source?: string;
  captured_at?: string;
  restore_confidence: "high" | "medium" | "low";
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
