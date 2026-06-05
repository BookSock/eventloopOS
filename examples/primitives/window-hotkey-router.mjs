#!/usr/bin/env node
import assert from "node:assert/strict";
import { createPrimitiveExampleOperations } from "./lib/primitive-sdk-loader.mjs";

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  runSelfTest();
  console.log("window-hotkey-router example self-test passed");
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  node examples/primitives/window-hotkey-router.mjs claim --task-id task_x --window-id 123
  node examples/primitives/window-hotkey-router.mjs claim-root --task-id task_x --process-root-pid 4242
  node examples/primitives/window-hotkey-router.mjs unfollow-title --title Slack
  node examples/primitives/window-hotkey-router.mjs follow-again --exclusion-id fwex_x
  node examples/primitives/window-hotkey-router.mjs claim --task-id task_x --window-id 123 --timeout-ms 5000

Small example app for wiring external hotkey tools to eventloopOS primitives.
Attach these commands to Keyboard Maestro, Hammerspoon, AeroSpace, or another
hotkey runner to claim windows for a task or control sticky follows-window rules.
Live calls use @eventloopos/shared/primitives for catalog validation, typed
operation helpers, and request timeouts.
`);
  process.exit(0);
}

const options = parseArgs(args);
const baseUrl = options.url ?? process.env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377";
const { ops } = await createPrimitiveExampleOperations({
  baseUrl,
  catalogPath: options.catalog,
  timeoutMs: options.timeoutMs,
});
const body = await runCommand(ops, options);
console.log(JSON.stringify(body, null, 2));

async function runCommand(ops, options) {
  if (options.command === "claim") {
    return await ops.taskWindowClaims.create(claimBody(options));
  }
  if (options.command === "claim-root") {
    return await ops.taskWindowClaims.create(claimRootBody(options));
  }
  if (options.command === "unfollow-title") {
    if (!options.title) die("unfollow-title requires --title");
    return await ops.followsWindows.exclude({ title_substring: options.title });
  }
  if (options.command === "follow-again") {
    if (!options.exclusionId) die("follow-again requires --exclusion-id");
    return await ops.followsWindows.deleteExclusion(options.exclusionId);
  }
  die(`unknown command: ${options.command}`);
}

function requestPlan(options) {
  if (options.command === "claim") {
    if (!options.taskId) die("claim requires --task-id");
    if (!options.windowId && !options.appBundle && !options.titlePrefix) {
      die("claim requires --window-id, --app-bundle, or --title-prefix");
    }
    return {
      method: "POST",
      path: "/task-window-claims",
      body: claimBody(options),
    };
  }
  if (options.command === "claim-root") {
    if (!options.taskId) die("claim-root requires --task-id");
    const processRootPid = Number(options.processRootPid);
    if (!Number.isInteger(processRootPid) || processRootPid <= 0) die("claim-root requires positive --process-root-pid");
    return {
      method: "POST",
      path: "/task-window-claims",
      body: claimRootBody(options),
    };
  }
  if (options.command === "unfollow-title") {
    if (!options.title) die("unfollow-title requires --title");
    return {
      method: "POST",
      path: "/follows-windows/exclude",
      body: { title_substring: options.title },
    };
  }
  if (options.command === "follow-again") {
    if (!options.exclusionId) die("follow-again requires --exclusion-id");
    return {
      method: "DELETE",
      path: `/follows-windows/exclusions/${encodeURIComponent(options.exclusionId)}`,
    };
  }
  die(`unknown command: ${options.command}`);
}

function claimBody(options) {
  if (!options.taskId) die("claim requires --task-id");
  if (!options.windowId && !options.appBundle && !options.titlePrefix) {
    die("claim requires --window-id, --app-bundle, or --title-prefix");
  }
  return {
    task_id: options.taskId,
    window_id: options.windowId,
    app_bundle: options.appBundle,
    title_prefix: options.titlePrefix,
    source: "example_window_hotkey_router",
  };
}

function claimRootBody(options) {
  if (!options.taskId) die("claim-root requires --task-id");
  const processRootPid = Number(options.processRootPid);
  if (!Number.isInteger(processRootPid) || processRootPid <= 0) die("claim-root requires positive --process-root-pid");
  return {
    task_id: options.taskId,
    process_root_pid: processRootPid,
    source: "example_window_hotkey_router",
  };
}

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task-id") options.taskId = readValue(argv, ++index, arg);
    else if (arg === "--window-id") options.windowId = readValue(argv, ++index, arg);
    else if (arg === "--app-bundle") options.appBundle = readValue(argv, ++index, arg);
    else if (arg === "--title-prefix") options.titlePrefix = readValue(argv, ++index, arg);
    else if (arg === "--process-root-pid") options.processRootPid = readValue(argv, ++index, arg);
    else if (arg === "--title") options.title = readValue(argv, ++index, arg);
    else if (arg === "--exclusion-id") options.exclusionId = readValue(argv, ++index, arg);
    else if (arg === "--url") options.url = readValue(argv, ++index, arg);
    else if (arg === "--catalog") options.catalog = readValue(argv, ++index, arg);
    else if (arg === "--timeout-ms") options.timeoutMs = parsePositiveInteger(readValue(argv, ++index, arg), arg);
    else die(`unknown option: ${arg}`);
  }
  return options;
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

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) die(`${flag} must be a positive integer`);
  return parsed;
}

function runSelfTest() {
  assert.deepEqual(requestPlan(parseArgs(["claim", "--task-id", "task_demo", "--window-id", "123"])), {
    method: "POST",
    path: "/task-window-claims",
    body: {
      task_id: "task_demo",
      window_id: "123",
      app_bundle: undefined,
      title_prefix: undefined,
      source: "example_window_hotkey_router",
    },
  });
  assert.equal(requestPlan(parseArgs(["claim-root", "--task-id", "task_demo", "--process-root-pid", "4242"])).body.process_root_pid, 4242);
  assert.deepEqual(requestPlan(parseArgs(["unfollow-title", "--title", "Slack"])), {
    method: "POST",
    path: "/follows-windows/exclude",
    body: { title_substring: "Slack" },
  });
  assert.deepEqual(requestPlan(parseArgs(["follow-again", "--exclusion-id", "fwex_demo"])), {
    method: "DELETE",
    path: "/follows-windows/exclusions/fwex_demo",
  });
}
