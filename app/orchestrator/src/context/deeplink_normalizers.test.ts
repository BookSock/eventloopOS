import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDeeplinkResource, normalizeUnknownResource } from "./deeplink_normalizers.js";

describe("deeplink normalizers", () => {
  it("normalizes Slack permalink anchors", () => {
    const resource = normalizeDeeplinkResource({
      id: "ctx_slack",
      title: "Slack launch thread",
      url: "https://acme.slack.com/archives/C123/p1715000000123456",
      source: "slack",
      fields: {
        team_id: "T123",
      },
    });

    assert.equal(resource.kind, "slack_thread");
    assert.equal(resource.restore_confidence, "high");
    assert.deepEqual(resource.details, {
      provider: "slack",
      confidence_reason: "slack_permalink",
      team_id: "T123",
      channel_id: "C123",
      message_ts: "1715000000.123456",
      thread_ts: "1715000000.123456",
    });
  });

  it("normalizes GitHub issue, PR, and code line permalinks", () => {
    const issue = normalizeDeeplinkResource({
      id: "ctx_gh_issue",
      title: "Issue",
      url: "https://github.com/acme/eventloopOS/issues/42",
      source: "github",
    });
    const code = normalizeDeeplinkResource({
      id: "ctx_gh_code",
      title: "Code",
      url: "https://github.com/acme/eventloopOS/blob/abc123/app/orchestrator/src/server.ts#L10-L20",
      source: "github",
    });

    assert.equal(issue.kind, "github");
    assert.deepEqual(issue.details, {
      provider: "github",
      confidence_reason: "github_issue_or_pr_permalink",
      owner: "acme",
      repo: "eventloopOS",
      resource_type: "issue",
      number: 42,
    });
    assert.deepEqual(code.details, {
      provider: "github",
      confidence_reason: "github_code_line_permalink",
      owner: "acme",
      repo: "eventloopOS",
      resource_type: "code",
      commit_sha: "abc123",
      file_path: "app/orchestrator/src/server.ts",
      line_start: 10,
      line_end: 20,
    });
  });

  it("normalizes Notion, Google Docs, and Figma URLs", () => {
    const notion = normalizeDeeplinkResource({
      id: "ctx_notion",
      title: "Launch notes",
      url: "https://www.notion.so/acme/Launch-0123456789abcdef0123456789abcdef#abcdefabcdefabcdefabcdefabcdefab",
    });
    const googleDoc = normalizeDeeplinkResource({
      id: "ctx_gdoc",
      title: "Draft",
      url: "https://docs.google.com/document/d/doc123/edit#heading=h.abc123",
    });
    const figma = normalizeDeeplinkResource({
      id: "ctx_figma",
      title: "Design",
      url: "https://www.figma.com/design/file123/Launch?node-id=12-34",
    });

    assert.equal(notion.kind, "notion_page");
    assert.equal(notion.restore_confidence, "medium");
    assert.equal(notion.details?.provider, "notion");
    assert.equal(notion.details?.page_id, "0123456789abcdef0123456789abcdef");
    assert.equal(notion.details?.block_id, "abcdefabcdefabcdefabcdefabcdefab");
    assert.deepEqual(googleDoc.details, {
      provider: "google_docs",
      confidence_reason: "google_doc_anchor",
      doc_id: "doc123",
      anchor: "heading=h.abc123",
    });
    assert.deepEqual(figma.details, {
      provider: "figma",
      confidence_reason: "figma_node_url",
      file_key: "file123",
      node_id: "12-34",
    });
    assert.equal(figma.restore_confidence, "high");
  });

  it("keeps generic URLs restorable through browser fallback", () => {
    const resource = normalizeUnknownResource(
      {
        url: "https://example.test/blog",
        kind: "external_resource",
      },
      {
        id: "ctx_generic",
        title: "Blog",
        source: "generic_mcp_source",
        captured_at: "2026-05-07T12:00:00.000Z",
      },
    );

    assert.deepEqual(resource, {
      id: "ctx_generic",
      kind: "url",
      title: "Blog",
      url: "https://example.test/blog",
      source: "generic_mcp_source",
      captured_at: "2026-05-07T12:00:00.000Z",
      restore_confidence: "medium",
      details: {
        provider: "browser",
        confidence_reason: "generic_url",
      },
    });
  });
});
