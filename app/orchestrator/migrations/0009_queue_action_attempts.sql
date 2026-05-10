CREATE TABLE queue_action_attempts (
  idempotency_key text PRIMARY KEY,
  queue_item_id text NOT NULL,
  terminal_send_ok boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,
  action_result jsonb,
  terminal_send_result jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX queue_action_attempts_queue_item_id_idx
  ON queue_action_attempts (queue_item_id);
