CREATE TABLE IF NOT EXISTS metric_counters (
  name text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'human', 'agent')),
  task_id text,
  queue_item_id text,
  event_id text,
  task_session_id text,
  source_id text,
  status text CHECK (status IN ('ok', 'failed', 'blocked')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_occurred_at_idx
  ON activity_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS activity_events_task_id_idx
  ON activity_events (task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_events_queue_item_id_idx
  ON activity_events (queue_item_id)
  WHERE queue_item_id IS NOT NULL;
