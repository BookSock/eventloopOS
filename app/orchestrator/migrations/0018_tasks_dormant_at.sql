ALTER TABLE tasks ADD COLUMN dormant_at timestamptz;

CREATE INDEX tasks_dormant_at_idx
  ON tasks (dormant_at)
  WHERE dormant_at IS NOT NULL;
