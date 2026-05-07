ALTER TABLE context_restore_requests
  DROP CONSTRAINT IF EXISTS context_restore_requests_status_check;

ALTER TABLE context_restore_requests
  ADD CONSTRAINT context_restore_requests_status_check
  CHECK (status IN ('pending', 'leased', 'done', 'failed'));
