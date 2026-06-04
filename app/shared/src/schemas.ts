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

export const WindowFrameSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive()
  })
  .strict();
export type WindowFrame = z.infer<typeof WindowFrameSchema>;

export const AerospaceLayoutSchema = z.enum(["h_tiles", "v_tiles", "h_accordion", "v_accordion", "tiles", "accordion", "floating"]);
export type AerospaceLayout = z.infer<typeof AerospaceLayoutSchema>;

export const WorkspaceWindowSchema = z
  .object({
    id: z.number().int().positive(),
    app: nonEmpty,
    title: nonEmpty,
    workspace: nonEmpty,
    monitorId: z.number().int().optional(),
    pid: z.number().int().positive().optional(),
    appBundleId: nonEmpty.optional(),
    layout: AerospaceLayoutSchema.optional(),
    frame: WindowFrameSchema.optional()
  })
  .strict();
export type WorkspaceWindow = z.infer<typeof WorkspaceWindowSchema>;

export const WorkspaceFrameCaptureStatusSchema = z
  .object({
    status: z.enum(["captured", "failed", "skipped"]),
    timeoutMs: z.number().int().nonnegative(),
    observed: z.number().int().nonnegative(),
    error: z.string().optional()
  })
  .strict();
export type WorkspaceFrameCaptureStatus = z.infer<typeof WorkspaceFrameCaptureStatusSchema>;

export const WorkspaceSnapshotSchema = z
  .object({
    backend: nonEmpty,
    windows: z.array(WorkspaceWindowSchema),
    activeWorkspace: nonEmpty.optional(),
    focusedWindowId: z.number().int().positive().optional(),
    frameCapture: WorkspaceFrameCaptureStatusSchema.optional()
  })
  .strict();
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

export const WorkspaceCapabilityStatusSchema = z
  .object({
    available: z.boolean(),
    backend: nonEmpty,
    reason: z.enum(["binary_missing", "permission_denied", "server_unavailable", "invalid_response", "unknown_error"]).optional(),
    detail: z.string().optional(),
    monitorCount: z.number().int().nonnegative().optional()
  })
  .strict();
export type WorkspaceCapabilityStatus = z.infer<typeof WorkspaceCapabilityStatusSchema>;

export const WorkspaceStatusResponseSchema = z
  .object({
    status: WorkspaceCapabilityStatusSchema,
    execute_supported: z.boolean(),
    request_id: id
  })
  .strict();
export type WorkspaceStatusResponse = z.infer<typeof WorkspaceStatusResponseSchema>;

export const WorkspaceCaptureResponseSchema = z
  .object({
    snapshot: WorkspaceSnapshotSchema,
    request_id: id
  })
  .strict();
export type WorkspaceCaptureResponse = z.infer<typeof WorkspaceCaptureResponseSchema>;

export const WorkspaceRestorePlanRequestSchema = z
  .object({
    snapshot: WorkspaceSnapshotSchema,
    current_windows: z.array(WorkspaceWindowSchema).optional()
  })
  .passthrough();
export type WorkspaceRestorePlanRequest = z.infer<typeof WorkspaceRestorePlanRequestSchema>;

export const WorkspaceCommandSchema = z
  .object({
    backend: nonEmpty.optional(),
    command: nonEmpty,
    args: z.array(z.string()),
    description: z.string().optional()
  })
  .strict();
export type WorkspaceCommand = z.infer<typeof WorkspaceCommandSchema>;

export const AerospaceCommandSchema = WorkspaceCommandSchema.extend({
  command: z.enum(["aerospace", "osascript"])
}).strict();
export type AerospaceCommand = z.infer<typeof AerospaceCommandSchema>;

export const RestoreSkipSchema = z
  .object({
    reason: z.literal("stale_window_id"),
    windowId: z.number().int().positive(),
    workspace: nonEmpty
  })
  .strict();
export type RestoreSkip = z.infer<typeof RestoreSkipSchema>;

export const WorkspaceRestorePlanSchema = z
  .object({
    commands: z.array(WorkspaceCommandSchema),
    skipped: z.array(RestoreSkipSchema)
  })
  .strict();
export type WorkspaceRestorePlan = z.infer<typeof WorkspaceRestorePlanSchema>;

export const WorkspaceRestorePlanResponseSchema = z
  .object({
    plan: WorkspaceRestorePlanSchema,
    execute_supported: z.boolean(),
    request_id: id
  })
  .strict();
export type WorkspaceRestorePlanResponse = z.infer<typeof WorkspaceRestorePlanResponseSchema>;

export const WorkspaceRestoreRequestSchema = WorkspaceRestorePlanRequestSchema.extend({
  confirm_execute: z.literal(true)
}).passthrough();
export type WorkspaceRestoreRequest = z.infer<typeof WorkspaceRestoreRequestSchema>;

export const WorkspaceRestoreCommandReceiptSchema = WorkspaceCommandSchema.extend({
  stdout: z.string(),
  stderr: z.string().optional()
}).strict();
export type WorkspaceRestoreCommandReceipt = z.infer<typeof WorkspaceRestoreCommandReceiptSchema>;

export const WorkspaceRestoreReceiptSchema = z
  .object({
    commands: z.array(WorkspaceRestoreCommandReceiptSchema),
    skipped: z.array(RestoreSkipSchema)
  })
  .strict();
export type WorkspaceRestoreReceipt = z.infer<typeof WorkspaceRestoreReceiptSchema>;

export const WorkspaceRestoreResponseSchema = z
  .object({
    ok: z.literal(true),
    plan: WorkspaceRestorePlanSchema,
    receipt: WorkspaceRestoreReceiptSchema,
    execute_supported: z.literal(true),
    idempotency_key: id,
    idempotency_replayed: z.boolean(),
    request_id: id
  })
  .strict();
export type WorkspaceRestoreResponse = z.infer<typeof WorkspaceRestoreResponseSchema>;

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
    status: z.enum(["pending", "leased", "done", "failed"]),
    created_at: isoDateTime.optional(),
    updated_at: isoDateTime.optional(),
    idempotency_key: z.string().optional(),
    resource: ContextResourceSchema,
    restore_plan: ContextRestorePlanSchema,
    result: unknownRecord.optional(),
    lease_owner: z.string().optional(),
    lease_expires_at: isoDateTime.optional()
  })
  .strict();
export type ContextRestoreRequest = z.infer<typeof ContextRestoreRequestSchema>;

export const ManualModeStateSchema = z
  .object({
    active: z.boolean(),
    entered_at: isoDateTime.optional(),
    reason: z.string().optional(),
    updated_at: isoDateTime
  })
  .strict();
export type ManualModeState = z.infer<typeof ManualModeStateSchema>;

export const ManualModeSetRequestSchema = z
  .object({
    active: z.boolean(),
    reason: z.string().optional()
  })
  .passthrough();
export type ManualModeSetRequest = z.infer<typeof ManualModeSetRequestSchema>;

export const ManualModeGetResponseSchema = z
  .object({
    manual_mode: ManualModeStateSchema,
    request_id: id
  })
  .strict();
export type ManualModeGetResponse = z.infer<typeof ManualModeGetResponseSchema>;

export const ManualModeSetResponseSchema = z
  .object({
    ok: z.literal(true),
    manual_mode: ManualModeStateSchema,
    transitioned: z.boolean(),
    request_id: id
  })
  .strict();
export type ManualModeSetResponse = z.infer<typeof ManualModeSetResponseSchema>;

export const TaskWindowClaimRecordSchema = z
  .object({
    claim_id: id,
    task_id: id,
    window_id: z.string().min(1).optional(),
    app_bundle: z.string().min(1).optional(),
    title_prefix: z.string().min(1).optional(),
    process_root_pid: z.number().int().positive().optional(),
    source: z.string().min(1).optional(),
    created_at: isoDateTime,
    expires_at: isoDateTime.optional()
  })
  .strict();
export type TaskWindowClaimRecord = z.infer<typeof TaskWindowClaimRecordSchema>;

export const TaskWindowClaimCreateRequestSchema = z
  .object({
    task_id: id.optional(),
    taskId: id.optional(),
    window_id: z.string().min(1).optional(),
    windowId: z.string().min(1).optional(),
    app_bundle: z.string().min(1).optional(),
    appBundle: z.string().min(1).optional(),
    title_prefix: z.string().min(1).optional(),
    titlePrefix: z.string().min(1).optional(),
    process_root_pid: z.number().int().positive().optional(),
    processRootPid: z.number().int().positive().optional(),
    source: z.string().min(1).optional(),
    ttl_ms: z.number().int().positive().optional(),
    ttlMs: z.number().int().positive().optional()
  })
  .passthrough()
  .superRefine((claim, ctx) => {
    if (!claim.task_id && !claim.taskId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "task_id is required",
        path: ["task_id"]
      });
    }
    if (
      !claim.window_id
      && !claim.windowId
      && !claim.app_bundle
      && !claim.appBundle
      && !claim.title_prefix
      && !claim.titlePrefix
      && claim.process_root_pid === undefined
      && claim.processRootPid === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "window_id, app_bundle, title_prefix, or process_root_pid is required",
        path: ["window_id"]
      });
    }
  });
