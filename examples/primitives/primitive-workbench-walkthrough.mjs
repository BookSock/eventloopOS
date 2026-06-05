#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPrimitiveSdk } from "./lib/primitive-sdk-loader.mjs";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  const sdk = await loadPrimitiveSdk();
  runSelfTest(sdk);
  console.log("primitive-workbench-walkthrough example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help")) {
  console.log(`Usage:
  node examples/primitives/primitive-workbench-walkthrough.mjs --id workspace_control
  node examples/primitives/primitive-workbench-walkthrough.mjs --category os_control --json
  node examples/primitives/primitive-workbench-walkthrough.mjs --catalog docs/primitives.catalog.json --id queue_paper_routing

Builds a starter workbench from the primitive catalog: selected primitives,
stable route operation ids, schemas, self-test commands, and latency proof
hooks. No live orchestrator is required.
`);
  process.exit(0);
}

const options = parseArgs(args);
const sdk = await loadPrimitiveSdk();
const catalogPath = path.resolve(options.catalog ?? "docs/primitives.catalog.json");
const catalog = sdk.parsePrimitiveCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
const walkthrough = buildWalkthrough(sdk, catalog, catalogPath, options);

if (options.json) {
  console.log(JSON.stringify(walkthrough, null, 2));
} else {
  printWalkthrough(walkthrough);
}

function buildWalkthrough(sdk, catalog, catalogPath, options) {
  const filter = {
    ids: options.ids,
    categories: options.categories,
    statuses: options.statuses,
    minRouteCount: options.minRouteCount,
    requireSelfTests: true,
    requireProofs: true,
  };
  const proofPlan = sdk.buildPrimitiveProofPlan(catalog, filter);
  const selected = new Set(proofPlan.selectedPrimitiveIds);
  const operationRoutesByPrimitive = groupOperationsByPrimitive(
    sdk.listPrimitiveOperations(catalog).filter((route) => selected.has(route.primitiveId))
  );
  const latencyBudgetsByPrimitive = groupLatencyBudgetsByPrimitive(proofPlan.latencyBudgets);
  const primitives = proofPlan.primitives
    .filter((primitive) => selected.has(primitive.id))
    .map((primitive) => ({
      id: primitive.id,
      title: primitive.title,
      status: primitive.status,
      category: primitive.category,
      summary: primitive.summary,
      route_count: primitive.routeCount,
      routes: (operationRoutesByPrimitive.get(primitive.id) ?? []).map((route) => ({
        operation: route.operation,
        method: route.route.method,
        path: route.route.path,
        request_schema: schemaReferenceName(route.route.request_schema),
        response_schema: schemaReferenceName(route.route.response_schema) ?? "FreeformJsonObject",
        query_parameters: queryParameterNames(route.route),
        latency_budgets: (latencyBudgetsByPrimitive.get(primitive.id) ?? [])
          .filter((budget) => budget.route === `${route.route.method} ${route.route.path}`)
          .map((budget) => budget.name),
      })),
      self_tests: selfTestsForPrimitive(catalog, primitive.id),
      proofs: proofsForPrimitive(catalog, primitive.id),
      latency_budgets: (latencyBudgetsByPrimitive.get(primitive.id) ?? []).map((budget) => ({
        name: budget.name,
        p95_ms: budget.p95Ms,
        proof: budget.proof,
        route: budget.route ?? null,
        hotkey: budget.hotkey ?? null,
      })),
    }));
  return {
    ok: proofPlan.missingPrimitiveIds.length === 0,
    catalog: catalogPath,
    source_catalog: "docs/primitives.catalog.json",
    selected_primitive_ids: proofPlan.selectedPrimitiveIds,
    missing_primitive_ids: proofPlan.missingPrimitiveIds,
    primitive_count: primitives.length,
    route_count: primitives.reduce((sum, primitive) => sum + primitive.route_count, 0),
    prerequisites: [
      "pnpm install --frozen-lockfile",
      "pnpm --filter @eventloopos/shared build",
      "node bin/primitives-host-doctor --skip-live",
    ],
    run_commands: [
      ...proofPlan.selfTestCommands.map((entry) => entry.command),
      ...Array.from(new Set(proofPlan.latencyBudgets.map((budget) => budget.proof))),
    ],
    primitives,
  };
}

