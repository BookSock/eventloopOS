#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createPrimitiveExampleOperationClient,
} from "./lib/primitive-sdk-loader.mjs";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  await runSelfTest();
  console.log("operation-id-client example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  node examples/primitives/operation-id-client.mjs list [--category os_control] [--json]
  node examples/primitives/operation-id-client.mjs describe workspace_control_get_workspace_status --json
  node examples/primitives/operation-id-client.mjs queue_paper_routing_get_queue_by_id_lineage --path-param id=qit_feedback_001 --query limit=25 --json
  node examples/primitives/operation-id-client.mjs workspace_control_get_workspace_status --url http://127.0.0.1:4377
  node examples/primitives/operation-id-client.mjs queue_paper_routing_get_queue --query state=ready --timeout-ms 1500

Calls an eventloopOS primitive by stable operation id from docs/primitives.catalog.json.
Use list/describe to discover operations without needing a live orchestrator.
The shared SDK resolves operation id -> method/path, validates request inputs,
performs the HTTP call, and validates the response schema.
`);
  process.exit(0);
}

const options = parseArgs(args);
const { sdk, catalog, client } = await createPrimitiveExampleOperationClient({
  baseUrl: options.url,
  catalogPath: options.catalog,
  timeoutMs: options.timeoutMs,
});

if (options.command === "list") {
  const operations = listOperations(sdk, catalog, options);
  if (options.json) {
    console.log(JSON.stringify({ ok: true, count: operations.length, operations }, null, 2));
  } else {
    printOperations(operations);
  }
  process.exit(0);
}

if (options.command === "describe") {
  const operation = describeOperation(sdk, catalog, options.operation);
  if (!operation) die(`unknown operation id: ${options.operation}`);
  if (options.json) {
    console.log(JSON.stringify({ ok: true, operation }, null, 2));
  } else {
    printOperation(operation);
  }
  process.exit(0);
}

const response = await client.requestOperation(options.operation, {
  pathParams: options.pathParams,
  query: options.query,
  body: options.body,
  strictQuery: options.strictQuery,
});

if (options.json) {
  console.log(JSON.stringify({ ok: true, operation: options.operation, response }, null, 2));
} else {
  console.log(`operation ok: ${options.operation}`);
  console.log(JSON.stringify(response, null, 2));
}

function parseArgs(argv) {
  const options = {
    command: ["list", "describe"].includes(argv[0]) ? argv[0] : "call",
    operation: argv[0] === "describe" ? argv[1] : argv[0] === "list" ? undefined : argv[0],
    pathParams: {},
    query: {},
    strictQuery: true,
    categories: [],
    statuses: [],
  };
  if (options.command !== "list" && (!options.operation || options.operation.startsWith("--"))) die("missing operation id");
  const startIndex = options.command === "call" ? 1 : options.command === "describe" ? 2 : 1;
  for (let index = startIndex; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--allow-unknown-query") options.strictQuery = false;
    else if (arg === "--url") options.url = readValue(argv, ++index, arg);
    else if (arg === "--catalog") options.catalog = readValue(argv, ++index, arg);
    else if (arg === "--timeout-ms") options.timeoutMs = parsePositiveInteger(readValue(argv, ++index, arg), arg);
    else if (arg === "--category") options.categories.push(readValue(argv, ++index, arg));
    else if (arg === "--status") options.statuses.push(readValue(argv, ++index, arg));
    else if (arg === "--path-param") {
      const [key, value] = parsePair(readValue(argv, ++index, arg), arg);
      options.pathParams[key] = value;
    } else if (arg === "--query") {
      const [key, value] = parsePair(readValue(argv, ++index, arg), arg);
      options.query[key] = coerceScalar(value);
    } else if (arg === "--body-json") {
      options.body = JSON.parse(readValue(argv, ++index, arg));
    } else {
      die(`unknown option: ${arg}`);
    }
  }
  return options;
}

function listOperations(sdk, catalog, options) {
  const index = sdk.buildPrimitiveApiIndex(catalog);
  return index.primitives
    .filter((primitive) => options.categories.length === 0 || options.categories.includes(primitive.category))
    .filter((primitive) => options.statuses.length === 0 || options.statuses.includes(primitive.status))
    .flatMap((primitive) => primitive.routes.map((route) => operationSummary(primitive, route)))
    .sort((left, right) => left.operation.localeCompare(right.operation));
}

function describeOperation(sdk, catalog, operationId) {
  const index = sdk.buildPrimitiveApiIndex(catalog);
  for (const primitive of index.primitives) {
    const route = primitive.routes.find((candidate) => candidate.operation === operationId);
    if (route) return operationDetail(primitive, route);
  }
  return undefined;
}

function operationSummary(primitive, route) {
  return {
    operation: route.operation,
    primitive_id: primitive.id,
    primitive_title: primitive.title,
    category: primitive.category,
    status: primitive.status,
    method: route.method,
    path: route.path,
    request_schema: route.requestSchema ?? null,
    response_schema: route.responseSchema,
    query_parameters: route.queryParameters,
    request_body: route.requestBody,
  };
}

function operationDetail(primitive, route) {
  return {
    ...operationSummary(primitive, route),
    route_file: route.routeFile,
    latency_budgets: route.latencyBudgets.map((budget) => ({
      name: budget.name,
      p95_ms: budget.p95Ms,
      proof: budget.proof,
    })),
  };
}

function printOperations(operations) {
  for (const operation of operations) {
    console.log(`${operation.operation}\t${operation.method} ${operation.path}\t${operation.primitive_id}`);
  }
}

function printOperation(operation) {
  console.log(`${operation.operation}`);
  console.log(`${operation.method} ${operation.path}`);
  console.log(`primitive: ${operation.primitive_id} (${operation.category}/${operation.status})`);
  if (operation.request_schema) console.log(`request: ${operation.request_schema}`);
  console.log(`response: ${operation.response_schema}`);
  if (operation.query_parameters.length > 0) console.log(`query: ${operation.query_parameters.join(", ")}`);
  if (operation.latency_budgets.length > 0) {
    console.log(`latency: ${operation.latency_budgets.map((budget) => `${budget.name} p95<=${budget.p95_ms}ms`).join(", ")}`);
  }
}

function parsePair(value, flag) {
  const split = value.indexOf("=");
  if (split <= 0) die(`${flag} must be key=value`);
  return [value.slice(0, split), value.slice(split + 1)];
}

function coerceScalar(value) {
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) die(`missing value for ${flag}`);
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) die(`${flag} must be a positive integer`);
  return parsed;
}

function die(message) {
  console.error(message);
  process.exit(2);
}

async function runSelfTest() {
  assert.deepEqual(parseArgs([
    "queue_paper_routing_get_queue_by_id_lineage",
    "--path-param",
    "id=qit_feedback_001",
    "--query",
    "limit=25",
    "--allow-unknown-query",
  ]), {
    command: "call",
    operation: "queue_paper_routing_get_queue_by_id_lineage",
    pathParams: { id: "qit_feedback_001" },
    query: { limit: 25 },
    strictQuery: false,
    categories: [],
    statuses: [],
  });

  assert.deepEqual(parseArgs([
    "list",
    "--category",
    "os_control",
    "--json",
  ]), {
    command: "list",
    operation: undefined,
    pathParams: {},
    query: {},
    strictQuery: true,
    categories: ["os_control"],
    statuses: [],
    json: true,
  });

  const calls = [];
  const { sdk, catalog, client } = await createPrimitiveExampleOperationClient({
    catalogPath: "examples/primitives/fixtures/workbench-catalog.json",
    baseUrl: "http://127.0.0.1:4480",
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({
        status: { available: true, backend: "aerospace" },
        execute_supported: true,
        request_id: "req_workspace_status",
      }), { status: 200 });
    },
  });
  const operations = listOperations(sdk, catalog, {
    categories: ["os_control"],
    statuses: [],
  });
  assert.deepEqual(operations.map((operation) => operation.operation), [
    "workspace_control_get_workspace_status",
    "workspace_control_post_workspace_capture",
  ]);

  assert.equal(
    describeOperation(sdk, catalog, "workspace_control_get_workspace_status").response_schema,
    "WorkspaceStatusResponse"
  );

  const response = await client.requestOperation("workspace_control_get_workspace_status");
  assert.deepEqual(response.status, { available: true, backend: "aerospace" });
  assert.deepEqual(calls, [{
    url: "http://127.0.0.1:4480/workspace/status",
    method: "GET",
  }]);
}
