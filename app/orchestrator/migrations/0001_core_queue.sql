CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  source text NOT NULL,
  source_id text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  actor jsonb,
  project_hint text,
  task_hint text,
  type text NOT NULL,
  title text NOT NULL,
  summary text,
  raw_ref jsonb NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, idempotency_key)
);

CREATE INDEX IF NOT EXISTS events_received_at_idx ON events (received_at);
CREATE INDEX IF NOT EXISTS events_source_id_idx ON events (source, source_id);

CREATE TABLE IF NOT EXISTS review_packets (
  id text PRIMARY KEY,
  task_id text,
  agent_run_id text,
  title text NOT NULL,
  summary text NOT NULL,
  decision_needed text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  risk_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action jsonb NOT NULL,
  alternate_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_items (
  id text PRIMARY KEY,
  review_packet_id text NOT NULL REFERENCES review_packets(id) ON DELETE RESTRICT,
  task_id text,
  state text NOT NULL CHECK (state IN ('ready', 'leased', 'deferred', 'done', 'dead')),
  priority_score integer NOT NULL DEFAULT 0,
  priority_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  due_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (review_packet_id)
);

CREATE INDEX IF NOT EXISTS queue_items_ready_rank_idx
  ON queue_items (priority_score DESC, created_at ASC, id ASC)
  WHERE state = 'ready';

CREATE INDEX IF NOT EXISTS queue_items_stale_lease_idx
  ON queue_items (lease_expires_at)
  WHERE state = 'leased';

CREATE TABLE IF NOT EXISTS route_decisions (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN (
      'ignore',
      'store_only',
      'attach_to_task',
      'start_agent_thread',
      'inject_into_agent_thread',
      'create_review_packet',
      'ask_human_now',
      'defer_until_context'
    )
  ),
  target_task_id text,
  target_task_session_id text,
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  human_queue_reason text CHECK (human_queue_reason IN ('human_blocked', 'ambiguous', 'risky')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);

ALTER TABLE route_decisions
  ADD COLUMN IF NOT EXISTS human_queue_reason text CHECK (
    human_queue_reason IN ('human_blocked', 'ambiguous', 'risky')
  );

CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY,
  receipt_type text NOT NULL,
  event_id text REFERENCES events(id) ON DELETE SET NULL,
  queue_item_id text REFERENCES queue_items(id) ON DELETE SET NULL,
  review_packet_id text REFERENCES review_packets(id) ON DELETE SET NULL,
  decision_id text REFERENCES route_decisions(id) ON DELETE SET NULL,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS receipts_created_at_idx ON receipts (created_at);
