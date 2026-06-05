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
  node examples/primitives/operation-id-client.mjs queue_paper_routing_get_queue_by_id_lineage --path-param id=qit_feedback_001 --query limit=25 --json
  node examples/primitives/operation-id-client.mjs workspace_control_get_workspace_status --url http://127.0.0.1:4377
  node examples/primitives/operation-id-client.mjs queue_paper_routing_get_queue --query state=ready --timeout-ms 1500

Calls an eventloopOS primitive by stable operation id from docs/primitives.catalog.json.
The shared SDK resolves operation id -> method/path, validates request inputs,
performs the HTTP call, and validates the response schema.
`);
  process.exit(0);
}

const options = parseArgs(args);
const { client } = await createPrimitiveExampleOperationClient({
  baseUrl: options.url,
  catalogPath: options.catalog,
  timeoutMs: options.timeoutMs,
});
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
    operation: argv[0],
    pathParams: {},
    query: {},
    strictQuery: true,
  };
  if (!options.operation || options.operation.startsWith("--")) die("missing operation id");
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--allow-unknown-query") options.strictQuery = false;
    else if (arg === "--url") options.url = readValue(argv, ++index, arg);
    else if (arg === "--catalog") options.catalog = readValue(argv, ++index, arg);
    else if (arg === "--timeout-ms") options.timeoutMs = parsePositiveInteger(readValue(argv, ++index, arg), arg);
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
    operation: "queue_paper_routing_get_queue_by_id_lineage",
    pathParams: { id: "qit_feedback_001" },
    query: { limit: 25 },
    strictQuery: false,
  });

  const calls = [];
  const { client } = await createPrimitiveExampleOperationClient({
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

  const response = await client.requestOperation("workspace_control_get_workspace_status");
  assert.deepEqual(response.status, { available: true, backend: "aerospace" });
  assert.deepEqual(calls, [{
    url: "http://127.0.0.1:4480/workspace/status",
    method: "GET",
  }]);
}
