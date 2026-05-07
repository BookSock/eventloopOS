CREATE TABLE IF NOT EXISTS context_restore_requests (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'done')),
  idempotency_key text UNIQUE,
  resource jsonb NOT NULL,
  restore_plan jsonb NOT NULL,
  result jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS context_restore_requests_pending_idx
  ON context_restore_requests (created_at ASC, id ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS context_restore_requests_stale_lease_idx
  ON context_restore_requests (lease_expires_at)
  WHERE status = 'leased';
