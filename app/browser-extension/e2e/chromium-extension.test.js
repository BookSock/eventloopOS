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
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });

    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    assert.match(serviceWorker.url(), /^chrome-extension:\/\//);

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
    await assertEventually(async () => {
      assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 720);
    });
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
    await server.close();
  }
});

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.url === "/launch") {
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
