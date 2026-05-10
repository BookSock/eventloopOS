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

// B7 — proves the orchestrator-side manual-mode pause:
//   - POST /modes/manual { active: true } pauses auto-promote, auto-bind, and lease-next.
//   - GET  /modes/manual returns current state.
//   - Auto-promote and auto-bind ticks during pause are no-ops (no new promotions / no new bindings).
//   - lease-next during pause returns 409 with code manual_mode_active and the entered_at timestamp.
//   - Deactivating resumes normal flow.

type AutoPromoteBody = {
  ok: boolean;
  paused?: boolean;
  reason?: string;
  evaluated_count: number;
  aged_count: number;
  promoted_count: number;
  promoted: Array<{ context_id: string; queue_item_id?: string; idempotent: boolean }>;
};

type AutoBindBody = {
  ok: boolean;
  paused?: boolean;
  reason?: string;
  scanned_window_count: number;
  matched_count: number;
  bound: Array<{ task_id: string; task_session_id: string; window_id: number }>;
};

type ModeBody = {
  ok?: boolean;
  manual_mode: { active: boolean; entered_at?: string; reason?: string; updated_at: string };
  transitioned?: boolean;
};

type QueueListBody = {
  items: Array<{ id: string; task_id?: string }>;
};

type FakeWorkspace = WorkspaceController & {
  setWindows: (windows: AerospaceWindow[]) => void;
};

function createFakeWorkspace(initial: AerospaceWindow[]): FakeWorkspace {
  let windows = [...initial];
  return {
    status() {
      return { available: true, backend: "aerospace" } as const;
    },
    capture(): WorkspaceSnapshot {
      return {
        backend: "aerospace",
        windows: windows.map((window) => ({ ...window })),
      };
    },
    planRestore() {
      throw new Error("planRestore should not be called");
    },
    setWindows(next: AerospaceWindow[]) {
      windows = [...next];
    },
  };
}

type FakeBindCall = { task_session_id: string; task_id: string; terminal_ref?: string };

type FakeTaskSessions = TaskSessionController & {
  bindCalls: FakeBindCall[];
};

