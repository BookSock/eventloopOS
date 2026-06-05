import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createAmbientWorkspaceSaver,
  createAmbientWorkspaceSaverFromRuntime,
  type CurrentTaskState,
} from "../src/agents/ambient_workspace_saver.js";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createInMemoryObservability } from "../src/observability.js";
import { createRuntime } from "../src/runtime.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import type { WorkspaceController } from "../src/workspace/controller.js";
import type { AerospaceWindow, WorkspaceSnapshot } from "../src/workspace/aerospace.js";

// Phase 4 — proves the ambient workspace saver wires into the gateway runtime
// and persists a layout snapshot keyed by current_task_id.
//
// The saver now wires through GatewayStore directly: current task state,
// updateTaskLayout, task workspace snapshots, task window claims, and follows
// observations all stay on the same store contract used by HTTP routes.

type FakeWorkspace = WorkspaceController & {
  setSnapshot: (snapshot: WorkspaceSnapshot) => void;
  setWindows: (windows: AerospaceWindow[]) => void;
};

function makeFakeWorkspace(initial: WorkspaceSnapshot): FakeWorkspace {
  let snapshot: WorkspaceSnapshot = JSON.parse(JSON.stringify(initial));
  return {
    status() {
      return { available: true, backend: "aerospace" } as const;
    },
    capture() {
      return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot;
    },
    planRestore() {
      throw new Error("planRestore not used in this test");
    },
    setSnapshot(next) {
      snapshot = JSON.parse(JSON.stringify(next));
    },
    setWindows(windows) {
      snapshot = { ...snapshot, windows: windows.map((window) => ({ ...window })) };
    },
  };
}

describe("ambient_workspace_saver — integration", () => {
  let server: Server;
  let baseUrl: string;
  let store: ReturnType<typeof createInMemoryGatewayStore>;
  let workspace: FakeWorkspace;
  let nowMs = Date.parse("2026-05-10T15:00:00.000Z");

  before(async () => {
    store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    workspace = makeFakeWorkspace({
      backend: "aerospace",
      windows: [
        { id: 401, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
        { id: 402, app: "Google Chrome", title: "Notion — design", workspace: "main" },
      ],
      activeWorkspace: "main",
      focusedWindowId: 401,
    });
    server = createGatewayServer({
      store,
      workspace,
      observability: createInMemoryObservability(),
      now: () => new Date(nowMs),
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

  it("boots gateway, simulates an AeroSpace change, and persists the latest layout for current_task_id", async () => {
    // Sanity: gateway answers basic queue listing with an empty queue.
    const queueResp = await fetch(`${baseUrl}/queue`);
    assert.equal(queueResp.status, 200);

    const observability = createInMemoryObservability();
    let currentTaskId: string | null = null;
    let manualMode = false;

    const saver = createAmbientWorkspaceSaver({
      workspace,
      // Drive the current task directly here so this integration test can focus
      // on debounce/write behavior without going through the task routes.
      getCurrentTaskState: async (): Promise<CurrentTaskState> => ({ currentTaskId }),
      // Mirror runtime adapter semantics by calling the store primitive that
      // persists per-task layouts.
      updateTaskLayout: async (taskId, snapshot) => {
        await store.saveTaskWorkspaceSnapshot({
          taskId,
          snapshot,
          capturedAt: new Date(nowMs),
          actorId: "ambient-workspace-saver",
        });
      },
      isManualModeActive: async () => manualMode,
      observability,
      pollIntervalMs: 5_000,
      debounceMs: 3_000,
      now: () => new Date(nowMs),
    });

    // Phase A: unbounded — no current_task_id.
    let result = await saver.tick();
    assert.equal(result.decision, "skipped_unbounded");
    assert.equal(await store.getLatestTaskWorkspaceSnapshot("task_blog"), undefined);

    // Phase B: a task is now current. First tick observes a change → debounced.
    currentTaskId = "task_blog";
    result = await saver.tick();
    assert.equal(result.decision, "debounced");
    assert.equal(await store.getLatestTaskWorkspaceSnapshot("task_blog"), undefined, "no commit before debounce elapses");

    // Phase C: advance the fake clock past debounce — commit lands.
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "committed");
    const stored = await store.getLatestTaskWorkspaceSnapshot("task_blog");
    assert.ok(stored, "expected a stored snapshot for task_blog after commit");
    assert.equal(stored!.snapshot.windows.length, 2);
    assert.equal(stored!.snapshot.focusedWindowId, 401);

    // Phase D: simulate an AeroSpace change (Chrome window closed, Ghostty
    // moved workspace). First tick after change → debounced.
    workspace.setSnapshot({
      backend: "aerospace",
      windows: [{ id: 401, app: "Ghostty", title: "[task:blog] codex", workspace: "alt" }],
      activeWorkspace: "alt",
      focusedWindowId: 401,
    });
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "debounced");

    // Phase E: advance past debounce — second commit reflects the new layout.
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "committed");
    const updated = await store.getLatestTaskWorkspaceSnapshot("task_blog");
    assert.ok(updated);
    assert.equal(updated!.snapshot.windows.length, 1, "window count drops to 1 after Chrome close");
    assert.equal(updated!.snapshot.activeWorkspace, "alt");

    // Phase F: no further changes → next tick is a no-op skipped_unchanged.
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "skipped_unchanged");

    // Phase G: manual mode active → saver skips even with a fresh change.
    manualMode = true;
    workspace.setSnapshot({
      backend: "aerospace",
      windows: [
        { id: 401, app: "Ghostty", title: "[task:blog] codex", workspace: "main" },
        { id: 999, app: "Slack", title: "Personal DM", workspace: "main" },
      ],
      activeWorkspace: "main",
      focusedWindowId: 999,
    });
    nowMs += 5_000;
    result = await saver.tick();
    assert.equal(result.decision, "skipped_manual_mode");
    const stillUpdated = await store.getLatestTaskWorkspaceSnapshot("task_blog");
    assert.equal(stillUpdated!.snapshot.windows.length, 1, "manual mode must not write the personal-desktop snapshot");

    // Observability surface: every decision must emit an event.
    const recorded = await observability.listActivity({ limit: 100 });
    const types = recorded.map((event) => event.type);
    assert.ok(types.includes("ambient_workspace_save_skipped_unbounded"), "missing skipped_unbounded event");
    assert.ok(types.includes("ambient_workspace_save_skipped_unchanged"), "missing skipped_unchanged event");
    assert.ok(types.includes("ambient_workspace_save_skipped_manual_mode"), "missing skipped_manual_mode event");
    assert.ok(types.includes("ambient_workspace_save_committed"), "missing committed event");
  });

  it("createAmbientWorkspaceSaverFromRuntime returns a no-op saver when workspace is missing", () => {
    const observability = createInMemoryObservability();
    const runtime = createRuntime({
      store,
      observability,
    });
    const saver = createAmbientWorkspaceSaverFromRuntime(runtime);
    assert.equal(saver, undefined, "no workspace → no saver");
  });

  it("createAmbientWorkspaceSaverFromRuntime skips unbounded when current task is unset", async () => {
    const observability = createInMemoryObservability();
    const runtime = createRuntime({
      store,
      workspace,
      observability,
    });
    const saver = createAmbientWorkspaceSaverFromRuntime(runtime, { pollIntervalMs: 100, debounceMs: 50 });
    assert.ok(saver, "saver should construct when workspace is present");
    const result = await saver!.tick();
    assert.equal(result.decision, "skipped_unbounded");
  });
});
