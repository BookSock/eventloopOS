import { z } from "zod";
import { getContractSchema } from "./schemas.js";
import type {
  ActivityResponse,
  AgentRunGetResponse,
  AgentRunUpsertRequest,
  AgentRunUpsertResponse,
  ClaudeSessionInspectionResponse,
  ContextRestoreClaimRequest,
  ContextRestoreFinishRequest,
  ContextRestorePlanRequest,
  ContextRestorePlanResponse,
  ContextRestoreRequestMaybeResponse,
  ContextRestoreRequestResponse,
  ContextsListResponse,
  CodexAutoBindResponse,
  CodexForegroundResolveResponse,
  CodexSessionInspectionResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  CurrentTaskResponse,
  CurrentTaskSetRequest,
  EventGetResponse,
  EventIngestRequest,
  EventIngestResponse,
  FollowsWindowExclusionCreateRequest,
  FollowsWindowExclusionResponse,
  FollowsWindowExclusionsListResponse,
  FollowsWindowsListResponse,
  HealthResponse,
  ManualModeGetResponse,
  ManualModeSetRequest,
  ManualModeSetResponse,
  MasterFanOutRequest,
  MasterFanOutResponse,
  McpPollAllAndRouteRequest,
  McpPollAllAndRouteResponse,
  McpPollAndRouteResponse,
  McpPollRequest,
  McpPollResponse,
  McpPollSourceRequest,
  McpPreviewResponse,
  McpSourceGetResponse,
  McpSourcesListResponse,
  MetricsResponse,
  OnboardingApprovalBatchRequest,
  OnboardingApprovalBatchResponse,
  OnboardingApprovalRequest,
  OnboardingApprovalResponse,
  OnboardingRejectionRequest,
  OnboardingRejectionResponse,
  OnboardingScanResponse,
  PaperTriggerCreateRequest,
  PaperTriggerGetResponse,
  PaperTriggerListResponse,
  PaperTriggerMutationResponse,
  PaperTriggerPatchRequest,
  QueueActionResponse,
  QueueDeferRequest,
  QueueDoneRequest,
  QueueIgnoreRequest,
  QueueLeaseRenewRequest,
  QueueLeaseRenewResponse,
  QueueLeaseRequest,
  QueueLineageResponse,
  QueueListResponse,
  QueueNextResponse,
  QueuePriorityRequest,
  QueuePriorityResponse,
  QueueRecommendedActionRequest,
  QueueRecommendedActionResponse,
  ReadingQueueAutoPromoteRequest,
  ReadingQueueAutoPromoteResponse,
  ReadingQueueListResponse,
  ReadingQueuePromoteRequest,
  ReadingQueuePromoteResponse,
  ReviewPacketGetResponse,
  TaskGetResponse,
  TaskLayoutResponse,
  TaskLayoutUpdateResponse,
  TaskListResponse,
  TaskMessagesListResponse,
  TaskMessagesReconcileAttemptedRequest,
  TaskMessagesReconcileAttemptedResponse,
  TaskSessionBindingRequest,
  TaskSessionBindingResponse,
  TaskSessionFollowupRequest,
  TaskSessionFollowupResponse,
  TaskSessionGetResponse,
  TaskSessionReplacementRequest,
  TaskSessionReplacementResponse,
  TaskSessionsListResponse,
  TaskSessionStartRequest,
  TaskSessionStartResponse,
  TaskWorkspaceSnapshotSaveRequest,
  TaskWorkspaceSnapshotSaveResponse,
  TaskWindowClaimCreateRequest,
  TaskWindowClaimResponse,
  TaskWindowClaimsListResponse,
  WorkspaceSnapshot,
  WorkspaceCaptureResponse,
  WorkspaceRestorePlanRequest,
  WorkspaceRestorePlanResponse,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResponse,
  WorkspaceStatusResponse,
  VoiceCommandRequest,
  VoiceCommandResponse
} from "./schemas.js";

const nonEmpty = z.string().min(1);
const schemaReference = z.union([nonEmpty, z.record(z.unknown())]);

export const PrimitiveHttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type PrimitiveHttpMethod = z.infer<typeof PrimitiveHttpMethodSchema>;

export const PrimitiveQueryParameterSchema = z
  .object({
    name: nonEmpty,
    in: z.literal("query").optional(),
    required: z.boolean().optional(),
    description: nonEmpty.optional(),
    schema: z.record(z.unknown()).optional()
  })
  .strict();
export type PrimitiveQueryParameter = z.infer<typeof PrimitiveQueryParameterSchema>;

export const PrimitiveHttpRouteSchema = z
  .object({
    method: PrimitiveHttpMethodSchema,
    path: nonEmpty.refine((path) => path.startsWith("/"), "path must start with /"),
    route_file: nonEmpty,
    request_schema: schemaReference.optional(),
    response_schema: schemaReference,
    request_body_required: z.boolean().optional(),
    no_request_body: z.boolean().optional(),
    query_parameters: z.array(PrimitiveQueryParameterSchema).optional(),
    parameters: z.array(PrimitiveQueryParameterSchema).optional()
  })
  .passthrough()
  .superRefine((route, ctx) => {
    if (route.query_parameters !== undefined && route.parameters !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "route must not define both query_parameters and parameters",
        path: ["query_parameters"]
      });
    }
    if (route.no_request_body === true && route.request_schema !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "route must not define request_schema when no_request_body is true",
        path: ["request_schema"]
      });
    }
    if (route.no_request_body === true && route.request_body_required !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "route must not define request_body_required when no_request_body is true",
        path: ["request_body_required"]
      });
    }
    if (["POST", "PUT", "PATCH"].includes(route.method) && route.request_schema === undefined && route.no_request_body !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mutating route must define request_schema or no_request_body",
        path: ["request_schema"]
      });
    }
  });
export type PrimitiveHttpRoute = z.infer<typeof PrimitiveHttpRouteSchema>;

export const PrimitiveLatencyBudgetSchema = z
  .object({
    name: nonEmpty,
    p95_ms: z.number().positive(),
    proof: nonEmpty,
    scope: nonEmpty.optional(),
    route: nonEmpty.optional(),
    hotkey: nonEmpty.optional()
  })
  .strict();
export type PrimitiveLatencyBudget = z.infer<typeof PrimitiveLatencyBudgetSchema>;

export const PrimitiveDefinitionSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty,
    status: nonEmpty,
    summary: nonEmpty,
    http: z.array(PrimitiveHttpRouteSchema).optional(),
    cli: z.array(nonEmpty).optional(),
    code: z.array(nonEmpty),
    proofs: z.array(nonEmpty),
    self_tests: z.array(nonEmpty).optional(),
    latency_budgets: z.array(PrimitiveLatencyBudgetSchema).optional(),
    responsiveness_critical: z.boolean().optional()
  })
  .passthrough();
export type PrimitiveDefinition = z.infer<typeof PrimitiveDefinitionSchema>;

export const PrimitiveCatalogSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: nonEmpty.optional(),
    license: nonEmpty.optional(),
    status_labels: z.array(nonEmpty).optional(),
    schemas: z.record(z.record(z.unknown())),
    primitives: z.array(PrimitiveDefinitionSchema).min(1)
  })
  .passthrough();
export type PrimitiveCatalog = z.infer<typeof PrimitiveCatalogSchema>;

export type PrimitiveCatalogSummary = {
  primitiveCount: number;
  routeCount: number;
  responseSchemaCount: number;
  requestSchemaCount: number;
  noRequestBodyCount: number;
  schemaCount: number;
  latencyBudgetCount: number;
  responsivenessCriticalCount: number;
  statusCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  primitives: PrimitiveCapabilitySummary[];
};

