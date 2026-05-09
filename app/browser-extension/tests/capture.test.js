import assert from "node:assert/strict";
import test from "node:test";
import { capturePageContext, restorePageContext } from "../src/capture-page.js";
import { buildContextResource, normalizeContextResource, validateContextResource } from "../src/protocol.js";
import { createExtensionController } from "../src/extension-controller.js";
import { createMockNativeBridge } from "../src/mock-native-bridge.js";

test("captures active tab and sends validated ContextResource to native bridge", async () => {
  const page = {
    url: "file:///fixture/context-page.html",
    title: "eventloopOS Browser Context Fixture",
    scroll: { x: 0, y: 840, maxX: 0, maxY: 1400 },
    quote: {
      strategy: "fixture-marker",
      text: "Fixture quote alpha anchors context capture after scroll restore."
    }
  };
  const chromeApi = fakeChrome({
    tabs: [{ id: 7, url: page.url, title: page.title, active: true, windowId: 3 }],
    pageByTabId: new Map([[7, page]])
  });
  const nativeBridge = createMockNativeBridge();
  const controller = createExtensionController({
    chromeApi,
    nativeBridge,
    now: () => new Date("2026-05-06T12:00:00.000Z")
  });

  const result = await controller.captureActiveTab();

  assert.equal(result.resource.kind, "browser_tab");
  assert.equal(result.resource.title, page.title);
  assert.equal(result.resource.url, page.url);
  assert.equal(result.resource.source, "chrome-extension");
  assert.equal(result.resource.captured_at, "2026-05-06T12:00:00.000Z");
  assert.equal(result.resource.restore_confidence, "high");
  assert.equal(result.resource.window_id, "3");
  assert.equal(result.resource.tab_id, "7");
  assert.equal(result.resource.scroll_y, 840);
  assert.equal(result.resource.text_quote, page.quote.text);
  assert.equal(result.resource.selector_hint, "[data-context-quote]");
  assert.doesNotThrow(() => validateContextResource(result.resource));
  assert.equal(nativeBridge.sent.length, 1);
  assert.equal(nativeBridge.sent[0].type, "eventloop.contextCaptured");
});

test("captures active tab with task route hints for native forwarding", async () => {
  const page = {
    url: "file:///fixture/context-page.html",
    title: "eventloopOS Browser Context Fixture",
    scroll: { x: 0, y: 0, maxX: 0, maxY: 1400 },
    quote: { strategy: "fixture-marker", text: "Blog launch context" }
  };
  const chromeApi = fakeChrome({
    tabs: [{ id: 9, url: page.url, title: page.title, active: true, windowId: 4 }],
    pageByTabId: new Map([[9, page]])
  });
  const nativeBridge = createMockNativeBridge();
  const controller = createExtensionController({
    chromeApi,
    nativeBridge,
    now: () => new Date("2026-05-06T12:00:00.000Z")
  });

  await controller.captureActiveTab({
    task_hint: " blog feedback ",
    project_hint: "launch"
  });

  assert.equal(nativeBridge.sent.length, 1);
  assert.equal(nativeBridge.sent[0].payload.task_hint, "blog feedback");
  assert.equal(nativeBridge.sent[0].payload.project_hint, "launch");
  assert.equal(nativeBridge.sent[0].payload.resource.kind, "browser_tab");
});

test("capture route hints ignore non-string values", async () => {
  const page = {
    url: "file:///fixture/context-page.html",
    title: "eventloopOS Browser Context Fixture",
    scroll: { x: 0, y: 0, maxX: 0, maxY: 1400 },
    quote: { strategy: "fixture-marker", text: "Context" }
  };
  const chromeApi = fakeChrome({
    tabs: [{ id: 10, url: page.url, title: page.title, active: true, windowId: 4 }],
    pageByTabId: new Map([[10, page]])
  });
  const nativeBridge = createMockNativeBridge();
  const controller = createExtensionController({ chromeApi, nativeBridge });

  await controller.captureActiveTab({
    task_hint: 123,
    project_hint: ""
  });

  assert.equal(nativeBridge.sent[0].payload.task_hint, undefined);
  assert.equal(nativeBridge.sent[0].payload.project_hint, undefined);
});

