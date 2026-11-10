-- Supplier Evaluation / dedicated Neon PostgreSQL

-- Version 001: additive migration staging schema. No Firebase data is altered.

-- Application access must be SERVER-SIDE ONLY, never use DATABASE_URL in NEXT_PUBLIC env.

-- Firestore document payloads are stored unchanged as JSONB and source document IDs as text.

-- Exact source snapshots provide validation and rollback confidence; no credential values stored.



CREATE TABLE IF NOT EXISTS migration_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_project_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','importing','verified','failed','cancelled')),
  expected_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS firestore_snapshots (
  run_id bigint NOT NULL REFERENCES migration_runs(id) ON DELETE RESTRICT,
  collection_name text NOT NULL CHECK (collection_name IN
    ('users','evaluations','purchaseOrders','evaluationLinks','evaluationContacts','workspace')),
  document_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  content_sha256 char(64),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, collection_name, document_id)
);

CREATE INDEX IF NOT EXISTS firestore_snapshots_collection_idx ON firestore_snapshots(collection_name, document_id);

CREATE TABLE IF NOT EXISTS se_users (
  uid text PRIMARY KEY,
  email text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff','viewer')),
  active boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS se_users_email_idx ON se_users (lower(email));

CREATE INDEX IF NOT EXISTS se_users_role_active_idx ON se_users (role, active);

CREATE TABLE IF NOT EXISTS se_purchase_orders (
  id text PRIMARY KEY,
  po_number text NOT NULL DEFAULT '',
  prf_number text NOT NULL DEFAULT '',
  vendor_name text NOT NULL DEFAULT '',
  po_status text NOT NULL DEFAULT '',
  document_provider text NOT NULL DEFAULT '',
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS se_purchase_orders_number_idx ON se_purchase_orders(po_number);

CREATE INDEX IF NOT EXISTS se_purchase_orders_prf_idx ON se_purchase_orders(prf_number);

CREATE INDEX IF NOT EXISTS se_purchase_orders_vendor_idx ON se_purchase_orders(lower(vendor_name));

CREATE TABLE IF NOT EXISTS se_evaluations (
  id text PRIMARY KEY,
  po_number text NOT NULL DEFAULT '',
  supplier_name text NOT NULL DEFAULT '',
  evaluator_role text NOT NULL DEFAULT '',
  evaluation_date text NOT NULL DEFAULT '',
  final_rating numeric(8,3),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS se_evaluations_po_idx ON se_evaluations(po_number);

CREATE INDEX IF NOT EXISTS se_evaluations_supplier_date_idx ON se_evaluations(lower(supplier_name), evaluation_date);

CREATE INDEX IF NOT EXISTS se_evaluations_role_idx ON se_evaluations(evaluator_role);

CREATE TABLE IF NOT EXISTS se_evaluation_links (
  token text PRIMARY KEY,
  link_status text NOT NULL DEFAULT 'pending',
  evaluator_role text NOT NULL DEFAULT '',
  po_number text NOT NULL DEFAULT '',
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS se_evaluation_links_status_idx ON se_evaluation_links(link_status);

CREATE INDEX IF NOT EXISTS se_evaluation_links_po_idx ON se_evaluation_links(po_number);

CREATE TABLE IF NOT EXISTS se_evaluation_contacts (
  id text PRIMARY KEY,
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS se_evaluation_contacts_email_idx ON se_evaluation_contacts(lower(email));

CREATE TABLE IF NOT EXISTS se_workspace (
  id text PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW supplier_rating_summary AS
  SELECT lower(supplier_name) AS supplier_key, max(supplier_name) AS supplier_name,
         count(*)::bigint AS evaluation_count,
         round(avg(final_rating)::numeric, 2) AS average_rating
  FROM se_evaluations
  WHERE supplier_name <> '' AND final_rating IS NOT NULL
  GROUP BY lower(supplier_name);
