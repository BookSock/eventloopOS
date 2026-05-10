CREATE TABLE onboarding_rejections (
  proposal_key text PRIMARY KEY,
  reason text,
  rejected_at timestamptz NOT NULL
);

CREATE TABLE onboarding_approval_batches (
  idempotency_key text PRIMARY KEY,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
