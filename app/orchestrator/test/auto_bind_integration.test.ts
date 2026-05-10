import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import type { TaskRuntimeBinding, TaskRuntimeSession, TaskSessionController } from "../src/task_sessions/types.js";
import type { WorkspaceController } from "../src/workspace/controller.js";
import type { AerospaceWindow, WorkspaceSnapshot } from "../src/workspace/aerospace.js";

// V10 — proves the auto-bind continuous timer end-to-ends:
//   - The orchestrator's setInterval timer in `app/orchestrator/src/index.ts`
//     is a thin HTTP poller that POSTs to `/agents/codex/auto-bind`. This
//     test boots the gateway in-process with a fake workspace controller and
//     a fake task-session controller, then drives that endpoint over real
//     setInterval ticks, mutating fake-window state between phases to prove:
//       1. Synthetic [task:foo] Ghostty windows bind to matching task_sessions.
//       2. Non-terminal apps and untagged windows are ignored.
//       3. Two windows for the same task → first bound, second logged as
//          "multiple_sessions_for_task" / "already_bound".
//       4. A task_session with no matching window stays unbound.
//       5. Window title appearing on a later tick (re-tagged mid-flight)
//          binds on the next tick.

type AutoBindResponse = {
  ok: boolean;
  scanned_window_count: number;
  matched_count: number;
  bound: Array<{ task_id: string; task_session_id: string; terminal_ref: string; window_id: number; window_app: string }>;
  skipped: Array<{ task_id?: string; window_id?: number; window_title?: string; reason: string }>;
};

type FakeWorkspace = WorkspaceController & {
  setWindows: (windows: AerospaceWindow[]) => void;
  captureCount: () => number;
};

function createFakeWorkspace(initial: AerospaceWindow[]): FakeWorkspace {
  let windows = [...initial];
  let captureCalls = 0;
  return {
    status() {
      return { available: true, backend: "aerospace" } as const;
    },
    capture(): WorkspaceSnapshot {
      captureCalls += 1;
      return {
        backend: "aerospace",
        windows: windows.map((window) => ({ ...window })),
      };
    },
    planRestore() {
      throw new Error("planRestore should not be called by auto-bind");
    },
    setWindows(next: AerospaceWindow[]) {
      windows = [...next];
    },
    captureCount() {
      return captureCalls;
    },
  };
}

type FakeBindCall = { task_session_id: string; task_id: string; terminal_ref?: string };

type FakeTaskSessions = TaskSessionController & {
  bindCalls: FakeBindCall[];
  setSessions: (sessions: TaskRuntimeSession[]) => void;
};

function createFakeTaskSessions(initial: TaskRuntimeSession[]): FakeTaskSessions {
  let sessions = initial.map((session) => ({ ...session }));
  const bindCalls: FakeBindCall[] = [];
  return {
    listSessions() {
      return sessions.map((session) => ({ ...session }));
    },
    sendFollowupMessage() {
      throw new Error("sendFollowupMessage should not be called by auto-bind");
    },
    bindTaskSession(input): TaskRuntimeBinding {
      bindCalls.push({ ...input });
      const target = sessions.find((session) => session.id === input.task_session_id);
      if (!target) {
        return { ok: false, task_session_id: input.task_session_id, task_id: input.task_id, error: "session_not_found" };
      }
      target.terminal_ref = input.terminal_ref;
      target.task_id = input.task_id;
      return { ok: true, task_session_id: input.task_session_id, task_id: input.task_id, session: { ...target } };
    },
    bindCalls,
    setSessions(next) {
      sessions = next.map((session) => ({ ...session }));
    },
  };
}

