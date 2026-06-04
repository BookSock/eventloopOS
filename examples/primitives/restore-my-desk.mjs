#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  await runSelfTest();
  console.log("restore-my-desk example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  node examples/primitives/restore-my-desk.mjs capture --output desk.json [--url http://127.0.0.1:4377]
  node examples/primitives/restore-my-desk.mjs plan --input desk.json [--url http://127.0.0.1:4377]
  node examples/primitives/restore-my-desk.mjs restore --input desk.json --execute [--url http://127.0.0.1:4377]

Small example app for the workspace_control primitive. It stores a workspace
snapshot in a plain JSON file, previews the restore plan, and only executes when
--execute is present.
`);
  process.exit(0);
}

const options = parseArgs(args);
const baseUrl = options.url ?? process.env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377";

if (options.command === "capture") {
  if (!options.output) die("capture requires --output");
  const body = await requestJson(baseUrl, "/workspace/capture", { method: "POST", body: {} });
  if (!body.snapshot) die("capture response did not include snapshot");
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(body.snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output: options.output, windows: body.snapshot.windows?.length ?? 0 }, null, 2));
} else if (options.command === "plan") {
  if (!options.input) die("plan requires --input");
  const snapshot = JSON.parse(await fs.readFile(options.input, "utf8"));
  const body = await requestJson(baseUrl, "/workspace/restore-plan", { method: "POST", body: { snapshot } });
  console.log(JSON.stringify(body, null, 2));
} else if (options.command === "restore") {
  if (!options.input) die("restore requires --input");
  if (!options.execute) die("restore requires --execute");
  const snapshot = JSON.parse(await fs.readFile(options.input, "utf8"));
  const idempotencyKey = options.idempotencyKey ?? `restore-my-desk-${Date.now()}`;
  const body = await requestJson(baseUrl, "/workspace/restore", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: { snapshot, confirm_execute: true },
  });
  console.log(JSON.stringify(body, null, 2));
} else {
  die(`unknown command: ${options.command}`);
}

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--input") options.input = readValue(argv, ++index, arg);
    else if (arg === "--output") options.output = readValue(argv, ++index, arg);
    else if (arg === "--url") options.url = readValue(argv, ++index, arg);
    else if (arg === "--idempotency-key") options.idempotencyKey = readValue(argv, ++index, arg);
    else die(`unknown option: ${arg}`);
  }
  return options;
}

async function requestJson(baseUrl, routePath, { method, body, headers = {} }) {
  const response = await fetch(new URL(routePath, baseUrl), {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${routePath} failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
  return payload;
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

async function runSelfTest() {
  assert.deepEqual(parseArgs(["capture", "--output", "desk.json"]), { command: "capture", output: "desk.json" });
  assert.deepEqual(parseArgs(["restore", "--input", "desk.json", "--execute", "--idempotency-key", "idem"]), {
    command: "restore",
    input: "desk.json",
    execute: true,
    idempotencyKey: "idem",
  });
}
