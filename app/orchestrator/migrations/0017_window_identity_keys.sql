ALTER TABLE window_workspace_observations
  ADD COLUMN app_bundle text,
  ADD COLUMN title_prefix text;

CREATE INDEX window_workspace_observations_slot_idx
  ON window_workspace_observations (app_bundle, title_prefix)
  WHERE app_bundle IS NOT NULL AND title_prefix IS NOT NULL;