test("captures tab registry for all allowed tabs without reading page content", async () => {
  const chromeApi = fakeChrome({
    tabs: [
      { id: 21, url: "file:///fixture/a.html", title: "Article A", active: false, windowId: 3, pinned: true },
      { id: 22, url: "http://127.0.0.1:4173/b.html", title: "Article B", active: true, windowId: 3 },
      { id: 23, url: "https://mail.google.com/mail/u/0", title: "Mail", active: false, windowId: 4 }
    ],
    pageByTabId: new Map()
  });
  const nativeBridge = createMockNativeBridge();
  const controller = createExtensionController({
    chromeApi,
    nativeBridge,
    now: () => new Date("2026-05-06T12:00:00.000Z")
  });

  const result = await controller.captureTabRegistry({ task_hint: "reading queue" });

  assert.equal(result.ok, true);
  assert.equal(result.attempted_count, 2);
  assert.equal(result.captured_count, 2);
  assert.equal(result.failed_count, 0);
  assert.equal(result.skipped_count, 1);
  assert.equal(chromeApi.calls.sendMessages.length, 0);
  assert.equal(nativeBridge.sent.length, 2);
  assert.deepEqual(result.captured.map((item) => item.resource.id), ["browser_tab:21", "browser_tab:22"]);
  assert.equal(result.captured[0].resource.restore_confidence, "medium");
  assert.equal(result.captured[0].resource.window_id, "3");
  assert.equal(result.captured[0].resource.tab_id, "21");
  assert.equal(result.captured[0].resource.details.registry_capture, true);
  assert.equal(nativeBridge.sent[0].payload.task_hint, "reading queue");
  assert.equal(nativeBridge.sent[0].idempotency_key, "browser_registry:21:2026-05-06T12:00:00.000Z");
  assert.equal(result.skipped[0].error.code, "origin_not_allowed");
});

test("tab registry capture reports native forwarding failures separately", async () => {
  const chromeApi = fakeChrome({
    tabs: [{ id: 31, url: "file:///fixture/a.html", title: "Article A", active: false, windowId: 3 }],
    pageByTabId: new Map()
  });
  const nativeBridge = createMockNativeBridge({
    responses: [{ ok: false, error: { code: "native_host_failed", message: "host down" } }]
  });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge,
    now: () => new Date("2026-05-06T12:00:00.000Z")
  });

  const result = await controller.captureTabRegistry();

  assert.equal(result.attempted_count, 1);
  assert.equal(result.captured_count, 0);
  assert.equal(result.failed_count, 1);
  assert.equal(result.captured[0].nativeResponse.ok, false);
});

test("capture skips disallowed active tab without reading page or native forwarding", async () => {
  const chromeApi = fakeChrome({
    tabs: [{ id: 11, url: "https://mail.google.com/mail/u/0", title: "Mail", active: true, windowId: 5 }],
    pageByTabId: new Map([[11, { url: "https://mail.google.com/mail/u/0", title: "Mail" }]])
  });
  const nativeBridge = createMockNativeBridge();
  const controller = createExtensionController({ chromeApi, nativeBridge });

  const result = await controller.captureActiveTab();

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.error.code, "origin_not_allowed");
  assert.equal(chromeApi.calls.sendMessages.length, 0);
  assert.equal(nativeBridge.sent.length, 0);
});

test("captures fixture marker quote and scroll from page-like objects", () => {
  const doc = {
    title: "eventloopOS Browser Context Fixture",
    location: { href: "file:///fixture/context-page.html" },
    scrollingElement: { scrollWidth: 800, scrollHeight: 1800 },
    documentElement: { scrollWidth: 800, scrollHeight: 1800 },
    querySelector: (selector) =>
      selector === "[data-context-quote]"
        ? { textContent: "\n Fixture quote alpha anchors context capture after scroll restore. \n" }
        : null,
    body: { textContent: "fallback body" }
  };
  const win = {
    scrollX: 0,
    scrollY: 912.4,
    innerWidth: 800,
    innerHeight: 600,
    getSelection: () => ({ toString: () => "" })
  };

  const page = capturePageContext(win, doc);

  assert.equal(page.scroll.y, 912);
  assert.equal(page.scroll.maxY, 1200);
  assert.equal(page.quote.strategy, "fixture-marker");
  assert.equal(page.quote.text, "Fixture quote alpha anchors context capture after scroll restore.");
});

