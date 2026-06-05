import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BrowserTabResourceSchema,
  ContractJsonSchemas,
  ContractSchemas,
  ContextRestoreRequestSchema,
  ContextRestorePlanSchema,
  ContextResourceSchema,
  EventSchema,
  FollowsWindowExclusionCreateRequestSchema,
  ManualModeSetRequestSchema,
  PrimitiveCatalogSchema,
  ReviewPacketSchema,
  TaskWindowClaimCreateRequestSchema,
  WorkspaceSnapshotResourceSchema,
  getPrimitive,
  getPrimitiveRoute,
  getContractSchema
} from "../src/index.js";
import {
  bindPrimitiveOperationsClient,
  buildPrimitiveApiIndex,
  buildPrimitiveProofPlan,
  buildPrimitiveRequest,
  createPrimitiveHttpClient,
  createPrimitiveOperationsClient,
  isPrimitiveHttpError,
  isPrimitiveRequestBuildError,
  isPrimitiveResponseParseError,
  isPrimitiveResponseValidationError,
  isPrimitiveTimeoutError,
  parsePrimitiveCatalog,
  primitiveErrorSummary,
  PrimitiveHttpError,
  PrimitiveRequestBuildError,
  PrimitiveResponseParseError,
  PrimitiveResponseValidationError,
  PrimitiveTimeoutError,
  primitiveRoutes,
  routeHasRequestBody,
  selectPrimitiveLatencyBudgets,
  selectPrimitiveSelfTestCommands,
  selectPrimitiveCapabilities,
  summarizePrimitiveCatalog,
  validatePrimitiveResponse
} from "../src/primitives.js";
import { validateFixtures } from "../src/cli.js";

type FixtureEnvelope = {
  schema: string;
  valid?: boolean;
  data: unknown;
};

const fixturesDir = resolve(import.meta.dirname, "../../../tests/fixtures/contracts");
const primitiveCatalogPath = resolve(import.meta.dirname, "../../../docs/primitives.catalog.json");

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return listJsonFiles(path);
      return path.endsWith(".json") ? [path] : [];
    })
    .sort();
}

function readFixture(path: string): FixtureEnvelope {
  return JSON.parse(readFileSync(path, "utf8")) as FixtureEnvelope;
}

function readJsonObject(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function generatedDefinition(schemaName: string): Record<string, unknown> {
  const schema = ContractJsonSchemas[schemaName as keyof typeof ContractJsonSchemas] as Record<string, unknown>;
  const definitions = schema?.definitions as Record<string, unknown> | undefined;
  const definition = definitions?.[schemaName];
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error(`missing generated JSON Schema definition for ${schemaName}`);
  }
  return definition as Record<string, unknown>;
}

function jsonProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return properties as Record<string, Record<string, unknown>>;
}

function requiredFields(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  return Array.isArray(required) ? required.filter((field): field is string => typeof field === "string") : [];
}

function expectCatalogSchemaCoversGeneratedShape(schemaName: string, catalogSchema: Record<string, unknown>): void {
  const generated = generatedDefinition(schemaName);
  expect(catalogSchema.type, `${schemaName}.type`).toBe(generated.type);
  expect(catalogSchema.additionalProperties, `${schemaName}.additionalProperties`).toBe(generated.additionalProperties);

  const generatedRequired = requiredFields(generated);
  const catalogRequired = requiredFields(catalogSchema);
  for (const field of generatedRequired) {
    expect(catalogRequired, `${schemaName}.required`).toContain(field);
  }

  const generatedProperties = jsonProperties(generated);
  const catalogProperties = jsonProperties(catalogSchema);
  for (const [propertyName, generatedProperty] of Object.entries(generatedProperties)) {
    const catalogProperty = catalogProperties[propertyName];
    expect(catalogProperty, `${schemaName}.properties.${propertyName}`).toBeTruthy();
    if (typeof catalogProperty.$ref === "string") continue;
    expect(catalogProperty.type, `${schemaName}.properties.${propertyName}.type`).toEqual(generatedProperty.type);
    if (generatedProperty.format !== undefined) {
      expect(catalogProperty.format, `${schemaName}.properties.${propertyName}.format`).toEqual(generatedProperty.format);
    }
    if (generatedProperty.minLength !== undefined) {
      expect(catalogProperty.minLength, `${schemaName}.properties.${propertyName}.minLength`).toEqual(generatedProperty.minLength);
    }
    if (generatedProperty.exclusiveMinimum === 0) {
      expect(catalogProperty.minimum, `${schemaName}.properties.${propertyName}.minimum`).toBe(1);
    }
  }
}

