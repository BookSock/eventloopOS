CREATE TABLE manual_mode_state (
  id text PRIMARY KEY DEFAULT 'singleton',
  active boolean NOT NULL DEFAULT false,
  entered_at timestamptz,
  reason text,
  updated_at timestamptz NOT NULL,
  CONSTRAINT manual_mode_state_singleton CHECK (id = 'singleton')
);

INSERT INTO manual_mode_state (id, active, updated_at)
VALUES ('singleton', false, now())
ON CONFLICT (id) DO NOTHING;
