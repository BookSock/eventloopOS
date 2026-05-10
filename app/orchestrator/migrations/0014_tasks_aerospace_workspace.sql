ALTER TABLE tasks ADD COLUMN aerospace_workspace_id text;

CREATE INDEX tasks_aerospace_workspace_idx
  ON tasks (aerospace_workspace_id)
  WHERE aerospace_workspace_id IS NOT NULL;