describe("contract schemas", () => {
  it("validates normalized event fixtures", () => {
    const fixture = readFixture(join(fixturesDir, "valid/event.json"));
    expect(EventSchema.parse(fixture.data).id).toBe("evt_slack_001");
  });

  it("validates discriminated context resources and flexible unknown resources", () => {
    expect(BrowserTabResourceSchema.parse(readFixture(join(fixturesDir, "valid/context_resource.json")).data).kind).toBe(
      "browser_tab"
    );

    expect(
      ContextResourceSchema.parse({
        id: "ctx_future_001",
        kind: "future_resource",
        title: "Future resource",
        restore_confidence: "low",
        custom: {
          ok: true
        }
      }).kind
    ).toBe("future_resource");
  });

  it("validates workspace snapshot context resources", () => {
    const resource = WorkspaceSnapshotResourceSchema.parse(
      readFixture(join(fixturesDir, "valid/workspace_snapshot_context_resource.json")).data
    );

    expect(resource.kind).toBe("workspace_snapshot");
    expect(resource.snapshot.backend).toBe("aerospace");
    expect(resource.snapshot.windows[0]?.workspace).toBe("eventloop-blog");
  });

  it("validates context restore plans", () => {
    const fixture = readFixture(join(fixturesDir, "valid/context_restore_plan.json"));
    const plan = ContextRestorePlanSchema.parse(fixture.data);

    expect(plan.kind).toBe("browser_extension_message");
    if (plan.kind === "browser_extension_message") {
      expect(plan.message.type).toBe("eventloop.restore");
      expect(plan.message.resource.kind).toBe("browser_tab");
    }
  });

  it("validates context restore requests", () => {
    const fixture = readFixture(join(fixturesDir, "valid/context_restore_request.json"));
    const request = ContextRestoreRequestSchema.parse(fixture.data);

    expect(request.status).toBe("pending");
    expect(request.restore_plan.kind).toBe("browser_extension_message");
    expect(request.resource.kind).toBe("browser_tab");
  });

  it("validates route request aliases that orchestrator accepts for primitive APIs", () => {
    expect(
      TaskWindowClaimCreateRequestSchema.parse({
        taskId: "task_background_test",
        processRootPid: 4242,
        ttlMs: 60_000,
        source: "codex_spawn_wrapper",
        ignored_future_field: true
      }).taskId
    ).toBe("task_background_test");

    expect(
      FollowsWindowExclusionCreateRequestSchema.parse({
        appBundle: "com.google.chrome",
        titleSubstring: "playwright",
        ignored_future_field: true
      }).titleSubstring
    ).toBe("playwright");

    expect(
      ManualModeSetRequestSchema.parse({
        active: true,
        reason: "user_hotkey",
        ignored_future_field: true
      }).active
    ).toBe(true);
  });

  it("allows failed context restore requests for retryable browser failures", () => {
    const fixture = readFixture(join(fixturesDir, "valid/context_restore_request.json"));
    const request = ContextRestoreRequestSchema.parse({
      ...(fixture.data as Record<string, unknown>),
      status: "failed",
      result: {
        ok: false,
        error: "tab not found"
      }
    });

    expect(request.status).toBe("failed");
    expect(request.result).toMatchObject({ ok: false });
  });

  it("requires review-packet evidence", () => {
    const fixture = readFixture(join(fixturesDir, "valid/review_packet.json"));
    const invalidPacket = {
      ...(fixture.data as Record<string, unknown>),
      evidence: []
    };

    expect(ReviewPacketSchema.safeParse(invalidPacket).success).toBe(false);
  });

  it("exposes JSON Schema for every contract", () => {
    for (const name of Object.keys(ContractSchemas)) {
      expect(ContractJsonSchemas[name as keyof typeof ContractJsonSchemas]).toBeTruthy();
    }
  });

  it("keeps primitive catalog schemas aligned with generated shared JSON schemas", () => {
    const catalog = readJsonObject(primitiveCatalogPath);
    const schemas = catalog.schemas as Record<string, unknown>;
    expect(schemas && typeof schemas === "object" && !Array.isArray(schemas)).toBe(true);

    for (const [schemaName, schema] of Object.entries(schemas)) {
      expect(schemaName in ContractSchemas, `${schemaName} must be an exported shared contract`).toBe(true);
      expectCatalogSchemaCoversGeneratedShape(schemaName, schema as Record<string, unknown>);
    }
  });
});