test("captures active selection text before fixture marker fallback", () => {
  const selection = {
    toString: () => " selected launch quote ",
    getRangeAt: () => ({
      cloneRange: () => ({
        startContainer: { length: 64 },
        startOffset: 10,
        endContainer: { length: 64 },
        endOffset: 31,
        setStart() {},
        setEnd() {},
        toString: () => "selected launch quote"
      })
    })
  };
  const doc = {
    title: "Selection fixture",
    location: { href: "http://127.0.0.1/selection" },
    scrollingElement: { scrollWidth: 800, scrollHeight: 1200 },
    documentElement: { scrollWidth: 800, scrollHeight: 1200 },
    querySelector: () => ({ textContent: "fixture fallback quote" }),
    body: { textContent: "fallback body" }
  };
  const win = {
    scrollX: 0,
    scrollY: 12,
    innerWidth: 800,
    innerHeight: 600,
    getSelection: () => selection
  };

  const page = capturePageContext(win, doc);

  assert.equal(page.title, "Selection fixture");
  assert.equal(page.url, "http://127.0.0.1/selection");
  assert.equal(page.quote.strategy, "selection");
  assert.equal(page.quote.text, "selected launch quote");
});

test("buildContextResource rejects malformed payloads", () => {
  assert.throws(
    () =>
      buildContextResource({
        tab: { id: 1, url: "", title: "fixture" },
        page: {
          url: "file:///fixture/context-page.html",
          title: "fixture",
          scroll: { x: 0, y: 0, maxX: 0, maxY: 0 },
          quote: { strategy: "fixture-marker", text: "quote" }
        }
      }),
    /url must be non-empty string/
  );
});

test("normalizes legacy browser.tab resource to shared browser_tab shape", () => {
  const legacyResource = {
    schemaVersion: "eventloop.contextResource.v1",
    type: "browser.tab",
    source: "chrome-extension",
    capturedAt: "2026-05-06T12:00:00.000Z",
    tab: {
      id: 7,
      url: "file:///fixture/context-page.html",
      title: "eventloopOS Browser Context Fixture",
      windowId: 3
    },
    page: {
      url: "file:///fixture/context-page.html",
      title: "eventloopOS Browser Context Fixture",
      scroll: { x: 0, y: 900, maxX: 0, maxY: 1200 },
      quote: {
        strategy: "fixture-marker",
        text: "Fixture quote alpha anchors context capture after scroll restore."
      }
    }
  };

  const normalized = validateContextResource(legacyResource);

  assert.deepEqual(normalized, {
    id: "browser_tab:7",
    kind: "browser_tab",
    title: "eventloopOS Browser Context Fixture",
    url: "file:///fixture/context-page.html",
    source: "chrome-extension",
    captured_at: "2026-05-06T12:00:00.000Z",
    restore_confidence: "high",
    window_id: "3",
    tab_id: "7",
    scroll_y: 900,
    text_quote: "Fixture quote alpha anchors context capture after scroll restore.",
    selector_hint: "[data-context-quote]"
  });
  assert.deepEqual(normalizeContextResource(normalized), normalized);
});

test("restorePageContext scrolls page-like window", () => {
  const calls = [];
  const win = {
    scrollX: 0,
    scrollY: 0,
    scrollTo: (options) => {
      calls.push(options);
      win.scrollX = options.left;
      win.scrollY = options.top;
    }
  };

  const result = restorePageContext({ scroll: { x: 0, y: 900 } }, win);

  assert.deepEqual(calls, [{ left: 0, top: 900, behavior: "instant" }]);
  assert.equal(result.ok, true);
  assert.equal(result.restoredScroll, true);
  assert.deepEqual(result.scroll, { x: 0, y: 900 });
});

function fakeChrome({ tabs, pageByTabId }) {
  const calls = {
    sendMessages: [],
    executeScript: []
  };
  return {
    calls,
    runtime: {},
    tabs: {
      query(query, callback) {
        if (query.active) {
          callback(tabs.filter((tab) => tab.active));
          return;
        }
        callback(tabs);
      },
      sendMessage(tabId, message, callback) {
        calls.sendMessages.push({ tabId, message });
        if (message.type === "eventloop.ping") {
          callback({ ok: true });
          return;
        }
        assert.equal(message.type, "eventloop.capturePage");
        callback(pageByTabId.get(tabId));
      }
    },
    scripting: {
      executeScript(options, callback) {
        calls.executeScript.push(options);
        callback([{ result: true }]);
      }
    }
  };
}