function createFakeTaskSessions(initial: TaskRuntimeSession[]): FakeTaskSessions {
  let sessions = initial.map((session) => ({ ...session }));
  const bindCalls: FakeBindCall[] = [];
  return {
    listSessions() {
      return sessions.map((session) => ({ ...session }));
    },
    sendFollowupMessage() {
      throw new Error("sendFollowupMessage should not be called");
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
  };
}

async function seedCapturedTab(
  store: ReturnType<typeof createInMemoryGatewayStore>,
  options: { id: string; capturedAt: string; title: string; url: string },
): Promise<void> {
  const eventId = `evt_capture_${options.id.replace(/[^a-z0-9]+/gi, "_")}`;
  const idemKey = `browser:${options.id}`;
  await store.recordEventRoute(
    {
      id: eventId,
      source: "browser",
      source_id: idemKey,
      idempotency_key: idemKey,
      occurred_at: options.capturedAt,
      received_at: options.capturedAt,
      actor: { id: "chrome_extension", type: "system" },
      type: "browser.context_captured",
      title: options.title,
      summary: "Captured browser tab.",
      raw_ref: { id: `raw_${eventId}`, uri: `browser://tabs/${options.id}`, media_type: "application/json" },
      links: [],
      resources: [{
        id: options.id,
        kind: "browser_tab",
        title: options.title,
        url: options.url,
        source: "chrome-extension",
        captured_at: options.capturedAt,
        restore_confidence: "high",
      }],
    },
    {
      id: `rte_${eventId}`,
      event_id: eventId,
      action: "store_only",
      confidence: "medium",
      evidence: [],
      created_at: options.capturedAt,
    },
    new Date(options.capturedAt),
  );
}

describe("manual mode pause — B7 integration proof", () => {
  let server: Server;
  let baseUrl: string;
  let store: ReturnType<typeof createInMemoryGatewayStore>;
  let workspace: FakeWorkspace;
  let taskSessions: FakeTaskSessions;
  let clock = new Date("2026-05-10T14:00:00.000Z");

  before(async () => {
    store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    workspace = createFakeWorkspace([
      { id: 501, app: "Ghostty", title: "no tag", workspace: "main" },
    ]);
    taskSessions = createFakeTaskSessions([
      { id: "session_b7", task_id: "task_b7", provider: "codex", status: "idle" },
      { id: "session_b7_extra", task_id: "task_b7_extra", provider: "codex", status: "idle" },
    ]);
    server = createGatewayServer({
      store,
      workspace,
      taskSessions,
      now: () => clock,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Seed two browser tabs that will exceed the 600s threshold immediately.
    await seedCapturedTab(store, {
      id: "browser_tab:b7_aged_a",
      capturedAt: "2026-05-10T13:30:00.000Z", // 30m old at clock=14:00
      title: "B7 aged tab A",
      url: "https://example.test/b7-a",
    });
    await seedCapturedTab(store, {
      id: "browser_tab:b7_aged_b",
      capturedAt: "2026-05-10T13:30:00.000Z",
      title: "B7 aged tab B",
      url: "https://example.test/b7-b",
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function autoPromote(): Promise<AutoPromoteBody> {
    const response = await fetch(`${baseUrl}/reading-queue/auto-promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ min_age_seconds: 600, actor_id: "b7_test" }),
    });
    assert.equal(response.status, 200);
    return await response.json() as AutoPromoteBody;
  }

  async function autoBind(): Promise<AutoBindBody> {
    const response = await fetch(`${baseUrl}/agents/codex/auto-bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    return await response.json() as AutoBindBody;
  }

  async function setManualMode(active: boolean, reason?: string): Promise<ModeBody> {
    const response = await fetch(`${baseUrl}/modes/manual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active, reason }),
    });
    assert.equal(response.status, 200);
    return await response.json() as ModeBody;
  }

  async function getMode(): Promise<ModeBody> {
    const response = await fetch(`${baseUrl}/modes/manual`);
    assert.equal(response.status, 200);
    return await response.json() as ModeBody;
  }

  async function leaseNext(): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}/queue/lease-next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lease_owner: "b7_worker", lease_ms: 60_000 }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it("default state is not-active and tick before pause promotes aged tabs and binds tagged windows", async () => {
    const initial = await getMode();
    assert.equal(initial.manual_mode.active, false);
    assert.equal(initial.manual_mode.entered_at, undefined);

    // Tag a window so auto-bind has work to do before pausing.
    workspace.setWindows([
      { id: 501, app: "Ghostty", title: "[task:b7] codex", workspace: "main" },
    ]);

    const promote1 = await autoPromote();
    assert.equal(promote1.paused, undefined);
    assert.equal(promote1.aged_count, 2);
    assert.equal(promote1.promoted_count, 2, "first tick promotes both aged tabs");

    const bind1 = await autoBind();
    assert.equal(bind1.paused, undefined);
    assert.equal(bind1.matched_count, 1);
    assert.equal(bind1.bound.length, 1);
    assert.equal(taskSessions.bindCalls.length, 1);
  });

  it("activating manual mode pauses auto-promote and auto-bind on subsequent ticks", async () => {
    const activated = await setManualMode(true, "personal email triage");
    assert.equal(activated.manual_mode.active, true);
    assert.equal(activated.manual_mode.reason, "personal email triage");
    assert.equal(activated.transitioned, true);
    const enteredAt = activated.manual_mode.entered_at;
    assert.ok(enteredAt, "entered_at should be set");

    // Seed a fresh aged tab past the threshold; without pause it would promote.
    await seedCapturedTab(store, {
      id: "browser_tab:b7_during_pause",
      capturedAt: "2026-05-10T13:00:00.000Z",
      title: "Tab seeded mid-pause",
      url: "https://example.test/b7-during-pause",
    });
    // Re-tag a window to give auto-bind a fresh, unbound match too.
    workspace.setWindows([
      { id: 502, app: "Ghostty", title: "[task:b7_extra] codex", workspace: "main" },
    ]);
    const bindCallsBeforePause = taskSessions.bindCalls.length;

    const promotePaused = await autoPromote();
    assert.equal(promotePaused.paused, true, "auto-promote tick should report paused");
    assert.equal(promotePaused.reason, "manual_mode_active");
    assert.equal(promotePaused.promoted_count, 0);
    assert.deepEqual(promotePaused.promoted, []);

    const bindPaused = await autoBind();
    assert.equal(bindPaused.paused, true, "auto-bind tick should report paused");
    assert.equal(bindPaused.reason, "manual_mode_active");
    assert.equal(bindPaused.scanned_window_count, 0);
    assert.equal(bindPaused.matched_count, 0);
    assert.deepEqual(bindPaused.bound, []);
    assert.equal(taskSessions.bindCalls.length, bindCallsBeforePause, "no new bindTaskSession calls during pause");

    const queue = await (await fetch(`${baseUrl}/queue`)).json() as QueueListBody;
    const readingPapers = queue.items.filter((item) => item.task_id === "task_reading_queue");
    assert.equal(readingPapers.length, 2, "no new reading-queue papers during pause");
  });

  it("lease-next during pause returns 409 manual_mode_active with entered_at", async () => {
    const stateBefore = await getMode();
    assert.equal(stateBefore.manual_mode.active, true);
    const enteredAt = stateBefore.manual_mode.entered_at;

    const result = await leaseNext();
    assert.equal(result.status, 409);
    const errorBody = result.body.error as { code?: string; details?: { manual_mode?: { entered_at?: string } } };
    assert.equal(errorBody?.code, "manual_mode_active");
    assert.equal(errorBody?.details?.manual_mode?.entered_at, enteredAt);
  });

  it("re-activating preserves entered_at (idempotent enter)", async () => {
    clock = new Date("2026-05-10T14:05:00.000Z");
    const before = await getMode();
    const reactivated = await setManualMode(true, "still in personal mode");
    assert.equal(reactivated.manual_mode.active, true);
    assert.equal(reactivated.manual_mode.entered_at, before.manual_mode.entered_at, "entered_at pinned to first activation");
    assert.equal(reactivated.transitioned, false, "no state transition when already active");
  });

  it("deactivating manual mode resumes auto-promote, auto-bind, and lease-next", async () => {
    clock = new Date("2026-05-10T14:10:00.000Z");

    const deactivated = await setManualMode(false);
    assert.equal(deactivated.manual_mode.active, false);
    assert.equal(deactivated.manual_mode.entered_at, undefined);
    assert.equal(deactivated.transitioned, true);

    const promoteAfter = await autoPromote();
    assert.equal(promoteAfter.paused, undefined);
    // The mid-pause-seeded tab is now aged enough and should promote.
    const promotedIds = promoteAfter.promoted.filter((p) => !p.idempotent).map((p) => p.context_id);
    assert.ok(promotedIds.includes("browser_tab:b7_during_pause"), "previously-blocked tab should promote after resume");

    const bindAfter = await autoBind();
    assert.equal(bindAfter.paused, undefined);
    assert.equal(bindAfter.matched_count, 1);
    assert.equal(bindAfter.bound.length, 1, "the [task:b7_extra] window binds after resume");
    assert.equal(bindAfter.bound[0].task_id, "task_b7_extra");

    const leaseResult = await leaseNext();
    assert.equal(leaseResult.status, 200, "lease-next succeeds after manual mode is deactivated");
  });
});
