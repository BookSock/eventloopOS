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
      "0007_agent_runs.sql",
      "0008_task_workspace_snapshots.sql",
      "0009_queue_action_attempts.sql",
      "0010_task_session_terminal_refs.sql",
      "0011_onboarding_rejections.sql",
      "0012_manual_mode_state.sql",
      "0013_tasks.sql",
      "0014_tasks_aerospace_workspace.sql",
      "0015_window_workspace_observations.sql",
      "0016_paper_triggers.sql",
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
    assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_runs/);
    assert.match(sql, /agent_runs_task_status_idx/);
    assert.match(sql, /CREATE TABLE task_workspace_snapshots/);
    assert.match(sql, /task_id text PRIMARY KEY/);
    assert.match(sql, /snapshot jsonb NOT NULL/);
    assert.match(sql, /queue_items_ready_rank_idx/);
    assert.match(sql, /queue_items_stale_lease_idx/);
    assert.match(sql, /CREATE TABLE queue_action_attempts/);
    assert.match(sql, /idempotency_key text PRIMARY KEY/);
    assert.match(sql, /queue_action_attempts_queue_item_id_idx/);
    assert.match(sql, /CREATE TABLE task_session_terminal_refs/);
    assert.match(sql, /task_session_id text PRIMARY KEY/);
    assert.match(sql, /terminal_ref text NOT NULL/);
    assert.match(sql, /CREATE TABLE onboarding_rejections/);
    assert.match(sql, /proposal_key text PRIMARY KEY/);
    assert.match(sql, /CREATE TABLE onboarding_approval_batches/);
    assert.match(sql, /CREATE TABLE tasks/);
    assert.match(sql, /tasks_primary_anchor_uidx/);
    assert.match(sql, /CREATE TABLE task_layouts/);
    assert.match(sql, /CREATE TABLE current_task_state/);
    assert.match(sql, /ALTER TABLE tasks ADD COLUMN aerospace_workspace_id text/);
    assert.match(sql, /tasks_aerospace_workspace_idx/);
    assert.match(sql, /CREATE TABLE paper_triggers/);
    assert.match(sql, /paper_triggers_enabled_event_type_idx/);
    assert.match(sql, /CREATE TABLE paper_trigger_firings/);
  });
});
