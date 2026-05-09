CREATE TABLE task_workspace_snapshots (
  task_id text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  source_queue_item_id text,
  actor_id text
);

