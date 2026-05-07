CREATE TABLE IF NOT EXISTS task_messages (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  task_session_id text NOT NULL,
  task_id text,
  queue_item_id text,
  event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin text NOT NULL,
  source_id text,
  mode text NOT NULL CHECK (mode IN ('followup')),
  status text NOT NULL CHECK (status IN ('attempted', 'sent', 'blocked', 'failed')),
  text_hash text NOT NULL,
  text_length integer NOT NULL CHECK (text_length >= 0),
  provider text,
  native_thread_id text,
  native_turn_id text,
  native_session_id text,
  native_result_session_id text,
  error text,
  message jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK (jsonb_typeof(event_ids) = 'array'),
  CHECK (jsonb_typeof(message) = 'object')
);

CREATE INDEX IF NOT EXISTS task_messages_task_session_id_idx
  ON task_messages (task_session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS task_messages_status_idx
  ON task_messages (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS task_messages_event_ids_gin_idx
  ON task_messages USING gin (event_ids);
