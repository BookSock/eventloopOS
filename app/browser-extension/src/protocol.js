export const CONTEXT_RESOURCE_SCHEMA_VERSION = "eventloop.contextResource.v1";
export const RESTORE_RESULT_SCHEMA_VERSION = "eventloop.restoreResult.v1";

export function buildContextResource({ tab, page, capturedAt = new Date().toISOString() }) {
  const resource = {
    id: `browser_tab:${tab.id ?? page.url}`,
    kind: "browser_tab",
    title: tab.title ?? page.title,
    url: tab.url ?? page.url,
    source: "chrome-extension",
    captured_at: capturedAt,
    restore_confidence: "high",
    window_id: tab.windowId == null ? undefined : String(tab.windowId),
    tab_id: tab.id == null ? undefined : String(tab.id),
    scroll_y: page.scroll?.y,
    text_quote: page.quote?.text,
    selector_hint: selectorHintFromQuote(page.quote)
  };

  validateContextResource(resource);
  return resource;
}

export function buildTabRegistryResource({ tab, capturedAt = new Date().toISOString() }) {
  const resource = {
    id: `browser_tab:${tab.id ?? tab.url}`,
    kind: "browser_tab",
    title: tab.title ?? tab.url ?? "Browser tab",
    url: tab.url,
    source: "chrome-extension",
    captured_at: capturedAt,
    restore_confidence: "medium",
    window_id: tab.windowId == null ? undefined : String(tab.windowId),
    tab_id: tab.id == null ? undefined : String(tab.id),
    details: {
      registry_capture: true,
      active: tab.active === true,
      pinned: tab.pinned === true,
      audible: tab.audible === true,
      discarded: tab.discarded === true
    }
  };

  validateContextResource(resource);
  return resource;
}

export function validateContextResource(resource) {
  const normalized = normalizeContextResource(resource);
  assertObject(normalized, "resource");
  assertString(normalized.id, "id");
  assertEqual(normalized.kind, "browser_tab", "kind");
  assertString(normalized.title, "title");
  if (normalized.url !== undefined) {
    assertUrl(normalized.url, "url");
  }
  if (normalized.source !== undefined) {
    assertString(normalized.source, "source");
  }
  if (normalized.captured_at !== undefined) {
    assertString(normalized.captured_at, "captured_at");
  }
  assertRestoreConfidence(normalized.restore_confidence, "restore_confidence");
  if (normalized.window_id !== undefined) {
    assertString(normalized.window_id, "window_id");
  }
  if (normalized.tab_id !== undefined) {
    assertString(normalized.tab_id, "tab_id");
  }
  if (normalized.scroll_y !== undefined) {
    assertNonnegativeInteger(normalized.scroll_y, "scroll_y");
  }
  if (normalized.text_quote !== undefined) {
    assertString(normalized.text_quote, "text_quote");
  }
  if (normalized.selector_hint !== undefined) {
    assertString(normalized.selector_hint, "selector_hint");
  }
  return normalized;
}

export function normalizeContextResource(resource) {
  assertObject(resource, "resource");

  if (resource.kind === "browser_tab") {
    return {
      ...resource,
      id: resource.id ?? `browser_tab:${resource.tab_id ?? resource.url ?? "unknown"}`,
      restore_confidence: resource.restore_confidence ?? "medium"
    };
  }

  if (resource.type === "browser.tab") {
    const url = resource.tab?.url ?? resource.page?.url;
    const title = resource.tab?.title ?? resource.page?.title;

    return {
      id: resource.id ?? `browser_tab:${resource.tab?.id ?? url ?? "unknown"}`,
      kind: "browser_tab",
      title,
      url,
      source: resource.source,
      captured_at: resource.captured_at ?? resource.capturedAt,
      restore_confidence: resource.restore_confidence ?? "high",
      window_id: stringOrUndefined(resource.window_id ?? resource.tab?.windowId),
      tab_id: stringOrUndefined(resource.tab_id ?? resource.tab?.id),
      scroll_y: resource.scroll_y ?? resource.page?.scroll?.y,
      text_quote: resource.text_quote ?? resource.page?.quote?.text,
      selector_hint: resource.selector_hint ?? selectorHintFromQuote(resource.page?.quote)
    };
  }

  return resource;
}

export function contextResourceToPageContext(resource) {
  if (resource?.page) {
    return resource.page;
  }

  const normalized = normalizeContextResource(resource);
  return {
    url: normalized.url,
    title: normalized.title,
    scroll: {
      x: 0,
      y: normalized.scroll_y ?? 0,
      maxX: 0,
      maxY: Math.max(0, normalized.scroll_y ?? 0)
    },
    quote: {
      strategy: normalized.selector_hint ? "selector-hint" : "text-quote",
      text: normalized.text_quote ?? "",
      selector_hint: normalized.selector_hint
    }
  };
}

export function buildRestoreResult({
  ok,
  tabId = null,
  url,
  restoredScroll = false,
  restoredHighlight = false,
  highlightStrategy,
  error = null
}) {
  return {
    schemaVersion: RESTORE_RESULT_SCHEMA_VERSION,
    ok,
    tabId,
    url,
    restoredScroll,
    restoredHighlight,
    highlightStrategy,
    error
  };
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be object`);
  }
}

function assertString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be non-empty string`);
  }
}

function assertNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be finite number`);
  }
}

function assertNonnegativeInteger(value, path) {
  assertNumber(value, path);
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be nonnegative integer`);
  }
}

function assertEqual(value, expected, path) {
  if (value !== expected) {
    throw new TypeError(`${path} must be ${expected}`);
  }
}

function assertUrl(value, path) {
  assertString(value, path);
  try {
    new URL(value);
  } catch {
    throw new TypeError(`${path} must be url`);
  }
}

function assertRestoreConfidence(value, path) {
  if (value !== "high" && value !== "medium" && value !== "low") {
    throw new TypeError(`${path} must be high, medium, or low`);
  }
}

function selectorHintFromQuote(quote) {
  if (quote?.selector_hint) {
    return quote.selector_hint;
  }

  if (quote?.strategy === "fixture-marker") {
    return "[data-context-quote]";
  }

  return undefined;
}

function stringOrUndefined(value) {
  return value == null ? undefined : String(value);
}
