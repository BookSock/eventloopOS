ALTER TABLE task_window_claims
  ADD COLUMN IF NOT EXISTS process_root_pid integer;

ALTER TABLE task_window_claims
  DROP CONSTRAINT IF EXISTS task_window_claims_check;

ALTER TABLE task_window_claims
  DROP CONSTRAINT IF EXISTS task_window_claims_identity_check;

ALTER TABLE task_window_claims
  ADD CONSTRAINT task_window_claims_identity_check CHECK (
    window_id IS NOT NULL
    OR app_bundle IS NOT NULL
    OR title_prefix IS NOT NULL
    OR process_root_pid IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_task_window_claims_process_root_pid
  ON task_window_claims(process_root_pid)
  WHERE process_root_pid IS NOT NULL;