export type PrimitiveCapabilitySummary = {
  id: string;
  title: string;
  status: string;
  category: string;
  summary: string;
  routeCount: number;
  cliCommandCount: number;
  selfTestCount: number;
  proofRefCount: number;
  latencyBudgetCount: number;
  responsivenessCritical: boolean;
  responseSchemaRouteCount: number;
  requestSchemaRouteCount: number;
  noRequestBodyRouteCount: number;
};

export type PrimitiveCapabilityFilter = {
  ids?: string[];
  statuses?: string[];
  categories?: string[];
  minRouteCount?: number;
  requireCli?: boolean;
  requireSelfTests?: boolean;
  requireProofs?: boolean;
  requireLatencyBudgets?: boolean;
  requireResponsivenessCritical?: boolean;
};

export type PrimitiveSelfTestCatalog = {
  primitives?: Array<{
    id?: unknown;
    self_tests?: unknown;
  }>;
};

export type PrimitiveSelfTestCommand = {
  command: string;
  primitiveIds: string[];
};

export type PrimitiveSelfTestSelection = {
  selectedPrimitiveIds: string[];
  missingPrimitiveIds: string[];
  commands: PrimitiveSelfTestCommand[];
};

export type PrimitiveLatencyBudgetSummary = {
  primitiveId: string;
  primitiveTitle: string;
  primitiveStatus: string;
  primitiveCategory: string;
  primitiveSummary: string;
  name: string;
  p95Ms: number;
  proof: string;
  scope?: string;
  route?: string;
  hotkey?: string;
};

export type PrimitiveProofPlan = {
  selectedPrimitiveIds: string[];
  missingPrimitiveIds: string[];
  primitives: PrimitiveCapabilitySummary[];
  selfTestCommands: PrimitiveSelfTestCommand[];
  latencyBudgets: PrimitiveLatencyBudgetSummary[];
};

export type PrimitiveOperationRoute = {
  operation: string;
  primitiveId: string;
  primitiveTitle: string;
  primitiveStatus: string;
  primitiveCategory: string;
  primitiveSummary: string;
  route: PrimitiveHttpRoute;
};

export type PrimitiveApiIndexRoute = {
  method: PrimitiveHttpMethod;
  path: string;
  operation: string;
  requestSchema?: string;
  responseSchema: string;
  requestBody: boolean;
  queryParameters: string[];
  routeFile: string;
  latencyBudgets: PrimitiveLatencyBudgetSummary[];
};

export type PrimitiveApiIndexEntry = PrimitiveCapabilitySummary & {
  code: string[];
  proofs: string[];
  cli: string[];
  selfTests: string[];
  routes: PrimitiveApiIndexRoute[];
  latencyBudgets: PrimitiveLatencyBudgetSummary[];
};

export type PrimitiveApiIndex = {
  schemaVersion: 1;
  primitiveCount: number;
  routeCount: number;
  generatedFrom: string;
  license?: string;
  statusLabels: string[];
  schemaNames: string[];
  primitives: PrimitiveApiIndexEntry[];
};

export type PrimitiveRequestBuildInput = {
  catalog: PrimitiveCatalog;
  method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>;
  path: string;
  baseUrl?: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean | null | undefined>;
  strictQuery?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
};

export type PrimitiveOperationRequestBuildInput =
  & Omit<PrimitiveRequestBuildInput, "method" | "path">
  & {
    operation: string;
  };

export type PrimitiveRequest = {
  method: PrimitiveHttpMethod;
  path: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  route: PrimitiveHttpRoute;
};

export type PrimitiveHttpClient = {
  request<T = unknown>(
    method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>,
    path: string,
    input?: PrimitiveHttpClientRequestOptions
  ): Promise<T>;
};

export type PrimitiveQueueListOptions = {
  state?: "ready" | "leased" | "deferred" | "done" | "dead";
};

export type PrimitiveQueueLineageOptions = {
  limit?: number;
};

export type PrimitiveFollowsWindowsListOptions = {
  ttl_ms?: number;
  min_workspace_count?: number;
};

