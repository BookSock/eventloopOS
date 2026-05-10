CREATE TABLE follows_window_exclusions (
  exclusion_id text PRIMARY KEY,
  app_bundle text,
  title_substring text,
  created_at timestamptz NOT NULL,
  CHECK (app_bundle IS NOT NULL OR title_substring IS NOT NULL)
);
