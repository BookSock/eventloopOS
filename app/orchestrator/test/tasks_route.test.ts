import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import type { WorkspaceSnapshot } from "../src/contracts.js";
import type { TaskRuntimeBinding, TaskRuntimeSession, TaskSessionController } from "../src/task_sessions/types.js";

const fixedNow = new Date("2026-05-10T12:00:00.000Z");

const layoutA: WorkspaceSnapshot = {
  backend: "aerospace",
  activeWorkspace: "eventloop-blog",
  focusedWindowId: 11,
  windows: [{ id: 11, app: "Ghostty", title: "codex blog", workspace: "eventloop-blog" }],
};

const layoutB: WorkspaceSnapshot = {
  backend: "aerospace",
  activeWorkspace: "eventloop-reports",
  focusedWindowId: 22,
  windows: [{ id: 22, app: "Ghostty", title: "codex reports", workspace: "eventloop-reports" }],
};

const layoutFake: WorkspaceSnapshot = {
  backend: "fake",
  activeWorkspace: "fake-main",
  focusedWindowId: 33,
  windows: [{ id: 33, app: "FakeApp", title: "fake docs", workspace: "fake-main" }],
};

describe("tasks route — phase 2 of hotkey state machine", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({ store, now: () => fixedNow });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("creates a task and reports current=false until /tasks/current is set", async () => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-route-1" },
        captured_layout: layoutA,
        auto_paper_idle_seconds: 45,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      task: { task_id: string; primary_anchor_id: string; auto_paper_idle_seconds: number };
      created: boolean;
      current: boolean;
    };
    assert.equal(body.task.primary_anchor_id, "thread-route-1");
    assert.equal(body.task.auto_paper_idle_seconds, 45);
    assert.equal(body.created, true);
    assert.equal(body.current, false);
  });

  it("binds a matching Codex task session with terminal_ref synchronously when creating a task", async () => {
    const bindCalls: Array<{ task_session_id: string; task_id: string; terminal_ref?: string }> = [];
    const taskSessions: TaskSessionController = {
      listSessions(): TaskRuntimeSession[] {
        return [{
          id: "codex_thread_route_sync",
          provider: "codex",
          native_thread_id: "thread-route-sync-bind",
          status: "idle",
        }];
      },
      sendFollowupMessage() {
        throw new Error("not used");
      },
      bindTaskSession(input): TaskRuntimeBinding {
        bindCalls.push(input);
        return {
          ok: true,
          task_session_id: input.task_session_id,
          task_id: input.task_id,
          session: {
            id: input.task_session_id,
            provider: "codex",
            native_thread_id: "thread-route-sync-bind",
            task_id: input.task_id,
          },
        };
      },
    };
    const syncStore = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const syncServer = createGatewayServer({ store: syncStore, taskSessions, now: () => fixedNow });
    await new Promise<void>((resolve) => syncServer.listen(0, "127.0.0.1", resolve));
    const address = syncServer.address() as AddressInfo;
    const syncBaseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${syncBaseUrl}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primary_anchor: { kind: "codex_thread", id: "thread-route-sync-bind" },
          captured_layout: layoutA,
          terminal_ref: "ghostty:win-route-sync",
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        task: { task_id: string };
        binding?: { ok?: boolean; task_session_id?: string };
      };
      assert.equal(bindCalls.length, 1);
      assert.equal(bindCalls[0]?.task_session_id, "codex_thread_route_sync");
      assert.equal(bindCalls[0]?.task_id, body.task.task_id);
      assert.equal(bindCalls[0]?.terminal_ref, "ghostty:win-route-sync");
      assert.equal(body.binding?.ok, true);
      assert.equal(body.binding?.task_session_id, "codex_thread_route_sync");
    } finally {
      await new Promise<void>((resolve, reject) => {
        syncServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("re-POSTing the same anchor returns the same task with created=false", async () => {
    const replay = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-route-1" },
        captured_layout: layoutB,
      }),
    });
    assert.equal(replay.status, 200);
    const body = await replay.json() as { task: { task_id: string }; created: boolean };
    assert.equal(body.created, false);

    const list = await fetch(`${baseUrl}/tasks`).then((r) => r.json()) as { tasks: Array<{ task_id: string }> };
    const matching = list.tasks.filter((task) => task.task_id === body.task.task_id);
    assert.equal(matching.length, 1, "duplicate anchor must not create a second task");
  });

  it("PUT /tasks/:id/layout updates the stored layout", async () => {
    const created = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "ghostty_window", id: "win-route-2" },
        captured_layout: layoutA,
      }),
    }).then((r) => r.json()) as { task: { task_id: string } };

    const updated = await fetch(`${baseUrl}/tasks/${created.task.task_id}/layout`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layoutFake),
    });
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json() as { ok: boolean; layout: { layout: WorkspaceSnapshot } };
    assert.equal(updatedBody.ok, true);
    assert.equal(updatedBody.layout.layout.backend, "fake");
    assert.equal(updatedBody.layout.layout.activeWorkspace, "fake-main");

    const fetched = await fetch(`${baseUrl}/tasks/${created.task.task_id}`).then((r) => r.json()) as {
      layout: { layout: WorkspaceSnapshot } | null;
    };
    assert.equal(fetched.layout?.layout.backend, "fake");
    assert.equal(fetched.layout?.layout.activeWorkspace, "fake-main");

    const fetchedLayout = await fetch(`${baseUrl}/tasks/${created.task.task_id}/layout`).then((r) => r.json()) as {
      task_id: string;
      layout: { layout: WorkspaceSnapshot } | null;
    };
    assert.equal(fetchedLayout.task_id, created.task.task_id);
    assert.equal(fetchedLayout.layout?.layout.backend, "fake");
  });

  it("POST /tasks/current sets the singleton, GET reflects it, null clears it", async () => {
    const created = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-route-current" },
        captured_layout: layoutA,
      }),
    }).then((r) => r.json()) as { task: { task_id: string } };

    const setResponse = await fetch(`${baseUrl}/tasks/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: created.task.task_id }),
    });
    assert.equal(setResponse.status, 200);
    const setBody = await setResponse.json() as { ok: boolean; task: { task_id: string } | null };
    assert.equal(setBody.ok, true);
    assert.equal(setBody.task?.task_id, created.task.task_id);

    const getBody = await fetch(`${baseUrl}/tasks/current`).then((r) => r.json()) as {
      task: { task_id: string } | null;
      entered_at?: string;
    };
    assert.equal(getBody.task?.task_id, created.task.task_id);
    assert.ok(getBody.entered_at);

    const cleared = await fetch(`${baseUrl}/tasks/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: null }),
    });
    assert.equal(cleared.status, 200);
    const clearedGet = await fetch(`${baseUrl}/tasks/current`).then((r) => r.json()) as {
      task: { task_id: string } | null;
    };
    assert.equal(clearedGet.task, null);
  });

  it("rejects unknown task_id on POST /tasks/current", async () => {
    const response = await fetch(`${baseUrl}/tasks/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task_does_not_exist" }),
    });
    assert.equal(response.status, 404);
  });

  it("POST /tasks accepts aerospace_workspace_id and GET /tasks?aerospace_workspace_id=X filters", async () => {
    const created = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-route-ws-1" },
        captured_layout: layoutA,
        aerospace_workspace_id: "ws-route-alpha",
      }),
    });
    assert.equal(created.status, 200);
    const createdBody = await created.json() as {
      task: { task_id: string; aerospace_workspace_id?: string };
      created: boolean;
    };
    assert.equal(createdBody.task.aerospace_workspace_id, "ws-route-alpha");

    const filtered = await fetch(`${baseUrl}/tasks?aerospace_workspace_id=ws-route-alpha`).then((r) => r.json()) as {
      tasks: Array<{ task_id: string; aerospace_workspace_id?: string }>;
    };
    assert.equal(filtered.tasks.length, 1);
    assert.equal(filtered.tasks[0]?.task_id, createdBody.task.task_id);
    assert.equal(filtered.tasks[0]?.aerospace_workspace_id, "ws-route-alpha");

    const empty = await fetch(`${baseUrl}/tasks?aerospace_workspace_id=ws-route-nobody`).then((r) => r.json()) as {
      tasks: Array<unknown>;
    };
    assert.deepEqual(empty.tasks, []);

    const moved = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-route-ws-1" },
        captured_layout: layoutA,
        aerospace_workspace_id: "ws-route-beta",
      }),
    }).then((r) => r.json()) as { task: { task_id: string; aerospace_workspace_id?: string }; created: boolean };
    assert.equal(moved.created, false);
    assert.equal(moved.task.task_id, createdBody.task.task_id);
    assert.equal(moved.task.aerospace_workspace_id, "ws-route-beta", "newer workspace_id wins");

    const all = await fetch(`${baseUrl}/tasks`).then((r) => r.json()) as { tasks: Array<{ task_id: string }> };
    const matching = all.tasks.filter((task) => task.task_id === createdBody.task.task_id);
    assert.equal(matching.length, 1, "unfiltered list still returns the task once");
  });

  it("rejects malformed bodies with schema_error", async () => {
    const missingAnchor = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captured_layout: layoutA }),
    });
    assert.equal(missingAnchor.status, 400);

    const badKind = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "what", id: "x" },
        captured_layout: layoutA,
      }),
    });
    assert.equal(badKind.status, 400);
  });
});

describe("tasks route — full-flow integration proof", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({ store, now: () => fixedNow });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("create A → set current → create B → set current B → list → clear current", async () => {
    const a = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "codex_thread", id: "thread-flow-a" },
        captured_layout: layoutA,
      }),
    }).then((r) => r.json()) as { task: { task_id: string } };

    await fetch(`${baseUrl}/tasks/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: a.task.task_id }),
    });

    const b = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primary_anchor: { kind: "ghostty_window", id: "win-flow-b" },
        captured_layout: layoutB,
      }),
    }).then((r) => r.json()) as { task: { task_id: string }; current: boolean };
    assert.equal(b.current, false, "creating B does not auto-promote it to current");

    await fetch(`${baseUrl}/tasks/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: b.task.task_id }),
    });

    const list = await fetch(`${baseUrl}/tasks`).then((r) => r.json()) as { tasks: Array<{ task_id: string }> };
    const ids = list.tasks.map((task) => task.task_id);
    assert.ok(ids.includes(a.task.task_id));
    assert.ok(ids.includes(b.task.task_id));

    const current = await fetch(`${baseUrl}/tasks/current`).then((r) => r.json()) as { task: { task_id: string } | null };
    assert.equal(current.task?.task_id, b.task.task_id);

    await fetch(`${baseUrl}/tasks/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: null }),
    });
    const finalCurrent = await fetch(`${baseUrl}/tasks/current`).then((r) => r.json()) as { task: { task_id: string } | null };
    assert.equal(finalCurrent.task, null);
  });
});
