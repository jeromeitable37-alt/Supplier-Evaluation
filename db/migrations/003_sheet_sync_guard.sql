-- Preview-safe, additive idempotency guard for official Google Sheet sync.
-- Apply on isolated migration-preview. Never publish secrets or evaluator tokens.
CREATE TABLE IF NOT EXISTS se_sheet_sync (
  evaluation_id text PRIMARY KEY REFERENCES se_evaluations(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lock_expires_at timestamptz,
  sheet_name text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS se_sheet_sync_state_idx ON se_sheet_sync(state,updated_at);
