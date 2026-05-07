import { buildContextResource, buildRestoreResult, contextResourceToPageContext, normalizeContextResource } from "./protocol.js";
import { callChrome } from "./chrome-promises.js";

export function createExtensionController({ chromeApi, nativeBridge, now = () => new Date() }) {
  async function captureActiveTab(routeHints = {}) {
    const [tab] = await callChrome(chromeApi.tabs.query.bind(chromeApi.tabs), {
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      throw new Error("active_tab_not_found");
    }

    const page = await callChrome(chromeApi.tabs.sendMessage.bind(chromeApi.tabs), tab.id, {
      type: "eventloop.capturePage"
    });

    const resource = buildContextResource({
      tab,
      page,
      capturedAt: now().toISOString()
    });

    const nativeResponse = await nativeBridge.send({
      type: "eventloop.contextCaptured",
      resource,
      ...normalizeRouteHints(routeHints)
    });

    return { resource, nativeResponse };
  }

  async function restore(resource) {
    try {
      const normalizedResource = normalizeContextResource(resource);
      const url = normalizedResource.url;
      if (!url) {
        return buildRestoreResult({
          ok: false,
          url: "",
          error: { code: "missing_url", message: "restore resource missing url" }
        });
      }

      const tabs = await callChrome(chromeApi.tabs.query.bind(chromeApi.tabs), {});
      let tab = tabs.find((candidate) => urlsMatch(candidate.url, url));

      if (tab) {
        await callChrome(chromeApi.tabs.update.bind(chromeApi.tabs), tab.id, { active: true });
        if (tab.windowId != null && chromeApi.windows?.update) {
          await callChrome(chromeApi.windows.update.bind(chromeApi.windows), tab.windowId, { focused: true });
        }
      } else {
        tab = await callChrome(chromeApi.tabs.create.bind(chromeApi.tabs), { url, active: true });
      }

      const restoreResponse = await callChrome(chromeApi.tabs.sendMessage.bind(chromeApi.tabs), tab.id, {
        type: "eventloop.restorePage",
        page: contextResourceToPageContext(resource)
      });

      return buildRestoreResult({
        ok: restoreResponse?.ok !== false,
        tabId: tab.id,
        url,
        restoredScroll: restoreResponse?.restoredScroll === true,
        restoredHighlight: restoreResponse?.restoredHighlight === true,
        highlightStrategy: restoreResponse?.highlightStrategy,
        error: restoreResponse?.ok === false ? { code: "page_restore_failed", message: restoreResponse.error } : null
      });
    } catch (error) {
      return buildRestoreResult({
        ok: false,
        url: resource?.url ?? resource?.tab?.url ?? resource?.page?.url ?? "",
        error: { code: "restore_failed", message: error.message }
      });
    }
  }

  return { captureActiveTab, restore };
}

function normalizeRouteHints(routeHints) {
  if (!routeHints || typeof routeHints !== "object" || Array.isArray(routeHints)) {
    return {};
  }

  return Object.fromEntries(
    ["task_hint", "project_hint"]
      .map((key) => [key, routeHints[key]])
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => [key, value.trim()])
  );
}

export function urlsMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.href === rightUrl.href;
  } catch {
    return left === right;
  }
}
