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
  backend: "aerospace";
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
  status: "queued" | "running" | "blocked" | "waiting_approval" | "completed" | "failed" | "cancelled";
  started_at?: string;
  updated_at: string;
  completed_at?: string;
  blocked_reason?: string;
  risk_tags: string[];
  evidence: EvidenceRef[];
  output_refs: RawRef[];
  resume_actions: Action[];
};

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
