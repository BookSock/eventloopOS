CREATE TABLE task_session_terminal_refs (
  task_session_id text PRIMARY KEY,
  terminal_ref text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