export type PrimitiveOperationsClient = {
  master: {
    fanOut(body: MasterFanOutRequest): Promise<MasterFanOutResponse>;
  };
  manualMode: {
    get(): Promise<ManualModeGetResponse>;
    set(body: ManualModeSetRequest): Promise<ManualModeSetResponse>;
  };
  tasks: {
    create(body: CreateTaskRequest): Promise<CreateTaskResponse>;
    list(): Promise<TaskListResponse>;
    get(id: string): Promise<TaskGetResponse>;
    getLayout(id: string): Promise<TaskLayoutResponse>;
    updateLayout(id: string, snapshot: WorkspaceSnapshot): Promise<TaskLayoutUpdateResponse>;
    saveWorkspaceSnapshot(id: string, body: TaskWorkspaceSnapshotSaveRequest): Promise<TaskWorkspaceSnapshotSaveResponse>;
    current(): Promise<CurrentTaskResponse>;
    setCurrent(body: CurrentTaskSetRequest): Promise<CurrentTaskResponse>;
  };
  queue: {
    ingestEvent(body: EventIngestRequest): Promise<EventIngestResponse>;
    getEvent(id: string): Promise<EventGetResponse>;
    getReviewPacket(id: string): Promise<ReviewPacketGetResponse>;
    list(options?: PrimitiveQueueListOptions): Promise<QueueListResponse>;
    next(): Promise<QueueNextResponse>;
    leaseNext(body?: QueueLeaseRequest): Promise<QueueNextResponse>;
    renewLease(id: string, body: QueueLeaseRenewRequest): Promise<QueueLeaseRenewResponse>;
    done(id: string, body?: Omit<QueueDoneRequest, "action">): Promise<QueueActionResponse>;
    defer(id: string, body: Omit<QueueDeferRequest, "action">): Promise<QueueActionResponse>;
    ignore(id: string, body?: Omit<QueueIgnoreRequest, "action">): Promise<QueueActionResponse>;
    recommendedAction(id: string, body?: QueueRecommendedActionRequest): Promise<QueueRecommendedActionResponse>;
    lineage(id: string, options?: PrimitiveQueueLineageOptions): Promise<QueueLineageResponse>;
    priority(id: string, body: QueuePriorityRequest): Promise<QueuePriorityResponse>;
  };
  taskWindowClaims: {
    create(body: TaskWindowClaimCreateRequest): Promise<TaskWindowClaimResponse>;
    list(): Promise<TaskWindowClaimsListResponse>;
  };
  taskSessions: {
    list(): Promise<TaskSessionsListResponse>;
    start(body: TaskSessionStartRequest): Promise<TaskSessionStartResponse>;
    get(id: string): Promise<TaskSessionGetResponse>;
    followup(id: string, body: TaskSessionFollowupRequest): Promise<TaskSessionFollowupResponse>;
    replacement(id: string, body: TaskSessionReplacementRequest): Promise<TaskSessionReplacementResponse>;
    bindTask(id: string, body: TaskSessionBindingRequest): Promise<TaskSessionBindingResponse>;
    listMessages(): Promise<TaskMessagesListResponse>;
    reconcileAttempted(body: TaskMessagesReconcileAttemptedRequest): Promise<TaskMessagesReconcileAttemptedResponse>;
  };
  agents: {
    codex: {
      autoBind(): Promise<CodexAutoBindResponse>;
      resolveForeground(): Promise<CodexForegroundResolveResponse>;
      inspect(id: string): Promise<CodexSessionInspectionResponse>;
    };
    claude: {
      inspect(id: string): Promise<ClaudeSessionInspectionResponse>;
    };
  };
  readingQueue: {
    list(): Promise<ReadingQueueListResponse>;
    promote(body: ReadingQueuePromoteRequest): Promise<ReadingQueuePromoteResponse>;
    autoPromote(body: ReadingQueueAutoPromoteRequest): Promise<ReadingQueueAutoPromoteResponse>;
  };
  onboarding: {
    scan(): Promise<OnboardingScanResponse>;
    approve(body: OnboardingApprovalRequest): Promise<OnboardingApprovalResponse>;
    approveBatch(body: OnboardingApprovalBatchRequest): Promise<OnboardingApprovalBatchResponse>;
    reject(body: OnboardingRejectionRequest): Promise<OnboardingRejectionResponse>;
  };
  contexts: {
    list(): Promise<ContextsListResponse>;
    restorePlan(body: ContextRestorePlanRequest): Promise<ContextRestorePlanResponse>;
    createRestoreRequest(body: ContextRestorePlanRequest): Promise<ContextRestoreRequestResponse>;
    nextRestoreRequest(): Promise<ContextRestoreRequestMaybeResponse>;
    claimNextRestoreRequest(body: ContextRestoreClaimRequest): Promise<ContextRestoreRequestMaybeResponse>;
    getRestoreRequest(id: string): Promise<ContextRestoreRequestResponse>;
    markRestoreRequestDone(id: string, body: ContextRestoreFinishRequest): Promise<ContextRestoreRequestResponse>;
    markRestoreRequestFailed(id: string, body: ContextRestoreFinishRequest): Promise<ContextRestoreRequestResponse>;
    retryRestoreRequest(id: string): Promise<ContextRestoreRequestResponse>;
  };
  triggers: {
    list(): Promise<PaperTriggerListResponse>;
    create(body: PaperTriggerCreateRequest): Promise<PaperTriggerMutationResponse>;
    get(id: string): Promise<PaperTriggerGetResponse>;
    patch(id: string, body: PaperTriggerPatchRequest): Promise<PaperTriggerMutationResponse>;
    delete(id: string): Promise<PaperTriggerMutationResponse>;
  };
  agentSources: {
    poll(body: McpPollRequest): Promise<McpPollResponse>;
    listMcpSources(): Promise<McpSourcesListResponse>;
    pollAllAndRoute(body: McpPollAllAndRouteRequest): Promise<McpPollAllAndRouteResponse>;
    getMcpSource(id: string): Promise<McpSourceGetResponse>;
    pollMcpSource(id: string, body?: McpPollSourceRequest): Promise<McpPollResponse>;
    previewMcpSource(id: string, body?: McpPollSourceRequest): Promise<McpPreviewResponse>;
    pollAndRouteMcpSource(id: string, body?: McpPollSourceRequest): Promise<McpPollAndRouteResponse>;
    upsertAgentRun(body: AgentRunUpsertRequest): Promise<AgentRunUpsertResponse>;
    getAgentRun(id: string): Promise<AgentRunGetResponse>;
    submitVoiceCommand(body: VoiceCommandRequest): Promise<VoiceCommandResponse>;
  };
  observability: {
    health(): Promise<HealthResponse>;
    metrics(): Promise<MetricsResponse>;
    activity(): Promise<ActivityResponse>;
  };
  followsWindows: {
    list(options?: PrimitiveFollowsWindowsListOptions): Promise<FollowsWindowsListResponse>;
    exclude(body: FollowsWindowExclusionCreateRequest): Promise<FollowsWindowExclusionResponse>;
    listExclusions(): Promise<FollowsWindowExclusionsListResponse>;
    deleteExclusion(id: string): Promise<FollowsWindowExclusionResponse>;
  };
  workspace: {
    status(): Promise<WorkspaceStatusResponse>;
    capture(): Promise<WorkspaceCaptureResponse>;
    restorePlan(body: WorkspaceRestorePlanRequest): Promise<WorkspaceRestorePlanResponse>;
    restore(body: WorkspaceRestoreRequest, idempotencyKey: string): Promise<WorkspaceRestoreResponse>;
  };
};

export type PrimitiveHttpClientRequestRuntimeOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};
export type PrimitiveHttpClientRequestOptions =
  & Omit<PrimitiveRequestBuildInput, "catalog" | "method" | "path" | "baseUrl">
  & PrimitiveHttpClientRequestRuntimeOptions;