export type TaskWindowClaimCreateRequest = z.infer<typeof TaskWindowClaimCreateRequestSchema>;

export const TaskWindowClaimResponseSchema = z
  .object({
    ok: z.literal(true),
    claim: TaskWindowClaimRecordSchema,
    request_id: id
  })
  .strict();
export type TaskWindowClaimResponse = z.infer<typeof TaskWindowClaimResponseSchema>;

export const TaskWindowClaimsListResponseSchema = z
  .object({
    ok: z.literal(true),
    claims: z.array(TaskWindowClaimRecordSchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type TaskWindowClaimsListResponse = z.infer<typeof TaskWindowClaimsListResponseSchema>;

export const TaskAnchorKindSchema = z.enum(["codex_thread", "ghostty_window"]);
export type TaskAnchorKind = z.infer<typeof TaskAnchorKindSchema>;

export const TaskAnchorSchema = z
  .object({
    kind: TaskAnchorKindSchema,
    id
  })
  .strict();
export type TaskAnchor = z.infer<typeof TaskAnchorSchema>;

export const TaskRecordSchema = z
  .object({
    task_id: id,
    primary_anchor_kind: TaskAnchorKindSchema,
    primary_anchor_id: id,
    aerospace_workspace_id: nonEmpty.optional(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
    last_paper_emitted_at: isoDateTime.optional(),
    dormant_at: isoDateTime.optional(),
    auto_paper_idle_seconds: z.number().int().positive()
  })
  .strict();
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const TaskLayoutRecordSchema = z
  .object({
    task_id: id,
    layout: WorkspaceSnapshotSchema,
    updated_at: isoDateTime
  })
  .strict();
export type TaskLayoutRecord = z.infer<typeof TaskLayoutRecordSchema>;

export const TaskWorkspaceSnapshotRecordSchema = z
  .object({
    task_id: id,
    snapshot: WorkspaceSnapshotSchema,
    captured_at: isoDateTime,
    updated_at: isoDateTime,
    source_queue_item_id: id.optional(),
    actor_id: id.optional()
  })
  .strict();
export type TaskWorkspaceSnapshotRecord = z.infer<typeof TaskWorkspaceSnapshotRecordSchema>;

export const OnboardingWindowSchema = z
  .object({
    id: z.number().int().positive(),
    app: nonEmpty,
    title: z.string(),
    workspace: z.string(),
    task_hint: id.optional()
  })
  .strict();
export type OnboardingWindow = z.infer<typeof OnboardingWindowSchema>;

export const OnboardingBrowserContextSchema = z
  .object({
    id,
    title: nonEmpty,
    url: z.string().optional(),
    task_id: id.optional(),
    window_id: z.string().optional(),
    tab_id: z.string().optional(),
    captured_at: isoDateTime,
    restore_confidence: z.enum(["high", "medium", "low"])
  })
  .strict();
export type OnboardingBrowserContext = z.infer<typeof OnboardingBrowserContextSchema>;

export const OnboardingScanSummarySchema = z
  .object({
    window_count: z.number().int().nonnegative(),
    grouped_window_count: z.number().int().nonnegative(),
    ungrouped_window_count: z.number().int().nonnegative(),
    task_session_count: z.number().int().nonnegative(),
    browser_context_count: z.number().int().nonnegative(),
    proposal_count: z.number().int().nonnegative()
  })
  .strict();
export type OnboardingScanSummary = z.infer<typeof OnboardingScanSummarySchema>;

export const OnboardingTaskProposalSchema = z
  .object({
    id,
    task_id: id,
    title: nonEmpty,
    confidence: z.enum(["high", "medium", "low"]),
    reason: nonEmpty,
    windows: z.array(OnboardingWindowSchema),
    browser_contexts: z.array(OnboardingBrowserContextSchema),
    task_sessions: z.array(z.lazy(() => TaskRuntimeSessionSchema)),
    suggested_next_action: nonEmpty
  })
  .strict();
export type OnboardingTaskProposal = z.infer<typeof OnboardingTaskProposalSchema>;

export const OnboardingScanResponseSchema = z
  .object({
    ok: z.literal(true),
    captured_at: isoDateTime,
    active_workspace: z.string().optional(),
    focused_window_id: z.number().int().positive().optional(),
    summary: OnboardingScanSummarySchema,
    proposals: z.array(OnboardingTaskProposalSchema),
    ungrouped_windows: z.array(OnboardingWindowSchema),
    browser_contexts: z.array(OnboardingBrowserContextSchema),
    task_sessions: z.array(z.lazy(() => TaskRuntimeSessionSchema)),
    warnings: z.array(z.string()),
    rejected_proposal_keys: z.array(id),
    request_id: id
  })
  .strict();
export type OnboardingScanResponse = z.infer<typeof OnboardingScanResponseSchema>;

export const OnboardingApprovalRequestSchema = z
  .object({
    proposal_id: id.optional(),
    task_id: id.optional(),
    task_hint: id.optional(),
    window_ids: z.array(z.number().int().positive()).optional(),
    window_id: z.number().int().positive().optional(),
    task_session_ids: z.array(id).optional(),
    task_session_id: id.optional(),
    browser_context_ids: z.array(id).optional(),
    browser_context_id: id.optional(),
    queue_paper: z.boolean().optional(),
    actor_id: id.optional(),
    idempotency_key: id.optional()
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (!value.proposal_id && !value.task_id && !value.task_hint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "proposal_id, task_id, or task_hint is required",
        path: ["proposal_id"]
      });
    }
  });
export type OnboardingApprovalRequest = z.infer<typeof OnboardingApprovalRequestSchema>;

export const OnboardingBrowserContextBindingSchema = z
  .object({
    browser_context_id: id,
    event_id: id,
    task_id: id
  })
  .strict();
export type OnboardingBrowserContextBinding = z.infer<typeof OnboardingBrowserContextBindingSchema>;

export const OnboardingApprovalResponseSchema = z
  .object({
    ok: z.literal(true),
    task_id: id,
    proposal_id: id.optional(),
    workspace_snapshot: TaskWorkspaceSnapshotRecordSchema.optional(),
    bindings: z.array(unknownRecord),
    browser_context_bindings: z.array(OnboardingBrowserContextBindingSchema),
    task: TaskRecordSchema.optional(),
    task_layout: TaskLayoutRecordSchema.optional(),
    task_created: z.boolean().optional(),
    queue_item: z.lazy(() => QueueItemWithPacketSchema).optional(),
    review_packet: z.lazy(() => ReviewPacketSchema).optional(),
    warnings: z.array(z.string()),
    request_id: id
  })
  .strict();
export type OnboardingApprovalResponse = z.infer<typeof OnboardingApprovalResponseSchema>;

export const OnboardingApprovalBatchRequestSchema = z
  .object({
    approvals: z.array(OnboardingApprovalRequestSchema).min(1),
    idempotency_key: id.optional()
  })
  .passthrough();
export type OnboardingApprovalBatchRequest = z.infer<typeof OnboardingApprovalBatchRequestSchema>;

export const OnboardingApprovalBatchEntrySchema = z
  .object({
    ok: z.boolean(),
    proposal_id: id.optional(),
    task_id: id.optional(),
    queue_item: z.lazy(() => QueueItemWithPacketSchema).optional(),
    review_packet: z.lazy(() => ReviewPacketSchema).optional(),
    error: z
      .object({
        code: nonEmpty,
        message: nonEmpty,
        details: unknownRecord.optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();
export type OnboardingApprovalBatchEntry = z.infer<typeof OnboardingApprovalBatchEntrySchema>;

export const OnboardingApprovalBatchResponseSchema = z
  .object({
    ok: z.literal(true),
    results: z.array(OnboardingApprovalBatchEntrySchema),
    idempotent_replay: z.boolean().optional(),
    request_id: id
  })
  .strict();
export type OnboardingApprovalBatchResponse = z.infer<typeof OnboardingApprovalBatchResponseSchema>;

export const OnboardingRejectionRequestSchema = z
  .object({
    proposal_key: id,
    reason: z.string().optional()
  })
  .passthrough();
export type OnboardingRejectionRequest = z.infer<typeof OnboardingRejectionRequestSchema>;

export const OnboardingRejectionRecordSchema = z
  .object({
    proposal_key: id,
    reason: z.string().optional(),
    rejected_at: isoDateTime
  })
  .strict();
export type OnboardingRejectionRecord = z.infer<typeof OnboardingRejectionRecordSchema>;

export const OnboardingRejectionResponseSchema = z
  .object({
    ok: z.literal(true),
    rejection: OnboardingRejectionRecordSchema,
    request_id: id
  })
  .strict();
export type OnboardingRejectionResponse = z.infer<typeof OnboardingRejectionResponseSchema>;

export const CreateTaskRequestSchema = z
  .object({
    primary_anchor: TaskAnchorSchema,
    captured_layout: WorkspaceSnapshotSchema,
    auto_paper_idle_seconds: z.number().optional(),
    aerospace_workspace_id: nonEmpty.optional(),
    terminal_ref: nonEmpty.optional()
  })
  .passthrough();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const CreateTaskResponseSchema = z
  .object({
    task: TaskRecordSchema,
    layout: TaskLayoutRecordSchema,
    created: z.boolean(),
    current: z.boolean(),
    binding: unknownRecord.optional(),
    request_id: id
  })
  .strict();
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;

export const TaskListResponseSchema = z
  .object({
    tasks: z.array(TaskRecordSchema),
    request_id: id
  })
  .strict();
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const TaskGetResponseSchema = z
  .object({
    task: TaskRecordSchema,
    layout: TaskLayoutRecordSchema.nullable(),
    request_id: id
  })
  .strict();
export type TaskGetResponse = z.infer<typeof TaskGetResponseSchema>;

export const TaskLayoutResponseSchema = z
  .object({
    task_id: id,
    layout: TaskLayoutRecordSchema.nullable(),
    request_id: id
  })
  .strict();
export type TaskLayoutResponse = z.infer<typeof TaskLayoutResponseSchema>;

export const TaskLayoutUpdateResponseSchema = z
  .object({
    ok: z.literal(true),
    task: TaskRecordSchema,
    layout: TaskLayoutRecordSchema.nullable(),
    request_id: id
  })
  .strict();
export type TaskLayoutUpdateResponse = z.infer<typeof TaskLayoutUpdateResponseSchema>;

export const TaskWorkspaceSnapshotSaveRequestSchema = z
  .object({
    workspace_snapshot: WorkspaceSnapshotSchema.optional(),
    workspaceSnapshot: WorkspaceSnapshotSchema.optional(),
    source_queue_item_id: id.optional(),
    actor_id: id.optional()
  })
  .passthrough()
  .superRefine((request, ctx) => {
    if (!request.workspace_snapshot && !request.workspaceSnapshot) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workspace_snapshot is required",
        path: ["workspace_snapshot"]
      });
    }
  });
export type TaskWorkspaceSnapshotSaveRequest = z.infer<typeof TaskWorkspaceSnapshotSaveRequestSchema>;

export const TaskWorkspaceSnapshotSaveResponseSchema = z
  .object({
    ok: z.literal(true),
    workspace_snapshot: TaskWorkspaceSnapshotRecordSchema,
    request_id: id
  })
  .strict();
export type TaskWorkspaceSnapshotSaveResponse = z.infer<typeof TaskWorkspaceSnapshotSaveResponseSchema>;

export const CurrentTaskSetRequestSchema = z
  .object({
    task_id: id.nullable()
  })
  .passthrough();
export type CurrentTaskSetRequest = z.infer<typeof CurrentTaskSetRequestSchema>;

export const CurrentTaskResponseSchema = z
  .object({
    ok: z.literal(true).optional(),
    task: TaskRecordSchema.nullable(),
    entered_at: isoDateTime.optional(),
    updated_at: isoDateTime,
    request_id: id
  })
  .strict();
export type CurrentTaskResponse = z.infer<typeof CurrentTaskResponseSchema>;

export const FollowsWindowExclusionRecordSchema = z
  .object({
    exclusion_id: id,
    app_bundle: z.string().min(1).optional(),
    title_substring: z.string().min(1).optional(),
    created_at: isoDateTime
  })
  .strict();
export type FollowsWindowExclusionRecord = z.infer<typeof FollowsWindowExclusionRecordSchema>;

export const FollowsWindowExclusionCreateRequestSchema = z
  .object({
    app_bundle: z.string().min(1).optional(),
    appBundle: z.string().min(1).optional(),
    title_substring: z.string().min(1).optional(),
    titleSubstring: z.string().min(1).optional()
  })
  .passthrough()
  .superRefine((exclusion, ctx) => {
    if (!exclusion.app_bundle && !exclusion.appBundle && !exclusion.title_substring && !exclusion.titleSubstring) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "app_bundle or title_substring is required",
        path: ["app_bundle"]
      });
    }
  });
