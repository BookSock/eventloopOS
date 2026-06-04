#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  runSelfTest();
  console.log("discover-primitives example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  node examples/primitives/discover-primitives.mjs list [--status dogfood] [--category os_control]
  node examples/primitives/discover-primitives.mjs list --min-routes 4 --require-self-tests --require-proofs --json
  node examples/primitives/discover-primitives.mjs list --catalog docs/primitives.catalog.json

Small example app for discovering reusable eventloopOS primitive surfaces before
building against them. It reads the machine-readable primitive catalog and
filters by status, category, route count, self-test coverage, and proof coverage.
`);
  process.exit(0);
}

const options = parseArgs(args);
if (options.command !== "list") die(`unknown command: ${options.command}`);

const catalogPath = path.resolve(options.catalog ?? "docs/primitives.catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const capabilities = selectCapabilities(summarizeCatalog(catalog), options);

if (options.json) {
  console.log(JSON.stringify({ ok: true, catalog: catalogPath, count: capabilities.length, primitives: capabilities }, null, 2));
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
    else if (arg === "--catalog") options.catalog = readValue(argv, ++index, arg);
    else if (arg === "--id") pushValue(options, "ids", readValue(argv, ++index, arg));
    else if (arg === "--status") pushValue(options, "statuses", readValue(argv, ++index, arg));
    else if (arg === "--category") pushValue(options, "categories", readValue(argv, ++index, arg));
    else if (arg === "--min-routes") options.minRouteCount = parsePositiveInteger(readValue(argv, ++index, arg), arg);
    else die(`unknown option: ${arg}`);
  }
  return options;
}

function summarizeCatalog(catalog) {
  const primitives = Array.isArray(catalog.primitives) ? catalog.primitives : [];
  return primitives.map((primitive) => summarizePrimitive(primitive));
}

function summarizePrimitive(primitive) {
  const http = Array.isArray(primitive.http) ? primitive.http : [];
  const cli = arrayOfStrings(primitive.cli);
  const selfTests = arrayOfStrings(primitive.self_tests);
  const proofs = arrayOfStrings(primitive.proofs);
  return {
    id: String(primitive.id ?? ""),
    title: String(primitive.title ?? primitive.id ?? ""),
    status: String(primitive.status ?? "unknown"),
    category: classifyPrimitive(primitive, http),
    routes: http.length,
    cli: cli.length,
    self_tests: selfTests.length,
    proofs: proofs.length,
  };
}

function selectCapabilities(capabilities, options) {
  const ids = options.ids ? new Set(options.ids) : undefined;
  const statuses = options.statuses ? new Set(options.statuses) : undefined;
  const categories = options.categories ? new Set(options.categories) : undefined;
  const minRouteCount = options.minRouteCount ?? 0;
  return capabilities.filter((primitive) => {
    if (ids && !ids.has(primitive.id)) return false;
    if (statuses && !statuses.has(primitive.status)) return false;
    if (categories && !categories.has(primitive.category)) return false;
    if (primitive.routes < minRouteCount) return false;
    if (options.requireCli === true && primitive.cli === 0) return false;
    if (options.requireSelfTests === true && primitive.self_tests === 0) return false;
    if (options.requireProofs === true && primitive.proofs === 0) return false;
    return true;
  });
}

function printTable(capabilities) {
  if (capabilities.length === 0) {
    console.log("no matching primitives");
    return;
  }
  console.log(["id", "status", "category", "routes", "cli", "self_tests", "proofs"].join("\t"));
  for (const primitive of capabilities) {
    console.log([
      primitive.id,
      primitive.status,
      primitive.category,
      primitive.routes,
      primitive.cli,
      primitive.self_tests,
      primitive.proofs,
    ].join("\t"));
  }
}

function classifyPrimitive(primitive, http) {
  const id = String(primitive.id ?? "");
  if (id.includes("workspace") || id.includes("window") || id === "manual_mode" || id === "mac_app_hotkeys") return "os_control";
  if (id.includes("queue") || id.includes("routing") || id.includes("command") || id.includes("trigger")) return "attention_routing";
  if (id.includes("agent") || id.includes("session") || id.includes("context")) return "agent_context";
  if (http.some((route) => String(route.path ?? "").startsWith("/health") || String(route.path ?? "").startsWith("/metrics"))) {
    return "observability";
  }
  return "runtime";
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()) : [];
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

function runSelfTest() {
  assert.deepEqual(parseArgs(["list", "--status", "dogfood", "--category", "os_control", "--min-routes", "2"]), {
    command: "list",
    statuses: ["dogfood"],
    categories: ["os_control"],
    minRouteCount: 2,
  });
  const fixture = {
    primitives: [
      {
        id: "workspace_control",
        title: "Workspace Control",
        status: "dogfood",
        http: [{ method: "GET", path: "/workspace/status" }],
        cli: [],
        self_tests: ["pnpm test"],
        proofs: ["proof.ts"],
      },
      {
        id: "runtime_spine",
        title: "Runtime Spine",
        status: "stable_enough",
        http: [],
        cli: [],
        self_tests: ["pnpm test"],
        proofs: ["runtime.ts"],
      },
    ],
  };
  assert.deepEqual(selectCapabilities(summarizeCatalog(fixture), {
    categories: ["os_control"],
    requireSelfTests: true,
    requireProofs: true,
  }).map((primitive) => primitive.id), ["workspace_control"]);
  assert.deepEqual(selectCapabilities(summarizeCatalog(fixture), {
    statuses: ["stable_enough"],
  }).map((primitive) => primitive.id), ["runtime_spine"]);
}
