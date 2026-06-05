#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  const sdk = await loadPrimitiveSdk();
  runSelfTest(sdk);
  console.log("discover-primitives example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  node examples/primitives/discover-primitives.mjs list [--status dogfood] [--category os_control]
  node examples/primitives/discover-primitives.mjs list --min-routes 4 --require-self-tests --require-proofs --json
  node examples/primitives/discover-primitives.mjs list --require-responsive --require-latency-budgets
  node examples/primitives/discover-primitives.mjs self-tests --id workspace_control
  node examples/primitives/discover-primitives.mjs self-tests --category os_control --json
  node examples/primitives/discover-primitives.mjs latency-budgets --require-responsive --json
  node examples/primitives/discover-primitives.mjs list --catalog docs/primitives.catalog.json

Small example app for discovering reusable eventloopOS primitive surfaces before
building against them. It consumes the shared primitive SDK exported at
@eventloopos/shared/primitives, reads the machine-readable primitive catalog,
and filters by status, category, route count, self-test coverage, proof
coverage, and latency-budget coverage. The self-tests command shows which
cataloged proof commands to run for a primitive subset. The latency-budgets
command shows the p95 responsiveness budgets and proof hooks.
`);
  process.exit(0);
}

const options = parseArgs(args);
if (!["list", "self-tests", "latency-budgets"].includes(options.command)) die(`unknown command: ${options.command}`);

const sdk = await loadPrimitiveSdk();
const catalogPath = path.resolve(options.catalog ?? "docs/primitives.catalog.json");
const catalog = sdk.parsePrimitiveCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
const catalogSummary = sdk.summarizePrimitiveCatalog(catalog);

if (options.command === "list") {
  const capabilities = selectCapabilities(sdk, catalog, options);
  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      catalog: catalogPath,
      catalog_summary: toExampleCatalogSummary(catalogSummary),
      count: capabilities.length,
      primitives: capabilities,
    }, null, 2));
  } else {
    printTable(capabilities);
  }
} else if (options.command === "self-tests") {
  const selfTests = selectSelfTests(sdk, catalog, catalogSummary, options);
  const commands = selfTests.commands.map((command) => ({
    command: command.command,
    primitive_ids: command.primitiveIds,
  }));
  if (options.json) {
    console.log(JSON.stringify({
      ok: selfTests.missingPrimitiveIds.length === 0,
      catalog: catalogPath,
      catalog_summary: toExampleCatalogSummary(catalogSummary),
      selected_primitive_ids: selfTests.selectedPrimitiveIds,
      missing_primitive_ids: selfTests.missingPrimitiveIds,
      count: commands.length,
      commands,
    }, null, 2));
  } else {
    printSelfTestTable(commands, selfTests.missingPrimitiveIds);
  }
} else {
  const budgets = sdk.selectPrimitiveLatencyBudgets(catalog, {
    ids: options.ids,
    statuses: options.statuses,
    categories: options.categories,
    minRouteCount: options.minRouteCount,
    requireCli: options.requireCli,
    requireSelfTests: options.requireSelfTests,
    requireProofs: options.requireProofs,
    requireLatencyBudgets: options.requireLatencyBudgets,
    requireResponsivenessCritical: options.requireResponsive,
  }).map(toExampleLatencyBudget);
  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      catalog: catalogPath,
      catalog_summary: toExampleCatalogSummary(catalogSummary),
      count: budgets.length,
      latency_budgets: budgets,
    }, null, 2));
  } else {
    printLatencyBudgetTable(budgets);
  }
}

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--require-cli") options.requireCli = true;
    else if (arg === "--require-self-tests") options.requireSelfTests = true;
    else if (arg === "--require-proofs") options.requireProofs = true;
    else if (arg === "--require-latency-budgets") options.requireLatencyBudgets = true;
    else if (arg === "--require-responsive") options.requireResponsive = true;
    else if (arg === "--catalog") options.catalog = readValue(argv, ++index, arg);
    else if (arg === "--id") pushValue(options, "ids", readValue(argv, ++index, arg));
    else if (arg === "--status") pushValue(options, "statuses", readValue(argv, ++index, arg));
    else if (arg === "--category") pushValue(options, "categories", readValue(argv, ++index, arg));
    else if (arg === "--min-routes") options.minRouteCount = parsePositiveInteger(readValue(argv, ++index, arg), arg);
    else die(`unknown option: ${arg}`);
  }
  return options;
}

function toExampleCatalogSummary(summary) {
  return {
    primitives: summary.primitiveCount,
    routes: summary.routeCount,
    schemas: summary.schemaCount,
    latency_budgets: summary.latencyBudgetCount,
    responsiveness_critical: summary.responsivenessCriticalCount,
  };
}

function selectCapabilities(sdk, catalog, options) {
  return sdk.selectPrimitiveCapabilities(catalog, {
    ids: options.ids,
    statuses: options.statuses,
    categories: options.categories,
    minRouteCount: options.minRouteCount,
    requireCli: options.requireCli,
    requireSelfTests: options.requireSelfTests,
    requireProofs: options.requireProofs,
    requireLatencyBudgets: options.requireLatencyBudgets,
    requireResponsivenessCritical: options.requireResponsive,
  }).map(toExampleCapability);
}

function toExampleCapability(primitive) {
  return {
    id: primitive.id,
    title: primitive.title,
    status: primitive.status,
    category: primitive.category,
    summary: primitive.summary,
    routes: primitive.routeCount,
    cli: primitive.cliCommandCount,
    self_tests: primitive.selfTestCount,
    proofs: primitive.proofRefCount,
    latency_budgets: primitive.latencyBudgetCount,
    responsiveness_critical: primitive.responsivenessCritical,
  };
}

function toExampleLatencyBudget(budget) {
  return {
    primitive_id: budget.primitiveId,
    primitive_title: budget.primitiveTitle,
    primitive_status: budget.primitiveStatus,
    primitive_category: budget.primitiveCategory,
    name: budget.name,
    p95_ms: budget.p95Ms,
    proof: budget.proof,
    ...(budget.scope ? { scope: budget.scope } : {}),
    ...(budget.route ? { route: budget.route } : {}),
    ...(budget.hotkey ? { hotkey: budget.hotkey } : {}),
  };
}

function selectSelfTests(sdk, catalog, catalogSummary, options) {
  const ids = primitiveIdsForSelfTests(sdk, catalog, catalogSummary, options);
  return sdk.selectPrimitiveSelfTestCommands(catalog, ids);
}

function primitiveIdsForSelfTests(sdk, catalog, catalogSummary, options) {
  if (!hasCapabilityFilters(options)) return options.ids ?? [];
  const selectedIds = selectCapabilities(sdk, catalog, options).map((primitive) => primitive.id);
  const knownIds = new Set(catalogSummary.primitives.map((primitive) => primitive.id));
  const unknownExplicitIds = (options.ids ?? []).filter((id) => !knownIds.has(id));
  return [...selectedIds, ...unknownExplicitIds];
}

function hasCapabilityFilters(options) {
  return Boolean(
    options.statuses
      || options.categories
      || options.minRouteCount !== undefined
      || options.requireCli
      || options.requireSelfTests
      || options.requireProofs
      || options.requireLatencyBudgets
      || options.requireResponsive
  );
}

function printTable(capabilities) {
  if (capabilities.length === 0) {
    console.log("no matching primitives");
    return;
  }
  console.log(["id", "status", "category", "routes", "cli", "self_tests", "proofs", "latency_budgets"].join("\t"));
  for (const primitive of capabilities) {
    console.log([
      primitive.id,
      primitive.status,
      primitive.category,
      primitive.routes,
      primitive.cli,
      primitive.self_tests,
      primitive.proofs,
      primitive.latency_budgets,
    ].join("\t"));
  }
}

function printSelfTestTable(commands, missingPrimitiveIds) {
  if (missingPrimitiveIds.length > 0) {
    console.error(`missing primitives: ${missingPrimitiveIds.join(", ")}`);
  }
  if (commands.length === 0) {
    console.log("no matching self-test commands");
    return;
  }
  console.log(["command", "primitive_ids"].join("\t"));
  for (const command of commands) {
    console.log([command.command, command.primitive_ids.join(",")].join("\t"));
  }
}

function printLatencyBudgetTable(budgets) {
  if (budgets.length === 0) {
    console.log("no matching latency budgets");
    return;
  }
  console.log(["primitive_id", "name", "p95_ms", "proof", "route", "hotkey"].join("\t"));
  for (const budget of budgets) {
    console.log([
      budget.primitive_id,
      budget.name,
      budget.p95_ms,
      budget.proof,
      budget.route ?? "",
      budget.hotkey ?? "",
    ].join("\t"));
  }
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) die(`${flag} must be a non-negative integer`);
  return parsed;
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

function die(message) {
  console.error(message);
  process.exit(2);
}

async function loadPrimitiveSdk() {
  const sdkUrl = new URL("../../app/shared/dist/primitives.js", import.meta.url);
  try {
    const sdk = await import(sdkUrl.href);
    if (hasPrimitiveSdkExports(sdk)) return sdk;
    throw new Error("app/shared/dist/primitives.js is missing required primitive SDK exports");
  } catch (firstError) {
    try {
      execFileSync("pnpm", ["--filter", "@eventloopos/shared", "build"], {
        cwd: new URL("../..", import.meta.url),
        stdio: "ignore",
      });
      const sdk = await import(`${sdkUrl.href}?built=${Date.now()}`);
      if (hasPrimitiveSdkExports(sdk)) return sdk;
      throw new Error("rebuilt app/shared/dist/primitives.js is missing required primitive SDK exports");
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      die(`failed to load @eventloopos/shared/primitives SDK from app/shared/dist/primitives.js: ${firstMessage}; build failed: ${message}`);
    }
  }
}

function hasPrimitiveSdkExports(sdk) {
  return typeof sdk.parsePrimitiveCatalog === "function"
    && typeof sdk.summarizePrimitiveCatalog === "function"
    && typeof sdk.selectPrimitiveCapabilities === "function"
    && typeof sdk.selectPrimitiveSelfTestCommands === "function"
    && typeof sdk.selectPrimitiveLatencyBudgets === "function";
}

function runSelfTest(sdk) {
  assert.deepEqual(parseArgs(["list", "--status", "dogfood", "--category", "os_control", "--min-routes", "2"]), {
    command: "list",
    statuses: ["dogfood"],
    categories: ["os_control"],
    minRouteCount: 2,
  });
  const fixture = {
    schema_version: 1,
    schemas: {},
    primitives: [
      {
        id: "workspace_control",
        title: "Workspace Control",
        status: "dogfood",
        summary: "Capture, plan, and restore active window workspaces.",
        http: [{
          method: "GET",
          path: "/workspace/status",
          route_file: "app/orchestrator/src/server.ts",
          response_schema: "WorkspaceStatusResponse",
        }],
        code: ["app/orchestrator/src/workspace/controller.ts"],
        cli: [],
        self_tests: ["pnpm test"],
        proofs: ["proof.ts"],
        responsiveness_critical: true,
        latency_budgets: [{ name: "workspace_capture", p95_ms: 5000, proof: "proof.ts" }],
      },
      {
        id: "runtime_spine",
        title: "Runtime Spine",
        status: "stable_enough",
        summary: "Shared runtime dependency record.",
        http: [],
        code: ["app/orchestrator/src/runtime.ts"],
        cli: [],
        self_tests: ["pnpm runtime"],
        proofs: ["runtime.ts"],
      },
    ],
  };
  const catalog = sdk.parsePrimitiveCatalog(fixture);
  assert.deepEqual(selectCapabilities(sdk, catalog, {
    categories: ["os_control"],
    requireSelfTests: true,
    requireProofs: true,
  }).map((primitive) => primitive.id), ["workspace_control"]);
  assert.deepEqual(selectCapabilities(sdk, catalog, {
    statuses: ["stable_enough"],
  }).map((primitive) => primitive.id), ["runtime_spine"]);
  assert.deepEqual(selectCapabilities(sdk, catalog, {
    requireResponsive: true,
    requireLatencyBudgets: true,
  }).map((primitive) => primitive.id), ["workspace_control"]);
  assert.deepEqual(selectSelfTests(sdk, catalog, sdk.summarizePrimitiveCatalog(catalog), {
    command: "self-tests",
    categories: ["os_control"],
  }).commands, [{
    command: "pnpm test",
    primitiveIds: ["workspace_control"],
  }]);
  assert.deepEqual(selectSelfTests(sdk, catalog, sdk.summarizePrimitiveCatalog(catalog), {
    command: "self-tests",
    ids: ["runtime_spine", "missing"],
  }), {
    selectedPrimitiveIds: ["runtime_spine"],
    missingPrimitiveIds: ["missing"],
    commands: [{
      command: "pnpm runtime",
      primitiveIds: ["runtime_spine"],
    }],
  });
  assert.deepEqual(sdk.selectPrimitiveLatencyBudgets(catalog, {
    requireResponsivenessCritical: true,
  }).map(toExampleLatencyBudget), [{
    primitive_id: "workspace_control",
    primitive_title: "Workspace Control",
    primitive_status: "dogfood",
    primitive_category: "os_control",
    name: "workspace_capture",
    p95_ms: 5000,
    proof: "proof.ts",
  }]);
}
