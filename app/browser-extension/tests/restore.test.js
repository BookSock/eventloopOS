import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionController, urlsMatch } from "../src/extension-controller.js";
import { createMockNativeBridge } from "../src/mock-native-bridge.js";

const fixtureResource = {
  id: "browser_tab:7",
  kind: "browser_tab",
  title: "eventloopOS Browser Context Fixture",
  url: "file:///fixture/context-page.html",
  source: "chrome-extension",
  captured_at: "2026-05-06T12:00:00.000Z",
  restore_confidence: "high",
  window_id: "11",
  tab_id: "7",
  scroll_y: 900,
  text_quote: "Fixture quote alpha anchors context capture after scroll restore.",
  selector_hint: "[data-context-quote]"
};

const legacyFixtureResource = {
  schemaVersion: "eventloop.contextResource.v1",
  type: "browser.tab",
  source: "chrome-extension",
  capturedAt: "2026-05-06T12:00:00.000Z",
  tab: {
    id: 7,
    url: fixtureResource.url,
    title: fixtureResource.title
  },
  page: {
    url: fixtureResource.url,
    title: fixtureResource.title,
    scroll: { x: 0, y: 900, maxX: 0, maxY: 1200 },
    quote: {
      strategy: "fixture-marker",
      text: fixtureResource.text_quote
    }
  }
};

test("restore focuses existing tab by URL match and restores scroll", async () => {
  const chromeApi = fakeChrome({
    tabs: [{ id: 7, url: `${fixtureResource.url}#section`, title: fixtureResource.title, windowId: 11 }]
  });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge: createMockNativeBridge()
  });

  const result = await controller.restore(fixtureResource);

  assert.equal(result.ok, true);
  assert.equal(result.tabId, 7);
  assert.equal(result.restoredScroll, true);
  assert.equal(result.restoredHighlight, true);
  assert.equal(result.highlightStrategy, "selector");
  assert.deepEqual(chromeApi.calls.tabsUpdate, [{ id: 7, update: { active: true } }]);
  assert.deepEqual(chromeApi.calls.windowsUpdate, [{ id: 11, update: { focused: true } }]);
  assert.equal(chromeApi.calls.tabsCreate.length, 0);
  assert.equal(chromeApi.calls.restoreMessages[0].page.scroll.y, 900);
  assert.equal(chromeApi.calls.restoreMessages[0].page.quote.text, fixtureResource.text_quote);
  assert.equal(chromeApi.calls.restoreMessages[0].page.quote.selector_hint, fixtureResource.selector_hint);
});

test("restore opens missing tab and restores scroll", async () => {
  const chromeApi = fakeChrome({ tabs: [] });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge: createMockNativeBridge()
  });

  const result = await controller.restore(fixtureResource);

  assert.equal(result.ok, true);
  assert.equal(result.tabId, 100);
  assert.deepEqual(chromeApi.calls.tabsCreate, [{ url: fixtureResource.url, active: true }]);
  assert.equal(chromeApi.calls.restoreMessages[0].tabId, 100);
});

test("restore accepts legacy browser.tab resource", async () => {
  const chromeApi = fakeChrome({ tabs: [] });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge: createMockNativeBridge()
  });

  const result = await controller.restore(legacyFixtureResource);

  assert.equal(result.ok, true);
  assert.deepEqual(chromeApi.calls.tabsCreate, [{ url: fixtureResource.url, active: true }]);
  assert.equal(chromeApi.calls.restoreMessages[0].page.scroll.y, 900);
  assert.equal(chromeApi.calls.restoreMessages[0].page.quote.text, fixtureResource.text_quote);
});

test("restore returns structured error when resource has no URL", async () => {
  const chromeApi = fakeChrome({ tabs: [] });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge: createMockNativeBridge()
  });

  const result = await controller.restore({ page: { scroll: { y: 1 } } });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "missing_url");
});

test("restore skips disallowed URL without tab or page side effects", async () => {
  const chromeApi = fakeChrome({ tabs: [] });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge: createMockNativeBridge()
  });

  const result = await controller.restore({
    ...fixtureResource,
    url: "https://mail.google.com/mail/u/0"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "origin_not_allowed");
  assert.equal(chromeApi.calls.tabsQuery, 0);
  assert.equal(chromeApi.calls.tabsCreate.length, 0);
  assert.equal(chromeApi.calls.restoreMessages.length, 0);
});

test("restore injects content script when page listener is missing", async () => {
  const chromeApi = fakeChrome({
    tabs: [{ id: 7, url: fixtureResource.url, title: fixtureResource.title, windowId: 11 }],
    contentScriptReady: false
  });
  const controller = createExtensionController({
    chromeApi,
    nativeBridge: createMockNativeBridge()
  });

  const result = await controller.restore(fixtureResource);

  assert.equal(result.ok, true);
  assert.equal(chromeApi.calls.executeScript.length, 1);
  assert.deepEqual(chromeApi.calls.executeScript[0], {
    target: { tabId: 7 },
    files: ["src/content-script.js"]
  });
});

test("urlsMatch ignores hash and preserves query", () => {
  assert.equal(urlsMatch("https://example.test/a?b=1#top", "https://example.test/a?b=1"), true);
  assert.equal(urlsMatch("https://example.test/a?b=2", "https://example.test/a?b=1"), false);
});

function fakeChrome({ tabs, contentScriptReady = true }) {
  const state = {
    tabs: [...tabs],
    nextTabId: 100,
    contentScriptReady
  };
  const calls = {
    tabsQuery: 0,
    tabsCreate: [],
    tabsUpdate: [],
    windowsUpdate: [],
    restoreMessages: [],
    executeScript: []
  };

  return {
    calls,
    runtime: {},
    tabs: {
      query(_query, callback) {
        calls.tabsQuery += 1;
        callback([...state.tabs]);
      },
      update(id, update, callback) {
        calls.tabsUpdate.push({ id, update });
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (tab) {
          Object.assign(tab, update);
        }
        callback(tab);
      },
      create(create, callback) {
        calls.tabsCreate.push(create);
        const tab = { id: state.nextTabId++, ...create, windowId: 1 };
        state.tabs.push(tab);
        callback(tab);
      },
      sendMessage(tabId, message, callback) {
        if (message.type === "eventloop.ping") {
          if (!state.contentScriptReady) {
            globalThis.chrome = { runtime: { lastError: { message: "Could not establish connection." } } };
            callback(undefined);
            globalThis.chrome = undefined;
            return;
          }
          callback({ ok: true });
          return;
        }
        calls.restoreMessages.push({ tabId, ...message });
        callback({ ok: true, restoredScroll: true, restoredHighlight: true, highlightStrategy: "selector" });
      }
    },
    scripting: {
      executeScript(options, callback) {
        calls.executeScript.push(options);
        state.contentScriptReady = true;
        callback([{ result: true }]);
      }
    },
    windows: {
      update(id, update, callback) {
        calls.windowsUpdate.push({ id, update });
        callback({ id, focused: update.focused });
      }
    }
  };
}