export type PrimitiveHttpClientOptions = {
  catalog: PrimitiveCatalog;
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type PrimitiveErrorDetails = {
  route?: PrimitiveHttpRoute;
  method?: PrimitiveHttpMethod;
  path?: string;
  cause?: unknown;
};

export class PrimitiveError extends Error {
  readonly route?: PrimitiveHttpRoute;
  readonly method?: PrimitiveHttpMethod;
  readonly path?: string;
  override readonly cause?: unknown;

  constructor(message: string, details: PrimitiveErrorDetails = {}) {
    super(message);
    this.name = "PrimitiveError";
    this.route = details.route;
    this.method = details.method ?? details.route?.method;
    this.path = details.path ?? details.route?.path;
    this.cause = details.cause;
  }
}

export class PrimitiveHttpError extends PrimitiveError {
  readonly status: number;
  readonly statusText: string;
  readonly code?: string;
  readonly detail?: string;
  readonly payload: unknown;
  readonly responseText: string;

  constructor(
    message: string,
    details: PrimitiveErrorDetails & {
      status: number;
      statusText: string;
      payload: unknown;
      responseText: string;
    }
  ) {
    super(message, details);
    this.name = "PrimitiveHttpError";
    this.status = details.status;
    this.statusText = details.statusText;
    this.payload = details.payload;
    this.responseText = details.responseText;
    this.code = primitiveHttpPayloadCode(details.payload);
    this.detail = primitiveHttpPayloadMessage(details.payload);
  }
}

export type PrimitiveRequestBuildErrorKind =
  | "invalid_method"
  | "unknown_route"
  | "unknown_operation"
  | "missing_path_param"
  | "missing_query_param"
  | "unknown_query_param"
  | "invalid_query_param"
  | "request_body_required"
  | "request_body_forbidden"
  | "request_body_invalid";

export class PrimitiveRequestBuildError extends PrimitiveError {
  readonly kind: PrimitiveRequestBuildErrorKind;
  readonly parameter?: string;

  constructor(
    message: string,
    details: PrimitiveErrorDetails & {
      kind: PrimitiveRequestBuildErrorKind;
      parameter?: string;
    }
  ) {
    super(message, details);
    this.name = "PrimitiveRequestBuildError";
    this.kind = details.kind;
    this.parameter = details.parameter;
  }
}

export class PrimitiveResponseParseError extends PrimitiveError {
  readonly responseText: string;

  constructor(message: string, details: PrimitiveErrorDetails & { responseText: string }) {
    super(message, details);
    this.name = "PrimitiveResponseParseError";
    this.responseText = details.responseText;
  }
}

export class PrimitiveResponseValidationError extends PrimitiveError {
  readonly payload: unknown;

  constructor(message: string, details: PrimitiveErrorDetails & { payload: unknown }) {
    super(message, details);
    this.name = "PrimitiveResponseValidationError";
    this.payload = details.payload;
  }
}

export class PrimitiveTimeoutError extends PrimitiveError {
  readonly timeoutMs: number;

  constructor(message: string, details: PrimitiveErrorDetails & { timeoutMs: number }) {
    super(message, details);
    this.name = "PrimitiveTimeoutError";
    this.timeoutMs = details.timeoutMs;
  }
}

export type PrimitiveHttpErrorMatch = {
  status?: number;
  code?: string;
  path?: string;
  method?: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>;
};

export type PrimitiveRequestBuildErrorMatch = {
  kind?: PrimitiveRequestBuildErrorKind;
  parameter?: string;
  path?: string;
  method?: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>;
};

export type PrimitiveRouteErrorMatch = {
  path?: string;
  method?: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>;
};

export type PrimitiveErrorSummary = {
  name: string;
  message: string;
  method?: PrimitiveHttpMethod;
  path?: string;
  kind?: PrimitiveRequestBuildErrorKind;
  parameter?: string;
  status?: number;
  code?: string;
  detail?: string;
  timeoutMs?: number;
};

export function isPrimitiveHttpError(error: unknown, match: PrimitiveHttpErrorMatch = {}): error is PrimitiveHttpError {
  if (!(error instanceof PrimitiveHttpError)) return false;
  if (match.status !== undefined && error.status !== match.status) return false;
  if (match.code !== undefined && error.code !== match.code) return false;
  if (match.path !== undefined && error.path !== match.path) return false;
  if (match.method !== undefined && error.method !== normalizePrimitiveMethod(match.method)) return false;
  return true;
}

export function isPrimitiveRequestBuildError(
  error: unknown,
  match: PrimitiveRequestBuildErrorMatch = {}
): error is PrimitiveRequestBuildError {
  if (!(error instanceof PrimitiveRequestBuildError)) return false;
  if (match.kind !== undefined && error.kind !== match.kind) return false;
  if (match.parameter !== undefined && error.parameter !== match.parameter) return false;
  if (match.path !== undefined && error.path !== match.path) return false;
  if (match.method !== undefined && error.method !== normalizePrimitiveMethod(match.method)) return false;
  return true;
}

export function isPrimitiveTimeoutError(error: unknown, match: PrimitiveRouteErrorMatch = {}): error is PrimitiveTimeoutError {
  if (!(error instanceof PrimitiveTimeoutError)) return false;
  if (match.path !== undefined && error.path !== match.path) return false;
  if (match.method !== undefined && error.method !== normalizePrimitiveMethod(match.method)) return false;
  return true;
}

export function isPrimitiveResponseParseError(error: unknown, match: PrimitiveRouteErrorMatch = {}): error is PrimitiveResponseParseError {
  if (!(error instanceof PrimitiveResponseParseError)) return false;
  if (match.path !== undefined && error.path !== match.path) return false;
  if (match.method !== undefined && error.method !== normalizePrimitiveMethod(match.method)) return false;
  return true;
}

export function isPrimitiveResponseValidationError(
  error: unknown,
  match: PrimitiveRouteErrorMatch = {}
): error is PrimitiveResponseValidationError {
  if (!(error instanceof PrimitiveResponseValidationError)) return false;
  if (match.path !== undefined && error.path !== match.path) return false;
  if (match.method !== undefined && error.method !== normalizePrimitiveMethod(match.method)) return false;
  return true;
}

export function primitiveErrorSummary(error: unknown): PrimitiveErrorSummary {
  if (error instanceof PrimitiveHttpError) {
    return {
      name: error.name,
      message: error.message,
      method: error.method,
      path: error.path,
      status: error.status,
      code: error.code,
      detail: error.detail
    };
  }
  if (error instanceof PrimitiveError) {
    const summary: PrimitiveErrorSummary = {
      name: error.name,
      message: error.message,
      method: error.method,
      path: error.path
    };
    if (error instanceof PrimitiveRequestBuildError) {
      summary.kind = error.kind;
      summary.parameter = error.parameter;
    }
    if (error instanceof PrimitiveTimeoutError) {
      summary.timeoutMs = error.timeoutMs;
    }
    return summary;
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return {
    name: "UnknownError",
    message: String(error)
  };
}

export function parsePrimitiveCatalog(value: unknown): PrimitiveCatalog {
  return PrimitiveCatalogSchema.parse(value);
}

export function routeHasRequestBody(route: PrimitiveHttpRoute): boolean {
  return ["POST", "PUT", "PATCH"].includes(route.method) && route.no_request_body !== true;
}

export function primitiveRoutes(catalog: PrimitiveCatalog): PrimitiveHttpRoute[] {
  return catalog.primitives.flatMap((primitive) => primitive.http ?? []);
}

export function getPrimitive(catalog: PrimitiveCatalog, id: string): PrimitiveDefinition | undefined {
  return catalog.primitives.find((primitive) => primitive.id === id);
}

export function getPrimitiveRoute(
  catalog: PrimitiveCatalog,
  method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>,
  path: string
): PrimitiveHttpRoute | undefined {
  const normalizedMethod = method.toUpperCase() as PrimitiveHttpMethod;
  return primitiveRoutes(catalog).find((route) => route.method === normalizedMethod && route.path === path);
}

export function primitiveOperationId(primitiveId: string, method: string, routePath: string): string {
  const routeName = routePath
    .replace(/^\/+/, "")
    .replace(/:([A-Za-z0-9_]+)/g, "by_$1")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return [primitiveId, method.toLowerCase(), routeName].filter(Boolean).join("_");
}

export function getPrimitiveOperation(catalog: PrimitiveCatalog, operation: string): PrimitiveOperationRoute | undefined {
  for (const primitive of catalog.primitives) {
    const category = classifyPrimitiveCapability(primitive, primitive.http ?? []);
    for (const route of primitive.http ?? []) {
      const routeOperation = primitiveOperationId(primitive.id, route.method, route.path);
      if (routeOperation !== operation) continue;
      return {
        operation: routeOperation,
        primitiveId: primitive.id,
        primitiveTitle: primitive.title,
        primitiveStatus: primitive.status,
        primitiveCategory: category,
        primitiveSummary: primitive.summary,
        route
      };
    }
  }
  return undefined;
}

export function buildPrimitiveRequest(input: PrimitiveRequestBuildInput): PrimitiveRequest {
  let method: PrimitiveHttpMethod;
  try {
    method = normalizePrimitiveMethod(input.method);
  } catch (error) {
    throw new PrimitiveRequestBuildError(`Invalid primitive HTTP method: ${String(input.method)}`, {
      kind: "invalid_method",
      cause: error
    });
  }
  const route = getPrimitiveRoute(input.catalog, method, input.path);
  if (!route) {
    throw new PrimitiveRequestBuildError(`Unknown primitive route: ${method} ${input.path}`, {
      kind: "unknown_route",
      method,
      path: input.path
    });
  }

  const path = interpolatePrimitivePath(route, input.pathParams ?? {});
  const query = encodePrimitiveQuery(route, input.query ?? {}, input.strictQuery === true);
  const baseUrl = input.baseUrl ?? "http://127.0.0.1:4377";
  const url = new URL(path, baseUrl);
  url.search = query;

  const headers = { ...(input.headers ?? {}) };
  const request: PrimitiveRequest = {
    method,
    path,
    url: url.toString(),
    headers,
    route
  };

  if (routeHasRequestBody(route)) {
    if (input.body === undefined) {
      if (route.request_body_required === false) return request;
      throw new PrimitiveRequestBuildError(`Primitive route requires request body: ${method} ${route.path}`, {
        kind: "request_body_required",
        route,
        method,
        path: route.path
      });
    }
    let parsedBody: unknown;
    try {
      parsedBody = validatePrimitiveRequestBody(route, input.body);
    } catch (error) {
      throw new PrimitiveRequestBuildError(`Primitive request body failed schema validation: ${method} ${route.path}`, {
        kind: "request_body_invalid",
        route,
        method,
        path: route.path,
        cause: error
      });
    }
    request.headers = {
      "content-type": "application/json",
      ...headers
    };
    request.body = JSON.stringify(parsedBody);
    return request;
  }

  if (input.body !== undefined) {
    throw new PrimitiveRequestBuildError(`Primitive route does not accept request body: ${method} ${route.path}`, {
      kind: "request_body_forbidden",
      route,
      method,
      path: route.path
    });
  }
  return request;
}

export function buildPrimitiveOperationRequest(input: PrimitiveOperationRequestBuildInput): PrimitiveRequest {
  const operation = getPrimitiveOperation(input.catalog, input.operation);
  if (!operation) {
    throw new PrimitiveRequestBuildError(`Unknown primitive operation: ${input.operation}`, {
      kind: "unknown_operation",
      parameter: input.operation
    });
  }
  return buildPrimitiveRequest({
    ...input,
    method: operation.route.method,
    path: operation.route.path
  });
}

export function validatePrimitiveRequestBody<T = unknown>(route: PrimitiveHttpRoute, body: unknown): T {
  if (!route.request_schema) {
    throw new Error(`Primitive route has no request schema: ${route.method} ${route.path}`);
  }
  return parseWithSchemaReference<T>(route.request_schema, body, "request", route);
}

export function validatePrimitiveResponse<T = unknown>(route: PrimitiveHttpRoute, body: unknown): T {
  return parseWithSchemaReference<T>(route.response_schema, body, "response", route);
}

export function createPrimitiveHttpClient(options: PrimitiveHttpClientOptions): PrimitiveHttpClient {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async request<T = unknown>(
      method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>,
      path: string,
      input: PrimitiveHttpClientRequestOptions = {}
    ) {
      const request = buildPrimitiveRequest({
        ...input,
        catalog: options.catalog,
        method,
        path,
        baseUrl: options.baseUrl,
        headers: {
          ...(options.headers ?? {}),
          ...(input.headers ?? {})
        }
      });
      const abortSignal = primitiveAbortSignal({
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? options.timeoutMs,
        request
      });
      let response: Response;
      try {
        response = await fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: abortSignal.signal
        });
      } catch (error) {
        if (abortSignal.timedOut()) {
          if (error instanceof PrimitiveTimeoutError) throw error;
          throw new PrimitiveTimeoutError(
            `Primitive route timed out after ${abortSignal.timeoutMs}ms: ${request.method} ${request.path}`,
            {
              route: request.route,
              method: request.method,
              path: request.path,
              timeoutMs: abortSignal.timeoutMs ?? 0,
              cause: error
            }
          );
        }
        throw error;
      } finally {
        abortSignal.cleanup();
      }
      const text = await response.text();
      const payload = parsePrimitiveResponsePayload(request, text);
      if (!response.ok) {
        throw new PrimitiveHttpError(
          `Primitive route failed: ${request.method} ${request.path} HTTP ${response.status}`,
          {
            route: request.route,
            method: request.method,
            path: request.path,
            status: response.status,
            statusText: response.statusText,
            payload,
            responseText: text
          }
        );
      }
      try {
        return validatePrimitiveResponse<T>(request.route, payload);
      } catch (error) {
        throw new PrimitiveResponseValidationError(
          `Primitive response failed schema validation: ${request.method} ${request.path}`,
          {
            route: request.route,
            method: request.method,
            path: request.path,
            payload,
            cause: error
          }
        );
      }
    }
  };
}

