chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "eventloop.ping") {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "eventloop.capturePage") {
    sendResponse(capturePageContext(window, document));
    return false;
  }

  if (message?.type === "eventloop.restorePage") {
    sendResponse(restorePageContext(message.page, window));
    return false;
  }

  return false;
});

const HIGHLIGHT_ATTRIBUTE = "data-eventloopos-restore-highlight";
const HIGHLIGHT_STYLE_ID = "eventloopos-restore-highlight-style";

function capturePageContext(win, doc) {
  const scrollingElement = doc.scrollingElement ?? doc.documentElement;
  const quote = captureQuote(win, doc);

  return {
    url: doc.location.href,
    title: doc.title,
    scroll: {
      x: Math.round(win.scrollX),
      y: Math.round(win.scrollY),
      maxX: Math.max(0, scrollingElement.scrollWidth - win.innerWidth),
      maxY: Math.max(0, scrollingElement.scrollHeight - win.innerHeight)
    },
    quote
  };
}

function restorePageContext(pageContext, win) {
  const anchorResult = scrollToProviderAnchor(pageContext, win);
  if (!pageContext?.scroll) {
    if (anchorResult.ok) {
      return {
        ok: true,
        restoredScroll: true,
        restoredHighlight: false,
        highlightStrategy: anchorResult.strategy,
        anchorStrategy: anchorResult.strategy,
        scroll: {
          x: Math.round(win.scrollX),
          y: Math.round(win.scrollY)
        }
      };
    }
    return { ok: false, error: "missing_scroll" };
  }

  win.scrollTo({
    left: pageContext.scroll.x,
    top: pageContext.scroll.y,
    behavior: "instant"
  });

  const highlight = highlightRestoredQuote(pageContext.quote, win.document);

  return {
    ok: true,
    restoredScroll: true,
    restoredHighlight: highlight.ok,
    highlightStrategy: highlight.strategy,
    anchorStrategy: anchorResult.strategy,
    scroll: {
      x: Math.round(win.scrollX),
      y: Math.round(win.scrollY)
    }
  };
}

function scrollToProviderAnchor(pageContext, win) {
  const planKind = pageContext?.plan_kind;
  const anchor = pageContext?.anchor;
  const doc = win.document;
  if (!planKind || !anchor || !doc) {
    return { ok: false, strategy: "no_anchor" };
  }

  if (planKind === "open_slack_thread" && typeof anchor.message_ts === "string") {
    const candidate = doc.querySelector(`[data-item-key*="${cssEscape(anchor.message_ts)}"]`)
      ?? doc.querySelector(`[data-ts="${cssEscape(anchor.message_ts)}"]`);
    if (candidate?.scrollIntoView) {
      candidate.scrollIntoView({ block: "center", behavior: "instant" });
      return { ok: true, strategy: "slack_message_ts" };
    }
    return { ok: false, strategy: "slack_message_not_found" };
  }

  if (planKind === "open_email" && typeof anchor.message_id === "string") {
    const candidate = doc.querySelector(`[data-message-id="${cssEscape(anchor.message_id)}"]`);
    if (candidate?.scrollIntoView) {
      candidate.scrollIntoView({ block: "center", behavior: "instant" });
      return { ok: true, strategy: "gmail_message_id" };
    }
    return { ok: false, strategy: "gmail_message_not_found" };
  }

  if (planKind === "open_doc_anchor" && typeof anchor.heading_id === "string") {
    const candidate = doc.querySelector(`[id="${cssEscape(anchor.heading_id)}"]`)
      ?? doc.querySelector(`[name="${cssEscape(anchor.heading_id)}"]`);
    if (candidate?.scrollIntoView) {
      candidate.scrollIntoView({ block: "center", behavior: "instant" });
      return { ok: true, strategy: "doc_heading_id" };
    }
    return { ok: false, strategy: "doc_heading_not_found" };
  }

  if (planKind === "open_notion_page" && typeof anchor.block_id === "string") {
    const candidate = doc.querySelector(`[data-block-id="${cssEscape(anchor.block_id)}"]`);
    if (candidate?.scrollIntoView) {
      candidate.scrollIntoView({ block: "center", behavior: "instant" });
      return { ok: true, strategy: "notion_block_id" };
    }
    return { ok: false, strategy: "notion_block_not_found" };
  }

  return { ok: false, strategy: "unknown_anchor" };
}

function cssEscape(value) {
  if (typeof value !== "string") return "";
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
}

