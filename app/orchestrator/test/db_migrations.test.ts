import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadMigrations } from "../src/db/migrations.js";

describe("Postgres migrations", () => {
  it("include deterministic queue, event idempotency, decisions, and receipts schema", async () => {
    const migrations = await loadMigrations();
    const sql = migrations.map((migration) => migration.sql).join("\n");

    assert.deepEqual(migrations.map((migration) => migration.id), ["0001_core_queue.sql"]);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS events/);
    assert.match(sql, /UNIQUE \(source, idempotency_key\)/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS review_packets/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS queue_items/);
    assert.match(sql, /CHECK \(state IN \('ready', 'leased', 'deferred', 'done', 'dead'\)\)/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS route_decisions/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS receipts/);
    assert.match(sql, /queue_items_ready_rank_idx/);
    assert.match(sql, /queue_items_stale_lease_idx/);
  });
});