function primitiveAbortSignal(input: {
  signal?: AbortSignal;
  timeoutMs?: number;
  request: PrimitiveRequest;
}): {
  signal?: AbortSignal;
  timeoutMs?: number;
  timedOut(): boolean;
  cleanup(): void;
} {
  const timeoutMs = normalizePrimitiveTimeoutMs(input.timeoutMs);
  if (timeoutMs === undefined && input.signal === undefined) {
    return {
      timedOut: () => false,
      cleanup: () => {}
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  if (input.signal) {
    onAbort = () => controller.abort(input.signal?.reason);
    if (input.signal.aborted) {
      onAbort();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new PrimitiveTimeoutError(`Primitive route timed out after ${timeoutMs}ms: ${input.request.method} ${input.request.path}`, {
          route: input.request.route,
          method: input.request.method,
          path: input.request.path,
          timeoutMs
        })
      );
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    timeoutMs,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      if (input.signal && onAbort) input.signal.removeEventListener("abort", onAbort);
    }
  };
}

function normalizePrimitiveTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
  return Math.trunc(timeoutMs);
}

export function createPrimitiveOperationsClient(options: PrimitiveHttpClientOptions): PrimitiveOperationsClient {
  return bindPrimitiveOperationsClient(createPrimitiveHttpClient(options));
}