function highlightRestoredQuote(quote, doc) {
  if (!doc?.body) {
    return { ok: false, strategy: "missing_document" };
  }

  clearRestoreHighlights(doc);

  const selector = quote?.selector_hint;
  if (selector) {
    try {
      const element = doc.querySelector(selector);
      if (element) {
        installHighlightStyle(doc);
        element.setAttribute(HIGHLIGHT_ATTRIBUTE, "selector");
        return { ok: true, strategy: "selector" };
      }
    } catch {
      return { ok: false, strategy: "invalid_selector" };
    }
  }

  const text = normalizeWhitespace(quote?.text ?? "");
  if (!text) {
    return { ok: false, strategy: "missing_quote" };
  }

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const rawText = node.nodeValue ?? "";
    const index = rawText.indexOf(text);
    if (index >= 0) {
      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const mark = doc.createElement("mark");
      mark.setAttribute(HIGHLIGHT_ATTRIBUTE, "text");
      try {
        installHighlightStyle(doc);
        range.surroundContents(mark);
        return { ok: true, strategy: "text" };
      } catch {
        return { ok: false, strategy: "range_failed" };
      }
    }
    node = walker.nextNode();
  }

  return { ok: false, strategy: "quote_not_found" };
}

function clearRestoreHighlights(doc) {
  for (const element of doc.querySelectorAll(`[${HIGHLIGHT_ATTRIBUTE}]`)) {
    if (element.tagName === "MARK" && element.getAttribute(HIGHLIGHT_ATTRIBUTE) === "text") {
      element.replaceWith(doc.createTextNode(element.textContent ?? ""));
    } else {
      element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
    }
  }
  doc.body?.normalize?.();
}

function installHighlightStyle(doc) {
  if (doc.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const style = doc.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    [${HIGHLIGHT_ATTRIBUTE}] {
      background: #ffe66d !important;
      box-shadow: 0 0 0 3px rgba(255, 190, 80, 0.55) !important;
      border-radius: 3px !important;
    }
  `;
  doc.head?.appendChild(style);
}

function captureQuote(win, doc) {
  const selection = win.getSelection?.();
  const selectedText = selection?.toString().trim();

  if (selectedText) {
    return {
      strategy: "selection",
      text: selectedText,
      prefix: "",
      suffix: ""
    };
  }

  const explicitQuote = doc.querySelector("[data-context-quote]");
  if (explicitQuote?.textContent?.trim()) {
    return {
      strategy: "fixture-marker",
      text: normalizeWhitespace(explicitQuote.textContent)
    };
  }

  const anchor = pickViewportAnchor(doc, win);
  if (anchor?.text) {
    return {
      strategy: "viewport-anchor",
      text: anchor.text,
      selector_hint: anchor.selector_hint
    };
  }

  const visibleText = normalizeWhitespace(doc.body?.innerText ?? doc.body?.textContent ?? "");
  return {
    strategy: "document-body",
    text: visibleText.slice(0, 120)
  };
}

const VIEWPORT_ANCHOR_SELECTORS = "h1, h2, h3, h4, h5, h6, [role=heading], main, [role=main], article, section[id], p";
const VIEWPORT_ANCHOR_TEXT_LIMIT = 120;

function pickViewportAnchor(doc, win) {
  if (!doc?.querySelectorAll) {
    return null;
  }
  const innerHeight = Number.isFinite(win?.innerHeight) ? win.innerHeight : 0;
  let candidates;
  try {
    candidates = doc.querySelectorAll(VIEWPORT_ANCHOR_SELECTORS);
  } catch {
    return null;
  }

  for (const element of candidates) {
    const rect = safeBoundingRect(element);
    if (!rect) continue;
    if (innerHeight > 0 && rect.top > innerHeight) continue;
    if (rect.bottom !== undefined && rect.bottom < 0) continue;
    const text = normalizeWhitespace(element.textContent ?? "");
    if (!text) continue;
    return {
      selector_hint: selectorHintForElement(element),
      text: text.slice(0, VIEWPORT_ANCHOR_TEXT_LIMIT)
    };
  }
  return null;
}

function safeBoundingRect(element) {
  if (typeof element?.getBoundingClientRect !== "function") {
    return { top: 0, bottom: 0 };
  }
  try {
    return element.getBoundingClientRect();
  } catch {
    return null;
  }
}

const PROVIDER_DATA_ATTRIBUTES = ["data-block-id", "data-ts", "data-message-id", "data-qa"];

function selectorHintForElement(element) {
  if (!element) return undefined;
  for (const attr of PROVIDER_DATA_ATTRIBUTES) {
    const value = element.getAttribute?.(attr);
    if (value) return `[${attr}="${escapeAttrValue(value)}"]`;
  }
  const id = typeof element.id === "string" ? element.id.trim() : "";
  if (id) {
    if (/^[A-Za-z][\w-]*$/.test(id)) return `#${id}`;
    return `[id="${escapeAttrValue(id)}"]`;
  }
  const role = element.getAttribute?.("role");
  if (role === "main") return "[role=\"main\"]";
  if (role === "heading") return "[role=\"heading\"]";
  const tag = (element.tagName ?? "").toLowerCase();
  if (tag === "main") return "main";
  if (tag === "article") return "article";
  if (tag && /^h[1-6]$/.test(tag)) return tag;
  return undefined;
}

function escapeAttrValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}
