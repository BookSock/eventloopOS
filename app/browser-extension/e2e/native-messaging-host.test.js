import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import {
  HOST_NAME,
  CHROME_BROWSER_FLAVORS,
  chromeNativeMessagingHostsDir,
  installChromeHostManifest
} from "../../native-host/src/install.js";

const extensionDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(extensionDir, "../..");
const orchestratorDistEntry = path.join(repoRoot, "app/orchestrator/dist/src/index.js");

test("installed Chromium native host forwards real extension capture to orchestrator", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("native host install path smoke is macOS-only for now");
    return;
  }
  if (process.env.EVENTLOOPOS_ENABLE_NATIVE_BROWSER_SMOKE !== "1") {
    t.skip("set EVENTLOOPOS_ENABLE_NATIVE_BROWSER_SMOKE=1 to run installed native browser smoke");
    return;
  }

  const server = await startOrchestratorFixture();
  let result;

  try {
    result = await runInstalledBrowserCaptureSmoke({
      orchestratorOrigin: server.origin,
      pageOrigin: server.origin,
      routeHints: { task_hint: "native smoke" }
    });
  } finally {
    await server.close();
  }

  assert.equal(result.captureResult.resource.title, "Native messaging smoke");
  assert.equal(result.captureResult.nativeResponse.ok, true, JSON.stringify(result.captureResult.nativeResponse));
  assert.equal(result.captureResult.nativeResponse.payload.forwarded, true);
  assert.equal(result.captureResult.nativeResponse.payload.forward_result.route_decision.action, "inject_task_session");
  assert.equal(result.captureResult.nativeResponse.payload.forward_result.queue_item, null);

  const forwardedEvent = await assertEventually(async () => {
    const event = server.forwardedEvent();
    assert.ok(event);
    return event;
  });
  assert.equal(forwardedEvent.source, "browser");
  assert.equal(forwardedEvent.task_hint, "native smoke");

  assert.match(result.contextLog, /Native messaging smoke/);
});

test("installed Chromium native host forwards real extension capture to real orchestrator", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("native host install path smoke is macOS-only for now");
    return;
  }
  if (process.env.EVENTLOOPOS_ENABLE_REAL_ORCHESTRATOR_NATIVE_BROWSER_SMOKE !== "1") {
    t.skip("set EVENTLOOPOS_ENABLE_REAL_ORCHESTRATOR_NATIVE_BROWSER_SMOKE=1 to run real orchestrator native browser smoke");
    return;
  }

  const pageServer = await startStaticPageFixture();
  const externalOrchestratorOrigin = process.env.EVENTLOOPOS_REAL_ORCHESTRATOR_URL;
  const orchestrator = externalOrchestratorOrigin
    ? { origin: externalOrchestratorOrigin, close: async () => {} }
    : await startRealOrchestrator();
  try {
    const result = await runInstalledBrowserCaptureSmoke({
      orchestratorOrigin: orchestrator.origin,
      pageOrigin: pageServer.origin
    });

    assert.equal(result.captureResult.resource.title, "Native messaging smoke");
    assert.equal(result.captureResult.nativeResponse.ok, true, JSON.stringify(result.captureResult.nativeResponse));
    assert.equal(result.captureResult.nativeResponse.payload.forwarded, true);
    assert.equal(result.captureResult.nativeResponse.payload.forward_result.route_decision.action, "store_only");
    assert.equal(result.captureResult.nativeResponse.payload.forward_result.queue_item ?? null, null);

    const queueResponse = await fetch(new URL("/queue", orchestrator.origin));
    const queueBody = await queueResponse.json();
    assert.equal(queueResponse.status, 200);
    assert.equal(queueBody.items.some((item) => item.review_packet?.title === "Native messaging smoke"), false);

    const contextsResponse = await fetch(new URL("/contexts?source=browser&q=Native%20messaging%20smoke&limit=5", orchestrator.origin));
    const contextsBody = await contextsResponse.json();
    assert.equal(contextsResponse.status, 200);
    assert.equal(contextsBody.entries.some((entry) => entry.resource.title === "Native messaging smoke"), true);
    assert.match(result.contextLog, /Native messaging smoke/);
  } finally {
    await orchestrator.close();
    await pageServer.close();
  }
});