export function bindPrimitiveOperationsClient(client: PrimitiveHttpClient): PrimitiveOperationsClient {
  return {
    master: {
      fanOut(body: MasterFanOutRequest) {
        return client.request("POST", "/master/fan-out", { body });
      }
    },
    manualMode: {
      get() {
        return client.request("GET", "/modes/manual");
      },
      set(body: ManualModeSetRequest) {
        return client.request("POST", "/modes/manual", { body });
      }
    },
    tasks: {
      create(body: CreateTaskRequest) {
        return client.request("POST", "/tasks", { body });
      },
      list() {
        return client.request("GET", "/tasks");
      },
      get(id: string) {
        return client.request("GET", "/tasks/:id", { pathParams: { id } });
      },
      getLayout(id: string) {
        return client.request("GET", "/tasks/:id/layout", { pathParams: { id } });
      },
      updateLayout(id: string, snapshot: WorkspaceSnapshot) {
        return client.request("PUT", "/tasks/:id/layout", { pathParams: { id }, body: snapshot });
      },
      saveWorkspaceSnapshot(id: string, body: TaskWorkspaceSnapshotSaveRequest) {
        return client.request("POST", "/tasks/:id/workspace-snapshot", { pathParams: { id }, body });
      },
      current() {
        return client.request("GET", "/tasks/current");
      },
      setCurrent(body: CurrentTaskSetRequest) {
        return client.request("POST", "/tasks/current", { body });
      }
    },
    queue: {
      ingestEvent(body: EventIngestRequest) {
        return client.request("POST", "/events", { body });
      },
      getEvent(id: string) {
        return client.request("GET", "/events/:id", { pathParams: { id } });
      },
      getReviewPacket(id: string) {
        return client.request("GET", "/review-packets/:id", { pathParams: { id } });
      },
      list(options: PrimitiveQueueListOptions = {}) {
        return client.request("GET", "/queue", { query: options });
      },
      next() {
        return client.request("GET", "/queue/next");
      },
      leaseNext(body: QueueLeaseRequest = {}) {
        return client.request("POST", "/queue/lease-next", { body });
      },
      renewLease(id: string, body: QueueLeaseRenewRequest) {
        return client.request("POST", "/queue/:id/lease/renew", { pathParams: { id }, body });
      },
      done(id: string, body: Omit<QueueDoneRequest, "action"> = {}) {
        return client.request("POST", "/queue/:id/done", { pathParams: { id }, body: { ...body, action: "done" } });
      },
      defer(id: string, body: Omit<QueueDeferRequest, "action">) {
        return client.request("POST", "/queue/:id/defer", { pathParams: { id }, body: { ...body, action: "defer" } });
      },
      ignore(id: string, body: Omit<QueueIgnoreRequest, "action"> = {}) {
        return client.request("POST", "/queue/:id/ignore", { pathParams: { id }, body: { ...body, action: "ignore" } });
      },
      recommendedAction(id: string, body: QueueRecommendedActionRequest = {}) {
        return client.request("POST", "/queue/:id/actions/recommended", { pathParams: { id }, body });
      },
      lineage(id: string, options: PrimitiveQueueLineageOptions = {}) {
        return client.request("GET", "/queue/:id/lineage", { pathParams: { id }, query: options });
      },
      priority(id: string, body: QueuePriorityRequest) {
        return client.request("POST", "/queue/:id/priority", { pathParams: { id }, body });
      }
    },
    taskWindowClaims: {
      create(body: TaskWindowClaimCreateRequest) {
        return client.request("POST", "/task-window-claims", { body });
      },
      list() {
        return client.request("GET", "/task-window-claims");
      }
    },
    taskSessions: {
      list() {
        return client.request("GET", "/task-sessions");
      },
      start(body: TaskSessionStartRequest) {
        return client.request("POST", "/task-sessions", { body });
      },
      get(id: string) {
        return client.request("GET", "/task-sessions/:id", { pathParams: { id } });
      },
      followup(id: string, body: TaskSessionFollowupRequest) {
        return client.request("POST", "/task-sessions/:id/followup", { pathParams: { id }, body });
      },
      replacement(id: string, body: TaskSessionReplacementRequest) {
        return client.request("POST", "/task-sessions/:id/replacement", { pathParams: { id }, body });
      },
      bindTask(id: string, body: TaskSessionBindingRequest) {
        return client.request("PUT", "/task-sessions/:id/task-binding", { pathParams: { id }, body });
      },
      listMessages() {
        return client.request("GET", "/task-messages");
      },
      reconcileAttempted(body: TaskMessagesReconcileAttemptedRequest) {
        return client.request("POST", "/task-messages/reconcile-attempted", { body });
      }
    },
    agents: {
      codex: {
        autoBind() {
          return client.request("POST", "/agents/codex/auto-bind");
        },
        resolveForeground() {
          return client.request("POST", "/agents/codex/resolve-foreground");
        },
        inspect(id: string) {
          return client.request("GET", "/agents/codex/inspect/:id", { pathParams: { id } });
        }
      },
      claude: {
        inspect(id: string) {
          return client.request("GET", "/agents/claude/inspect/:id", { pathParams: { id } });
        }
      }
    },
    readingQueue: {
      list() {
        return client.request("GET", "/reading-queue");
      },
      promote(body: ReadingQueuePromoteRequest) {
        return client.request("POST", "/reading-queue/promote", { body });
      },
      autoPromote(body: ReadingQueueAutoPromoteRequest) {
        return client.request("POST", "/reading-queue/auto-promote", { body });
      }
    },
    onboarding: {
      scan() {
        return client.request("GET", "/onboarding/scan");
      },
      approve(body: OnboardingApprovalRequest) {
        return client.request("POST", "/onboarding/approvals", { body });
      },
      approveBatch(body: OnboardingApprovalBatchRequest) {
        return client.request("POST", "/onboarding/approvals/batch", { body });
      },
      reject(body: OnboardingRejectionRequest) {
        return client.request("POST", "/onboarding/rejections", { body });
      }
    },
    contexts: {
      list() {
        return client.request("GET", "/contexts");
      },
      restorePlan(body: ContextRestorePlanRequest) {
        return client.request("POST", "/contexts/restore-plan", { body });
      },
      createRestoreRequest(body: ContextRestorePlanRequest) {
        return client.request("POST", "/contexts/restore-requests", { body });
      },
      nextRestoreRequest() {
        return client.request("GET", "/contexts/restore-requests/next");
      },
      claimNextRestoreRequest(body: ContextRestoreClaimRequest) {
        return client.request("POST", "/contexts/restore-requests/claim-next", { body });
      },
      getRestoreRequest(id: string) {
        return client.request("GET", "/contexts/restore-requests/:id", { pathParams: { id } });
      },
      markRestoreRequestDone(id: string, body: ContextRestoreFinishRequest) {
        return client.request("POST", "/contexts/restore-requests/:id/done", { pathParams: { id }, body });
      },
      markRestoreRequestFailed(id: string, body: ContextRestoreFinishRequest) {
        return client.request("POST", "/contexts/restore-requests/:id/failed", { pathParams: { id }, body });
      },
      retryRestoreRequest(id: string) {
        return client.request("POST", "/contexts/restore-requests/:id/retry", { pathParams: { id } });
      }
    },
    triggers: {
      list() {
        return client.request("GET", "/triggers");
      },
      create(body: PaperTriggerCreateRequest) {
        return client.request("POST", "/triggers", { body });
      },
      get(id: string) {
        return client.request("GET", "/triggers/:id", { pathParams: { id } });
      },
      patch(id: string, body: PaperTriggerPatchRequest) {
        return client.request("PATCH", "/triggers/:id", { pathParams: { id }, body });
      },
      delete(id: string) {
        return client.request("DELETE", "/triggers/:id", { pathParams: { id } });
      }
    },
    agentSources: {
      poll(body: McpPollRequest) {
        return client.request("POST", "/mcp/poll", { body });
      },
      listMcpSources() {
        return client.request("GET", "/mcp-sources");
      },
      pollAllAndRoute(body: McpPollAllAndRouteRequest) {
        return client.request("POST", "/mcp-sources/poll-all-and-route", { body });
      },
      getMcpSource(id: string) {
        return client.request("GET", "/mcp-sources/:id", { pathParams: { id } });
      },
      pollMcpSource(id: string, body: McpPollSourceRequest = {}) {
        return client.request("POST", "/mcp-sources/:id/poll", { pathParams: { id }, body });
      },
      previewMcpSource(id: string, body: McpPollSourceRequest = {}) {
        return client.request("POST", "/mcp-sources/:id/preview", { pathParams: { id }, body });
      },
      pollAndRouteMcpSource(id: string, body: McpPollSourceRequest = {}) {
        return client.request("POST", "/mcp-sources/:id/poll-and-route", { pathParams: { id }, body });
      },
      upsertAgentRun(body: AgentRunUpsertRequest) {
        return client.request("POST", "/agent-runs", { body });
      },
      getAgentRun(id: string) {
        return client.request("GET", "/agent-runs/:id", { pathParams: { id } });
      },
      submitVoiceCommand(body: VoiceCommandRequest) {
        return client.request("POST", "/voice/commands", { body });
      }
    },
    observability: {
      health() {
        return client.request("GET", "/health");
      },
      metrics() {
        return client.request("GET", "/metrics");
      },
      activity() {
        return client.request("GET", "/activity");
      }
    },
    followsWindows: {
      list(options: PrimitiveFollowsWindowsListOptions = {}) {
        return client.request("GET", "/follows-windows", { query: options });
      },
      exclude(body: FollowsWindowExclusionCreateRequest) {
        return client.request("POST", "/follows-windows/exclude", { body });
      },
      listExclusions() {
        return client.request("GET", "/follows-windows/exclusions");
      },
      deleteExclusion(id: string) {
        return client.request("DELETE", "/follows-windows/exclusions/:id", { pathParams: { id } });
      }
    },
    workspace: {
      status() {
        return client.request("GET", "/workspace/status");
      },
      capture() {
        return client.request("POST", "/workspace/capture", { body: {} });
      },
      restorePlan(body: WorkspaceRestorePlanRequest) {
        return client.request("POST", "/workspace/restore-plan", { body });
      },
      restore(body: WorkspaceRestoreRequest, idempotencyKey: string) {
        return client.request("POST", "/workspace/restore", {
          body,
          headers: { "Idempotency-Key": idempotencyKey }
        });
      }
    }
  };
}

