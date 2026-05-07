import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadMigrations } from "../src/db/migrations.js";

describe("Postgres migrations", () => {
  it("include deterministic queue, event idempotency, decisions, and receipts schema", async () => {
    const migrations = await loadMigrations();
    const sql = migrations.map((migration) => migration.sql).join("\n");

    assert.deepEqual(migrations.map((migration) => migration.id), [
      "0001_core_queue.sql",
      "0002_context_restore_requests.sql",
      "0003_observability.sql",
      "0004_context_restore_failures.sql",
      "0005_mcp_poll_states.sql",
      "0006_task_messages.sql",
    ]);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS events/);
    assert.match(sql, /UNIQUE \(source, idempotency_key\)/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS review_packets/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS queue_items/);
    assert.match(sql, /CHECK \(state IN \('ready', 'leased', 'deferred', 'done', 'dead'\)\)/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS route_decisions/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS receipts/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS context_restore_requests/);
    assert.match(sql, /CHECK \(status IN \('pending', 'leased', 'done'\)\)/);
    assert.match(sql, /CHECK \(status IN \('pending', 'leased', 'done', 'failed'\)\)/);
    assert.match(sql, /context_restore_requests_pending_idx/);
    assert.match(sql, /context_restore_requests_stale_lease_idx/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS metric_counters/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS activity_events/);
    assert.match(sql, /activity_events_occurred_at_idx/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS mcp_poll_states/);
    assert.match(sql, /mcp_poll_states_updated_at_idx/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS task_messages/);
    assert.match(sql, /idempotency_key text NOT NULL UNIQUE/);
    assert.match(sql, /CHECK \(status IN \('attempted', 'sent', 'blocked', 'failed'\)\)/);
    assert.match(sql, /task_messages_task_session_id_idx/);
    assert.match(sql, /queue_items_ready_rank_idx/);
    assert.match(sql, /queue_items_stale_lease_idx/);
  });
});
