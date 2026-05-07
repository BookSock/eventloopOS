import { z } from "zod";

export const isoDateTime = z.string().datetime({ offset: true });
const id = z.string().min(1);
const nonEmpty = z.string().min(1);
const unknownRecord = z.record(z.unknown());

export const ActorSchema = z
  .object({
    id,
    type: z.enum(["human", "agent", "system", "service"]),
    name: nonEmpty.optional(),
    email: z.string().email().optional(),
    source: z.string().optional()
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;

export const RawRefSchema = z
  .object({
    id,
    uri: nonEmpty,
    media_type: z.string().optional(),
    sha256: z.string().optional()
  })
  .strict();
export type RawRef = z.infer<typeof RawRefSchema>;

export const LinkRefSchema = z
  .object({
    label: nonEmpty,
    url: z.string().url(),
    source: z.string().optional()
  })
  .strict();
export type LinkRef = z.infer<typeof LinkRefSchema>;

export const EvidenceRefSchema = z
  .object({
    id,
    kind: z.enum(["raw", "receipt", "link", "resource", "test", "log", "artifact"]),
    title: nonEmpty,
    ref: nonEmpty,
    created_at: isoDateTime.optional()
  })
  .strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const RiskTagSchema = z.enum([
  "external_send",
  "delete",
  "production",
  "money",
  "legal",
  "credential",
  "privacy",
  "low_confidence",
  "prompt_injection",
  "ownership_conflict",
  "local_write",
  "network"
]);
export type RiskTag = z.infer<typeof RiskTagSchema>;

export const ContextResourceBaseSchema = z
  .object({
    id,
    kind: nonEmpty,
    title: nonEmpty,
    url: z.string().url().optional(),
    source: z.string().optional(),
    captured_at: isoDateTime.optional(),
    restore_confidence: z.enum(["high", "medium", "low"])
  })
  .strict();

export const BrowserTabResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("browser_tab"),
  window_id: z.string().optional(),
  tab_id: z.string().optional(),
  scroll_y: z.number().int().nonnegative().optional(),
  text_quote: z.string().optional(),
  selector_hint: z.string().optional()
}).strict();

export const UrlResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("url")
}).strict();

export const FileResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("file"),
  path: nonEmpty,
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional()
}).strict();

export const AppWindowResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("app_window"),
  bundle_id: z.string().optional(),
  pid: z.number().int().positive().optional(),
  window_id: z.string().optional(),
  frame: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive()
    })
    .strict()
    .optional()
}).strict();

export const WorkspaceWindowSchema = z
  .object({
    id: z.number().int().positive(),
    app: nonEmpty,
    title: nonEmpty,
    workspace: nonEmpty
  })
  .strict();
export type WorkspaceWindow = z.infer<typeof WorkspaceWindowSchema>;

export const WorkspaceSnapshotSchema = z
  .object({
    backend: z.literal("aerospace"),
    windows: z.array(WorkspaceWindowSchema),
    activeWorkspace: nonEmpty.optional(),
    focusedWindowId: z.number().int().positive().optional()
  })
  .strict();
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

export const WorkspaceSnapshotResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("workspace_snapshot"),
  snapshot: WorkspaceSnapshotSchema
}).strict();

export const TerminalResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("terminal"),
  cwd: z.string().optional(),
  session_id: z.string().optional(),
  command: z.string().optional()
}).strict();

export const SlackThreadResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("slack_thread"),
  workspace_id: nonEmpty.optional(),
  channel_id: nonEmpty.optional(),
  thread_ts: nonEmpty.optional()
}).strict();

export const GitHubResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("github"),
  owner: nonEmpty.optional(),
  repo: nonEmpty.optional(),
  number: z.number().int().positive().optional(),
  resource_type: z.enum(["issue", "pull_request", "commit", "branch", "workflow_run"]).optional()
}).strict();

export const AgentThreadResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("agent_thread"),
  provider: z.enum(["codex", "claude", "openai", "manual", "fake"]).optional(),
  thread_id: z.string().optional()
}).strict();

export const VoiceCommandResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("voice_command"),
  transcript_ref: RawRefSchema.optional()
}).strict();

export const TaskSessionResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("task_session"),
  task_session_id: nonEmpty
}).strict();

