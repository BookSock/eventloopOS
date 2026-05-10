import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContextRestorePlan, createDefaultRestorePlanRegistry, RestorePlanRegistry } from "./index.js";

describe("RestorePlanRegistry", () => {
  it("dispatches by kind to the registered builder", () => {
    const registry = new RestorePlanRegistry();
    registry.register("custom_kind", () => ({ kind: "custom_plan", side_effect: "local", execute_supported: false }));
    const plan = registry.build({ kind: "custom_kind" });
    assert.equal(plan?.kind, "custom_plan");
  });

  it("falls back to the registered fallback builder when no kind matches", () => {
    const registry = new RestorePlanRegistry();
    registry.registerFallback((resource) => resource.url ? { kind: "open_url", url: resource.url } : undefined);
    const plan = registry.build({ kind: "unknown", url: "https://example.test/x" });
    assert.equal(plan?.kind, "open_url");
    assert.equal(plan?.url, "https://example.test/x");
  });

  it("aliases let two kinds share one builder", () => {
    const registry = new RestorePlanRegistry();
    registry.register("primary", () => ({ kind: "primary_plan" }));
    registry.registerAlias("alias", "primary");
    assert.equal(registry.build({ kind: "alias" })?.kind, "primary_plan");
  });
});

describe("buildContextRestorePlan default registry", () => {
  it("emits open_slack_thread for slack_thread resources", () => {
    const plan = buildContextRestorePlan({
      kind: "slack_thread",
      url: "https://acme.slack.com/archives/C1/p123",
      details: { thread_ts: "123.456", channel_id: "C1" },
    });
    assert.equal(plan?.kind, "open_slack_thread");
  });

  it("emits open_url as fallback when kind is unknown but url is present", () => {
    const plan = buildContextRestorePlan({ kind: "unknown_kind", url: "https://example.test/" });
    assert.equal(plan?.kind, "open_url");
  });

  it("returns undefined when nothing matches", () => {
    const plan = buildContextRestorePlan({ kind: "note", title: "no url" });
    assert.equal(plan, undefined);
  });

  it("emits open_doc_anchor for google_doc with heading_id anchor", () => {
    const plan = buildContextRestorePlan({
      kind: "google_doc",
      url: "https://docs.google.com/document/d/abc/edit",
      details: { doc_id: "abc", heading_id: "h.x", selection_quote: "Hello" },
    }) as Record<string, unknown>;
    assert.equal(plan?.kind, "open_doc_anchor");
    const anchor = plan.anchor as Record<string, unknown> | undefined;
    assert.equal(anchor?.heading_id, "h.x");
  });

  it("custom registry from createDefaultRestorePlanRegistry can be extended", () => {
    const registry = createDefaultRestorePlanRegistry();
    registry.register("custom_provider", () => ({ kind: "open_custom_provider" }));
    const plan = buildContextRestorePlan({ kind: "custom_provider" }, registry);
    assert.equal(plan?.kind, "open_custom_provider");
  });
});
