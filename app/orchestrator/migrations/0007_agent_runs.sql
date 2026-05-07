CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('codex', 'claude', 'openai', 'manual', 'fake')),
  task_id text,
  thread_id text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'blocked', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  blocked_reason text,
  risk_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_task_status_idx ON agent_runs (task_id, status);