export type FollowsWindowExclusionCreateRequest = z.infer<typeof FollowsWindowExclusionCreateRequestSchema>;

export const FollowsWindowExclusionResponseSchema = z
  .object({
    ok: z.literal(true),
    exclusion: FollowsWindowExclusionRecordSchema,
    request_id: id
  })
  .strict();
export type FollowsWindowExclusionResponse = z.infer<typeof FollowsWindowExclusionResponseSchema>;

export const FollowsWindowExclusionsListResponseSchema = z
  .object({
    ok: z.literal(true),
    exclusions: z.array(FollowsWindowExclusionRecordSchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type FollowsWindowExclusionsListResponse = z.infer<typeof FollowsWindowExclusionsListResponseSchema>;

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
    recovery_hint: nonEmpty.optional(),
    evidence: z.array(EvidenceRefSchema)
  })
  .strict();
export type TaskMessage = z.infer<typeof TaskMessageSchema>;

export const TaskRuntimeSessionSchema = z
  .object({
    id,
    task_id: id.optional(),
    provider: nonEmpty,
    status: nonEmpty,
    native_thread_id: z.string().optional(),
    name: z.string().optional(),
    preview: z.string().optional(),
    cwd: z.string().optional(),
    terminal_ref: z.string().optional(),
    pid: z.number().int().positive().optional(),
    agent_pid: z.number().int().positive().optional(),
    terminal_pid: z.number().int().positive().optional(),
    root_pid: z.number().int().positive().optional(),
    pids: z.array(z.number().int().positive()).optional()
  })
  .passthrough();
export type TaskRuntimeSession = z.infer<typeof TaskRuntimeSessionSchema>;

export const TaskSessionBindingSchema = z
  .object({
    ok: z.boolean(),
    task_session_id: id,
    task_id: id,
    native_thread_id: z.string().optional(),
    session: TaskRuntimeSessionSchema.optional()
  })
  .passthrough();
export type TaskSessionBinding = z.infer<typeof TaskSessionBindingSchema>;

export const TaskMessageApiSchema = z
  .object({
    id,
    durable_id: id,
    task_session_id: id,
    task_id: id.optional(),
    queue_item_id: id.optional(),
    origin: nonEmpty,
    source_id: z.string().optional(),
    mode: z.literal("followup"),
    event_ids: z.array(id),
    idempotency_key: id,
    status: z.enum(["attempted", "sent", "blocked", "failed"]),
    sent_at: isoDateTime.optional(),
    text_hash: nonEmpty,
    text_length: z.number().int().nonnegative(),
    provider: z.string().optional(),
    native_thread_id: z.string().optional(),
    native_turn_id: z.string().optional(),
    native_session_id: z.string().optional(),
    native_result_session_id: z.string().optional(),
    error: z.string().optional(),
    recovery_hint: z.string().optional(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
    durable: z.literal(true)
  })
  .strict();
export type TaskMessageApi = z.infer<typeof TaskMessageApiSchema>;

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

export const QueueItemWithPacketSchema = QueueItemSchema.extend({
  review_packet: ReviewPacketSchema
}).strict();
export type QueueItemWithPacket = z.infer<typeof QueueItemWithPacketSchema>;

export const QueueListResponseSchema = z
  .object({
    items: z.array(QueueItemWithPacketSchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type QueueListResponse = z.infer<typeof QueueListResponseSchema>;

export const QueueNextResponseSchema = z
  .object({
    item: QueueItemWithPacketSchema.nullable(),
    request_id: id
  })
  .strict();
export type QueueNextResponse = z.infer<typeof QueueNextResponseSchema>;

export const QueueLeaseRequestSchema = z
  .object({
    lease_owner: id.optional(),
    lease_ms: z.number().int().positive().max(1_800_000).optional(),
    exclude_queue_item_id: id.optional()
  })
  .passthrough();
export type QueueLeaseRequest = z.infer<typeof QueueLeaseRequestSchema>;

export const QueueLeaseRenewRequestSchema = QueueLeaseRequestSchema.extend({
  lease_owner: id
}).passthrough();
export type QueueLeaseRenewRequest = z.infer<typeof QueueLeaseRenewRequestSchema>;

export const QueueLeaseRenewResponseSchema = z
  .object({
    ok: z.literal(true),
    item: QueueItemWithPacketSchema,
    request_id: id
  })
  .strict();
export type QueueLeaseRenewResponse = z.infer<typeof QueueLeaseRenewResponseSchema>;

const QueueWorkspaceSnapshotMixin = {
  actor_id: id.optional(),
  workspace_snapshot: WorkspaceSnapshotSchema.optional(),
  workspaceSnapshot: WorkspaceSnapshotSchema.optional()
};

export const QueueDoneRequestSchema = z
  .object({
    action: z.literal("done"),
    ...QueueWorkspaceSnapshotMixin
  })
  .passthrough();
export type QueueDoneRequest = z.infer<typeof QueueDoneRequestSchema>;

export const QueueDeferRequestSchema = z
  .object({
    action: z.literal("defer"),
    due_at: isoDateTime,
    ...QueueWorkspaceSnapshotMixin
  })
  .passthrough();
export type QueueDeferRequest = z.infer<typeof QueueDeferRequestSchema>;

export const QueueIgnoreRequestSchema = z
  .object({
    action: z.literal("ignore"),
    ...QueueWorkspaceSnapshotMixin
  })
  .passthrough();
export type QueueIgnoreRequest = z.infer<typeof QueueIgnoreRequestSchema>;

export const QueueActionDecisionSchema = z
  .object({
    id,
    queue_item_id: id,
    review_packet_id: id,
    action: z.enum(["done", "defer", "ignore"]),
    actor_id: id,
    due_at: isoDateTime.optional(),
    decided_at: isoDateTime
  })
  .strict();
export type QueueActionDecision = z.infer<typeof QueueActionDecisionSchema>;

export const QueueActionResponseSchema = z
  .object({
    ok: z.literal(true),
    item: QueueItemWithPacketSchema,
    decision: QueueActionDecisionSchema,
    request_id: id
  })
  .strict();
export type QueueActionResponse = z.infer<typeof QueueActionResponseSchema>;

export const QueuePriorityRequestSchema = z
  .object({
    delta: z.number().finite().optional(),
    score: z.number().finite().nonnegative().optional(),
    reason: z.string().min(1).max(80).optional(),
    actor_id: id.optional()
  })
  .passthrough()
  .superRefine((request, ctx) => {
    if (request.delta === undefined && request.score === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "priority request must include delta or score",
        path: ["delta"]
      });
    }
  });
export type QueuePriorityRequest = z.infer<typeof QueuePriorityRequestSchema>;

export const QueuePriorityResponseSchema = z
  .object({
    ok: z.literal(true),
    item: QueueItemWithPacketSchema,
    request_id: id
  })
  .strict();
export type QueuePriorityResponse = z.infer<typeof QueuePriorityResponseSchema>;

export const QueueRecommendedActionRequestSchema = z
  .object({
    actor_id: id.optional(),
    idempotency_key: id.optional(),
    workspace_snapshot: WorkspaceSnapshotSchema.optional(),
    workspaceSnapshot: WorkspaceSnapshotSchema.optional()
  })
  .passthrough();
export type QueueRecommendedActionRequest = z.infer<typeof QueueRecommendedActionRequestSchema>;

export const QueueRecommendedActionResponseSchema = z
  .object({
    ok: z.literal(true),
    action_result: unknownRecord,
    item: QueueItemWithPacketSchema.nullable().optional(),
    idempotent_replay: z.boolean().optional(),
    request_id: id
  })
  .strict();
export type QueueRecommendedActionResponse = z.infer<typeof QueueRecommendedActionResponseSchema>;

export const TaskSessionsListResponseSchema = z
  .object({
    sessions: z.array(TaskRuntimeSessionSchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type TaskSessionsListResponse = z.infer<typeof TaskSessionsListResponseSchema>;

export const TaskSessionGetResponseSchema = z
  .object({
    session: TaskRuntimeSessionSchema,
    request_id: id
  })
  .strict();
export type TaskSessionGetResponse = z.infer<typeof TaskSessionGetResponseSchema>;

export const TaskSessionStartRequestSchema = z
  .object({
    task_id: id.regex(/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
    prompt: nonEmpty,
    cwd: z.string().optional(),
    model: z.string().optional(),
    queue_paper: z.boolean().optional(),
    workspace_snapshot: WorkspaceSnapshotSchema.optional(),
    idempotency_key: id.optional()
  })
  .passthrough();
export type TaskSessionStartRequest = z.infer<typeof TaskSessionStartRequestSchema>;

export const TaskSessionStartResultSchema = z
  .object({
    ok: z.boolean(),
    task_id: id,
    task_session_id: id.optional(),
    session: TaskRuntimeSessionSchema.optional(),
    deduped: z.boolean().optional(),
    error: z.string().optional(),
    message: TaskMessageApiSchema.optional()
  })
  .passthrough();
export type TaskSessionStartResult = z.infer<typeof TaskSessionStartResultSchema>;

export const TaskSessionStartResponseSchema = z
  .object({
    ok: z.literal(true),
    started: TaskSessionStartResultSchema,
    task_message: TaskMessageApiSchema,
    task: TaskRecordSchema.optional(),
    workspace_snapshot: z.union([TaskWorkspaceSnapshotRecordSchema, TaskLayoutRecordSchema]).optional(),
    queue_item: QueueItemSchema.optional(),
    review_packet: ReviewPacketSchema.optional(),
    request_id: id
  })
  .strict();
export type TaskSessionStartResponse = z.infer<typeof TaskSessionStartResponseSchema>;

export const TaskSessionFollowupRequestSchema = z
  .object({
    text: nonEmpty,
    event_ids: z.array(id).optional(),
    idempotency_key: id.optional(),
    untrusted_source_text: z.string().optional()
  })
  .passthrough();
export type TaskSessionFollowupRequest = z.infer<typeof TaskSessionFollowupRequestSchema>;

export const TaskSessionFollowupResponseSchema = z
  .object({
    ok: z.literal(true),
    message: TaskMessageApiSchema,
    request_id: id
  })
  .strict();
export type TaskSessionFollowupResponse = z.infer<typeof TaskSessionFollowupResponseSchema>;

export const TaskSessionReplacementRequestSchema = z
  .object({
    prompt: z.string().optional(),
    text: z.string().optional(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    idempotency_key: id.optional()
  })
  .passthrough()
  .superRefine((request, ctx) => {
    const prompt = typeof request.prompt === "string" && request.prompt.trim();
    const text = typeof request.text === "string" && request.text.trim();
    if (!prompt && !text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prompt or text is required",
        path: ["prompt"]
      });
    }
  });
export type TaskSessionReplacementRequest = z.infer<typeof TaskSessionReplacementRequestSchema>;

export const TaskSessionReplacementResponseSchema = TaskSessionStartResponseSchema.extend({
  replaced_session: TaskRuntimeSessionSchema,
  replacement_for_task_session_id: id
}).strict();
export type TaskSessionReplacementResponse = z.infer<typeof TaskSessionReplacementResponseSchema>;

export const TaskSessionBindingRequestSchema = z
  .object({
    task_id: id.regex(/^task_[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
    terminal_ref: z.string().regex(/^(ghostty|tmux|kitty|wezterm):/i).optional()
  })
  .passthrough();
export type TaskSessionBindingRequest = z.infer<typeof TaskSessionBindingRequestSchema>;

export const TaskSessionBindingResponseSchema = z
  .object({
    ok: z.literal(true),
    binding: TaskSessionBindingSchema,
    request_id: id
  })
  .strict();
export type TaskSessionBindingResponse = z.infer<typeof TaskSessionBindingResponseSchema>;

export const TaskMessagesListResponseSchema = z
  .object({
    ok: z.literal(true),
    messages: z.array(TaskMessageApiSchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type TaskMessagesListResponse = z.infer<typeof TaskMessagesListResponseSchema>;

export const TaskMessagesReconcileAttemptedRequestSchema = z
  .object({
    action: z.literal("mark_failed"),
    older_than_ms: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).optional()
  })
  .passthrough();
export type TaskMessagesReconcileAttemptedRequest = z.infer<typeof TaskMessagesReconcileAttemptedRequestSchema>;

export const TaskMessagesReconcileAttemptedResponseSchema = z
  .object({
    ok: z.literal(true),
    reconciled: z.array(TaskMessageApiSchema),
    count: z.number().int().nonnegative(),
    scanned: z.number().int().nonnegative(),
    older_than_ms: z.number().int().positive(),
    request_id: id
  })
  .strict();
export type TaskMessagesReconcileAttemptedResponse = z.infer<typeof TaskMessagesReconcileAttemptedResponseSchema>;

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
    human_queue_reason: z.enum(["human_blocked", "ambiguous", "risky"]).optional(),
    evidence: z.array(EvidenceRefSchema),
    created_at: isoDateTime
  })
  .strict();
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export const ContextEntrySchema = z
  .object({
    event_id: id,
    event_title: nonEmpty,
    event_source: nonEmpty,
    task_id: id.optional(),
    route_decision: RouteDecisionSchema,
    resource: ContextResourceSchema,
    captured_at: isoDateTime,
    relevance_score: z.number(),
    match_reasons: z.array(nonEmpty)
  })
  .strict();
export type ContextEntry = z.infer<typeof ContextEntrySchema>;

export const ContextsListResponseSchema = z
  .object({
    entries: z.array(ContextEntrySchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type ContextsListResponse = z.infer<typeof ContextsListResponseSchema>;

export const ContextRestorePlanRequestSchema = z
  .object({
    resource: ContextResourceSchema
  })
  .passthrough();
export type ContextRestorePlanRequest = z.infer<typeof ContextRestorePlanRequestSchema>;

export const ContextRestorePlanResponseSchema = z
  .object({
    restore_plan: ContextRestorePlanSchema,
    request_id: id
  })
  .strict();
export type ContextRestorePlanResponse = z.infer<typeof ContextRestorePlanResponseSchema>;

export const ContextRestoreRequestResponseSchema = z
  .object({
    restore_request: ContextRestoreRequestSchema,
    request_id: id
  })
  .strict();
export type ContextRestoreRequestResponse = z.infer<typeof ContextRestoreRequestResponseSchema>;

export const ContextRestoreRequestMaybeResponseSchema = z
  .object({
    restore_request: ContextRestoreRequestSchema.nullable(),
    request_id: id
  })
  .strict();
export type ContextRestoreRequestMaybeResponse = z.infer<typeof ContextRestoreRequestMaybeResponseSchema>;

export const ContextRestoreClaimRequestSchema = z
  .object({
    lease_owner: id,
    lease_ms: z.number().int().positive().max(1_800_000).optional()
  })
  .passthrough();
export type ContextRestoreClaimRequest = z.infer<typeof ContextRestoreClaimRequestSchema>;

export const ContextRestoreFinishRequestSchema = z
  .object({
    result: z.unknown().optional()
  })
  .passthrough();
export type ContextRestoreFinishRequest = z.infer<typeof ContextRestoreFinishRequestSchema>;

export const ReadingQueueContextSummarySchema = z
  .object({
    id,
    title: nonEmpty,
    url: z.string().url().optional(),
    captured_at: isoDateTime,
    event_id: id,
    source: nonEmpty
  })
  .strict();
export type ReadingQueueContextSummary = z.infer<typeof ReadingQueueContextSummarySchema>;

export const ReadingQueueListResponseSchema = z
  .object({
    contexts: z.array(ReadingQueueContextSummarySchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type ReadingQueueListResponse = z.infer<typeof ReadingQueueListResponseSchema>;

export const ReadingQueuePromoteRequestSchema = z
  .object({
    context_ids: z.union([id, z.array(id)]).optional(),
    context_id: z.union([id, z.array(id)]).optional(),
    actor_id: id.optional()
  })
  .passthrough();
export type ReadingQueuePromoteRequest = z.infer<typeof ReadingQueuePromoteRequestSchema>;

export const ReadingQueuePromotionResultSchema = z
  .object({
    context_id: id,
    queue_item_id: id.optional(),
    review_packet_id: id.optional(),
    event_id: id,
    idempotent: z.boolean()
  })
  .strict();
export type ReadingQueuePromotionResult = z.infer<typeof ReadingQueuePromotionResultSchema>;

export const ReadingQueuePromoteResponseSchema = z
  .object({
    ok: z.literal(true),
    promoted: z.array(ReadingQueuePromotionResultSchema),
    promoted_count: z.number().int().nonnegative(),
    missing_context_ids: z.array(id),
    request_id: id
  })
  .strict();
export type ReadingQueuePromoteResponse = z.infer<typeof ReadingQueuePromoteResponseSchema>;

export const ReadingQueueAutoPromoteRequestSchema = z
  .object({
    min_age_seconds: z.number().nonnegative().optional(),
    actor_id: id.optional()
  })
  .passthrough();
export type ReadingQueueAutoPromoteRequest = z.infer<typeof ReadingQueueAutoPromoteRequestSchema>;

export const ReadingQueueAutoPromoteResponseSchema = z
  .object({
    ok: z.literal(true),
    paused: z.literal(true).optional(),
    reason: z.literal("manual_mode_active").optional(),
    manual_mode: ManualModeStateSchema.optional(),
    evaluated_count: z.number().int().nonnegative(),
    aged_count: z.number().int().nonnegative(),
    promoted_count: z.number().int().nonnegative(),
    promoted: z.array(ReadingQueuePromotionResultSchema),
    request_id: id
  })
  .strict();
export type ReadingQueueAutoPromoteResponse = z.infer<typeof ReadingQueueAutoPromoteResponseSchema>;

export const McpPollItemSchema = z
  .object({
    id,
    occurred_at: isoDateTime,
    title: nonEmpty,
    summary: nonEmpty,
    thread_url: z.string().url(),
    actor_id: id,
    actor_name: nonEmpty,
    type: nonEmpty,
    workspace_id: z.string().optional(),
    channel_id: z.string().optional(),
    thread_ts: z.string().optional(),
    project_hint: z.string().optional(),
    task_hint: z.string().optional()
  })
  .passthrough();
export type McpPollItem = z.infer<typeof McpPollItemSchema>;

export const McpPollRequestSchema = z
  .object({
    source_id: id.optional(),
    items: z.array(McpPollItemSchema),
    next_cursor: z.string().optional()
  })
  .passthrough();
export type McpPollRequest = z.infer<typeof McpPollRequestSchema>;

export const McpPollResponseSchema = z
  .object({
    source_id: id,
    events: z.array(EventSchema),
    duplicates_ignored: z.number().int().nonnegative(),
    cursor: z.string().optional(),
    request_id: id
  })
  .strict();
export type McpPollResponse = z.infer<typeof McpPollResponseSchema>;

export const McpSourceSummarySchema = z
  .object({
    id,
    title: nonEmpty.optional(),
    kind: nonEmpty.optional(),
    provider: nonEmpty.optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    cursor: z.string().optional()
  })
  .passthrough();
export type McpSourceSummary = z.infer<typeof McpSourceSummarySchema>;

export const McpSourcesListResponseSchema = z
  .object({
    sources: z.array(McpSourceSummarySchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type McpSourcesListResponse = z.infer<typeof McpSourcesListResponseSchema>;

export const McpSourceGetResponseSchema = z
  .object({
    source: McpSourceSummarySchema,
    request_id: id
  })
  .strict();
export type McpSourceGetResponse = z.infer<typeof McpSourceGetResponseSchema>;

export const PaperTriggerRecordSchema = z
  .object({
    trigger_id: id,
    task_id: id,
    name: nonEmpty,
    match_event_type: nonEmpty,
    match_source_id_pattern: nonEmpty.optional(),
    match_body_substring: nonEmpty.optional(),
    enabled: z.boolean(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
    last_fired_at: isoDateTime.optional()
  })
  .strict();
export type PaperTriggerRecord = z.infer<typeof PaperTriggerRecordSchema>;

export const PaperTriggerCreateRequestSchema = z
  .object({
    task_id: id,
    name: nonEmpty,
    match_event_type: nonEmpty,
    match_source_id_pattern: nonEmpty.optional(),
    match_body_substring: nonEmpty.optional(),
    enabled: z.boolean().optional()
  })
  .strict();
export type PaperTriggerCreateRequest = z.infer<typeof PaperTriggerCreateRequestSchema>;

export const PaperTriggerPatchRequestSchema = z
  .object({
    name: nonEmpty.optional(),
    match_event_type: nonEmpty.optional(),
    match_source_id_pattern: nonEmpty.nullable().optional(),
    match_body_substring: nonEmpty.nullable().optional(),
    enabled: z.boolean().optional()
  })
  .strict();
export type PaperTriggerPatchRequest = z.infer<typeof PaperTriggerPatchRequestSchema>;

export const PaperTriggerListResponseSchema = z
  .object({
    triggers: z.array(PaperTriggerRecordSchema),
    request_id: id
  })
  .strict();
export type PaperTriggerListResponse = z.infer<typeof PaperTriggerListResponseSchema>;

export const PaperTriggerGetResponseSchema = z
  .object({
    trigger: PaperTriggerRecordSchema,
    request_id: id
  })
  .strict();
export type PaperTriggerGetResponse = z.infer<typeof PaperTriggerGetResponseSchema>;

export const PaperTriggerMutationResponseSchema = z
  .object({
    ok: z.literal(true),
    trigger: PaperTriggerRecordSchema,
    request_id: id
  })
  .strict();
export type PaperTriggerMutationResponse = z.infer<typeof PaperTriggerMutationResponseSchema>;

export const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    service: nonEmpty,
    time: isoDateTime,
    request_id: id
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const MetricsSnapshotSchema = z
  .object({
    counters: z.record(z.number()),
    activity_count: z.number().int().nonnegative()
  })
  .strict();
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

export const MetricsResponseSchema = z
  .object({
    metrics: MetricsSnapshotSchema,
    generated_at: isoDateTime,
    request_id: id
  })
  .strict();
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

export const ActivityActorSchema = z.enum(["system", "human", "agent"]);
export type ActivityActor = z.infer<typeof ActivityActorSchema>;

export const ActivityStatusSchema = z.enum(["ok", "failed", "blocked"]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ActivityEventSchema = z
  .object({
    id,
    type: nonEmpty,
    occurred_at: isoDateTime,
    actor: ActivityActorSchema,
    task_id: id.optional(),
    queue_item_id: id.optional(),
    event_id: id.optional(),
    task_session_id: id.optional(),
    source_id: id.optional(),
    status: ActivityStatusSchema.optional(),
    summary: nonEmpty,
    details: z.record(z.unknown())
  })
  .strict();
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityResponseSchema = z
  .object({
    events: z.array(ActivityEventSchema),
    count: z.number().int().nonnegative(),
    request_id: id
  })
  .strict();
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

export const RouteEventResultSchema = z
  .object({
    event: EventSchema,
    route_decision: RouteDecisionSchema,
    review_packet: ReviewPacketSchema.optional(),
    queue_item: QueueItemWithPacketSchema.optional(),
    task_message: TaskMessageApiSchema.optional(),
    trigger_fires: z.array(z.object({
      trigger_id: id,
      task_id: id,
      queue_item_id: id.optional(),
      event_id: id
    }).strict()).optional()
  })
  .passthrough();
export type RouteEventResult = z.infer<typeof RouteEventResultSchema>;

export const EventIngestRequestSchema = z.union([
  EventSchema,
  z.object({ event: EventSchema }).passthrough()
]);
export type EventIngestRequest = z.infer<typeof EventIngestRequestSchema>;

export const EventIngestResponseSchema = RouteEventResultSchema.extend({
  ok: z.literal(true),
  request_id: id
}).passthrough();
export type EventIngestResponse = z.infer<typeof EventIngestResponseSchema>;

export const EventGetResponseSchema = RouteEventResultSchema.extend({
  request_id: id
}).passthrough();
export type EventGetResponse = z.infer<typeof EventGetResponseSchema>;

export const ReviewPacketGetResponseSchema = z
  .object({
    packet: ReviewPacketSchema,
    request_id: id
  })
  .strict();
export type ReviewPacketGetResponse = z.infer<typeof ReviewPacketGetResponseSchema>;

export const QueueLineageSchema = z
  .object({
    queue_item: QueueItemWithPacketSchema,
    related_event_ids: z.array(id),
    events: z.array(RouteEventResultSchema),
    activity: z.array(ActivityEventSchema),
    task_messages: z.array(TaskMessageApiSchema),
    counts: z
      .object({
        events: z.number().int().nonnegative(),
        activity: z.number().int().nonnegative(),
        task_messages: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();
export type QueueLineage = z.infer<typeof QueueLineageSchema>;

export const QueueLineageResponseSchema = z
  .object({
    lineage: QueueLineageSchema,
    request_id: id
  })
  .strict();
export type QueueLineageResponse = z.infer<typeof QueueLineageResponseSchema>;

export const McpPollAllAndRouteRequestSchema = z
  .object({
    source_ids: z.array(id).optional(),
    inputs_by_source_id: z.record(z.unknown()).optional()
  })
  .passthrough();
export type McpPollAllAndRouteRequest = z.infer<typeof McpPollAllAndRouteRequestSchema>;

export const McpPollSourceRequestSchema = z.object({}).passthrough();
export type McpPollSourceRequest = z.infer<typeof McpPollSourceRequestSchema>;

export const McpPollAndRouteResultSchema = z
  .object({
    source_id: id,
    ok: z.boolean(),
    events_seen: z.number().int().nonnegative().optional(),
    routed: z.array(RouteEventResultSchema).optional(),
    duplicates_ignored: z.number().int().nonnegative().optional(),
    cursor: z.string().optional(),
    error: z.string().optional()
  })
  .strict();
export type McpPollAndRouteResult = z.infer<typeof McpPollAndRouteResultSchema>;

export const McpPollAllAndRouteResponseSchema = z
  .object({
    ok: z.boolean(),
    sources_seen: z.number().int().nonnegative(),
    events_seen: z.number().int().nonnegative(),
    routed_count: z.number().int().nonnegative(),
    duplicates_ignored: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    polled: z.array(McpPollAndRouteResultSchema),
    request_id: id
  })
  .strict();
export type McpPollAllAndRouteResponse = z.infer<typeof McpPollAllAndRouteResponseSchema>;

export const McpPreviewItemSchema = z
  .object({
    source: nonEmpty,
    type: nonEmpty,
    occurred_at: isoDateTime,
    actor: z.object({
      type: nonEmpty,
      name_present: z.boolean()
    }).strict(),
    has_project_hint: z.boolean(),
    has_task_hint: z.boolean(),
    links: z.number().int().nonnegative(),
    resources: z.number().int().nonnegative(),
    first_link_host: z.string().optional()
  })
  .strict();
export type McpPreviewItem = z.infer<typeof McpPreviewItemSchema>;

export const McpPreviewResponseSchema = z
  .object({
    source_id: id,
    events_seen: z.number().int().nonnegative(),
    duplicates_ignored: z.number().int().nonnegative(),
    cursor: z.string().optional(),
    preview: z.array(McpPreviewItemSchema),
    request_id: id
  })
  .strict();
export type McpPreviewResponse = z.infer<typeof McpPreviewResponseSchema>;

export const McpPollAndRouteResponseSchema = z
  .object({
    source_id: id,
    events_seen: z.number().int().nonnegative(),
    routed: z.array(RouteEventResultSchema),
    duplicates_ignored: z.number().int().nonnegative(),
    cursor: z.string().optional(),
    request_id: id
  })
  .strict();
export type McpPollAndRouteResponse = z.infer<typeof McpPollAndRouteResponseSchema>;

export const AgentRunUpsertRequestSchema = AgentRunSchema.partial({
  risk_tags: true,
  evidence: true,
  output_refs: true,
  resume_actions: true,
  updated_at: true
}).extend({
  id,
  provider: z.enum(["codex", "claude", "openai", "manual", "fake"]),
  status: z.enum(["queued", "running", "blocked", "waiting_approval", "completed", "failed", "cancelled"])
}).passthrough();
export type AgentRunUpsertRequest = z.infer<typeof AgentRunUpsertRequestSchema>;

export const AgentRunUpsertResponseSchema = z
  .object({
    agent_run: AgentRunSchema,
    review_packet: ReviewPacketSchema.optional(),
    queue_item: QueueItemWithPacketSchema.optional(),
    request_id: id
  })
  .strict();
export type AgentRunUpsertResponse = z.infer<typeof AgentRunUpsertResponseSchema>;

export const AgentRunGetResponseSchema = z
  .object({
    agent_run: AgentRunSchema,
    request_id: id
  })
  .strict();
export type AgentRunGetResponse = z.infer<typeof AgentRunGetResponseSchema>;

export const VoiceCommandRequestSchema = z
  .object({
    transcript: nonEmpty,
    idempotency_key: id.optional(),
    source_id: id.optional(),
    occurred_at: isoDateTime.optional(),
    project_hint: z.string().optional(),
    task_hint: z.string().optional()
  })
  .passthrough();
export type VoiceCommandRequest = z.infer<typeof VoiceCommandRequestSchema>;

export const VoiceCommandResponseSchema = z
  .object({
    ok: z.boolean(),
    intent: nonEmpty.optional(),
    request_id: id
  })
  .passthrough();
export type VoiceCommandResponse = z.infer<typeof VoiceCommandResponseSchema>;

export const CodexAutoBindBoundSchema = z
  .object({
    task_id: id,
    task_session_id: id,
    terminal_ref: nonEmpty,
    window_id: z.number().int().positive(),
    window_app: nonEmpty
  })
  .strict();
export type CodexAutoBindBound = z.infer<typeof CodexAutoBindBoundSchema>;

export const CodexAutoBindSkippedSchema = z
  .object({
    task_id: id.optional(),
    window_id: z.number().int().positive().optional(),
    window_title: z.string().optional(),
    reason: nonEmpty
  })
  .strict();
export type CodexAutoBindSkipped = z.infer<typeof CodexAutoBindSkippedSchema>;

export const CodexAutoBindResponseSchema = z
  .object({
    ok: z.literal(true),
    paused: z.literal(true).optional(),
    reason: z.literal("manual_mode_active").optional(),
    manual_mode: ManualModeStateSchema.optional(),
    scanned_window_count: z.number().int().nonnegative(),
    matched_count: z.number().int().nonnegative(),
    bound: z.array(CodexAutoBindBoundSchema),
    skipped: z.array(CodexAutoBindSkippedSchema),
    request_id: id
  })
  .strict();
export type CodexAutoBindResponse = z.infer<typeof CodexAutoBindResponseSchema>;

export const CodexForegroundResolveResponseSchema = z
  .object({
    codex_thread_id: id.nullable(),
    ghostty_window_id: id.nullable(),
    source: z.enum(["title_resolver", "codex_session", "none"]),
    request_id: id
  })
  .strict();
export type CodexForegroundResolveResponse = z.infer<typeof CodexForegroundResolveResponseSchema>;

export const CodexSessionInspectionResponseSchema = z
  .object({
    thread_id: nonEmpty,
    exists: z.boolean(),
    rollout_path: z.string().optional(),
    rollout_size_bytes: z.number().int().nonnegative().optional(),
    last_event_at: isoDateTime.optional(),
    idle_seconds: z.number().int().nonnegative().optional(),
    event_count: z.number().int().nonnegative().optional(),
    recent_event_types: z.array(nonEmpty).optional(),
    recent_summary: z.string().optional(),
    request_id: id
  })
  .strict();
export type CodexSessionInspectionResponse = z.infer<typeof CodexSessionInspectionResponseSchema>;

export const ClaudeSessionInspectionResponseSchema = z
  .object({
    session_id: nonEmpty,
    exists: z.boolean(),
    rollout_path: z.string().optional(),
    rollout_size_bytes: z.number().int().nonnegative().optional(),
    last_event_at: isoDateTime.optional(),
    idle_seconds: z.number().int().nonnegative().optional(),
    event_count: z.number().int().nonnegative().optional(),
    recent_event_types: z.array(nonEmpty).optional(),
    recent_summary: z.string().optional(),
    cwd_hint: z.string().optional(),
    request_id: id
  })
  .strict();
export type ClaudeSessionInspectionResponse = z.infer<typeof ClaudeSessionInspectionResponseSchema>;

export const MasterFanOutSelectorSchema = z
  .object({
    task_ids: z.array(id).optional(),
    task_id_pattern: nonEmpty.optional(),
    task_hint_substring: nonEmpty.optional(),
    idle_min_seconds: z.number().nonnegative().optional()
  })
  .passthrough();
export type MasterFanOutSelector = z.infer<typeof MasterFanOutSelectorSchema>;

export const MasterFanOutRequestSchema = z
  .object({
    message: nonEmpty.max(4000),
    selector: MasterFanOutSelectorSchema,
    dry_run: z.boolean().optional(),
    target: nonEmpty.optional(),
    idempotency_key: id.optional()
  })
  .passthrough();
export type MasterFanOutRequest = z.infer<typeof MasterFanOutRequestSchema>;

export const MasterFanOutMatchSchema = z
  .object({
    task_id: id,
    task_session_id: id.optional(),
    matched_packet_id: id.optional(),
    matched_packet_title: z.string().optional(),
    idle_seconds: z.number().int().nonnegative().optional()
  })
  .strict();
export type MasterFanOutMatch = z.infer<typeof MasterFanOutMatchSchema>;

export const MasterFanOutDeliveredSchema = z
  .object({
    task_id: id,
    task_session_id: id,
    task_message: TaskMessageApiSchema
  })
  .strict();
export type MasterFanOutDelivered = z.infer<typeof MasterFanOutDeliveredSchema>;

export const MasterFanOutSkippedSchema = z
  .object({
    task_id: id,
    reason: nonEmpty
  })
  .strict();
export type MasterFanOutSkipped = z.infer<typeof MasterFanOutSkippedSchema>;

export const MasterFanOutResponseSchema = z
  .object({
    ok: z.literal(true),
    dry_run: z.boolean(),
    fan_out_id: id.optional(),
    matched_count: z.number().int().nonnegative(),
    preview: z.array(MasterFanOutMatchSchema).optional(),
    delivered_count: z.number().int().nonnegative().optional(),
    delivered: z.array(MasterFanOutDeliveredSchema).optional(),
    skipped: z.array(MasterFanOutSkippedSchema).optional(),
    missing_task_ids: z.array(id).optional(),
    request_id: id
  })
  .strict();
export type MasterFanOutResponse = z.infer<typeof MasterFanOutResponseSchema>;

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

export const ContractSchemas: Record<string, z.ZodTypeAny> = {
  Actor: ActorSchema,
  RawRef: RawRefSchema,
  LinkRef: LinkRefSchema,
  EvidenceRef: EvidenceRefSchema,
  RiskTag: RiskTagSchema,
  ContextResource: ContextResourceSchema,
  WorkspaceWindow: WorkspaceWindowSchema,
  WindowFrame: WindowFrameSchema,
  WorkspaceFrameCaptureStatus: WorkspaceFrameCaptureStatusSchema,
  WorkspaceSnapshot: WorkspaceSnapshotSchema,
  WorkspaceCapabilityStatus: WorkspaceCapabilityStatusSchema,
  WorkspaceStatusResponse: WorkspaceStatusResponseSchema,
  WorkspaceCaptureResponse: WorkspaceCaptureResponseSchema,
  WorkspaceRestorePlanRequest: WorkspaceRestorePlanRequestSchema,
  WorkspaceCommand: WorkspaceCommandSchema,
  AerospaceCommand: AerospaceCommandSchema,
  RestoreSkip: RestoreSkipSchema,
  WorkspaceRestorePlan: WorkspaceRestorePlanSchema,
  WorkspaceRestorePlanResponse: WorkspaceRestorePlanResponseSchema,
  WorkspaceRestoreRequest: WorkspaceRestoreRequestSchema,
  WorkspaceRestoreCommandReceipt: WorkspaceRestoreCommandReceiptSchema,
  WorkspaceRestoreReceipt: WorkspaceRestoreReceiptSchema,
  WorkspaceRestoreResponse: WorkspaceRestoreResponseSchema,
  ContextRestorePlan: ContextRestorePlanSchema,
  ContextRestoreRequest: ContextRestoreRequestSchema,
  ManualModeState: ManualModeStateSchema,
  ManualModeSetRequest: ManualModeSetRequestSchema,
  ManualModeGetResponse: ManualModeGetResponseSchema,
  ManualModeSetResponse: ManualModeSetResponseSchema,
  TaskWindowClaimRecord: TaskWindowClaimRecordSchema,
  TaskWindowClaimCreateRequest: TaskWindowClaimCreateRequestSchema,
  TaskWindowClaimResponse: TaskWindowClaimResponseSchema,
  TaskWindowClaimsListResponse: TaskWindowClaimsListResponseSchema,
  TaskAnchorKind: TaskAnchorKindSchema,
  TaskAnchor: TaskAnchorSchema,
  TaskRecord: TaskRecordSchema,
  TaskLayoutRecord: TaskLayoutRecordSchema,
  TaskWorkspaceSnapshotRecord: TaskWorkspaceSnapshotRecordSchema,
  OnboardingWindow: OnboardingWindowSchema,
  OnboardingBrowserContext: OnboardingBrowserContextSchema,
  OnboardingScanSummary: OnboardingScanSummarySchema,
  OnboardingTaskProposal: OnboardingTaskProposalSchema,
  OnboardingScanResponse: OnboardingScanResponseSchema,
  OnboardingApprovalRequest: OnboardingApprovalRequestSchema,
  OnboardingBrowserContextBinding: OnboardingBrowserContextBindingSchema,
  OnboardingApprovalResponse: OnboardingApprovalResponseSchema,
  OnboardingApprovalBatchRequest: OnboardingApprovalBatchRequestSchema,
  OnboardingApprovalBatchEntry: OnboardingApprovalBatchEntrySchema,
  OnboardingApprovalBatchResponse: OnboardingApprovalBatchResponseSchema,
  OnboardingRejectionRequest: OnboardingRejectionRequestSchema,
  OnboardingRejectionRecord: OnboardingRejectionRecordSchema,
  OnboardingRejectionResponse: OnboardingRejectionResponseSchema,
  CreateTaskRequest: CreateTaskRequestSchema,
  CreateTaskResponse: CreateTaskResponseSchema,
  TaskListResponse: TaskListResponseSchema,
  TaskGetResponse: TaskGetResponseSchema,
  TaskLayoutResponse: TaskLayoutResponseSchema,
  TaskLayoutUpdateResponse: TaskLayoutUpdateResponseSchema,
  TaskWorkspaceSnapshotSaveRequest: TaskWorkspaceSnapshotSaveRequestSchema,
  TaskWorkspaceSnapshotSaveResponse: TaskWorkspaceSnapshotSaveResponseSchema,
  CurrentTaskSetRequest: CurrentTaskSetRequestSchema,
  CurrentTaskResponse: CurrentTaskResponseSchema,
  FollowsWindowExclusionRecord: FollowsWindowExclusionRecordSchema,
  FollowsWindowExclusionCreateRequest: FollowsWindowExclusionCreateRequestSchema,
  FollowsWindowExclusionResponse: FollowsWindowExclusionResponseSchema,
  FollowsWindowExclusionsListResponse: FollowsWindowExclusionsListResponseSchema,
  Event: EventSchema,
  Task: TaskSchema,
  AgentRun: AgentRunSchema,
  TaskSession: TaskSessionSchema,
  TaskMessage: TaskMessageSchema,
  TaskRuntimeSession: TaskRuntimeSessionSchema,
  TaskSessionBinding: TaskSessionBindingSchema,
  TaskMessageApi: TaskMessageApiSchema,
  ReviewPacket: ReviewPacketSchema,
  QueueItem: QueueItemSchema,
  QueueItemWithPacket: QueueItemWithPacketSchema,
  QueueListResponse: QueueListResponseSchema,
  QueueNextResponse: QueueNextResponseSchema,
  QueueLeaseRequest: QueueLeaseRequestSchema,
  QueueLeaseRenewRequest: QueueLeaseRenewRequestSchema,
  QueueLeaseRenewResponse: QueueLeaseRenewResponseSchema,
  QueueDoneRequest: QueueDoneRequestSchema,
  QueueDeferRequest: QueueDeferRequestSchema,
  QueueIgnoreRequest: QueueIgnoreRequestSchema,
  QueueActionDecision: QueueActionDecisionSchema,
  QueueActionResponse: QueueActionResponseSchema,
  QueuePriorityRequest: QueuePriorityRequestSchema,
  QueuePriorityResponse: QueuePriorityResponseSchema,
  QueueRecommendedActionRequest: QueueRecommendedActionRequestSchema,
  QueueRecommendedActionResponse: QueueRecommendedActionResponseSchema,
  TaskSessionsListResponse: TaskSessionsListResponseSchema,
  TaskSessionGetResponse: TaskSessionGetResponseSchema,
  TaskSessionStartRequest: TaskSessionStartRequestSchema,
  TaskSessionStartResult: TaskSessionStartResultSchema,
  TaskSessionStartResponse: TaskSessionStartResponseSchema,
  TaskSessionFollowupRequest: TaskSessionFollowupRequestSchema,
  TaskSessionFollowupResponse: TaskSessionFollowupResponseSchema,
  TaskSessionReplacementRequest: TaskSessionReplacementRequestSchema,
  TaskSessionReplacementResponse: TaskSessionReplacementResponseSchema,
  TaskSessionBindingRequest: TaskSessionBindingRequestSchema,
  TaskSessionBindingResponse: TaskSessionBindingResponseSchema,
  TaskMessagesListResponse: TaskMessagesListResponseSchema,
  TaskMessagesReconcileAttemptedRequest: TaskMessagesReconcileAttemptedRequestSchema,
  TaskMessagesReconcileAttemptedResponse: TaskMessagesReconcileAttemptedResponseSchema,
  RouteDecision: RouteDecisionSchema,
  EventIngestRequest: EventIngestRequestSchema,
  EventIngestResponse: EventIngestResponseSchema,
  EventGetResponse: EventGetResponseSchema,
  ReviewPacketGetResponse: ReviewPacketGetResponseSchema,
  QueueLineage: QueueLineageSchema,
  QueueLineageResponse: QueueLineageResponseSchema,
  ContextEntry: ContextEntrySchema,
  ContextsListResponse: ContextsListResponseSchema,
  ContextRestorePlanRequest: ContextRestorePlanRequestSchema,
  ContextRestorePlanResponse: ContextRestorePlanResponseSchema,
  ContextRestoreRequestResponse: ContextRestoreRequestResponseSchema,
  ContextRestoreRequestMaybeResponse: ContextRestoreRequestMaybeResponseSchema,
  ContextRestoreClaimRequest: ContextRestoreClaimRequestSchema,
  ContextRestoreFinishRequest: ContextRestoreFinishRequestSchema,
  ReadingQueueContextSummary: ReadingQueueContextSummarySchema,
  ReadingQueueListResponse: ReadingQueueListResponseSchema,
  ReadingQueuePromoteRequest: ReadingQueuePromoteRequestSchema,
  ReadingQueuePromotionResult: ReadingQueuePromotionResultSchema,
  ReadingQueuePromoteResponse: ReadingQueuePromoteResponseSchema,
  ReadingQueueAutoPromoteRequest: ReadingQueueAutoPromoteRequestSchema,
  ReadingQueueAutoPromoteResponse: ReadingQueueAutoPromoteResponseSchema,
  McpPollItem: McpPollItemSchema,
  McpPollRequest: McpPollRequestSchema,
  McpPollResponse: McpPollResponseSchema,
  McpSourceSummary: McpSourceSummarySchema,
  McpSourcesListResponse: McpSourcesListResponseSchema,
  McpSourceGetResponse: McpSourceGetResponseSchema,
  PaperTriggerRecord: PaperTriggerRecordSchema,
  PaperTriggerCreateRequest: PaperTriggerCreateRequestSchema,
  PaperTriggerPatchRequest: PaperTriggerPatchRequestSchema,
  PaperTriggerListResponse: PaperTriggerListResponseSchema,
  PaperTriggerGetResponse: PaperTriggerGetResponseSchema,
  PaperTriggerMutationResponse: PaperTriggerMutationResponseSchema,
  HealthResponse: HealthResponseSchema,
  MetricsSnapshot: MetricsSnapshotSchema,
  MetricsResponse: MetricsResponseSchema,
  ActivityActor: ActivityActorSchema,
  ActivityStatus: ActivityStatusSchema,
  ActivityEvent: ActivityEventSchema,
  ActivityResponse: ActivityResponseSchema,
  RouteEventResult: RouteEventResultSchema,
  McpPollAllAndRouteRequest: McpPollAllAndRouteRequestSchema,
  McpPollSourceRequest: McpPollSourceRequestSchema,
  McpPollAndRouteResult: McpPollAndRouteResultSchema,
  McpPollAllAndRouteResponse: McpPollAllAndRouteResponseSchema,
  McpPreviewItem: McpPreviewItemSchema,
  McpPreviewResponse: McpPreviewResponseSchema,
  McpPollAndRouteResponse: McpPollAndRouteResponseSchema,
  AgentRunUpsertRequest: AgentRunUpsertRequestSchema,
  AgentRunUpsertResponse: AgentRunUpsertResponseSchema,
  AgentRunGetResponse: AgentRunGetResponseSchema,
  VoiceCommandRequest: VoiceCommandRequestSchema,
  VoiceCommandResponse: VoiceCommandResponseSchema,
  CodexAutoBindBound: CodexAutoBindBoundSchema,
  CodexAutoBindSkipped: CodexAutoBindSkippedSchema,
  CodexAutoBindResponse: CodexAutoBindResponseSchema,
  CodexForegroundResolveResponse: CodexForegroundResolveResponseSchema,
  CodexSessionInspectionResponse: CodexSessionInspectionResponseSchema,
  ClaudeSessionInspectionResponse: ClaudeSessionInspectionResponseSchema,
  MasterFanOutSelector: MasterFanOutSelectorSchema,
  MasterFanOutRequest: MasterFanOutRequestSchema,
  MasterFanOutMatch: MasterFanOutMatchSchema,
  MasterFanOutDelivered: MasterFanOutDeliveredSchema,
  MasterFanOutSkipped: MasterFanOutSkippedSchema,
  MasterFanOutResponse: MasterFanOutResponseSchema,
  OwnershipLock: OwnershipLockSchema,
  HookDecision: HookDecisionSchema,
  EvidenceReceipt: EvidenceReceiptSchema,
  Procedure: ProcedureSchema,
  ProcedureStep: ProcedureStepSchema,
  ProcedureRun: ProcedureRunSchema,
  AutonomyGrant: AutonomyGrantSchema,
  Action: ActionSchema,
  Decision: DecisionSchema
};

export type ContractName = keyof typeof ContractSchemas;

export function getContractSchema(name: string) {
  const schema = ContractSchemas[name as ContractName];
  if (!schema) {
    throw new Error(`Unknown contract schema: ${name}`);
  }
  return schema;
}
