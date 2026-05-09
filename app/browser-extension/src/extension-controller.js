import { buildContextResource, buildRestoreResult, buildTabRegistryResource, contextResourceToPageContext, normalizeContextResource } from "./protocol.js";
import { callChrome } from "./chrome-promises.js";
import { DEFAULT_ALLOWED_ORIGINS, isUrlAllowedByOrigins } from "./extension-config.js";

export function createExtensionController({ chromeApi, nativeBridge, configStore, now = () => new Date() }) {
  async function captureActiveTab(routeHints = {}) {
    const [tab] = await callChrome(chromeApi.tabs.query.bind(chromeApi.tabs), {
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      throw new Error("active_tab_not_found");
    }

    if (!(await isAllowedUrl(tab.url))) {
      return {
        ok: false,
        skipped: true,
        error: disallowedOriginError(tab.url, "capture")
      };
    }

    const page = await sendContentScriptMessage(tab.id, {
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

  async function captureTabRegistry(routeHints = {}) {
    const tabs = await callChrome(chromeApi.tabs.query.bind(chromeApi.tabs), {});
    const capturedAt = now().toISOString();
    const normalizedRouteHints = normalizeRouteHints(routeHints);
    const captured = [];
    const skipped = [];

    for (const tab of tabs) {
      if (!tab?.id) {
        skipped.push({ reason: "missing_tab_id", title: tab?.title ?? null, url: tab?.url ?? null });
        continue;
      }
      if (!(await isAllowedUrl(tab.url))) {
        skipped.push({
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          error: disallowedOriginError(tab.url, "tab registry")
        });
        continue;
      }

      const resource = buildTabRegistryResource({ tab, capturedAt });
      const nativeResponse = await nativeBridge.send({
        type: "eventloop.contextCaptured",
        resource,
        idempotency_key: `browser_registry:${resource.tab_id ?? resource.id}:${capturedAt}`,
        ...normalizedRouteHints
      });
      captured.push({ resource, nativeResponse });
    }

    return {
      ok: true,
      captured_at: capturedAt,
      attempted_count: captured.length,
      captured_count: captured.filter((item) => item.nativeResponse?.ok === true).length,
      failed_count: captured.filter((item) => item.nativeResponse?.ok === false).length,
      skipped_count: skipped.length,
      captured,
      skipped
    };
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
      if (!(await isAllowedUrl(url))) {
        return buildRestoreResult({
          ok: false,
          url,
          error: disallowedOriginError(url, "restore")
        });
      }

      const tabs = await callChrome(chromeApi.tabs.query.bind(chromeApi.tabs), {});
      let tab = tabByCapturedId(tabs, normalizedResource.tab_id, url);
      tab ??= tabs.find((candidate) => urlsMatch(candidate.url, url));

      if (tab) {
        await callChrome(chromeApi.tabs.update.bind(chromeApi.tabs), tab.id, { active: true });
        if (tab.windowId != null && chromeApi.windows?.update) {
          await callChrome(chromeApi.windows.update.bind(chromeApi.windows), tab.windowId, { focused: true });
        }
      } else {
        tab = await callChrome(chromeApi.tabs.create.bind(chromeApi.tabs), { url, active: true });
      }

      const restoreResponse = await sendContentScriptMessage(tab.id, {
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

  async function isAllowedUrl(url) {
    const allowedOrigins = configStore?.getAllowedOrigins
      ? await configStore.getAllowedOrigins()
      : DEFAULT_ALLOWED_ORIGINS;
    return isUrlAllowedByOrigins(url, allowedOrigins);
  }

  async function sendContentScriptMessage(tabId, message) {
    await ensureContentScript(tabId);
    return await callChrome(chromeApi.tabs.sendMessage.bind(chromeApi.tabs), tabId, message);
  }

  async function ensureContentScript(tabId) {
    try {
      const response = await callChrome(chromeApi.tabs.sendMessage.bind(chromeApi.tabs), tabId, {
        type: "eventloop.ping"
      });
      if (response?.ok === true) {
        return;
      }
    } catch {
      // No listener yet. Programmatic injection keeps the content script out of every page by default.
    }

    if (!chromeApi.scripting?.executeScript) {
      throw new Error("content_script_injection_unavailable");
    }
    await callChrome(chromeApi.scripting.executeScript.bind(chromeApi.scripting), {
      target: { tabId },
      files: ["src/content-script.js"]
    });
  }

  return { captureActiveTab, captureTabRegistry, restore };
}

function disallowedOriginError(url, action) {
  let host = "unknown";
  try {
    const parsed = new URL(url);
    host = parsed.protocol === "file:" ? "file" : parsed.host;
  } catch {
    host = String(url ?? "unknown");
  }
  return {
    code: "origin_not_allowed",
    message: `origin not allowed for ${action}: ${host}`
  };
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

export function tabByCapturedId(tabs, tabId, expectedUrl) {
  const parsedTabId = Number(tabId);
  if (!Number.isInteger(parsedTabId) || parsedTabId <= 0) {
    return undefined;
  }
  const tab = tabs.find((candidate) => candidate.id === parsedTabId);
  if (!tab) {
    return undefined;
  }
  if (expectedUrl && !urlsMatch(tab.url, expectedUrl)) {
    return undefined;
  }
  return tab;
}
