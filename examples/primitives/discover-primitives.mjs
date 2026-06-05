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
  node examples/primitives/discover-primitives.mjs list --catalog docs/primitives.catalog.json

Small example app for discovering reusable eventloopOS primitive surfaces before
building against them. It consumes the shared primitive SDK exported at
@eventloopos/shared/primitives, reads the machine-readable primitive catalog,
and filters by status, category, route count, self-test coverage, proof
coverage, and latency-budget coverage.
`);
  process.exit(0);
}

const options = parseArgs(args);
if (options.command !== "list") die(`unknown command: ${options.command}`);

const sdk = await loadPrimitiveSdk();
const catalogPath = path.resolve(options.catalog ?? "docs/primitives.catalog.json");
const catalog = sdk.parsePrimitiveCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
const catalogSummary = sdk.summarizePrimitiveCatalog(catalog);
const capabilities = selectCapabilities(sdk, catalog, options);

if (options.json) {
  console.log(JSON.stringify({
    ok: true,
    catalog: catalogPath,
    catalog_summary: {
      primitives: catalogSummary.primitiveCount,
      routes: catalogSummary.routeCount,
      schemas: catalogSummary.schemaCount,
      latency_budgets: catalogSummary.latencyBudgetCount,
      responsiveness_critical: catalogSummary.responsivenessCriticalCount,
    },
    count: capabilities.length,
    primitives: capabilities,
  }, null, 2));
} else {
  printTable(capabilities);
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
    && typeof sdk.selectPrimitiveCapabilities === "function";
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
        self_tests: ["pnpm test"],
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
}
