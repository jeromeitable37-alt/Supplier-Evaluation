-- Additive backup table for Firestore document paths outside mapped top-level collections.
-- Keeps all nested subcollection documents and unknown root collections recoverable.
-- Never expose these original source payloads to unauthenticated callers.
CREATE TABLE IF NOT EXISTS firestore_extra_snapshots (
  run_id bigint NOT NULL REFERENCES migration_runs(id) ON DELETE RESTRICT,
  firestore_path text NOT NULL,
  collection_name text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  content_sha256 char(64),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, firestore_path)
);

CREATE INDEX IF NOT EXISTS firestore_extra_snapshots_collection_idx
ON firestore_extra_snapshots(collection_name, firestore_path);
