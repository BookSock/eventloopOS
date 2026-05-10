import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaperPlan } from "./paper.js";
import { buildContextRestorePlan } from "./index.js";

describe("buildPaperPlan", () => {
  it("emits open_url with file:// when file_uri is set on the resource", () => {
    const plan = buildPaperPlan({
      kind: "paper",
      title: "Term sheet review",
      file_uri: "file:///Users/jason/Documents/term-sheet.pdf",
      body_markdown: "Skim section 4.",
      source_kind: "pdf",
    }) as Record<string, unknown>;

    assert.equal(plan.kind, "open_url");
    assert.equal(plan.url, "file:///Users/jason/Documents/term-sheet.pdf");
    assert.equal(plan.side_effect, "local");
    assert.equal(plan.execute_supported, false);
    const paper = plan.paper as Record<string, unknown>;
    assert.equal(paper.title, "Term sheet review");
    assert.equal(paper.source_kind, "pdf");
    assert.equal(paper.body_markdown, "Skim section 4.");
  });

  it("falls back to resource.url when file_uri is absent", () => {
    const plan = buildPaperPlan({
      kind: "paper",
      title: "External doc",
      url: "https://example.test/doc",
      body_markdown: "Look at headings 2 and 4.",
    }) as Record<string, unknown>;

    assert.equal(plan.kind, "open_url");
    assert.equal(plan.url, "https://example.test/doc");
  });

  it("reads file_uri from details when not on the top level", () => {
    const plan = buildPaperPlan({
      kind: "paper",
      title: "Image to label",
      details: { file_uri: "file:///Users/jason/Pictures/screenshot.png", source_kind: "image" },
    }) as Record<string, unknown>;

    assert.equal(plan.kind, "open_url");
    assert.equal(plan.url, "file:///Users/jason/Pictures/screenshot.png");
    const paper = plan.paper as Record<string, unknown>;
    assert.equal(paper.source_kind, "image");
  });

  it("emits show_paper with body_markdown when no file or url is present", () => {
    const plan = buildPaperPlan({
      kind: "paper",
      title: "Quick note",
      body_markdown: "Decide whether to bump pricing for Q3.",
    }) as Record<string, unknown>;

    assert.equal(plan.kind, "show_paper");
    assert.equal(plan.url, undefined);
    const paper = plan.paper as Record<string, unknown>;
    assert.equal(paper.title, "Quick note");
    assert.equal(paper.source_kind, "note");
    assert.equal(paper.body_markdown, "Decide whether to bump pricing for Q3.");
  });

  it("returns undefined when neither file, url, nor body is present", () => {
    assert.equal(buildPaperPlan({ kind: "paper", title: "Empty" }), undefined);
  });

  it("is registered on the default registry under kind=paper", () => {
    const plan = buildContextRestorePlan({
      kind: "paper",
      title: "Onboarding doc",
      body_markdown: "Skim the intro.",
    }) as Record<string, unknown>;

    assert.equal(plan?.kind, "show_paper");
  });

  it("default registry prefers file_uri over the url fallback for paper kind", () => {
    const plan = buildContextRestorePlan({
      kind: "paper",
      title: "PDF",
      url: "https://example.test/should-be-ignored",
      file_uri: "file:///Users/jason/Documents/term-sheet.pdf",
    }) as Record<string, unknown>;

    assert.equal(plan?.kind, "open_url");
    assert.equal(plan?.url, "file:///Users/jason/Documents/term-sheet.pdf");
  });
});