export function summarizePrimitiveCatalog(catalog: PrimitiveCatalog): PrimitiveCatalogSummary {
  const routes = primitiveRoutes(catalog);
  const primitives = catalog.primitives.map(summarizePrimitiveCapability);
  return {
    primitiveCount: catalog.primitives.length,
    routeCount: routes.length,
    responseSchemaCount: routes.filter((route) => route.response_schema).length,
    requestSchemaCount: routes.filter((route) => route.request_schema).length,
    noRequestBodyCount: routes.filter((route) => route.no_request_body === true).length,
    schemaCount: Object.keys(catalog.schemas).length,
    latencyBudgetCount: sumBy(primitives, (primitive) => primitive.latencyBudgetCount),
    responsivenessCriticalCount: primitives.filter((primitive) => primitive.responsivenessCritical).length,
    statusCounts: countBy(primitives, (primitive) => primitive.status),
    categoryCounts: countBy(primitives, (primitive) => primitive.category),
    primitives
  };
}

export function selectPrimitiveCapabilities(
  catalog: PrimitiveCatalog,
  filter: PrimitiveCapabilityFilter = {}
): PrimitiveCapabilitySummary[] {
  const idSet = filter.ids ? new Set(filter.ids) : undefined;
  const statusSet = filter.statuses ? new Set(filter.statuses) : undefined;
  const categorySet = filter.categories ? new Set(filter.categories) : undefined;
  const minRouteCount = filter.minRouteCount ?? 0;
  return summarizePrimitiveCatalog(catalog).primitives.filter((primitive) => {
    if (idSet && !idSet.has(primitive.id)) return false;
    if (statusSet && !statusSet.has(primitive.status)) return false;
    if (categorySet && !categorySet.has(primitive.category)) return false;
    if (primitive.routeCount < minRouteCount) return false;
    if (filter.requireCli === true && primitive.cliCommandCount === 0) return false;
    if (filter.requireSelfTests === true && primitive.selfTestCount === 0) return false;
    if (filter.requireProofs === true && primitive.proofRefCount === 0) return false;
    if (filter.requireLatencyBudgets === true && primitive.latencyBudgetCount === 0) return false;
    if (filter.requireResponsivenessCritical === true && primitive.responsivenessCritical !== true) return false;
    return true;
  });
}

export function selectPrimitiveSelfTestCommands(
  catalog: PrimitiveSelfTestCatalog,
  primitiveIds: string[] = []
): PrimitiveSelfTestSelection {
  const primitives = Array.isArray(catalog.primitives) ? catalog.primitives : [];
  const catalogIds = new Set(primitives.map((primitive) => readPrimitiveString(primitive.id)).filter(isNonEmptyString));
  const requested = Array.from(new Set(primitiveIds.filter(isNonEmptyString)));
  const missingPrimitiveIds = requested.filter((id) => !catalogIds.has(id));
  const selectedPrimitiveIds = requested.length > 0
    ? requested.filter((id) => catalogIds.has(id))
    : Array.from(catalogIds).sort();
  const selectedSet = new Set(selectedPrimitiveIds);
  const grouped = new Map<string, Set<string>>();

  for (const primitive of primitives) {
    const primitiveId = readPrimitiveString(primitive.id);
    if (!primitiveId || !selectedSet.has(primitiveId)) continue;
    const selfTests = Array.isArray(primitive.self_tests) ? primitive.self_tests : [];
    for (const rawCommand of selfTests) {
      const command = readPrimitiveString(rawCommand);
      if (!command) continue;
      if (!grouped.has(command)) grouped.set(command, new Set());
      grouped.get(command)?.add(primitiveId);
    }
  }

  return {
    selectedPrimitiveIds,
    missingPrimitiveIds,
    commands: Array.from(grouped.entries())
      .map(([command, primitiveIdSet]) => ({
        command,
        primitiveIds: Array.from(primitiveIdSet).sort()
      }))
      .sort((left, right) => left.command.localeCompare(right.command))
  };
}

export function selectPrimitiveLatencyBudgets(
  catalog: PrimitiveCatalog,
  filter: PrimitiveCapabilityFilter = {}
): PrimitiveLatencyBudgetSummary[] {
  const capabilities = summarizePrimitiveCatalog(catalog).primitives;
  const selectedIds = new Set(selectPrimitiveCapabilities(catalog, filter).map((primitive) => primitive.id));
  const capabilityById = new Map(capabilities.map((primitive) => [primitive.id, primitive]));
  const budgets: PrimitiveLatencyBudgetSummary[] = [];
  for (const primitive of catalog.primitives) {
    if (!selectedIds.has(primitive.id)) continue;
    const capability = capabilityById.get(primitive.id);
    for (const budget of primitive.latency_budgets ?? []) {
      budgets.push({
        primitiveId: primitive.id,
        primitiveTitle: primitive.title,
        primitiveStatus: primitive.status,
        primitiveCategory: capability?.category ?? classifyPrimitiveCapability(primitive, primitive.http ?? []),
        primitiveSummary: primitive.summary,
        name: budget.name,
        p95Ms: budget.p95_ms,
        proof: budget.proof,
        scope: budget.scope,
        route: budget.route,
        hotkey: budget.hotkey
      });
    }
  }
  return budgets;
}

export function buildPrimitiveProofPlan(catalog: PrimitiveCatalog, filter: PrimitiveCapabilityFilter = {}): PrimitiveProofPlan {
  const knownIds = new Set(catalog.primitives.map((primitive) => primitive.id));
  const requestedIds = Array.from(new Set((filter.ids ?? []).filter(isNonEmptyString)));
  const missingPrimitiveIds = requestedIds.filter((id) => !knownIds.has(id));
  const primitives = selectPrimitiveCapabilities(catalog, filter);
  const selectedPrimitiveIds = primitives.map((primitive) => primitive.id);
  const selfTestSelection = selectPrimitiveSelfTestCommands(catalog, [
    ...selectedPrimitiveIds,
    ...missingPrimitiveIds
  ]);
  return {
    selectedPrimitiveIds,
    missingPrimitiveIds: selfTestSelection.missingPrimitiveIds,
    primitives,
    selfTestCommands: selfTestSelection.commands,
    latencyBudgets: selectPrimitiveLatencyBudgets(catalog, {
      ...filter,
      ids: selectedPrimitiveIds
    })
  };
}

