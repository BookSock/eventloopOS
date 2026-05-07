import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const extensionDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("MV3 extension captures and restores browser page context in Chromium", async () => {
  const server = await startFixtureServer();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "eventloopos-browser-e2e-"));
  const secondUserDataDir = await mkdtemp(path.join(tmpdir(), "eventloopos-browser-e2e-profile-"));
  let context;
  let secondContext;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });

    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    assert.match(serviceWorker.url(), /^chrome-extension:\/\//);
    const extensionId = new URL(serviceWorker.url()).host;

    const page = context.pages()[0] ?? (await context.newPage());
    const url = `${server.origin}/launch`;
    await page.goto(url);
    await page.waitForSelector("[data-context-quote]");
    await page.evaluate(() => window.scrollTo(0, 360));

    const captured = await assertEventually(
      async () =>
        await serviceWorker.evaluate(async (targetUrl) => {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find((candidate) => candidate.url === targetUrl);
          if (!tab) {
            throw new Error(`target tab not found: ${targetUrl}`);
          }
          return await chrome.tabs.sendMessage(tab.id, { type: "eventloop.capturePage" });
        }, url)
    );

    assert.equal(captured.url, url);
    assert.equal(captured.title, "Launch brief");
    assert.equal(captured.quote.text, "Launch date moved up. Human review needed.");
    assert.equal(captured.scroll.y, 360);

    const setConfig = await sendRuntimeMessageFromTab(serviceWorker, url, {
      type: "eventloop.setConfig",
      config: { orchestratorUrl: "http://127.0.0.1:9999/" }
    });
    assert.deepEqual(setConfig, { orchestratorUrl: "http://127.0.0.1:9999" });

    const storedConfig = await serviceWorker.evaluate(async () => await chrome.storage.local.get("orchestratorUrl"));
    assert.deepEqual(storedConfig, { orchestratorUrl: "http://127.0.0.1:9999" });

    const getConfig = await sendRuntimeMessageFromTab(serviceWorker, url, { type: "eventloop.getConfig" });
    assert.deepEqual(getConfig, { orchestratorUrl: "http://127.0.0.1:9999" });

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.fill("#orchestrator-url", "http://127.0.0.1:8888/");
    await optionsPage.click("button[type='submit']");
    await optionsPage.waitForSelector('#status[data-state="saved"]');
    assert.equal(await optionsPage.inputValue("#orchestrator-url"), "http://127.0.0.1:8888");
    assert.deepEqual(await serviceWorker.evaluate(async () => await chrome.storage.local.get("orchestratorUrl")), {
      orchestratorUrl: "http://127.0.0.1:8888"
    });
    await optionsPage.close();

    await page.evaluate(() => window.scrollTo(0, 0));
    const restoreResult = await sendRuntimeMessageFromTab(serviceWorker, url, {
      type: "eventloop.restore",
      resource: {
        id: "browser_tab:e2e",
        kind: "browser_tab",
        title: "Launch brief",
        url,
        restore_confidence: "high",
        scroll_y: 720,
        text_quote: "Launch date moved up. Human review needed."
      }
    });

    assert.equal(restoreResult.ok, true);
    assert.equal(restoreResult.url, url);
    assert.equal(restoreResult.restoredScroll, true);
    assert.equal(restoreResult.restoredHighlight, true);
    assert.equal(restoreResult.highlightStrategy, "text");
    await assertEventually(async () => {
      assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 720);
    });
    await assertEventually(async () => {
      assert.equal(
        await page.evaluate(() => document.querySelector("[data-eventloopos-restore-highlight]")?.textContent?.trim()),
        "Launch date moved up. Human review needed."
      );
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    const pollConfig = await sendRuntimeMessageFromTab(serviceWorker, url, {
      type: "eventloop.setConfig",
      config: { orchestratorUrl: server.origin }
    });
    assert.deepEqual(pollConfig, { orchestratorUrl: server.origin });

    await serviceWorker.evaluate(async () => {
      await chrome.alarms.create("eventloop.restoreRequests.poll", { when: Date.now() + 100 });
    });
    const pollDoneBody = await assertEventually(async () => {
      const body = server.restoreDoneBody();
      assert.ok(body);
      return body;
    }, { timeoutMs: 5_000 });
    const firstInstallation = await serviceWorker.evaluate(async () => await chrome.storage.local.get("installationId"));
    assert.equal(pollDoneBody.result.ok, true);
    assert.equal(pollDoneBody.result.url, url);
    assert.equal(pollDoneBody.result.restoredScroll, true);
    assert.equal(pollDoneBody.result.restoredHighlight, true);
    await assertEventually(async () => {
      assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 840);
    });

    secondContext = await chromium.launchPersistentContext(secondUserDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    const secondServiceWorker =
      secondContext.serviceWorkers()[0] ?? (await secondContext.waitForEvent("serviceworker", { timeout: 10_000 }));
    const secondPage = secondContext.pages()[0] ?? (await secondContext.newPage());
    await secondPage.goto(url);
    await secondPage.waitForSelector("[data-context-quote]");
    await sendRuntimeMessageFromTab(secondServiceWorker, url, {
      type: "eventloop.setConfig",
      config: { orchestratorUrl: server.origin }
    });
    await secondServiceWorker.evaluate(async () => {
      await chrome.alarms.create("eventloop.restoreRequests.poll", { when: Date.now() + 100 });
    });
    await assertEventually(async () => {
      assert.equal(server.restoreClaimBodies().length, 2);
    }, { timeoutMs: 5_000 });
    const secondInstallation = await secondServiceWorker.evaluate(async () => await chrome.storage.local.get("installationId"));

    assert.match(firstInstallation.installationId, /^[a-z0-9_-]+$/);
    assert.match(secondInstallation.installationId, /^[a-z0-9_-]+$/);
    assert.notEqual(firstInstallation.installationId, secondInstallation.installationId);
    assert.notEqual(
      server.restoreClaimBodies()[0].lease_owner,
      server.restoreClaimBodies()[1].lease_owner
    );
  } finally {
    await secondContext?.close();
    await context?.close();
    await rm(secondUserDataDir, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
    await server.close();
  }
});