export const McpSourceResourceSchema = ContextResourceBaseSchema.extend({
  kind: z.literal("mcp_source"),
  server_id: nonEmpty.optional(),
  cursor: z.string().optional()
}).strict();

export const GenericContextResourceSchema = ContextResourceBaseSchema.extend({
  details: unknownRecord.optional()
})
  .catchall(z.unknown());

export const ContextResourceSchema = z.union([
  BrowserTabResourceSchema,
  UrlResourceSchema,
  FileResourceSchema,
  AppWindowResourceSchema,
  WorkspaceSnapshotResourceSchema,
  TerminalResourceSchema,
  SlackThreadResourceSchema,
  GitHubResourceSchema,
  AgentThreadResourceSchema,
  VoiceCommandResourceSchema,
  TaskSessionResourceSchema,
  McpSourceResourceSchema,
  GenericContextResourceSchema
]);
export type ContextResource = z.infer<typeof ContextResourceSchema>;

export const BrowserExtensionContextRestorePlanSchema = z
  .object({
    kind: z.literal("browser_extension_message"),
    side_effect: z.literal("local"),
    execute_supported: z.literal(false),
    target: nonEmpty,
    message: z
      .object({
        type: z.literal("eventloop.restore"),
        resource: ContextResourceSchema
      })
      .strict()
  })
  .strict();

export const OpenUrlContextRestorePlanSchema = z
  .object({
    kind: z.literal("open_url"),
    side_effect: z.literal("local"),
    execute_supported: z.literal(false),
    url: z.string().url()
  })
  .strict();

export const OpenFileContextRestorePlanSchema = z
  .object({
    kind: z.literal("open_file"),
    side_effect: z.literal("local"),
    execute_supported: z.literal(false),
    path: nonEmpty,
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional()
  })
  .strict();

export const ContextRestorePlanSchema = z.union([
  BrowserExtensionContextRestorePlanSchema,
  OpenUrlContextRestorePlanSchema,
  OpenFileContextRestorePlanSchema
]);
export type ContextRestorePlan = z.infer<typeof ContextRestorePlanSchema>;

export const ContextRestoreRequestSchema = z
  .object({
    id,
    status: z.enum(["pending", "done"]),
    created_at: isoDateTime.optional(),
    updated_at: isoDateTime.optional(),
    idempotency_key: z.string().optional(),
    resource: ContextResourceSchema,
    restore_plan: ContextRestorePlanSchema,
    result: unknownRecord.optional()
  })
  .strict();
export type ContextRestoreRequest = z.infer<typeof ContextRestoreRequestSchema>;

