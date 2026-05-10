CREATE TABLE window_workspace_observations (
  window_id text NOT NULL,
  workspace_id text NOT NULL,
  is_task_workspace boolean NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (window_id, workspace_id)
);

CREATE INDEX window_workspace_observations_last_seen_idx
  ON window_workspace_observations (last_seen_at);

CREATE INDEX window_workspace_observations_window_idx
  ON window_workspace_observations (window_id);
