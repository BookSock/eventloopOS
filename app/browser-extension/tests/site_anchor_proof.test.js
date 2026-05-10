// Fixture proof: capture+restore round-trip against synthetic Slack / Notion /
// Google Docs DOMs. Each fixture documents the attribute patterns we observed
// on the real sites; CSS classes are elided since they churn frequently.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  capturePageContext,
  pickViewportAnchor,
  restorePageContext,
  selectorHintForElement
} from "../src/capture-page.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sites");

function readFixture(name) {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

test("slack-thread fixture: capture picks data-qa landmark, restore highlights it", () => {
  const { doc, win } = parseFixture(readFixture("slack-thread.html"), { innerHeight: 800 });

  const anchor = pickViewportAnchor(doc, win);
  assert.ok(anchor, "expected a viewport anchor");
  assert.equal(anchor.selector_hint, '[data-qa="slack_kit_list"]');
  assert.match(anchor.text, /Kicking off the launch retro thread/);

  const page = capturePageContext(win, doc);
  assert.equal(page.quote.strategy, "viewport-anchor");
  assert.equal(page.quote.selector_hint, '[data-qa="slack_kit_list"]');

  const result = restorePageContext({ scroll: { x: 0, y: 0 }, quote: page.quote }, win, doc);
  assert.equal(result.ok, true);
  assert.equal(result.restoredHighlight, true);
  assert.equal(result.highlightStrategy, "selector");
  const highlighted = doc.querySelector("[data-eventloopos-restore-highlight]");
  assert.equal(highlighted.getAttribute("data-qa"), "slack_kit_list");
});

test("slack-thread fixture: data-ts message anchor survives restore via custom hint", () => {
  // V14b shipped: selectorHintForElement now prefers data-qa/data-ts/data-block-id
  // over plain ids and tags. The capture path emits these directly; this test
  // additionally proves the restore-time querySelector path on a fabricated hint.
  const { doc, win } = parseFixture(readFixture("slack-thread.html"), { innerHeight: 800 });

  const targetTs = "1715300050.000200";
  const fabricatedQuote = {
    strategy: "viewport-anchor",
    text: "Thread anchor target: rollout pacing felt too aggressive on Tuesday.",
    selector_hint: `[data-ts="${targetTs}"]`
  };

  const result = restorePageContext({ scroll: { x: 0, y: 0 }, quote: fabricatedQuote }, win, doc);
  assert.equal(result.ok, true);
  assert.equal(result.highlightStrategy, "selector");
  const highlighted = doc.querySelector("[data-eventloopos-restore-highlight]");
  assert.equal(highlighted.getAttribute("data-ts"), targetTs);
});

test("notion-page fixture: capture picks first data-block-id, restore highlights it", () => {
  const { doc, win } = parseFixture(readFixture("notion-page.html"), { innerHeight: 800 });

  const anchor = pickViewportAnchor(doc, win);
  assert.ok(anchor);
  // V14b shipped: selectorHintForElement now prefers data-block-id (more
  // deterministic than the [role="main"] landmark which could match many pages).
  assert.match(anchor.selector_hint, /^\[data-block-id="[0-9a-f-]+"\]$/);

  const result = restorePageContext({ scroll: { x: 0, y: 0 }, quote: anchor }, win, doc);
  assert.equal(result.highlightStrategy, "selector");
  const highlighted = doc.querySelector("[data-eventloopos-restore-highlight]");
  assert.ok(highlighted.getAttribute("data-block-id"));
});

test("notion-page fixture: data-block-id selector survives DOM mutation above the block", () => {
  // V14b shipped: capture now emits [data-block-id="..."] directly. This test
  // proves the selector survives sibling insertion that would shift y-offsets.
  const { doc, win } = parseFixture(readFixture("notion-page.html"), { innerHeight: 800 });
  const targetBlockId = "44444444-aaaa-bbbb-cccc-000000000004";

  const targetBefore = doc.querySelector(`[data-block-id="${targetBlockId}"]`);
  assert.ok(targetBefore, "fixture must contain the target block");
  const originalText = targetBefore.textContent.trim();

  // Mutate: prepend a new block above the target to shift document positions.
  const newBlock = doc.createElement("p");
  newBlock.setAttribute("data-block-id", "99999999-aaaa-bbbb-cccc-000000000099");
  newBlock.appendChild(doc.createTextNode("Inserted-by-test sibling shifts offsets"));
  const parent = targetBefore.parent;
  parent.children.unshift(newBlock);
  newBlock.parent = parent;

  const quote = {
    strategy: "viewport-anchor",
    text: originalText,
    selector_hint: `[data-block-id="${targetBlockId}"]`
  };
  const result = restorePageContext({ scroll: { x: 0, y: 0 }, quote }, win, doc);

  assert.equal(result.highlightStrategy, "selector");
  const highlighted = doc.querySelector("[data-eventloopos-restore-highlight]");
  assert.equal(highlighted.getAttribute("data-block-id"), targetBlockId);
});

test("gdocs-preview fixture: heading id with dot survives via [id=\"…\"] hint", () => {
  // V14b shipped: ids that don't match the bare-#id regex now degrade to an
  // [id="…"] attribute selector instead of a bare tag, preserving the anchor.
  const h1 = {
    id: "h.title-anchor",
    tagName: "H1",
    getAttribute: () => null
  };
  assert.equal(selectorHintForElement(h1), '[id="h.title-anchor"]');
});

test("gdocs-preview fixture: published heading anchors resolve via [id=\"…\"]", () => {
  // V14b shipped: capture emits [id="h.angle2"] for ids with dots; restore
  // resolves the right heading via querySelector on the attribute form.
  const { doc, win } = parseFixture(readFixture("gdocs-preview.html"), { innerHeight: 800 });

  const quote = {
    strategy: "viewport-anchor",
    text: "Angle 2: Should we ship Tuesday?",
    selector_hint: `[id="h.angle2"]`
  };
  const result = restorePageContext({ scroll: { x: 0, y: 0 }, quote }, win, doc);

  assert.equal(result.highlightStrategy, "selector");
  const highlighted = doc.querySelector("[data-eventloopos-restore-highlight]");
  assert.equal(highlighted.getAttribute("id"), "h.angle2");
  assert.match(highlighted.textContent, /Should we ship Tuesday\?/);
});

test("all three fixtures: capture round-trips a non-empty text quote", () => {
  for (const name of ["slack-thread.html", "notion-page.html", "gdocs-preview.html"]) {
    const { doc, win } = parseFixture(readFixture(name), { innerHeight: 800 });
    const page = capturePageContext(win, doc);
    assert.ok(page.quote.text && page.quote.text.length > 0, `${name} produced empty quote`);
    assert.ok(page.quote.strategy, `${name} missing strategy`);
  }
});

// ---------- minimal HTML -> mock-DOM parser ----------
// Just enough surface to drive capture-page.js: querySelector(All), getAttribute,
// setAttribute, removeAttribute, textContent, tagName, id, getBoundingClientRect,
// createElement, createTextNode, getElementById, head.appendChild, body.normalize.
// Bounding rects are synthesized from document order so viewport filtering is
// deterministic; first element gets top=0, each subsequent one shifts down.
function parseFixture(html, { innerHeight = 800 } = {}) {
  const root = parseHtml(html);
  const docEl = findFirst(root, (n) => n.tagName === "HTML") ?? root;
  const body = findFirst(docEl, (n) => n.tagName === "BODY") ?? docEl;
  let head = findFirst(docEl, (n) => n.tagName === "HEAD");
  if (!head) {
    head = makeElement("HEAD");
    head.parent = docEl;
    docEl.children.unshift(head);
  }
  assignRects(body, innerHeight);

  const doc = {
    body,
    head,
    documentElement: docEl,
    scrollingElement: docEl,
    title: "fixture",
    location: { href: "http://fixture.local/" },
    querySelector(selector) {
      return querySelector(body, selector) ?? querySelector(head, selector);
    },
    querySelectorAll(selector) {
      const results = [];
      collectAll(body, selector, results);
      return results;
    },
    getElementById(id) {
      return findFirst(docEl, (n) => n.id === id);
    },
    createElement(tag) {
      return makeElement(tag.toUpperCase());
    },
    createTextNode(text) {
      return { nodeType: 3, nodeValue: text, parent: null, textContent: text };
    },
    createTreeWalker() {
      // The selector path is what we exercise; tree walker is not needed for
      // the assertions we run. Return a stub that yields nothing.
      return { nextNode: () => null };
    },
    createRange() {
      return {
        setStart() {},
        setEnd() {},
        surroundContents() {}
      };
    }
  };
  body.normalize = () => {};
  head.appendChild = (child) => {
    child.parent = head;
    head.children.push(child);
    return child;
  };

  const win = {
    innerHeight,
    innerWidth: 1024,
    scrollX: 0,
    scrollY: 0,
    document: doc,
    getSelection: () => ({ toString: () => "" }),
    scrollTo({ left, top }) {
      win.scrollX = left ?? win.scrollX;
      win.scrollY = top ?? win.scrollY;
    }
  };

  return { doc, win };
}

function makeElement(tagName) {
  const el = {
    nodeType: 1,
    tagName,
    id: "",
    attributes: new Map(),
    children: [],
    textNodes: [],
    parent: null
  };
  defineElementMethods(el);
  return el;
}

function defineElementMethods(el) {
  Object.defineProperty(el, "textContent", {
    get() {
      return collectText(el);
    },
    set(value) {
      el.children = [];
      el.textNodes = [{ nodeType: 3, nodeValue: String(value), parent: el, textContent: String(value) }];
    },
    configurable: true
  });
  el.getAttribute = (name) => (el.attributes.has(name) ? el.attributes.get(name) : null);
  el.setAttribute = (name, value) => {
    el.attributes.set(name, String(value));
    if (name === "id") el.id = String(value);
  };
  el.removeAttribute = (name) => {
    el.attributes.delete(name);
    if (name === "id") el.id = "";
  };
  el.appendChild = (child) => {
    child.parent = el;
    if (child.nodeType === 3) {
      el.textNodes.push(child);
    } else {
      el.children.push(child);
    }
    return child;
  };
  el.replaceWith = (replacement) => {
    if (!el.parent) return;
    const arr = el.parent.children;
    const idx = arr.indexOf(el);
    if (idx >= 0) arr.splice(idx, 1, replacement);
    replacement.parent = el.parent;
  };
  el.getBoundingClientRect = () => el.__rect ?? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
}

function collectText(el) {
  const parts = [];
  walk(el, (node) => {
    if (node.nodeType === 3) parts.push(node.nodeValue ?? "");
  });
  return parts.join("");
}

function walk(node, fn) {
  fn(node);
  for (const t of node.textNodes ?? []) fn(t);
  for (const c of node.children ?? []) walk(c, fn);
}

function findFirst(node, predicate) {
  if (node.nodeType === 1 && predicate(node)) return node;
  for (const c of node.children ?? []) {
    const found = findFirst(c, predicate);
    if (found) return found;
  }
  return null;
}

function collectAll(node, selector, out) {
  for (const part of splitSelector(selector)) {
    if (matches(node, part)) {
      out.push(node);
      break;
    }
  }
  for (const c of node.children ?? []) collectAll(c, selector, out);
}

function querySelector(node, selector) {
  const results = [];
  collectAll(node, selector, results);
  return results[0] ?? null;
}

function splitSelector(selector) {
  return selector.split(",").map((s) => s.trim()).filter(Boolean);
}

function matches(el, selector) {
  if (el.nodeType !== 1) return false;
  // Compound: tag + #id + attribute filters, evaluated as AND.
  const tokens = tokenizeSelector(selector);
  for (const token of tokens) {
    if (token.kind === "tag") {
      if (el.tagName.toLowerCase() !== token.value) return false;
    } else if (token.kind === "id") {
      if (el.id !== token.value) return false;
    } else if (token.kind === "attr") {
      const actual = el.getAttribute(token.name);
      if (actual === null) return false;
      if (token.value !== undefined && actual !== token.value) return false;
    } else if (token.kind === "universal") {
      // matches anything
    } else {
      return false;
    }
  }
  return tokens.length > 0;
}

function tokenizeSelector(selector) {
  const tokens = [];
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (ch === "#") {
      let j = i + 1;
      while (j < selector.length && /[\w.-]/.test(selector[j])) j++;
      tokens.push({ kind: "id", value: selector.slice(i + 1, j) });
      i = j;
    } else if (ch === "[") {
      const end = selector.indexOf("]", i);
      if (end < 0) return [];
      const inner = selector.slice(i + 1, end);
      const eq = inner.indexOf("=");
      if (eq < 0) {
        tokens.push({ kind: "attr", name: inner.trim() });
      } else {
        const name = inner.slice(0, eq).trim();
        let value = inner.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        tokens.push({ kind: "attr", name, value });
      }
      i = end + 1;
    } else if (ch === "*") {
      tokens.push({ kind: "universal" });
      i++;
    } else if (/[a-zA-Z0-9-]/.test(ch)) {
      let j = i;
      while (j < selector.length && /[a-zA-Z0-9-]/.test(selector[j])) j++;
      tokens.push({ kind: "tag", value: selector.slice(i, j).toLowerCase() });
      i = j;
    } else {
      i++;
    }
  }
  return tokens;
}

