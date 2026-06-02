import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createInMemoryGatewayStore } from "./gateway_store.js";
import {
  loadOrCreatePersistentInMemoryStore,
  withStorePersistence,
} from "./persistent_in_memory_gateway_store.js";
import type { InMemoryStore } from "./store.js";

describe("persistent in-memory gateway store", () => {
  it("persists mutations to a JSON file and reloads them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eventloopos-persistent-store-"));
    const statePath = join(dir, "gateway-store.json");
    try {
      const baseStore = emptyStore();
      const gateway = withStorePersistence(createInMemoryGatewayStore(baseStore), baseStore, statePath);

      await gateway.createTask({
        taskId: "task_persisted",
        primaryAnchor: { kind: "codex_thread", id: "thread_1" },
        capturedLayout: { backend: "aerospace", windows: [] },
        now: new Date("2026-06-01T17:00:00Z"),
      });
      await gateway.setCurrentTaskId("task_persisted", new Date("2026-06-01T17:00:01Z"));

      const reloadedStore = await loadOrCreatePersistentInMemoryStore(statePath, async () => emptyStore());
      const reloadedGateway = createInMemoryGatewayStore(reloadedStore);

      assert.equal((await reloadedGateway.getTask("task_persisted"))?.task_id, "task_persisted");
      assert.equal((await reloadedGateway.getCurrentTaskState()).current_task_id, "task_persisted");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function emptyStore(): InMemoryStore {
  return {
    queue: [],
    reviewPackets: new Map(),
    eventsByIdempotencyKey: new Map(),
    eventsById: new Map(),
    contextRestoreRequests: new Map(),
    contextRestoreRequestIdsByIdempotencyKey: new Map(),
  };
}