async function startFixtureServer() {
  let restoreDoneBody = null;
  const restoreClaimBodies = [];
  const pendingRestoreRequest = {
    id: "ctx_restore_e2e",
    status: "pending",
    restore_plan: {
      kind: "browser_extension_message",
      message: {
        type: "eventloop.restore",
        resource: {
          id: "browser_tab:e2e_poll",
          kind: "browser_tab",
          title: "Launch brief",
          url: null,
          restore_confidence: "high",
          scroll_y: 840,
          text_quote: "Launch date moved up. Human review needed."
        }
      }
    }
  };

  const server = createServer(async (request, response) => {
    if (request.url === "/launch") {
      pendingRestoreRequest.restore_plan.message.resource.url = `http://${request.headers.host}/launch`;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Launch brief</title>
            <style>
              body { margin: 0; font-family: sans-serif; }
              .spacer { height: 1200px; }
            </style>
          </head>
          <body>
            <main>
              <div class="spacer"></div>
              <p data-context-quote>Launch date moved up. Human review needed.</p>
              <div class="spacer"></div>
            </main>
          </body>
        </html>`);
      return;
    }

    if (request.method === "POST" && request.url === "/contexts/restore-requests/claim-next") {
      const claimBody = JSON.parse(await readRequestBody(request));
      assert.match(claimBody.lease_owner, /^eventloop-browser-extension-[a-z0-9_-]+$/);
      restoreClaimBodies.push(claimBody);
      pendingRestoreRequest.status = "leased";
      pendingRestoreRequest.lease_owner = claimBody.lease_owner;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ restore_request: restoreDoneBody ? null : pendingRestoreRequest }));
      return;
    }

    if (request.method === "POST" && request.url === "/contexts/restore-requests/ctx_restore_e2e/done") {
      restoreDoneBody = JSON.parse(await readRequestBody(request));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        restore_request: {
          ...pendingRestoreRequest,
          status: "done",
          result: restoreDoneBody.result
        }
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
    restoreDoneBody: () => restoreDoneBody,
    restoreClaimBodies: () => restoreClaimBodies,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
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