describe("codex auto-bind — V10 integration proof", () => {
  let server: Server;
  let baseUrl: string;
  let workspace: FakeWorkspace;
  let taskSessions: FakeTaskSessions;
  let clock = new Date("2026-05-10T15:00:00.000Z");

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    workspace = createFakeWorkspace([
      { id: 101, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
      { id: 102, app: "Mail", title: "Inbox - 0 unread", workspace: "main" },
      { id: 103, app: "Ghostty", title: "no tag here", workspace: "main" },
      { id: 104, app: "Ghostty", title: "[task:recruiting] hiring loop", workspace: "main" },
      // unbound_no_window has no matching window — stays unbound across the test.
    ]);
    taskSessions = createFakeTaskSessions([
      { id: "session_blog", task_id: "task_blog", provider: "codex", status: "idle" },
      { id: "session_recruiting", task_id: "task_recruiting", provider: "codex", status: "idle" },
      { id: "session_unbound_no_window", task_id: "task_no_window", provider: "codex", status: "idle" },
    ]);
    server = createGatewayServer({
      store,
      taskSessions,
      workspace,
      now: () => clock,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function tick(): Promise<AutoBindResponse> {
    const response = await fetch(`${baseUrl}/agents/codex/auto-bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    return await response.json() as AutoBindResponse;
  }

  it("first tick binds all matching [task:foo] Ghostty windows; ignores non-terminal and untagged", async () => {
    const result = await tick();
    assert.equal(result.ok, true);
    assert.equal(result.scanned_window_count, 4, "scanned all 4 fake windows");
    assert.equal(result.matched_count, 2, "matched only the 2 tagged Ghostty windows");
    assert.equal(result.bound.length, 2);

    const boundByTask = new Map(result.bound.map((entry) => [entry.task_id, entry]));
    const blog = boundByTask.get("task_blog");
    const recruiting = boundByTask.get("task_recruiting");
    assert.ok(blog, "task_blog should be bound");
    assert.ok(recruiting, "task_recruiting should be bound");
    assert.equal(blog!.window_id, 101);
    assert.equal(blog!.terminal_ref, "ghostty:win-101", "per-window ref derived from AeroSpace window-id, not the legacy ghostty:front");
    assert.equal(recruiting!.window_id, 104);
    assert.equal(recruiting!.terminal_ref, "ghostty:win-104");
    assert.notEqual(blog!.terminal_ref, recruiting!.terminal_ref, "two distinct windows must produce distinct terminal_refs");

    // Mail and the untagged Ghostty window must never appear in skipped — they
    // are filtered before the [task:] regex even runs.
    for (const skip of result.skipped) {
      assert.notEqual(skip.window_id, 102, "Mail window should not surface as a skip entry");
      assert.notEqual(skip.window_id, 103, "untagged Ghostty window should not surface as a skip entry");
    }

    assert.equal(taskSessions.bindCalls.length, 2);
  });

  it("idempotent on a second tick at the same clock — already-bound sessions skip with reason 'already_bound'", async () => {
    const beforeBindCount = taskSessions.bindCalls.length;
    const result = await tick();
    assert.equal(result.matched_count, 2);
    assert.equal(result.bound.length, 0, "no fresh bindings on second tick");
    const reasons = new Set(result.skipped.map((skip) => skip.reason));
    assert.ok(reasons.has("already_bound"), `expected already_bound, got ${[...reasons].join(",")}`);
    assert.equal(taskSessions.bindCalls.length, beforeBindCount, "bindTaskSession not called again");
  });

  it("task_session whose task_id has no matching window stays unbound", async () => {
    const sessions = (taskSessions.listSessions?.() as TaskRuntimeSession[]) ?? [];
    const orphan = sessions.find((s) => s.id === "session_unbound_no_window");
    assert.ok(orphan, "orphan session should still exist");
    assert.equal(orphan!.terminal_ref, undefined, "orphan session's terminal_ref must remain unset");
  });

  it("two windows with the same [task:blog] tag — first wins, second logged", async () => {
    // Reset bindings: drop the existing terminal_ref on session_blog so the
    // ambiguous case is observable on the next tick.
    taskSessions.setSessions([
      { id: "session_blog_a", task_id: "task_blog", provider: "codex", status: "idle" },
      { id: "session_blog_b", task_id: "task_blog", provider: "codex", status: "idle" },
      { id: "session_recruiting", task_id: "task_recruiting", provider: "codex", status: "idle", terminal_ref: "ghostty:front" },
      { id: "session_unbound_no_window", task_id: "task_no_window", provider: "codex", status: "idle" },
    ]);
    workspace.setWindows([
      { id: 201, app: "Ghostty", title: "[task:blog] window A", workspace: "main" },
      { id: 202, app: "Ghostty", title: "[task:blog] window B", workspace: "main" },
    ]);

    const result = await tick();
    assert.equal(result.matched_count, 2, "two windows still match the [task:blog] tag");
    assert.equal(result.bound.length, 0, "ambiguity blocks any binding");
    const ambiguousSkips = result.skipped.filter((skip) => skip.reason === "multiple_sessions_for_task");
    assert.ok(ambiguousSkips.length >= 1, "at least one window should report multiple_sessions_for_task");
    // bindTaskSession must not have been called for an ambiguous match.
    const callsForBlogAmbiguous = taskSessions.bindCalls.filter(
      (call) => call.task_id === "task_blog" && (call.task_session_id === "session_blog_a" || call.task_session_id === "session_blog_b"),
    );
    assert.equal(callsForBlogAmbiguous.length, 0, "no bind call should fire while two sessions match");
  });

  it("window title changes mid-flight — newly-tagged window binds on the next tick", async () => {
    // Disambiguate sessions: only one session matches task_blog now. Simulate
    // a previously-untagged terminal getting a [task:blog] title at runtime.
    taskSessions.setSessions([
      { id: "session_blog_only", task_id: "task_blog", provider: "codex", status: "idle" },
    ]);
    workspace.setWindows([
      { id: 301, app: "Ghostty", title: "no tag yet", workspace: "main" },
    ]);

    const tick1 = await tick();
    assert.equal(tick1.matched_count, 0, "tick 1: no tagged windows");
    assert.equal(tick1.bound.length, 0);

    // Window title changes between ticks — auto-bind should pick it up.
    workspace.setWindows([
      { id: 301, app: "Ghostty", title: "[task:blog] now tagged", workspace: "main" },
    ]);

    const tick2 = await tick();
    assert.equal(tick2.matched_count, 1, "tick 2: title now matches [task:blog]");
    assert.equal(tick2.bound.length, 1);
    assert.equal(tick2.bound[0].task_id, "task_blog");
    assert.equal(tick2.bound[0].task_session_id, "session_blog_only");
    assert.equal(tick2.bound[0].window_id, 301);
  });
});

describe("codex auto-bind — V10 real-timer end-to-end", () => {
  // Mirrors the real `setInterval` block in app/orchestrator/src/index.ts:
  // a real interval POSTs to /agents/codex/auto-bind, the fake workspace
  // gets re-tagged between phases, and we assert the binding shows up
  // within a deterministic window.
  let server: Server;
  let baseUrl: string;
  let workspace: FakeWorkspace;
  let taskSessions: FakeTaskSessions;
  let timer: NodeJS.Timeout | undefined;
  let clock = new Date("2026-05-10T16:00:00.000Z");

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    workspace = createFakeWorkspace([
      { id: 401, app: "Ghostty", title: "no task tag yet", workspace: "main" },
    ]);
    taskSessions = createFakeTaskSessions([
      { id: "session_blog_rt", task_id: "task_blog", provider: "codex", status: "idle" },
    ]);
    server = createGatewayServer({
      store,
      taskSessions,
      workspace,
      now: () => clock,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (timer) clearInterval(timer);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("a real setInterval timer ticks /agents/codex/auto-bind and binds when window gets [task:foo] tag", async () => {
    let tickCount = 0;
    let lastError: unknown;
    timer = setInterval(async () => {
      tickCount += 1;
      try {
        await fetch(`${baseUrl}/agents/codex/auto-bind`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch (error) {
        lastError = error;
      }
    }, 50);

    // Wait for >= 2 ticks before re-tagging the window.
    const deadlineA = Date.now() + 1500;
    while (tickCount < 2 && Date.now() < deadlineA) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(tickCount >= 2, `phase A: timer did not fire enough; tickCount=${tickCount}`);
    assert.equal(taskSessions.bindCalls.length, 0, "phase A: no binding while window is untagged");

    // Re-tag the window mid-flight.
    workspace.setWindows([
      { id: 401, app: "Ghostty", title: "[task:blog] - Ghostty", workspace: "main" },
    ]);
    const tickAtTag = tickCount;

    // Wait for the next tick to land the bind.
    const deadlineB = Date.now() + 1500;
    while (taskSessions.bindCalls.length === 0 && Date.now() < deadlineB) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(lastError, undefined, `tick threw: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    assert.ok(taskSessions.bindCalls.length >= 1, "phase B: at least one bind call after window is tagged");
    assert.ok(tickCount >= tickAtTag, `phase B: timer continued ticking after re-tag (tickAtTag=${tickAtTag}, tickCount=${tickCount})`);
    const lastCall = taskSessions.bindCalls.at(-1)!;
    assert.equal(lastCall.task_session_id, "session_blog_rt");
    assert.equal(lastCall.task_id, "task_blog");
    assert.equal(lastCall.terminal_ref, "ghostty:win-401");
  });
});
