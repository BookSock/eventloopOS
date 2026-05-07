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
});
