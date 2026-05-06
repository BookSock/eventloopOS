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

export function restorePageContext(pageContext, win = globalThis.window) {
  if (!pageContext?.scroll) {
    return { ok: false, error: "missing_scroll" };
  }

  win.scrollTo({
    left: pageContext.scroll.x,
    top: pageContext.scroll.y,
    behavior: "instant"
  });

  return {
    ok: true,
    restoredScroll: true,
    scroll: {
      x: Math.round(win.scrollX),
      y: Math.round(win.scrollY)
    }
  };
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

  const visibleText = normalizeWhitespace(doc.body?.innerText ?? doc.body?.textContent ?? "");
  return {
    strategy: "document-body",
    text: visibleText.slice(0, 240)
  };
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
