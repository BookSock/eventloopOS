#!/usr/bin/env node
import assert from "node:assert/strict";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  runSelfTest();
  console.log("agent-attention-queue example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  node examples/primitives/agent-attention-queue.mjs list [--url http://127.0.0.1:4377] [--state ready]
  node examples/primitives/agent-attention-queue.mjs boost --id qit_x --delta 100
  node examples/primitives/agent-attention-queue.mjs defer --id qit_x --minutes 30

Small example app for the queue_paper_routing primitive. It lists attention
papers and changes queue priority/defer state without the macOS queue UI.
`);
  process.exit(0);
}

const options = parseArgs(args);
const baseUrl = options.url ?? process.env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377";
const plan = requestPlan(options);
const body = await requestJson(baseUrl, plan);
console.log(JSON.stringify(body, null, 2));

function requestPlan(options) {
  if (options.command === "list") {
    const query = new URLSearchParams();
    if (options.state) query.set("state", options.state);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return { method: "GET", path: `/queue${suffix}` };
  }
  if (options.command === "boost") {
    if (!options.id) die("boost requires --id");
    const delta = Number(options.delta ?? 100);
    if (!Number.isFinite(delta)) die("--delta must be a number");
    return {
      method: "POST",
      path: `/queue/${encodeURIComponent(options.id)}/priority`,
      body: { delta, reason: "example_app_boost" },
    };
  }
  if (options.command === "defer") {
    if (!options.id) die("defer requires --id");
    const minutes = Number(options.minutes ?? 30);
    if (!Number.isFinite(minutes) || minutes <= 0) die("--minutes must be positive");
    return {
      method: "POST",
      path: `/queue/${encodeURIComponent(options.id)}/defer`,
      body: { actor_id: "example_agent_attention_queue", due_at: new Date(Date.now() + minutes * 60_000).toISOString() },
    };
  }
  die(`unknown command: ${options.command}`);
}

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") options.id = readValue(argv, ++index, arg);
    else if (arg === "--state") options.state = readValue(argv, ++index, arg);
    else if (arg === "--delta") options.delta = readValue(argv, ++index, arg);
    else if (arg === "--minutes") options.minutes = readValue(argv, ++index, arg);
    else if (arg === "--url") options.url = readValue(argv, ++index, arg);
    else die(`unknown option: ${arg}`);
  }
  return options;
}

async function requestJson(baseUrl, plan) {
  const response = await fetch(new URL(plan.path, baseUrl), {
    method: plan.method,
    headers: plan.body ? { "content-type": "application/json" } : undefined,
    body: plan.body ? JSON.stringify(plan.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${plan.method} ${plan.path} failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
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

function runSelfTest() {
  assert.deepEqual(requestPlan(parseArgs(["list", "--state", "deferred"])), { method: "GET", path: "/queue?state=deferred" });
  assert.deepEqual(requestPlan(parseArgs(["boost", "--id", "qit_1", "--delta", "25"])), {
    method: "POST",
    path: "/queue/qit_1/priority",
    body: { delta: 25, reason: "example_app_boost" },
  });
  assert.equal(requestPlan(parseArgs(["defer", "--id", "qit_1", "--minutes", "1"])).path, "/queue/qit_1/defer");
}
