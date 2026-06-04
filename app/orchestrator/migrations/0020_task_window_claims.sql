CREATE TABLE IF NOT EXISTS task_window_claims (
  claim_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  window_id text,
  app_bundle text,
  title_prefix text,
  source text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  CHECK (
    window_id IS NOT NULL
    OR app_bundle IS NOT NULL
    OR title_prefix IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_task_window_claims_task_id
  ON task_window_claims(task_id);

CREATE INDEX IF NOT EXISTS idx_task_window_claims_window_id
  ON task_window_claims(window_id)
  WHERE window_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_window_claims_identity
  ON task_window_claims(app_bundle, title_prefix)
  WHERE app_bundle IS NOT NULL OR title_prefix IS NOT NULL;
