import assert from "node:assert/strict";
import test from "node:test";
import { capturePageContext, pickViewportAnchor, restorePageContext, selectorHintForElement } from "../src/capture-page.js";
import { buildContextResource, contextResourceToPageContext, normalizeContextResource, validateContextResource } from "../src/protocol.js";
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

test("contextResourceToPageContext propagates plan_kind and anchor for slack thread", () => {
  const resource = {
    id: "ctx_slack_thread_1",
    kind: "slack_thread",
    title: "Slack thread",
    url: "https://acme.slack.com/archives/C123/p1234567890123456",
    plan_kind: "open_slack_thread",
    anchor: {
      thread_ts: "1234567890.123456",
      channel_id: "C123",
    },
  };

  const pageContext = contextResourceToPageContext(resource);

  assert.equal(pageContext.plan_kind, "open_slack_thread");
  assert.equal(pageContext.anchor.thread_ts, "1234567890.123456");
  assert.equal(pageContext.anchor.channel_id, "C123");
});

test("contextResourceToPageContext fills quote.text from anchor selection_quote", () => {
  const resource = {
    id: "ctx_doc_anchor_1",
    kind: "google_doc",
    title: "Blog launch doc",
    url: "https://docs.google.com/document/d/abc123/edit",
    plan_kind: "open_doc_anchor",
    anchor: {
      doc_id: "abc123",
      heading_id: "h.angle1",
      selection_quote: "Should we ship Tuesday?",
    },
  };

  const pageContext = contextResourceToPageContext(resource);

  assert.equal(pageContext.plan_kind, "open_doc_anchor");
  assert.equal(pageContext.quote.text, "Should we ship Tuesday?");
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

test("pickViewportAnchor selects first heading inside viewport with #id selector", () => {
  const above = makeAnchorElement({ tag: "h2", id: "skipped", text: "Skipped heading", rect: { top: -800, bottom: -700 } });
  const inView = makeAnchorElement({ tag: "h1", id: "lede", text: "  Lede heading text  ", rect: { top: 40, bottom: 80 } });
  const below = makeAnchorElement({ tag: "h2", id: "later", text: "Below the fold", rect: { top: 4000, bottom: 4040 } });
  const doc = {
    querySelectorAll: () => [above, inView, below]
  };
  const win = { innerHeight: 600 };

  const anchor = pickViewportAnchor(doc, win);

  assert.ok(anchor);
  assert.equal(anchor.selector_hint, "#lede");
  assert.equal(anchor.text, "Lede heading text");
});

test("pickViewportAnchor falls back to tag-based hint when id is missing", () => {
  const heading = makeAnchorElement({ tag: "h3", text: "Section title", rect: { top: 10, bottom: 30 } });
  const doc = { querySelectorAll: () => [heading] };

  const anchor = pickViewportAnchor(doc, { innerHeight: 800 });

  assert.equal(anchor.selector_hint, "h3");
  assert.equal(anchor.text, "Section title");
});

test("pickViewportAnchor uses [role=\"main\"] for landmark elements", () => {
  const main = makeAnchorElement({ tag: "div", role: "main", text: "Main landmark text", rect: { top: 5, bottom: 20 } });
  const doc = { querySelectorAll: () => [main] };

  const anchor = pickViewportAnchor(doc, { innerHeight: 800 });

  assert.equal(anchor.selector_hint, "[role=\"main\"]");
});

test("pickViewportAnchor truncates long text to 120 chars", () => {
  const long = "x".repeat(200);
  const element = makeAnchorElement({ tag: "p", text: long, rect: { top: 100, bottom: 140 } });
  const doc = { querySelectorAll: () => [element] };

  const anchor = pickViewportAnchor(doc, { innerHeight: 600 });

  assert.equal(anchor.text.length, 120);
});

test("selectorHintForElement rejects ids with invalid CSS characters", () => {
  const element = { id: "has space", tagName: "H2", getAttribute: () => null };
  assert.equal(selectorHintForElement(element), "h2");
});

test("capturePageContext picks viewport anchor when no selection or fixture marker", () => {
  const heading = makeAnchorElement({ tag: "h2", id: "topic", text: "Why eventloopOS exists", rect: { top: 12, bottom: 36 } });
  const doc = {
    title: "Anchor capture fixture",
    location: { href: "http://127.0.0.1:4173/anchor" },
    scrollingElement: { scrollWidth: 800, scrollHeight: 2400 },
    documentElement: { scrollWidth: 800, scrollHeight: 2400 },
    querySelector: (selector) => (selector === "[data-context-quote]" ? null : null),
    querySelectorAll: () => [heading],
    body: { textContent: "fallback" }
  };
  const win = {
    scrollX: 0,
    scrollY: 540,
    innerWidth: 800,
    innerHeight: 600,
    getSelection: () => ({ toString: () => "" })
  };

  const page = capturePageContext(win, doc);

  assert.equal(page.scroll.y, 540);
  assert.equal(page.quote.strategy, "viewport-anchor");
  assert.equal(page.quote.text, "Why eventloopOS exists");
  assert.equal(page.quote.selector_hint, "#topic");
});

test("capture flow propagates scroll_y, text_quote, selector_hint from viewport anchor", async () => {
  const page = {
    url: "http://127.0.0.1:4173/anchor",
    title: "Anchor flow",
    scroll: { x: 0, y: 540, maxX: 0, maxY: 1800 },
    quote: {
      strategy: "viewport-anchor",
      text: "Why eventloopOS exists",
      selector_hint: "#topic"
    }
  };
  const chromeApi = fakeChrome({
    tabs: [{ id: 12, url: page.url, title: page.title, active: true, windowId: 4 }],
    pageByTabId: new Map([[12, page]])
  });
  const nativeBridge = createMockNativeBridge();
  const controller = createExtensionController({
    chromeApi,
    nativeBridge,
    now: () => new Date("2026-05-09T12:00:00.000Z")
  });

  const result = await controller.captureActiveTab();

  assert.equal(result.resource.scroll_y, 540);
  assert.equal(result.resource.text_quote, "Why eventloopOS exists");
  assert.equal(result.resource.selector_hint, "#topic");
  assert.doesNotThrow(() => validateContextResource(result.resource));
});

test("captured-then-restored round-trip preserves scroll_y, text_quote, selector_hint", () => {
  const tab = { id: 21, url: "https://example.test/round-trip", title: "Round-trip", windowId: 9 };
  const page = {
    url: tab.url,
    title: tab.title,
    scroll: { x: 0, y: 720, maxX: 0, maxY: 2000 },
    quote: {
      strategy: "viewport-anchor",
      text: "Section heading text",
      selector_hint: "#section-3"
    }
  };

  const resource = buildContextResource({ tab, page, capturedAt: "2026-05-09T13:00:00.000Z" });

  // Survives normalization round-trip (current shape).
  const normalized = normalizeContextResource(resource);
  assert.equal(normalized.scroll_y, 720);
  assert.equal(normalized.text_quote, "Section heading text");
  assert.equal(normalized.selector_hint, "#section-3");

  // Survives legacy-shape round-trip.
  const legacy = {
    schemaVersion: "eventloop.contextResource.v1",
    type: "browser.tab",
    source: "chrome-extension",
    capturedAt: "2026-05-09T13:00:00.000Z",
    tab: { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId },
    page
  };
  const fromLegacy = validateContextResource(legacy);
  assert.equal(fromLegacy.scroll_y, 720);
  assert.equal(fromLegacy.text_quote, "Section heading text");
  assert.equal(fromLegacy.selector_hint, "#section-3");

  // Restoration page-context derived from the resource carries the same fields.
  const restorePage = contextResourceToPageContext(resource);
  assert.equal(restorePage.scroll.y, 720);
  assert.equal(restorePage.quote.text, "Section heading text");
  assert.equal(restorePage.quote.selector_hint, "#section-3");
});

function makeAnchorElement({ tag, id = "", text, rect, role = null }) {
  return {
    tagName: tag.toUpperCase(),
    id,
    textContent: text,
    getAttribute(name) {
      if (name === "role") return role;
      return null;
    },
    getBoundingClientRect() {
      return { top: rect.top, bottom: rect.bottom, left: 0, right: 0, width: 0, height: rect.bottom - rect.top };
    }
  };
}

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
