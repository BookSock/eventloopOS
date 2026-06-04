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
  ReviewPacketSchema,
  TaskWindowClaimCreateRequestSchema,
  WorkspaceSnapshotResourceSchema,
  getContractSchema
} from "../src/index.js";
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