function assignRects(body, innerHeight) {
  let cursor = 0;
  walk(body, (node) => {
    if (node.nodeType === 1) {
      const top = cursor;
      const height = 24;
      node.__rect = { top, bottom: top + height, left: 0, right: 0, width: 0, height };
      cursor += height;
      // Keep the first ~ innerHeight worth of elements in the viewport.
      if (cursor > innerHeight * 4) cursor = innerHeight * 4;
    }
  });
}

function parseHtml(html) {
  const tokens = tokenizeHtml(html);
  const root = makeElement("ROOT");
  const stack = [root];
  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    if (tok.kind === "open") {
      const el = makeElement(tok.tag.toUpperCase());
      for (const [k, v] of Object.entries(tok.attrs)) {
        el.setAttribute(k, v);
      }
      el.parent = top;
      top.children.push(el);
      if (!tok.selfClosing && !VOID_TAGS.has(tok.tag.toLowerCase())) {
        stack.push(el);
      }
    } else if (tok.kind === "close") {
      // Pop until we find matching tag (lenient).
      for (let j = stack.length - 1; j >= 1; j--) {
        if (stack[j].tagName.toLowerCase() === tok.tag.toLowerCase()) {
          stack.length = j;
          break;
        }
      }
    } else if (tok.kind === "text") {
      const text = tok.value;
      if (text) {
        top.textNodes.push({ nodeType: 3, nodeValue: text, parent: top, textContent: text });
      }
    }
    // comments: ignored
  }
  return root;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function tokenizeHtml(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end < 0) break;
      const inner = html.slice(i + 1, end).trim();
      if (inner.startsWith("/")) {
        tokens.push({ kind: "close", tag: inner.slice(1).trim() });
      } else if (inner.startsWith("!")) {
        // doctype: skip
      } else {
        const selfClosing = inner.endsWith("/");
        const body = selfClosing ? inner.slice(0, -1).trim() : inner;
        const { tag, attrs } = parseTag(body);
        tokens.push({ kind: "open", tag, attrs, selfClosing });
      }
      i = end + 1;
    } else {
      let j = html.indexOf("<", i);
      if (j < 0) j = html.length;
      const text = html.slice(i, j).replace(/\s+/g, " ").trim();
      if (text) tokens.push({ kind: "text", value: text });
      i = j;
    }
  }
  return tokens;
}

function parseTag(body) {
  const match = body.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!match) return { tag: "div", attrs: {} };
  const tag = match[1];
  const rest = body.slice(tag.length);
  const attrs = {};
  const re = /\s+([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = value;
  }
  return { tag, attrs };
}
