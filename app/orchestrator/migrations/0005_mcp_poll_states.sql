CREATE TABLE IF NOT EXISTS mcp_poll_states (
  source_id text PRIMARY KEY,
  cursor text,
  seen jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(seen) = 'array')
);

CREATE INDEX IF NOT EXISTS mcp_poll_states_updated_at_idx
  ON mcp_poll_states (updated_at DESC);