export const ActionSchema = z
  .object({
    id,
    type: z.enum(["approve", "reject", "edit", "defer", "open_context", "resume_agent", "mark_done"]),
    label: nonEmpty,
    requires_confirmation: z.boolean(),
    side_effect: z.enum(["none", "local", "external", "production", "sensitive"]),
    payload: unknownRecord
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;

export const EventSchema = z
  .object({
    id,
    source: z.enum(["slack", "github", "notion", "browser", "agent", "manual", "voice", "mcp_poll", "local"]),
    source_id: id,
    idempotency_key: id,
    occurred_at: isoDateTime,
    received_at: isoDateTime,
    actor: ActorSchema.optional(),
    project_hint: z.string().optional(),
    task_hint: z.string().optional(),
    type: nonEmpty,
    title: nonEmpty,
    summary: z.string().optional(),
    raw_ref: RawRefSchema,
    links: z.array(LinkRefSchema),
    resources: z.array(ContextResourceSchema)
  })
  .strict();
export type Event = z.infer<typeof EventSchema>;

export const TaskSchema = z
  .object({
    id,
    title: nonEmpty,
    status: z.enum(["active", "blocked", "waiting", "done", "archived"]),
    project: z.string().optional(),
    owner: ActorSchema.optional(),
    priority: z.number().int(),
    importance: z.number().int(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
    resources: z.array(ContextResourceSchema),
    source_links: z.array(LinkRefSchema)
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;

export const AgentRunSchema = z
  .object({
    id,
    provider: z.enum(["codex", "claude", "openai", "manual", "fake"]),
    task_id: id.optional(),
    thread_id: z.string().optional(),
    status: z.enum(["queued", "running", "blocked", "waiting_approval", "completed", "failed", "cancelled"]),
    started_at: isoDateTime.optional(),
    updated_at: isoDateTime,
    completed_at: isoDateTime.optional(),
    blocked_reason: z.string().optional(),
    risk_tags: z.array(RiskTagSchema),
    evidence: z.array(EvidenceRefSchema),
    output_refs: z.array(RawRefSchema),
    resume_actions: z.array(ActionSchema)
  })
  .strict();
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const TaskSessionSchema = z
  .object({
    id,
    task_id: id.optional(),
    provider: z.enum(["codex", "claude", "terminal", "fake"]),
    native_thread_id: z.string().optional(),
    terminal_ref: z.string().optional(),
    status: z.enum(["idle", "running", "blocked", "stopped", "lost"]),
    supports: z
      .object({
        steer: z.boolean(),
        followup: z.boolean(),
        collect: z.boolean(),
        interrupt: z.boolean(),
        compact: z.boolean()
      })
      .strict(),
    last_seen_at: isoDateTime,
    created_at: isoDateTime,
    updated_at: isoDateTime
  })
  .strict();
export type TaskSession = z.infer<typeof TaskSessionSchema>;

export const TaskMessageSchema = z
  .object({
    id,
    task_session_id: id,
    mode: z.enum(["steer", "followup", "collect", "steer_backlog", "interrupt"]),
    text: nonEmpty,
    event_ids: z.array(id),
    idempotency_key: id,
    sent_at: isoDateTime.optional(),
    status: z.enum(["queued", "sent", "failed", "blocked"]),
    evidence: z.array(EvidenceRefSchema)
  })
  .strict();
export type TaskMessage = z.infer<typeof TaskMessageSchema>;

export const ReviewPacketSchema = z
  .object({
    id,
    task_id: id.optional(),
    agent_run_id: id.optional(),
    title: nonEmpty,
    summary: nonEmpty,
    decision_needed: nonEmpty,
    risk_level: z.enum(["low", "medium", "high", "critical"]),
    confidence: z.enum(["low", "medium", "high"]),
    risk_tags: z.array(RiskTagSchema),
    evidence: z.array(EvidenceRefSchema).min(1),
    context: z.array(ContextResourceSchema),
    recommended_action: ActionSchema,
    alternate_actions: z.array(ActionSchema),
    created_at: isoDateTime,
    updated_at: isoDateTime
  })
  .superRefine((packet, ctx) => {
    if (packet.evidence.length === 0 && packet.risk_level === "low") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "review packet without evidence must be medium risk or higher",
        path: ["risk_level"]
      });
    }
  });
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;

export const QueueItemSchema = z
  .object({
    id,
    review_packet_id: id,
    task_id: id.optional(),
    state: z.enum(["ready", "leased", "deferred", "done", "dead"]),
    priority_score: z.number(),
    priority_reasons: z.array(nonEmpty),
    due_at: isoDateTime.optional(),
    lease_owner: z.string().optional(),
    lease_expires_at: isoDateTime.optional(),
    created_at: isoDateTime,
    updated_at: isoDateTime
  })
  .strict();
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const RouteDecisionSchema = z
  .object({
    id,
    event_id: id,
    action: z.enum([
      "ignore",
      "store_only",
      "attach_to_task",
      "start_agent_thread",
      "inject_into_agent_thread",
      "create_review_packet",
      "ask_human_now",
      "defer_until_context"
    ]),
    target_task_id: id.optional(),
    target_task_session_id: id.optional(),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.array(EvidenceRefSchema),
    created_at: isoDateTime
  })
  .strict();
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export const OwnershipLockSchema = z
  .object({
    id,
    resource_key: nonEmpty,
    owner_task_id: id.optional(),
    owner_agent_run_id: id.optional(),
    lock_kind: z.enum(["route", "draft", "send", "workspace", "poll"]),
    lease_expires_at: isoDateTime.optional(),
    evidence: z.array(EvidenceRefSchema),
    created_at: isoDateTime,
    updated_at: isoDateTime
  })
  .strict();
export type OwnershipLock = z.infer<typeof OwnershipLockSchema>;

export const HookDecisionSchema = z
  .object({
    hook: nonEmpty,
    decision: z.enum(["allow", "block", "rewrite", "require_approval"]),
    reason: z.string().optional(),
    rewritten_payload: unknownRecord.optional(),
    evidence: z.array(EvidenceRefSchema)
  })
  .strict();
export type HookDecision = z.infer<typeof HookDecisionSchema>;

export const EvidenceReceiptSchema = z
  .object({
    id,
    action_type: z.enum([
      "source_poll",
      "event_normalize",
      "task_message",
      "workspace_restore",
      "test_run",
      "browser_capture",
      "external_draft",
      "external_send"
    ]),
    actor_id: id,
    input_hash: nonEmpty,
    output_hash: z.string().optional(),
    previous_receipt_hash: z.string().optional(),
    artifact_refs: z.array(RawRefSchema),
    created_at: isoDateTime
  })
  .strict();
export type EvidenceReceipt = z.infer<typeof EvidenceReceiptSchema>;

export const ProcedureStepSchema = z
  .object({
    id,
    name: nonEmpty,
    kind: z.enum(["agent", "human", "hook", "action", "wait"]),
    config: unknownRecord
  })
  .strict();
export type ProcedureStep = z.infer<typeof ProcedureStepSchema>;

export const ProcedureSchema = z
  .object({
    id,
    name: nonEmpty,
    trigger_types: z.array(nonEmpty),
    steps: z.array(ProcedureStepSchema).min(1),
    approval_required_for: z.array(nonEmpty),
    created_at: isoDateTime,
    updated_at: isoDateTime
  })
  .strict();
export type Procedure = z.infer<typeof ProcedureSchema>;

export const ProcedureRunSchema = z
  .object({
    id,
    procedure_id: id,
    task_id: id.optional(),
    state: z.enum(["running", "waiting_human", "resumed", "completed", "failed", "cancelled"]),
    current_step_id: id,
    resume_pointer: unknownRecord.optional(),
    receipt_ids: z.array(id),
    created_at: isoDateTime,
    updated_at: isoDateTime
  })
  .strict();
export type ProcedureRun = z.infer<typeof ProcedureRunSchema>;

export const AutonomyGrantSchema = z
  .object({
    id,
    scope_kind: z.enum(["source", "task", "agent_session", "workspace_backend"]),
    scope_id: id,
    surface: z.enum([
      "source_read",
      "context_read",
      "workspace_restore",
      "task_message",
      "local_write",
      "external_draft",
      "external_send",
      "prod_action",
      "money_action",
      "credential_action"
    ]),
    level: z.enum(["deny", "ask", "allow"]),
    expires_at: isoDateTime.optional(),
    created_at: isoDateTime
  })
  .strict();
export type AutonomyGrant = z.infer<typeof AutonomyGrantSchema>;

export const DecisionSchema = z
  .object({
    id,
    review_packet_id: id,
    queue_item_id: id,
    action_id: id,
    actor: ActorSchema,
    note: z.string().optional(),
    decided_at: isoDateTime,
    result_refs: z.array(RawRefSchema)
  })
  .strict();
export type Decision = z.infer<typeof DecisionSchema>;

export const ContractSchemas = {
  Actor: ActorSchema,
  RawRef: RawRefSchema,
  LinkRef: LinkRefSchema,
  EvidenceRef: EvidenceRefSchema,
  RiskTag: RiskTagSchema,
  ContextResource: ContextResourceSchema,
  ContextRestorePlan: ContextRestorePlanSchema,
  ContextRestoreRequest: ContextRestoreRequestSchema,
  Event: EventSchema,
  Task: TaskSchema,
  AgentRun: AgentRunSchema,
  TaskSession: TaskSessionSchema,
  TaskMessage: TaskMessageSchema,
  ReviewPacket: ReviewPacketSchema,
  QueueItem: QueueItemSchema,
  RouteDecision: RouteDecisionSchema,
  OwnershipLock: OwnershipLockSchema,
  HookDecision: HookDecisionSchema,
  EvidenceReceipt: EvidenceReceiptSchema,
  Procedure: ProcedureSchema,
  ProcedureStep: ProcedureStepSchema,
  ProcedureRun: ProcedureRunSchema,
  AutonomyGrant: AutonomyGrantSchema,
  Action: ActionSchema,
  Decision: DecisionSchema
} as const;

export type ContractName = keyof typeof ContractSchemas;

export function getContractSchema(name: string) {
  const schema = ContractSchemas[name as ContractName];
  if (!schema) {
    throw new Error(`Unknown contract schema: ${name}`);
  }
  return schema;
}
