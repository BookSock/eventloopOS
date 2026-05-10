CREATE TABLE tasks (
  task_id text PRIMARY KEY,
  primary_anchor_kind text NOT NULL,
  primary_anchor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_paper_emitted_at timestamptz,
  auto_paper_idle_seconds integer NOT NULL DEFAULT 60,
  CONSTRAINT tasks_primary_anchor_kind_check CHECK (primary_anchor_kind IN ('codex_thread', 'ghostty_window'))
);

CREATE UNIQUE INDEX tasks_primary_anchor_uidx
  ON tasks (primary_anchor_kind, primary_anchor_id);

CREATE TABLE task_layouts (
  task_id text PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  layout_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE current_task_state (
  id text PRIMARY KEY DEFAULT 'singleton',
  current_task_id text REFERENCES tasks(task_id) ON DELETE SET NULL,
  entered_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT current_task_state_singleton CHECK (id = 'singleton')
);

INSERT INTO current_task_state (id, current_task_id, entered_at, updated_at)
VALUES ('singleton', NULL, NULL, now())
ON CONFLICT (id) DO NOTHING;
