import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const extensionDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(extensionDir, "../..");
const macosDir = path.join(repoRoot, "app/macos");
const orchestratorDistEntry = path.join(repoRoot, "app/orchestrator/dist/src/index.js");

test("Mac client restore request is fulfilled by Chromium extension against real orchestrator", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("Mac client smoke is macOS-only");
    return;
  }
  if (process.env.EVENTLOOPOS_ENABLE_MAC_BROWSER_RESTORE_SMOKE !== "1") {
    t.skip("set EVENTLOOPOS_ENABLE_MAC_BROWSER_RESTORE_SMOKE=1 to run Mac client + browser restore smoke");
    return;
  }

  const pageServer = await startBrowserRestorePageFixture();
  const smokeDir = await mkdtemp(path.join(tmpdir(), "eventloopos-mac-browser-restore-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "eventloopos-mac-browser-profile-"));
  const requestIdPath = path.join(smokeDir, "restore-request-id.txt");
  const externalOrchestratorOrigin = process.env.EVENTLOOPOS_REAL_ORCHESTRATOR_URL;
  const orchestrator = externalOrchestratorOrigin
    ? { origin: externalOrchestratorOrigin, close: async () => {} }
    : await startRealOrchestrator();
  let context;

  try {
    const targetUrl = `${pageServer.origin}/mac-browser-restore`;
    await spawnChecked("swift", ["test", "--filter", "QueueClientLiveTests"], {
      cwd: macosDir,
      env: {
        ...process.env,
        EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL: orchestrator.origin,
        EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_URL: targetUrl,
        EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_TITLE: "Mac browser restore smoke",
        EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_QUOTE: "Mac client requested browser restore.",
        EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_SCROLL_Y: "640",
        EVENTLOOPOS_MACOS_LIVE_RESTORE_REQUEST_ID_FILE: requestIdPath
      }
    });
    const restoreRequestId = (await readFile(requestIdPath, "utf8")).trim();
    assert.match(restoreRequestId, /^ctx_restore_/);

    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(targetUrl);
    await page.waitForSelector("[data-context-quote]");
    await page.evaluate(() => window.scrollTo(0, 0));

    await sendRuntimeMessageFromTab(serviceWorker, targetUrl, {
      type: "eventloop.setConfig",
      config: { orchestratorUrl: orchestrator.origin }
    });
    await serviceWorker.evaluate(async () => {
      await chrome.alarms.create("eventloop.restoreRequests.poll", { when: Date.now() + 100 });
    });

    const completedRequest = await assertEventually(async () => {
      const response = await fetch(new URL(`/contexts/restore-requests/${restoreRequestId}`, orchestrator.origin));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.restore_request.status, "done");
      return body.restore_request;
    }, { timeoutMs: 8_000 });

    assert.equal(completedRequest.result.ok, true);
    assert.equal(completedRequest.result.url, targetUrl);
    assert.equal(completedRequest.result.restoredScroll, true);
    await assertEventually(async () => {
      assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 640);
    }, { timeoutMs: 5_000 });
  } finally {
    await context?.close();
    await orchestrator.close();
    await pageServer.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(smokeDir, { recursive: true, force: true });
  }
});

async function startBrowserRestorePageFixture() {
  const server = createServer((request, response) => {
    if (request.url === "/mac-browser-restore") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Mac browser restore smoke</title>
            <style>
              body { margin: 0; font-family: sans-serif; }
              .spacer { height: 900px; }
            </style>
          </head>
          <body>
            <main>
              <div class="spacer"></div>
              <p data-context-quote>Mac client requested browser restore.</p>
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

async function spawnChecked(file, args, { cwd, env }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${file} ${args.join(" ")} exited with ${signal ?? code}\n${output}`));
    });
  });
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