export function buildPrimitiveApiIndex(catalog: PrimitiveCatalog): PrimitiveApiIndex {
  const summary = summarizePrimitiveCatalog(catalog);
  const capabilityById = new Map(summary.primitives.map((primitive) => [primitive.id, primitive]));
  return {
    schemaVersion: 1,
    primitiveCount: summary.primitiveCount,
    routeCount: summary.routeCount,
    generatedFrom: "docs/primitives.catalog.json",
    license: catalog.license,
    statusLabels: [...(catalog.status_labels ?? [])].sort((left, right) => left.localeCompare(right)),
    schemaNames: Object.keys(catalog.schemas).sort((left, right) => left.localeCompare(right)),
    primitives: catalog.primitives.map((primitive) => {
      const capability = capabilityById.get(primitive.id) ?? summarizePrimitiveCapability(primitive);
      const latencyBudgets = selectPrimitiveLatencyBudgets(catalog, { ids: [primitive.id] });
      return {
        ...capability,
        code: sortedStrings(primitive.code),
        proofs: sortedStrings(primitive.proofs),
        cli: sortedStrings(primitive.cli ?? []),
        selfTests: sortedStrings(primitive.self_tests ?? []),
        latencyBudgets,
        routes: (primitive.http ?? []).map((route) => {
          const routeName = `${route.method} ${route.path}`;
          return {
            method: route.method,
            path: route.path,
            operation: primitiveOperationId(primitive.id, route.method, route.path),
            requestSchema: schemaReferenceName(route.request_schema),
            responseSchema: schemaReferenceName(route.response_schema) ?? "FreeformJsonObject",
            requestBody: routeHasRequestBody(route),
            queryParameters: (route.query_parameters ?? route.parameters ?? []).map((parameter) => parameter.name).sort(),
            routeFile: route.route_file,
            latencyBudgets: latencyBudgets.filter((budget) => budget.route === routeName)
          };
        })
      };
    })
  };
}

function summarizePrimitiveCapability(primitive: PrimitiveDefinition): PrimitiveCapabilitySummary {
  const http = primitive.http ?? [];
  const cli = primitive.cli ?? [];
  const selfTests = primitive.self_tests ?? [];
  const proofs = primitive.proofs ?? [];
  const latencyBudgets = primitive.latency_budgets ?? [];
  return {
    id: primitive.id,
    title: primitive.title,
    status: primitive.status,
    category: classifyPrimitiveCapability(primitive, http),
    summary: primitive.summary,
    routeCount: http.length,
    cliCommandCount: cli.length,
    selfTestCount: selfTests.length,
    proofRefCount: proofs.length,
    latencyBudgetCount: latencyBudgets.length,
    responsivenessCritical: primitive.responsiveness_critical === true,
    responseSchemaRouteCount: http.filter((route) => route.response_schema).length,
    requestSchemaRouteCount: http.filter((route) => route.request_schema).length,
    noRequestBodyRouteCount: http.filter((route) => route.no_request_body === true).length
  };
}

function schemaReferenceName(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const refPrefix = "#/components/schemas/";
  return value.startsWith(refPrefix) ? value.slice(refPrefix.length) : value;
}

function sortedStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function classifyPrimitiveCapability(primitive: PrimitiveDefinition, routes: PrimitiveHttpRoute[]): string {
  const id = primitive.id;
  if (id.includes("workspace") || id.includes("window") || id === "manual_mode" || id === "mac_app_hotkeys") {
    return "os_control";
  }
  if (id.includes("queue") || id.includes("routing") || id.includes("command") || id.includes("trigger")) {
    return "attention_routing";
  }
  if (id.includes("agent") || id.includes("session") || id.includes("context")) {
    return "agent_context";
  }
  if (routes.some((route) => route.path.startsWith("/health") || route.path.startsWith("/metrics"))) {
    return "observability";
  }
  return "runtime";
}

function readPrimitiveString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sumBy<T>(items: T[], valueFn: (item: T) => number): number {
  return items.reduce((total, item) => total + valueFn(item), 0);
}

function normalizePrimitiveMethod(method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>): PrimitiveHttpMethod {
  return PrimitiveHttpMethodSchema.parse(method.toUpperCase());
}

function interpolatePrimitivePath(route: PrimitiveHttpRoute, pathParams: Record<string, string | number | boolean>): string {
  return route.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined) {
      throw new PrimitiveRequestBuildError(`Missing primitive path parameter: ${name}`, {
        kind: "missing_path_param",
        route,
        method: route.method,
        path: route.path,
        parameter: name
      });
    }
    return encodeURIComponent(String(value));
  });
}

function encodePrimitiveQuery(
  route: PrimitiveHttpRoute,
  query: Record<string, string | number | boolean | null | undefined>,
  strictQuery: boolean
): string {
  const search = new URLSearchParams();
  const declared = route.query_parameters ?? route.parameters ?? [];
  const declaredNames = new Set(declared.map((parameter) => parameter.name));
  for (const parameter of declared) {
    const value = query[parameter.name];
    if (value === undefined || value === null) {
      if (parameter.required) {
        throw new PrimitiveRequestBuildError(`Missing primitive query parameter: ${parameter.name}`, {
          kind: "missing_query_param",
          route,
          method: route.method,
          path: route.path,
          parameter: parameter.name
        });
      }
      continue;
    }
    validatePrimitiveQueryValue(route, parameter, value);
    search.set(parameter.name, String(value));
  }
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (declaredNames.has(name)) continue;
    if (strictQuery) {
      throw new PrimitiveRequestBuildError(`Unknown primitive query parameter: ${name}`, {
        kind: "unknown_query_param",
        route,
        method: route.method,
        path: route.path,
        parameter: name
      });
    }
    search.set(name, String(value));
  }
  return search.toString();
}

function validatePrimitiveQueryValue(
  route: PrimitiveHttpRoute,
  parameter: PrimitiveQueryParameter,
  value: string | number | boolean
): void {
  const schema = parameter.schema;
  if (!schema) return;
  const label = `${route.method} ${route.path} query parameter ${parameter.name}`;

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((enumValue) => String(enumValue) === String(value))) {
    throwInvalidQueryValue(route, parameter, `${label} must be one of: ${enumValues.map(String).join(", ")}`);
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  if (type === "integer") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed)) {
      throwInvalidQueryValue(route, parameter, `${label} must be an integer`);
    }
    validateNumericBounds(route, parameter, label, parsed, schema);
    return;
  }
  if (type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throwInvalidQueryValue(route, parameter, `${label} must be a number`);
    }
    validateNumericBounds(route, parameter, label, parsed, schema);
    return;
  }
  if (type === "boolean" && typeof value !== "boolean") {
    throwInvalidQueryValue(route, parameter, `${label} must be a boolean`);
  }
}

function validateNumericBounds(
  route: PrimitiveHttpRoute,
  parameter: PrimitiveQueryParameter,
  label: string,
  value: number,
  schema: Record<string, unknown>
): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    throwInvalidQueryValue(route, parameter, `${label} must be >= ${schema.minimum}`);
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    throwInvalidQueryValue(route, parameter, `${label} must be <= ${schema.maximum}`);
  }
}

function throwInvalidQueryValue(route: PrimitiveHttpRoute, parameter: PrimitiveQueryParameter, message: string): never {
  throw new PrimitiveRequestBuildError(message, {
    kind: "invalid_query_param",
    route,
    method: route.method,
    path: route.path,
    parameter: parameter.name
  });
}

function parsePrimitiveResponsePayload(request: PrimitiveRequest, text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PrimitiveResponseParseError(`Primitive route returned invalid JSON: ${request.method} ${request.path}`, {
      route: request.route,
      method: request.method,
      path: request.path,
      responseText: text,
      cause: error
    });
  }
}

function primitiveHttpPayloadCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload.code ?? payload.error_code ?? payload.errorCode;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function primitiveHttpPayloadMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload.message ?? payload.error ?? payload.detail;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWithSchemaReference<T>(
  schemaReferenceValue: z.infer<typeof schemaReference>,
  body: unknown,
  direction: "request" | "response",
  route: PrimitiveHttpRoute
): T {
  if (typeof schemaReferenceValue !== "string") {
    throw new Error(`Inline primitive ${direction} schemas are not available at runtime: ${route.method} ${route.path}`);
  }
  return getContractSchema(schemaReferenceValue).parse(body) as T;
}
