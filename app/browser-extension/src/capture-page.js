export function capturePageContext(win = globalThis.window, doc = globalThis.document) {
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

const HIGHLIGHT_ATTRIBUTE = "data-eventloopos-restore-highlight";
const HIGHLIGHT_STYLE_ID = "eventloopos-restore-highlight-style";

export function restorePageContext(pageContext, win = globalThis.window, doc = win?.document ?? globalThis.document) {
  if (!pageContext?.scroll) {
    return { ok: false, error: "missing_scroll" };
  }

  win.scrollTo({
    left: pageContext.scroll.x,
    top: pageContext.scroll.y,
    behavior: "instant"
  });

  const highlight = highlightRestoredQuote(pageContext.quote, doc);

  return {
    ok: true,
    restoredScroll: true,
    restoredHighlight: highlight.ok,
    highlightStrategy: highlight.strategy,
    scroll: {
      x: Math.round(win.scrollX),
      y: Math.round(win.scrollY)
    }
  };
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
      prefix: textBefore(selection),
      suffix: textAfter(selection)
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

export function pickViewportAnchor(doc, win) {
  if (!doc?.querySelectorAll) {
    return null;
  }
  const innerHeight = Number.isFinite(win?.innerHeight) ? win.innerHeight : 0;
  const candidates = [];
  try {
    for (const element of doc.querySelectorAll(VIEWPORT_ANCHOR_SELECTORS)) {
      candidates.push(element);
    }
  } catch {
    return null;
  }

  for (const element of candidates) {
    const rect = safeBoundingRect(element);
    if (!rect) continue;
    // Must intersect viewport (top below screen-bottom would skip).
    if (innerHeight > 0 && rect.top > innerHeight) continue;
    if (rect.bottom !== undefined && rect.bottom < 0) continue;
    const text = normalizeWhitespace(element.textContent ?? "");
    if (!text) continue;
    const selectorHint = selectorHintForElement(element);
    return {
      element,
      selector_hint: selectorHint,
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
    const rect = element.getBoundingClientRect();
    if (!rect) return null;
    return rect;
  } catch {
    return null;
  }
}

export function selectorHintForElement(element) {
  if (!element) return undefined;
  const id = typeof element.id === "string" ? element.id.trim() : "";
  if (id && /^[A-Za-z][\w-]*$/.test(id)) {
    return `#${id}`;
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

function textBefore(selection) {
  try {
    const range = selection.getRangeAt(0).cloneRange();
    range.setStart(range.startContainer, Math.max(0, range.startOffset - 80));
    return normalizeWhitespace(range.toString()).slice(0, 80);
  } catch {
    return "";
  }
}

function textAfter(selection) {
  try {
    const range = selection.getRangeAt(0).cloneRange();
    range.setEnd(range.endContainer, Math.min(range.endContainer.length ?? 0, range.endOffset + 80));
    return normalizeWhitespace(range.toString()).slice(-80);
  } catch {
    return "";
  }
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}
