import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryOwnershipLockStore } from "./lock-store.js";

describe("InMemoryOwnershipLockStore", () => {
  it("detects active ownership conflict for same resource and lock kind", () => {
    const store = new InMemoryOwnershipLockStore({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      idFactory: () => "own_slack_thread",
    });

    const acquired = store.acquire({
      resource_key: "slack:thread:C123:1746550000.000100",
      owner_task_id: "task_blog",
      lock_kind: "send",
      lease_expires_at: "2026-05-06T12:10:00.000Z",
    });

    assert.equal(acquired.status, "acquired");

    const competing = store.acquire({
      resource_key: "slack:thread:C123:1746550000.000100",
      owner_task_id: "task_duplicate",
      lock_kind: "send",
      lease_expires_at: "2026-05-06T12:10:00.000Z",
    });

    assert.equal(competing.status, "conflict");
    assert.equal(competing.conflict.active_lock.owner_task_id, "task_blog");
    assert.equal(competing.conflict.requested_owner_task_id, "task_duplicate");
  });

  it("allows acquisition after lease expiry", () => {
    const store = new InMemoryOwnershipLockStore({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
    });

    store.acquire({
      resource_key: "slack:thread:C123:1746550000.000100",
      owner_task_id: "task_blog",
      lock_kind: "send",
      lease_expires_at: "2026-05-06T11:59:59.000Z",
    });

    const acquired = store.acquire({
      resource_key: "slack:thread:C123:1746550000.000100",
      owner_task_id: "task_new",
      lock_kind: "send",
      lease_expires_at: "2026-05-06T12:10:00.000Z",
    });

    assert.equal(acquired.status, "acquired");
    assert.equal(acquired.lock.owner_task_id, "task_new");
  });
});