describe("primitive catalog SDK boundary", () => {
  it("parses the real primitive catalog and exposes route helpers", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const summary = summarizePrimitiveCatalog(catalog);

    expect(summary.primitiveCount).toBe(18);
    expect(summary.routeCount).toBeGreaterThan(70);
    expect(summary.responseSchemaCount).toBe(summary.routeCount);
    expect(summary.requestSchemaCount + summary.noRequestBodyCount).toBeGreaterThan(40);
    expect(summary.schemaCount).toBeGreaterThan(100);
    expect(summary.latencyBudgetCount).toBe(11);
    expect(summary.responsivenessCriticalCount).toBe(5);
    expect(summary.statusCounts).toMatchObject({ dogfood: 13, stable_enough: 5 });
    expect(summary.categoryCounts).toMatchObject({
      agent_context: 4,
      attention_routing: 4,
      observability: 1,
      os_control: 6,
      runtime: 3
    });
    expect(summary.primitives).toContainEqual(
      expect.objectContaining({
        id: "workspace_control",
        category: "os_control",
        routeCount: 4,
        responseSchemaRouteCount: 4,
        latencyBudgetCount: expect.any(Number),
        responsivenessCritical: true,
        proofRefCount: expect.any(Number)
      })
    );
    expect(summary.primitives.find((primitive) => primitive.id === "runtime_spine")).toMatchObject({
      category: "runtime",
      routeCount: 0,
      selfTestCount: 1
    });

    const onboarding = getPrimitive(catalog, "task_intake_onboarding");
    expect(onboarding?.title).toBe("Task Intake Onboarding");

    const route = getPrimitiveRoute(catalog, "post", "/onboarding/approvals/batch");
    expect(route?.request_schema).toBe("OnboardingApprovalBatchRequest");
    expect(route?.response_schema).toBe("OnboardingApprovalBatchResponse");
    expect(route ? routeHasRequestBody(route) : undefined).toBe(true);

    const noBodyRoute = getPrimitiveRoute(catalog, "POST", "/agents/codex/auto-bind");
    expect(noBodyRoute?.no_request_body).toBe(true);
    expect(noBodyRoute ? routeHasRequestBody(noBodyRoute) : undefined).toBe(false);
  });

  it("selects primitive capabilities by builder-facing status and category filters", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));

    const stableOsControl = selectPrimitiveCapabilities(catalog, {
      statuses: ["stable_enough"],
      categories: ["os_control"],
      requireSelfTests: true,
      requireProofs: true
    });
    expect(stableOsControl.map((primitive) => primitive.id)).toEqual(["task_workspace_memory", "manual_mode"]);

    const routeBackedAgentContext = selectPrimitiveCapabilities(catalog, {
      categories: ["agent_context"],
      minRouteCount: 4
    });
    expect(routeBackedAgentContext.map((primitive) => primitive.id)).toEqual([
      "task_session_control",
      "context_capture_restore",
      "agent_source_hooks",
      "agent_focus_binding"
    ]);

    const cliBackedWindowPrimitives = selectPrimitiveCapabilities(catalog, {
      categories: ["os_control"],
      requireCli: true
    });
    expect(cliBackedWindowPrimitives.map((primitive) => primitive.id)).toEqual(["task_window_claims", "follows_windows"]);

    expect(selectPrimitiveCapabilities(catalog, { ids: ["workspace_control"] })).toEqual([
      expect.objectContaining({ id: "workspace_control", routeCount: 4 })
    ]);

    const latencyBudgetedCritical = selectPrimitiveCapabilities(catalog, {
      requireResponsivenessCritical: true,
      requireLatencyBudgets: true
    });
    expect(latencyBudgetedCritical.map((primitive) => primitive.id)).toEqual([
      "workspace_control",
      "queue_paper_routing",
      "master_command_router",
      "manual_mode",
      "mac_app_hotkeys"
    ]);
  });

  it("selects primitive self-test commands with stable primitive coverage", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const selection = selectPrimitiveSelfTestCommands(catalog);

    expect(selection.missingPrimitiveIds).toEqual([]);
    expect(selection.selectedPrimitiveIds).toHaveLength(18);
    expect(selection.commands.length).toBe(12);
    expect(selection.commands).toContainEqual({
      command: "pnpm --filter @eventloopos/orchestrator run test:runtime-spine",
      primitiveIds: ["runtime_spine"]
    });
    expect(selection.commands).toContainEqual(expect.objectContaining({
      command: "pnpm --filter @eventloopos/shared run test:primitive-ops",
      primitiveIds: expect.arrayContaining(["workspace_control"])
    }));

    const filtered = selectPrimitiveSelfTestCommands(catalog, ["workspace_control", "missing", "workspace_control"]);
    expect(filtered.selectedPrimitiveIds).toEqual(["workspace_control"]);
    expect(filtered.missingPrimitiveIds).toEqual(["missing"]);
    expect(filtered.commands).toEqual([
      {
        command: "bin/lab-mac-geometry-proof --self-test",
        primitiveIds: ["workspace_control"]
      },
      {
        command: "pnpm --filter @eventloopos/shared run test:primitive-ops",
        primitiveIds: ["workspace_control"]
      }
    ]);
  });

  it("selects primitive latency budgets by builder-facing filters", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const allBudgets = selectPrimitiveLatencyBudgets(catalog);

    expect(allBudgets).toHaveLength(11);
    expect(allBudgets).toContainEqual(expect.objectContaining({
      primitiveId: "workspace_control",
      primitiveCategory: "os_control",
      name: "workspace_capture",
      p95Ms: 5000,
      proof: "bin/workspace-latency-proof",
      route: "POST /workspace/capture"
    }));

    const osControlBudgets = selectPrimitiveLatencyBudgets(catalog, { categories: ["os_control"] });
    expect(osControlBudgets.map((budget) => budget.primitiveId)).toEqual([
      "workspace_control",
      "workspace_control",
      "workspace_control",
      "manual_mode",
      "manual_mode",
      "manual_mode",
      "mac_app_hotkeys"
    ]);

    const criticalBudgetNames = selectPrimitiveLatencyBudgets(catalog, {
      requireResponsivenessCritical: true,
      requireLatencyBudgets: true
    }).map((budget) => budget.name);
    expect(criticalBudgetNames).toEqual([
      "workspace_capture",
      "workspace_restore_plan",
      "workspace_restore_execute",
      "queue_list",
      "queue_next",
      "queue_lease_next",
      "master_fan_out_dry_run",
      "manual_mode_get",
      "manual_mode_set",
      "manual_mode_restore",
      "hotkey_to_feedback"
    ]);
  });

  it("builds primitive proof plans for builder-facing subsets", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));

    const workspacePlan = buildPrimitiveProofPlan(catalog, { ids: ["workspace_control", "missing"] });
    expect(workspacePlan.selectedPrimitiveIds).toEqual(["workspace_control"]);
    expect(workspacePlan.missingPrimitiveIds).toEqual(["missing"]);
    expect(workspacePlan.primitives).toEqual([
      expect.objectContaining({
        id: "workspace_control",
        routeCount: 4,
        responsivenessCritical: true
      })
    ]);
    expect(workspacePlan.selfTestCommands).toEqual([
      {
        command: "bin/lab-mac-geometry-proof --self-test",
        primitiveIds: ["workspace_control"]
      },
      {
        command: "pnpm --filter @eventloopos/shared run test:primitive-ops",
        primitiveIds: ["workspace_control"]
      }
    ]);
    expect(workspacePlan.latencyBudgets.map((budget) => budget.name)).toEqual([
      "workspace_capture",
      "workspace_restore_plan",
      "workspace_restore_execute"
    ]);

    const criticalPlan = buildPrimitiveProofPlan(catalog, {
      requireResponsivenessCritical: true,
      requireLatencyBudgets: true
    });
    expect(criticalPlan.missingPrimitiveIds).toEqual([]);
    expect(criticalPlan.selectedPrimitiveIds).toEqual([
      "workspace_control",
      "queue_paper_routing",
      "master_command_router",
      "manual_mode",
      "mac_app_hotkeys"
    ]);
    expect(criticalPlan.selfTestCommands.length).toBeGreaterThanOrEqual(2);
    expect(criticalPlan.latencyBudgets).toHaveLength(11);
  });

  it("builds a compact primitive API index for non-OpenAPI builders", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const index = buildPrimitiveApiIndex(catalog);

    expect(index.schemaVersion).toBe(1);
    expect(index.primitiveCount).toBe(18);
    expect(index.routeCount).toBeGreaterThan(70);
    expect(index.statusLabels).toEqual(["dogfood", "experimental", "mixed", "stable_enough"]);
    expect(index.schemaNames).toContain("WorkspaceCaptureResponse");

    const workspace = index.primitives.find((primitive) => primitive.id === "workspace_control");
    expect(workspace).toMatchObject({
      title: "Workspace Control",
      category: "os_control",
      responsivenessCritical: true,
      routeCount: 4,
      latencyBudgetCount: 3
    });
    expect(workspace?.code).toContain("app/orchestrator/src/workspace/aerospace.ts");
    expect(workspace?.selfTests).toContain("pnpm --filter @eventloopos/shared run test:primitive-ops");
    expect(workspace?.latencyBudgets.map((budget) => budget.name)).toEqual([
      "workspace_capture",
      "workspace_restore_plan",
      "workspace_restore_execute"
    ]);
    expect(workspace?.routes).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/workspace/capture",
      operation: "workspace_control_post_workspace_capture",
      responseSchema: "WorkspaceCaptureResponse",
      requestBody: true,
      routeFile: "app/orchestrator/src/routes/workspace.ts",
      latencyBudgets: [expect.objectContaining({ name: "workspace_capture" })]
    }));

    const lineage = index.primitives
      .find((primitive) => primitive.id === "queue_paper_routing")
      ?.routes.find((route) => route.path === "/queue/:id/lineage");
    expect(lineage).toMatchObject({
      operation: "queue_paper_routing_get_queue_by_id_lineage",
      queryParameters: ["limit"],
      responseSchema: "QueueLineageResponse"
    });
  });

  it("rejects primitive routes that drift back to freeform mutating bodies", () => {
    const catalog = readJsonObject(primitiveCatalogPath);
    const primitive = ((catalog.primitives as unknown[])?.[0] ?? {}) as Record<string, unknown>;
    const route = (((primitive.http as unknown[])?.[0] ?? {}) as Record<string, unknown>);
    const invalid = {
      ...catalog,
      primitives: [
        {
          ...primitive,
          http: [
            {
              ...route,
              method: "POST",
              request_schema: undefined,
              no_request_body: undefined
            }
          ]
        }
      ]
    };

    expect(PrimitiveCatalogSchema.safeParse(invalid).success).toBe(false);
  });

  it("builds typed primitive requests with path params, query, and validated JSON bodies", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const requestBody = readFixture(join(fixturesDir, "valid/onboarding_approval_batch_request.json")).data;

    const request = buildPrimitiveRequest({
      catalog,
      method: "post",
      path: "/onboarding/approvals/batch",
      baseUrl: "http://127.0.0.1:4480",
      body: requestBody,
      headers: { "x-agent": "codex" }
    });

    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://127.0.0.1:4480/onboarding/approvals/batch");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["x-agent"]).toBe("codex");
    expect(JSON.parse(request.body ?? "{}")).toMatchObject({
      idempotency_key: "idem_onboarding_batch"
    });

    const lineage = buildPrimitiveRequest({
      catalog,
      method: "GET",
      path: "/queue/:id/lineage",
      baseUrl: "http://localhost:4377/root/",
      pathParams: { id: "qit_feedback_001" },
      query: { limit: 25, ignored_future_filter: "yes" }
    });

    expect(lineage.url).toBe("http://localhost:4377/queue/qit_feedback_001/lineage?limit=25&ignored_future_filter=yes");
    expect(lineage.body).toBeUndefined();

    expect(() =>
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/queue/:id/lineage",
        pathParams: { id: "qit_feedback_001" },
        query: { limit: 25, limti: 10 },
        strictQuery: true
      })
    ).toThrow(/Unknown primitive query parameter: limti/);
  });

  it("validates declared primitive query parameter schemas", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));

    const lineage = buildPrimitiveRequest({
      catalog,
      method: "GET",
      path: "/queue/:id/lineage",
      pathParams: { id: "qit_feedback_001" },
      query: { limit: "500" }
    });
    expect(lineage.url).toBe("http://127.0.0.1:4377/queue/qit_feedback_001/lineage?limit=500");

    expect(() =>
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/queue",
        query: { state: "archived" }
      })
    ).toThrow(/must be one of: ready, leased, deferred, done, dead/);

    expect(() =>
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/queue/:id/lineage",
        pathParams: { id: "qit_feedback_001" },
        query: { limit: 501 }
      })
    ).toThrow(/must be <= 500/);

    expect(() =>
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/queue/:id/lineage",
        pathParams: { id: "qit_feedback_001" },
        query: { limit: "many" }
      })
    ).toThrow(/must be an integer/);
  });

  it("rejects request bodies for no-body primitives and validates primitive responses", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const noBodyRoute = getPrimitiveRoute(catalog, "POST", "/agents/codex/auto-bind");
    expect(noBodyRoute).toBeTruthy();

    expect(() =>
      buildPrimitiveRequest({
        catalog,
        method: "POST",
        path: "/agents/codex/auto-bind",
        body: {}
      })
    ).toThrow(/does not accept request body/);

    const response = validatePrimitiveResponse(
      noBodyRoute!,
      readFixture(join(fixturesDir, "valid/codex_auto_bind_response.json")).data
    );
    expect((response as { ok: boolean }).ok).toBe(true);
  });

  it("exposes typed primitive request-build failures before fetch", () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));

    expect(() =>
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/tasks/:id"
      })
    ).toThrow(PrimitiveRequestBuildError);

    try {
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/tasks/:id"
      });
      throw new Error("expected missing path parameter");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveRequestBuildError);
      const primitiveError = error as PrimitiveRequestBuildError;
      expect(primitiveError.kind).toBe("missing_path_param");
      expect(primitiveError.parameter).toBe("id");
      expect(isPrimitiveRequestBuildError(error, { kind: "missing_path_param", parameter: "id", method: "get" })).toBe(true);
      expect(isPrimitiveRequestBuildError(error, { kind: "unknown_query_param" })).toBe(false);
      expect(primitiveErrorSummary(error)).toEqual({
        name: "PrimitiveRequestBuildError",
        message: "Missing primitive path parameter: id",
        method: "GET",
        path: "/tasks/:id",
        kind: "missing_path_param",
        parameter: "id"
      });
    }

    try {
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/queue/:id/lineage",
        pathParams: { id: "qit_feedback_001" },
        query: { limit: "many" }
      });
      throw new Error("expected invalid query parameter");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveRequestBuildError);
      const primitiveError = error as PrimitiveRequestBuildError;
      expect(primitiveError.kind).toBe("invalid_query_param");
      expect(primitiveError.parameter).toBe("limit");
      expect(primitiveError.message).toMatch(/must be an integer/);
    }

    try {
      buildPrimitiveRequest({
        catalog,
        method: "GET",
        path: "/queue",
        query: { sttae: "ready" },
        strictQuery: true
      });
      throw new Error("expected unknown query parameter");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveRequestBuildError);
      const primitiveError = error as PrimitiveRequestBuildError;
      expect(primitiveError.kind).toBe("unknown_query_param");
      expect(primitiveError.parameter).toBe("sttae");
      expect(primitiveErrorSummary(error)).toEqual({
        name: "PrimitiveRequestBuildError",
        message: "Unknown primitive query parameter: sttae",
        method: "GET",
        path: "/queue",
        kind: "unknown_query_param",
        parameter: "sttae"
      });
    }

    try {
      buildPrimitiveRequest({
        catalog,
        method: "POST",
        path: "/task-window-claims",
        body: { task_id: "task_demo" }
      });
      throw new Error("expected invalid request body");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveRequestBuildError);
      const primitiveError = error as PrimitiveRequestBuildError;
      expect(primitiveError.kind).toBe("request_body_invalid");
      expect(primitiveError.cause).toBeTruthy();
    }
  });

  it("creates a primitive HTTP client that validates successful JSON responses", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const responseBody = readFixture(join(fixturesDir, "valid/onboarding_approval_batch_response.json")).data;
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined
      });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createPrimitiveHttpClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480",
      fetch: fakeFetch,
      headers: { authorization: "Bearer local" }
    });

    const result = await client.request("POST", "/onboarding/approvals/batch", {
      body: readFixture(join(fixturesDir, "valid/onboarding_approval_batch_request.json")).data
    });

    expect(result).toMatchObject({ ok: true, request_id: "req_onboarding_batch" });
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:4480/onboarding/approvals/batch",
        method: "POST",
        body: expect.stringContaining("idem_onboarding_batch")
      }
    ]);
  });

  it("exposes typed primitive HTTP failures with status, route, and payload", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, code: "idempotency_conflict", error: "duplicate idempotency key" }), {
        status: 409,
        statusText: "Conflict",
        headers: { "content-type": "application/json" }
      });
    const client = createPrimitiveHttpClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480",
      fetch: fakeFetch
    });

    try {
      await client.request("POST", "/onboarding/approvals/batch", {
        body: readFixture(join(fixturesDir, "valid/onboarding_approval_batch_request.json")).data
      });
      throw new Error("expected primitive HTTP error");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveHttpError);
      const primitiveError = error as PrimitiveHttpError;
      expect(primitiveError.status).toBe(409);
      expect(primitiveError.statusText).toBe("Conflict");
      expect(primitiveError.code).toBe("idempotency_conflict");
      expect(primitiveError.detail).toBe("duplicate idempotency key");
      expect(primitiveError.route?.path).toBe("/onboarding/approvals/batch");
      expect(primitiveError.payload).toMatchObject({ error: "duplicate idempotency key" });
      expect(primitiveError.responseText).toContain("duplicate idempotency key");
      expect(isPrimitiveHttpError(error, { status: 409, code: "idempotency_conflict", method: "post" })).toBe(true);
      expect(isPrimitiveHttpError(error, { status: 409, code: "manual_mode_active" })).toBe(false);
      expect(primitiveErrorSummary(error)).toEqual({
        name: "PrimitiveHttpError",
        message: "Primitive route failed: POST /onboarding/approvals/batch HTTP 409",
        method: "POST",
        path: "/onboarding/approvals/batch",
        status: 409,
        code: "idempotency_conflict",
        detail: "duplicate idempotency key"
      });
    }
  });

  it("exposes typed primitive response parse and validation failures", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const parseClient = createPrimitiveHttpClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480",
      fetch: async () => new Response("not-json", { status: 200 })
    });

    try {
      await parseClient.request("POST", "/agents/codex/auto-bind");
      throw new Error("expected primitive parse error");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveResponseParseError);
      expect(isPrimitiveResponseParseError(error, { method: "post", path: "/agents/codex/auto-bind" })).toBe(true);
      expect(isPrimitiveResponseParseError(error, { path: "/health" })).toBe(false);
    }

    const validationClient = createPrimitiveHttpClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480",
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    });

    try {
      await validationClient.request("POST", "/onboarding/approvals/batch", {
        body: readFixture(join(fixturesDir, "valid/onboarding_approval_batch_request.json")).data
      });
      throw new Error("expected primitive validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveResponseValidationError);
      const primitiveError = error as PrimitiveResponseValidationError;
      expect(primitiveError.route?.path).toBe("/onboarding/approvals/batch");
      expect(primitiveError.payload).toEqual({ ok: true });
      expect(primitiveError.cause).toBeTruthy();
      expect(isPrimitiveResponseValidationError(error, { method: "POST", path: "/onboarding/approvals/batch" })).toBe(true);
      expect(isPrimitiveResponseValidationError(error, { method: "GET" })).toBe(false);
    }
  });

  it("times out stalled primitive HTTP calls with a typed error", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    let observedSignal: AbortSignal | undefined;
    const fakeFetch: typeof fetch = async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      if (!observedSignal) throw new Error("expected abort signal");
      return await new Promise<Response>((_resolve, reject) => {
        if (observedSignal?.aborted) {
          reject(observedSignal.reason);
          return;
        }
        observedSignal?.addEventListener("abort", () => reject(observedSignal?.reason), { once: true });
      });
    };
    const client = createPrimitiveHttpClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480",
      fetch: fakeFetch,
      timeoutMs: 5
    });

    try {
      await client.request("GET", "/health");
      throw new Error("expected primitive timeout error");
    } catch (error) {
      expect(error).toBeInstanceOf(PrimitiveTimeoutError);
      const primitiveError = error as PrimitiveTimeoutError;
      expect(primitiveError.timeoutMs).toBe(5);
      expect(primitiveError.method).toBe("GET");
      expect(primitiveError.path).toBe("/health");
      expect(observedSignal?.aborted).toBe(true);
      expect(isPrimitiveTimeoutError(error, { method: "get", path: "/health" })).toBe(true);
      expect(isPrimitiveTimeoutError(error, { path: "/queue" })).toBe(false);
      expect(primitiveErrorSummary(error)).toEqual({
        name: "PrimitiveTimeoutError",
        message: "Primitive route timed out after 5ms: GET /health",
        method: "GET",
        path: "/health",
        timeoutMs: 5
      });
    }
  });

  it("creates typed primitive operation helpers over queue, sessions, windows, follows rules, and workspace routes", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const calls: Array<{ url: string; method?: string; headers: Record<string, string>; body?: unknown }> = [];
    const responseFixtures = new Map<string, unknown>([
      ["GET /queue?state=ready", readFixture(join(fixturesDir, "valid/queue_list_response.json")).data],
      ["POST /queue/qit_feedback_001/done", readFixture(join(fixturesDir, "valid/queue_action_response.json")).data],
      ["POST /task-window-claims", readFixture(join(fixturesDir, "valid/task_window_claim_response.json")).data],
      ["GET /task-sessions", readFixture(join(fixturesDir, "valid/task_sessions_list_response.json")).data],
      ["POST /task-sessions/codex_thread_123/followup", readFixture(join(fixturesDir, "valid/task_session_followup_response.json")).data],
      ["PUT /task-sessions/codex_thread_123/task-binding", readFixture(join(fixturesDir, "valid/task_session_binding_response.json")).data],
      ["POST /agents/codex/auto-bind", readFixture(join(fixturesDir, "valid/codex_auto_bind_response.json")).data],
      ["GET /agents/codex/inspect/codex_thread_123", readFixture(join(fixturesDir, "valid/codex_session_inspection_response.json")).data],
      ["GET /agents/claude/inspect/claude_session_123", readFixture(join(fixturesDir, "valid/claude_session_inspection_response.json")).data],
      ["GET /follows-windows?min_workspace_count=2", readFixture(join(fixturesDir, "valid/follows_windows_list_response.json")).data],
      ["DELETE /follows-windows/exclusions/fwex_demo", readFixture(join(fixturesDir, "valid/follows_window_exclusion_response.json")).data],
      ["POST /workspace/restore", readFixture(join(fixturesDir, "valid/workspace_restore_response.json")).data]
    ]);
    const fakeFetch: typeof fetch = async (url, init) => {
      const parsedUrl = new URL(String(url));
      const key = `${init?.method ?? "GET"} ${parsedUrl.pathname}${parsedUrl.search}`;
      const fixture = responseFixtures.get(key);
      calls.push({
        url: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: init?.method,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      });
      if (!fixture) {
        return new Response(JSON.stringify({ ok: false, error: `missing fixture for ${key}` }), { status: 500 });
      }
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createPrimitiveOperationsClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480/root/",
      fetch: fakeFetch
    });

    await expect(client.queue.list({ state: "ready" })).resolves.toMatchObject({ count: 1 });
    await expect(client.queue.done("qit_feedback_001", { actor_id: "human_demo" })).resolves.toMatchObject({ ok: true });
    await expect(
      client.taskWindowClaims.create(readFixture(join(fixturesDir, "valid/task_window_claim_create_request.json")).data)
    ).resolves.toMatchObject({ ok: true });
    await expect(client.taskSessions.list()).resolves.toHaveProperty("count");
    await expect(
      client.taskSessions.followup("codex_thread_123", readFixture(join(fixturesDir, "valid/task_session_followup_request.json")).data)
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.taskSessions.bindTask("codex_thread_123", readFixture(join(fixturesDir, "valid/task_session_binding_request.json")).data)
    ).resolves.toMatchObject({ ok: true });
    await expect(client.agents.codex.autoBind()).resolves.toMatchObject({ ok: true });
    await expect(client.agents.codex.inspect("codex_thread_123")).resolves.toHaveProperty("exists");
    await expect(client.agents.claude.inspect("claude_session_123")).resolves.toHaveProperty("exists");
    await expect(client.followsWindows.list({ min_workspace_count: 2 })).resolves.toMatchObject({ count: 1 });
    await expect(client.followsWindows.deleteExclusion("fwex_demo")).resolves.toMatchObject({ ok: true });
    await expect(
      client.workspace.restore(readFixture(join(fixturesDir, "valid/workspace_restore_request.json")).data, "idem_workspace_restore")
    ).resolves.toMatchObject({ ok: true });

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /queue?state=ready",
      "POST /queue/qit_feedback_001/done",
      "POST /task-window-claims",
      "GET /task-sessions",
      "POST /task-sessions/codex_thread_123/followup",
      "PUT /task-sessions/codex_thread_123/task-binding",
      "POST /agents/codex/auto-bind",
      "GET /agents/codex/inspect/codex_thread_123",
      "GET /agents/claude/inspect/claude_session_123",
      "GET /follows-windows?min_workspace_count=2",
      "DELETE /follows-windows/exclusions/fwex_demo",
      "POST /workspace/restore"
    ]);
    expect(calls[1]?.body).toMatchObject({ action: "done", actor_id: "human_demo" });
    expect(calls[4]?.body).toMatchObject({ text: expect.any(String) });
    expect(calls[6]?.body).toBeUndefined();
    expect(calls[11]?.headers["idempotency-key"]).toBe("idem_workspace_restore");
  });

  it("binds primitive operation helpers for every cataloged HTTP route", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const calls: Array<{ method: string; path: string; input?: unknown }> = [];
    const ops = bindPrimitiveOperationsClient({
      async request(method, path, input) {
        calls.push({ method: String(method).toUpperCase(), path, input });
        return {};
      }
    });
    const workspaceSnapshot = readFixture(join(fixturesDir, "valid/workspace_snapshot.json")).data;

    await ops.master.fanOut(readFixture(join(fixturesDir, "valid/master_fan_out_request.json")).data);
    await ops.manualMode.get();
    await ops.manualMode.set(readFixture(join(fixturesDir, "valid/manual_mode_set_request.json")).data);
    await ops.tasks.create(readFixture(join(fixturesDir, "valid/create_task_request.json")).data);
    await ops.tasks.list();
    await ops.tasks.get("task_demo_customer");
    await ops.tasks.getLayout("task_demo_customer");
    await ops.tasks.updateLayout("task_demo_customer", workspaceSnapshot);
    await ops.tasks.saveWorkspaceSnapshot(
      "task_demo_customer",
      readFixture(join(fixturesDir, "valid/task_workspace_snapshot_save_request.json")).data
    );
    await ops.tasks.current();
    await ops.tasks.setCurrent(readFixture(join(fixturesDir, "valid/current_task_set_request.json")).data);
    await ops.queue.ingestEvent(readFixture(join(fixturesDir, "valid/event_ingest_request.json")).data);
    await ops.queue.getEvent("evt_browser_ctx_123");
    await ops.queue.getReviewPacket("pkt_feedback_001");
    await ops.queue.list({ state: "ready" });
    await ops.queue.next();
    await ops.queue.leaseNext(readFixture(join(fixturesDir, "valid/queue_lease_request.json")).data);
    await ops.queue.renewLease("qit_feedback_001", readFixture(join(fixturesDir, "valid/queue_lease_renew_request.json")).data);
    await ops.queue.done("qit_feedback_001", { actor_id: "human_demo" });
    await ops.queue.defer("qit_feedback_001", { due_at: "2026-05-06T18:00:00Z" });
    await ops.queue.ignore("qit_feedback_001", { actor_id: "human_demo" });
    await ops.queue.recommendedAction("qit_feedback_001", readFixture(join(fixturesDir, "valid/queue_recommended_action_request.json")).data);
    await ops.queue.lineage("qit_feedback_001", { limit: 10 });
    await ops.queue.priority("qit_feedback_001", readFixture(join(fixturesDir, "valid/queue_priority_request.json")).data);
    await ops.taskWindowClaims.create(readFixture(join(fixturesDir, "valid/task_window_claim_create_request.json")).data);
    await ops.taskWindowClaims.list();
    await ops.taskSessions.list();
    await ops.taskSessions.start(readFixture(join(fixturesDir, "valid/task_session_start_request.json")).data);
    await ops.taskSessions.get("codex_thread_123");
    await ops.taskSessions.followup("codex_thread_123", readFixture(join(fixturesDir, "valid/task_session_followup_request.json")).data);
    await ops.taskSessions.replacement("codex_thread_123", readFixture(join(fixturesDir, "valid/task_session_replacement_request.json")).data);
    await ops.taskSessions.bindTask("codex_thread_123", readFixture(join(fixturesDir, "valid/task_session_binding_request.json")).data);
    await ops.taskSessions.listMessages();
    await ops.taskSessions.reconcileAttempted(readFixture(join(fixturesDir, "valid/task_messages_reconcile_attempted_request.json")).data);
    await ops.agents.codex.autoBind();
    await ops.agents.codex.resolveForeground();
    await ops.agents.codex.inspect("codex_thread_123");
    await ops.agents.claude.inspect("claude_session_123");
    await ops.readingQueue.list();
    await ops.readingQueue.promote(readFixture(join(fixturesDir, "valid/reading_queue_promote_request.json")).data);
    await ops.readingQueue.autoPromote(readFixture(join(fixturesDir, "valid/reading_queue_auto_promote_request.json")).data);
    await ops.onboarding.scan();
    await ops.onboarding.approve(readFixture(join(fixturesDir, "valid/onboarding_approval_request.json")).data);
    await ops.onboarding.approveBatch(readFixture(join(fixturesDir, "valid/onboarding_approval_batch_request.json")).data);
    await ops.onboarding.reject(readFixture(join(fixturesDir, "valid/onboarding_rejection_request.json")).data);
    await ops.contexts.list();
    await ops.contexts.restorePlan(readFixture(join(fixturesDir, "valid/context_restore_plan_request.json")).data);
    await ops.contexts.createRestoreRequest(readFixture(join(fixturesDir, "valid/context_restore_plan_request.json")).data);
    await ops.contexts.nextRestoreRequest();
    await ops.contexts.claimNextRestoreRequest(readFixture(join(fixturesDir, "valid/context_restore_claim_request.json")).data);
    await ops.contexts.getRestoreRequest("ctx_restore_123");
    await ops.contexts.markRestoreRequestDone("ctx_restore_123", readFixture(join(fixturesDir, "valid/context_restore_finish_request.json")).data);
    await ops.contexts.markRestoreRequestFailed(
      "ctx_restore_123",
      readFixture(join(fixturesDir, "valid/context_restore_finish_request.json")).data
    );
    await ops.contexts.retryRestoreRequest("ctx_restore_123");
    await ops.triggers.list();
    await ops.triggers.create(readFixture(join(fixturesDir, "valid/paper_trigger_create_request.json")).data);
    await ops.triggers.get("trg_deploy_watcher");
    await ops.triggers.patch("trg_deploy_watcher", readFixture(join(fixturesDir, "valid/paper_trigger_patch_request.json")).data);
    await ops.triggers.delete("trg_deploy_watcher");
    await ops.agentSources.poll(readFixture(join(fixturesDir, "valid/mcp_poll_request.json")).data);
    await ops.agentSources.listMcpSources();
    await ops.agentSources.pollAllAndRoute(readFixture(join(fixturesDir, "valid/mcp_poll_all_and_route_request.json")).data);
    await ops.agentSources.getMcpSource("local-events");
    await ops.agentSources.pollMcpSource("local-events");
    await ops.agentSources.previewMcpSource("local-events");
    await ops.agentSources.pollAndRouteMcpSource("local-events");
    await ops.agentSources.upsertAgentRun(readFixture(join(fixturesDir, "valid/agent_run_upsert_request.json")).data);
    await ops.agentSources.getAgentRun("agent_run_123");
    await ops.agentSources.submitVoiceCommand(readFixture(join(fixturesDir, "valid/voice_command_request.json")).data);
    await ops.observability.health();
    await ops.observability.metrics();
    await ops.observability.activity();
    await ops.followsWindows.list({ min_workspace_count: 2 });
    await ops.followsWindows.exclude(readFixture(join(fixturesDir, "valid/follows_window_exclusion_create_request.json")).data);
    await ops.followsWindows.listExclusions();
    await ops.followsWindows.deleteExclusion("fwex_demo");
    await ops.workspace.status();
    await ops.workspace.capture();
    await ops.workspace.restorePlan(readFixture(join(fixturesDir, "valid/workspace_restore_plan_request.json")).data);
    await ops.workspace.restore(readFixture(join(fixturesDir, "valid/workspace_restore_request.json")).data, "idem_workspace_restore");

    const calledRoutes = new Set(calls.map((call) => `${call.method} ${call.path}`));
    const catalogRoutes = new Set(primitiveRoutes(catalog).map((route) => `${route.method} ${route.path}`));
    expect(calledRoutes).toEqual(catalogRoutes);
    expect(calledRoutes.size).toBe(primitiveRoutes(catalog).length);
    expect(calls.find((call) => call.path === "/tasks/:id")?.input).toMatchObject({ pathParams: { id: "task_demo_customer" } });
    expect(calls.find((call) => call.path === "/tasks/:id/layout" && call.method === "PUT")?.input).toMatchObject({ body: workspaceSnapshot });
    expect(calls.find((call) => call.path === "/review-packets/:id")?.input).toMatchObject({ pathParams: { id: "pkt_feedback_001" } });
    expect(calls.find((call) => call.path === "/contexts/restore-requests/:id")?.input).toMatchObject({
      pathParams: { id: "ctx_restore_123" }
    });
    expect(calls.find((call) => call.path === "/mcp-sources/:id/poll")?.input).toMatchObject({
      pathParams: { id: "local-events" },
      body: {}
    });
    expect(calls.find((call) => call.path === "/follows-windows")?.input).toMatchObject({
      query: { min_workspace_count: 2 }
    });
  });
});

describe("contract fixtures", () => {
  it("validates all valid fixtures and rejects invalid fixtures", () => {
    const results = validateFixtures(fixturesDir);
    expect(results.length).toBeGreaterThan(1);
    expect(results.some((result) => !result.expectedValid && !result.valid)).toBe(true);
  });

  it("returns useful errors for invalid fixtures", () => {
    const fixture = readFixture(join(fixturesDir, "invalid/event_missing_id.json"));
    const result = getContractSchema(fixture.schema).safeParse(fixture.data);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("id");
    }
  });

  it("has a sample valid fixture for every exported schema", () => {
    const validFixtureNames = new Set(
      listJsonFiles(join(fixturesDir, "valid")).map((file) => readFixture(file).schema)
    );

    for (const name of Object.keys(ContractSchemas)) {
      expect(validFixtureNames.has(name), `missing valid fixture for ${name}`).toBe(true);
      expect(() => getContractSchema(name)).not.toThrow();
    }
  });
});