function groupOperationsByPrimitive(operationRoutes) {
  const grouped = new Map();
  for (const route of operationRoutes) {
    const routes = grouped.get(route.primitiveId) ?? [];
    routes.push(route);
    grouped.set(route.primitiveId, routes);
  }
  for (const routes of grouped.values()) {
    routes.sort((left, right) => left.operation.localeCompare(right.operation));
  }
  return grouped;
}

function groupLatencyBudgetsByPrimitive(latencyBudgets) {
  const grouped = new Map();
  for (const budget of latencyBudgets) {
    const budgets = grouped.get(budget.primitiveId) ?? [];
    budgets.push(budget);
    grouped.set(budget.primitiveId, budgets);
  }
  return grouped;
}

function primitiveDefinition(catalog, primitiveId) {
  return catalog.primitives.find((primitive) => primitive.id === primitiveId);
}

function selfTestsForPrimitive(catalog, primitiveId) {
  return [...(primitiveDefinition(catalog, primitiveId)?.self_tests ?? [])].sort((left, right) => left.localeCompare(right));
}

function proofsForPrimitive(catalog, primitiveId) {
  return [...(primitiveDefinition(catalog, primitiveId)?.proofs ?? [])].sort((left, right) => left.localeCompare(right));
}

function queryParameterNames(route) {
  return (route.query_parameters ?? route.parameters ?? [])
    .map((parameter) => parameter.name)
    .sort((left, right) => left.localeCompare(right));
}

function schemaReferenceName(schema) {
  if (typeof schema === "string") return schema;
  return schema?.$ref?.split("/").at(-1) ?? null;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--catalog") options.catalog = readValue(argv, ++index, arg);
    else if (arg === "--id") pushValue(options, "ids", readValue(argv, ++index, arg));
    else if (arg === "--category") pushValue(options, "categories", readValue(argv, ++index, arg));
    else if (arg === "--status") pushValue(options, "statuses", readValue(argv, ++index, arg));
    else if (arg === "--min-routes") options.minRouteCount = parseNonNegativeInteger(readValue(argv, ++index, arg), arg);
    else die(`unknown option: ${arg}`);
  }
  return options;
}

function printWalkthrough(walkthrough) {
  if (!walkthrough.ok) console.error(`missing primitives: ${walkthrough.missing_primitive_ids.join(", ")}`);
  console.log(`primitive workbench: ${walkthrough.primitive_count} primitives, ${walkthrough.route_count} routes`);
  console.log("prerequisites");
  for (const command of walkthrough.prerequisites) console.log(`- ${command}`);
  console.log("proof commands");
  for (const command of walkthrough.run_commands) console.log(`- ${command}`);
  for (const primitive of walkthrough.primitives) {
    console.log(`primitive ${primitive.id} [${primitive.status}/${primitive.category}]`);
    for (const route of primitive.routes) {
      console.log(`- ${route.operation}: ${route.method} ${route.path} -> ${route.response_schema}`);
    }
  }
}

function pushValue(options, key, value) {
  options[key] = options[key] ?? [];
  options[key].push(value);
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) die(`missing value for ${flag}`);
  return value;
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) die(`${flag} must be a non-negative integer`);
  return parsed;
}

function die(message) {
  console.error(message);
  process.exit(2);
}

function runSelfTest(sdk) {
  assert.deepEqual(parseArgs(["--id", "workspace_control", "--category", "os_control", "--min-routes", "1"]), {
    ids: ["workspace_control"],
    categories: ["os_control"],
    minRouteCount: 1,
  });
  const fixturePath = path.resolve("examples/primitives/fixtures/workbench-catalog.json");
  const catalog = sdk.parsePrimitiveCatalog(JSON.parse(fs.readFileSync(fixturePath, "utf8")));
  const walkthrough = buildWalkthrough(sdk, catalog, fixturePath, { ids: ["workspace_control", "missing"] });
  assert.equal(walkthrough.ok, false);
  assert.deepEqual(walkthrough.selected_primitive_ids, ["workspace_control"]);
  assert.deepEqual(walkthrough.missing_primitive_ids, ["missing"]);
  assert.equal(walkthrough.primitive_count, 1);
  assert.equal(walkthrough.route_count, 2);
  assert.deepEqual(walkthrough.primitives[0].routes.map((route) => route.operation), [
    "workspace_control_get_workspace_status",
    "workspace_control_post_workspace_capture",
  ]);
  assert.deepEqual(walkthrough.primitives[0].latency_budgets, [{
    name: "workspace_capture",
    p95_ms: 5000,
    proof: "bin/workspace-latency-proof",
    route: "POST /workspace/capture",
    hotkey: null,
  }]);
}
