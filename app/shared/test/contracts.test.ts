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
  buildPrimitiveRequest,
  createPrimitiveHttpClient,
  createPrimitiveOperationsClient,
  parsePrimitiveCatalog,
  PrimitiveHttpError,
  PrimitiveResponseParseError,
  PrimitiveResponseValidationError,
  routeHasRequestBody,
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
      new Response(JSON.stringify({ ok: false, error: "duplicate idempotency key" }), {
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
      expect(primitiveError.route?.path).toBe("/onboarding/approvals/batch");
      expect(primitiveError.payload).toMatchObject({ error: "duplicate idempotency key" });
      expect(primitiveError.responseText).toContain("duplicate idempotency key");
    }
  });

  it("exposes typed primitive response parse and validation failures", async () => {
    const catalog = parsePrimitiveCatalog(readJsonObject(primitiveCatalogPath));
    const parseClient = createPrimitiveHttpClient({
      catalog,
      baseUrl: "http://127.0.0.1:4480",
      fetch: async () => new Response("not-json", { status: 200 })
    });

    await expect(parseClient.request("POST", "/agents/codex/auto-bind")).rejects.toBeInstanceOf(PrimitiveResponseParseError);

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
      "DELETE /follows-windows/exclusions/fwex_demo",
      "POST /workspace/restore"
    ]);
    expect(calls[1]?.body).toMatchObject({ action: "done", actor_id: "human_demo" });
    expect(calls[4]?.body).toMatchObject({ text: expect.any(String) });
    expect(calls[6]?.body).toBeUndefined();
    expect(calls[10]?.headers["idempotency-key"]).toBe("idem_workspace_restore");
  });

  it("binds primitive operation helpers for master, manual mode, tasks, reading, onboarding, contexts, and triggers", async () => {
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

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /master/fan-out",
      "GET /modes/manual",
      "POST /modes/manual",
      "POST /tasks",
      "GET /tasks",
      "GET /tasks/:id",
      "GET /tasks/:id/layout",
      "PUT /tasks/:id/layout",
      "POST /tasks/:id/workspace-snapshot",
      "GET /tasks/current",
      "POST /tasks/current",
      "GET /reading-queue",
      "POST /reading-queue/promote",
      "POST /reading-queue/auto-promote",
      "GET /onboarding/scan",
      "POST /onboarding/approvals",
      "POST /onboarding/approvals/batch",
      "POST /onboarding/rejections",
      "GET /contexts",
      "POST /contexts/restore-plan",
      "POST /contexts/restore-requests",
      "GET /contexts/restore-requests/next",
      "POST /contexts/restore-requests/claim-next",
      "GET /contexts/restore-requests/:id",
      "POST /contexts/restore-requests/:id/done",
      "POST /contexts/restore-requests/:id/failed",
      "POST /contexts/restore-requests/:id/retry",
      "GET /triggers",
      "POST /triggers",
      "GET /triggers/:id",
      "PATCH /triggers/:id",
      "DELETE /triggers/:id"
    ]);
    expect(calls[5]?.input).toMatchObject({ pathParams: { id: "task_demo_customer" } });
    expect(calls[7]?.input).toMatchObject({ body: workspaceSnapshot });
    expect(calls[23]?.input).toMatchObject({ pathParams: { id: "ctx_restore_123" } });
    expect(calls[30]?.input).toMatchObject({ pathParams: { id: "trg_deploy_watcher" } });
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
