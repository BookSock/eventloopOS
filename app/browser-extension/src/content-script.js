chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  const visibleText = normalizeWhitespace(doc.body?.innerText ?? doc.body?.textContent ?? "");
  return {
    strategy: "document-body",
    text: visibleText.slice(0, 240)
  };
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}