async function runInstalledBrowserCaptureSmoke({ orchestratorOrigin, pageOrigin, routeHints }) {
  const smokeDir = await mkdtemp(path.join(tmpdir(), "eventloopos-native-smoke-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "eventloopos-native-browser-"));
  const homeDir = process.env.EVENTLOOPOS_NATIVE_BROWSER_SMOKE_HOME ?? process.env.HOME;
  const contextLogPath = path.join(smokeDir, "context-captures.jsonl");
  const previousManifestBodies = new Map();
  let context;

  try {
    const launchOptions = {
      channel: "chromium",
      headless: true,
      env: {
        ...process.env,
        HOME: homeDir,
        EVENTLOOPOS_ORCHESTRATOR_URL: orchestratorOrigin,
        EVENTLOOPOS_CONTEXT_LOG: contextLogPath
      },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    };

    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    const extensionId = new URL(serviceWorker.url()).host;
    await context.close();
    context = undefined;

    for (const browser of CHROME_BROWSER_FLAVORS) {
      const manifestPath = path.join(chromeNativeMessagingHostsDir(homeDir, browser), `${HOST_NAME}.json`);
      const previousBody = await readFile(manifestPath, "utf8").catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      });
      previousManifestBodies.set(manifestPath, previousBody);
      const installResult = await installChromeHostManifest({ extensionId, browser, homeDir });
      assert.equal(path.basename(installResult.path), `${HOST_NAME}.json`);
    }
    const chromiumManifest = await readFile(
      path.join(chromeNativeMessagingHostsDir(homeDir, "chromium"), `${HOST_NAME}.json`),
      "utf8"
    );
    for (const dir of [
      path.join(userDataDir, "NativeMessagingHosts"),
      path.join(userDataDir, "Default", "NativeMessagingHosts")
    ]) {
      const manifestPath = path.join(dir, `${HOST_NAME}.json`);
      previousManifestBodies.set(manifestPath, undefined);
      await mkdir(dir, { recursive: true });
      await writeFile(manifestPath, chromiumManifest, "utf8");
    }

    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const activeServiceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));

    const page = context.pages()[0] ?? (await context.newPage());
    const targetUrl = `${pageOrigin}/native-smoke`;
    await page.goto(targetUrl);
    await page.waitForSelector("[data-context-quote]");
    await page.evaluate(() => window.scrollTo(0, 240));

    const captureResult = await sendRuntimeMessageFromTab(activeServiceWorker, targetUrl, {
      type: "eventloop.captureActiveTab",
      ...(routeHints ? { route_hints: routeHints } : {})
    });

    const contextLog = await readFile(contextLogPath, "utf8");
    return { captureResult, contextLog };
  } finally {
    await context?.close();
    if (process.env.EVENTLOOPOS_NATIVE_BROWSER_SMOKE_KEEP_MANIFEST !== "1") {
      for (const [manifestPath, previousBody] of previousManifestBodies) {
        if (previousBody === undefined) {
          await rm(manifestPath, { force: true });
        } else {
          await writeFile(manifestPath, previousBody, "utf8");
        }
      }
    }
    await rm(userDataDir, { recursive: true, force: true });
    await rm(smokeDir, { recursive: true, force: true });
  }
}

async function startOrchestratorFixture() {
  let forwardedEvent = null;

  const server = createServer(async (request, response) => {
    if (request.url === "/native-smoke") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Native messaging smoke</title>
            <style>
              body { margin: 0; font-family: sans-serif; }
              .spacer { height: 600px; }
            </style>
          </head>
          <body>
            <main>
              <div class="spacer"></div>
              <p data-context-quote>Native messaging smoke reached orchestrator.</p>
              <div class="spacer"></div>
            </main>
          </body>
        </html>`);
      return;
    }

    if (request.method === "POST" && request.url === "/events") {
      const body = JSON.parse(await readRequestBody(request));
      forwardedEvent = body.event;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        inserted: true,
        event_id: body.event.id,
        route_decision: {
          id: "rte_native_smoke",
          event_id: body.event.id,
          action: "inject_task_session",
          target_task_id: "task_native_smoke",
          confidence: "medium",
          evidence: [],
          created_at: "2026-05-06T20:00:00.000Z"
        },
        queue_item: null,
        request_id: "req_native_smoke"
      }));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    forwardedEvent: () => forwardedEvent,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function startStaticPageFixture() {
  const server = createServer((request, response) => {
    if (request.url === "/native-smoke") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Native messaging smoke</title>
            <style>
              body { margin: 0; font-family: sans-serif; }
              .spacer { height: 600px; }
            </style>
          </head>
          <body>
            <main>
              <div class="spacer"></div>
              <p data-context-quote>Native messaging smoke reached real orchestrator.</p>
              <div class="spacer"></div>
            </main>
          </body>
        </html>`);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function startRealOrchestrator() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [orchestratorDistEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ORCHESTRATOR_PORT: String(port),
      ORCHESTRATOR_HOST: "127.0.0.1",
      ORCHESTRATOR_MCP_SOURCES: "off",
      ORCHESTRATOR_TASK_SESSIONS: "off",
      ORCHESTRATOR_WORKSPACE: "off"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForHealth(origin);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
  }

  return {
    origin,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };
}

async function waitForHealth(origin) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", origin));
      if (response.ok) return;
      lastError = new Error(`orchestrator health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("timed out waiting for orchestrator health");
}

async function freePort() {
  const { createServer: createNetServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("could not allocate local port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function sendRuntimeMessageFromTab(serviceWorker, targetUrl, message) {
  return await serviceWorker.evaluate(
    async ({ targetUrl, message }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url === targetUrl);
      if (!tab) {
        throw new Error(`target tab not found: ${targetUrl}`);
      }

      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [message],
        func: async (injectedMessage) => await chrome.runtime.sendMessage(injectedMessage)
      });
      return injection.result;
    },
    { targetUrl, message }
  );
}

async function assertEventually(assertion, { timeoutMs = 2_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError;
}
