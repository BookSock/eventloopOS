import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOnboardingScan } from "./task_grouping.js";

describe("onboarding task grouping", () => {
  it("groups tagged windows with matching task sessions at high confidence", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      snapshot: {
        backend: "aerospace",
        activeWorkspace: "main",
        focusedWindowId: 1,
        windows: [
          { id: 1, app: "Ghostty", title: "[task:blog review] codex", workspace: "main" },
          { id: 2, app: "Google Chrome", title: "Article", workspace: "main" },
        ],
      },
      taskSessions: [
        { id: "thread_blog", task_id: "task_blog_review", provider: "codex", status: "idle" },
      ],
    });

    assert.equal(scan.proposals[0]?.task_id, "task_blog_review");
    assert.equal(scan.proposals[0]?.confidence, "high");
    assert.equal(scan.proposals[0]?.windows.length, 1);
    assert.equal(scan.proposals[0]?.task_sessions.length, 1);
    assert.equal(scan.active_workspace, "main");
    assert.equal(scan.focused_window_id, 1);
    assert.deepEqual(scan.summary, {
      window_count: 2,
      grouped_window_count: 2,
      ungrouped_window_count: 0,
      task_session_count: 1,
      browser_context_count: 0,
      proposal_count: 2,
    });
    assert.equal(scan.proposals.some((proposal) => proposal.task_id === "task_reading_queue"), true);
  });

  it("keeps unknown apps ungrouped and adds warnings", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      warnings: ["workspace unavailable"],
      snapshot: {
        backend: "aerospace",
        windows: [
          { id: 9, app: "Calendar", title: "Week", workspace: "main" },
        ],
      },
    });

    assert.equal(scan.ungrouped_windows.length, 1);
    assert.deepEqual(scan.warnings, ["workspace unavailable"]);
  });

  it("does not propose raw unbound Codex thread ids as tasks", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      taskSessions: [
        { id: "thread_1", task_id: "task_codex_thread_abc123", provider: "codex" },
      ],
    });

    assert.equal(scan.proposals.length, 0);
    assert.equal(scan.task_sessions.length, 1);
  });

  it("groups terminal windows with matching unbound coding sessions by cwd", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      snapshot: {
        backend: "aerospace",
        windows: [
          { id: 31, app: "Ghostty", title: "codex eventloopOS", workspace: "main" },
        ],
      },
      taskSessions: [
        {
          id: "codex_thread_tmp",
          task_id: "task_codex_thread_abc123",
          provider: "codex",
          status: "running",
          cwd: "/Users/example/dev/eventloopOS",
        },
      ],
    });

    assert.equal(scan.proposals.length, 1);
    assert.equal(scan.proposals[0]?.task_id, "task_eventloopos");
    assert.equal(scan.proposals[0]?.confidence, "medium");
    assert.equal(scan.proposals[0]?.reason, "terminal window matches unbound coding session");
    assert.equal(scan.proposals[0]?.windows[0]?.id, 31);
    assert.equal(scan.proposals[0]?.task_sessions[0]?.id, "codex_thread_tmp");
    assert.equal(scan.summary.grouped_window_count, 1);
  });

  it("groups captured browser tab contexts by task", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      browserContexts: [
        {
          event_id: "evt_browser_blog",
          event_title: "Blog draft tab",
          event_source: "browser",
          task_id: "task_blog_review",
          route_decision: {
            id: "rte_browser_blog",
            event_id: "evt_browser_blog",
            action: "attach_to_task",
            target_task_id: "task_blog_review",
            confidence: "medium",
            evidence: [],
            created_at: "2026-05-07T00:00:00.000Z",
          },
          resource: {
            id: "browser_tab:42",
            kind: "browser_tab",
            title: "Blog draft",
            url: "https://example.test/blog",
            window_id: "101",
            tab_id: "42",
            restore_confidence: "high",
          },
          captured_at: "2026-05-07T00:00:00.000Z",
          relevance_score: 0,
          match_reasons: [],
        },
      ],
    });

    assert.equal(scan.summary.browser_context_count, 1);
    assert.equal(scan.proposals.length, 1);
    assert.equal(scan.proposals[0]?.task_id, "task_blog_review");
    assert.equal(scan.proposals[0]?.browser_contexts[0]?.id, "browser_tab:42");
  });

  it("turns unassigned captured browser tabs into reading queue work", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      browserContexts: [
        {
          event_id: "evt_browser_article",
          event_title: "Long launch article",
          event_source: "browser",
          route_decision: {
            id: "rte_browser_article",
            event_id: "evt_browser_article",
            action: "create_review_packet",
            confidence: "low",
            evidence: [],
            created_at: "2026-05-07T00:00:00.000Z",
          },
          resource: {
            id: "browser_tab:77",
            kind: "browser_tab",
            title: "Long launch article",
            url: "https://example.test/article",
            window_id: "7",
            tab_id: "77",
            restore_confidence: "medium",
          },
          captured_at: "2026-05-07T00:00:00.000Z",
          relevance_score: 0,
          match_reasons: [],
        },
      ],
    });

    assert.equal(scan.summary.browser_context_count, 1);
    assert.equal(scan.proposals.length, 1);
    assert.equal(scan.proposals[0]?.task_id, "task_reading_queue");
    assert.equal(scan.proposals[0]?.confidence, "low");
    assert.equal(scan.proposals[0]?.reason, "captured browser tab without task tag");
  });

  it("groups unassigned browser tabs with matching task sessions", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      taskSessions: [
        { id: "thread_blog", task_id: "task_blog_launch", provider: "codex", status: "running" },
      ],
      browserContexts: [
        {
          event_id: "evt_blog_doc",
          event_title: "Blog Launch Draft",
          event_source: "browser",
          route_decision: {
            id: "rte_blog_doc",
            event_id: "evt_blog_doc",
            action: "create_review_packet",
            confidence: "medium",
            evidence: [],
            created_at: "2026-05-07T00:00:00.000Z",
          },
          resource: {
            id: "browser_tab:88",
            kind: "browser_tab",
            title: "Blog Launch Draft",
            url: "https://docs.example.test/blog-launch",
            tab_id: "88",
            restore_confidence: "high",
          },
          captured_at: "2026-05-07T00:00:00.000Z",
          relevance_score: 0,
          match_reasons: [],
        },
      ],
    });

    assert.equal(scan.proposals.length, 1);
    assert.equal(scan.proposals[0]?.task_id, "task_blog_launch");
    assert.equal(scan.proposals[0]?.browser_contexts[0]?.id, "browser_tab:88");
    assert.equal(scan.proposals[0]?.task_sessions[0]?.id, "thread_blog");
  });

  it("pulls matching browser windows into the captured tab task proposal", () => {
    const scan = buildOnboardingScan({
      capturedAt: "2026-05-07T00:00:00.000Z",
      snapshot: {
        backend: "aerospace",
        windows: [
          { id: 42, app: "Google Chrome", title: "Blog Launch Draft - Google Docs", workspace: "main" },
          { id: 99, app: "Google Chrome", title: "Unrelated article", workspace: "main" },
        ],
      },
      browserContexts: [
        {
          event_id: "evt_blog_doc",
          event_title: "Blog Launch Draft",
          event_source: "browser",
          task_id: "task_blog_launch",
          route_decision: {
            id: "rte_blog_doc",
            event_id: "evt_blog_doc",
            action: "attach_to_task",
            target_task_id: "task_blog_launch",
            confidence: "medium",
            evidence: [],
            created_at: "2026-05-07T00:00:00.000Z",
          },
          resource: {
            id: "browser_tab:88",
            kind: "browser_tab",
            title: "Blog Launch Draft",
            url: "https://docs.example.test/blog-launch",
            window_id: "42",
            tab_id: "88",
            restore_confidence: "high",
          },
          captured_at: "2026-05-07T00:00:00.000Z",
          relevance_score: 0,
          match_reasons: [],
        },
      ],
    });

    const blogProposal = scan.proposals.find((proposal) => proposal.task_id === "task_blog_launch");
    assert.equal(blogProposal?.windows.map((window) => window.id).join(","), "42");
    assert.equal(blogProposal?.browser_contexts.map((context) => context.id).join(","), "browser_tab:88");
    assert.equal(blogProposal?.confidence, "medium");

    const readingProposal = scan.proposals.find((proposal) => proposal.task_id === "task_reading_queue");
    assert.equal(readingProposal?.windows.map((window) => window.id).join(","), "99");
    assert.equal(scan.summary.grouped_window_count, 2);
    assert.equal(scan.summary.ungrouped_window_count, 0);
  });
});
