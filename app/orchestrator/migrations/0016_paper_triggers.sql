CREATE TABLE paper_triggers (
  trigger_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  name text NOT NULL,
  match_event_type text NOT NULL,
  match_source_id_pattern text,
  match_body_substring text,
  enabled boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_fired_at timestamptz
);

CREATE INDEX paper_triggers_enabled_event_type_idx
  ON paper_triggers (enabled, match_event_type);

CREATE INDEX paper_triggers_task_id_idx
  ON paper_triggers (task_id);

CREATE TABLE paper_trigger_firings (
  trigger_id text NOT NULL REFERENCES paper_triggers(trigger_id) ON DELETE CASCADE,
  dedupe_key text NOT NULL,
  fired_at timestamptz NOT NULL,
  PRIMARY KEY (trigger_id, dedupe_key)
);
