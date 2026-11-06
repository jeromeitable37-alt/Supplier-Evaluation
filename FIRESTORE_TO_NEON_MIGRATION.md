# Supplier Evaluation: Firestore → Dedicated Neon PostgreSQL

**State as of November 6, 2026:** target database and schemas prepared; **zero
production school records have been copied**; Firebase remains the live source.

## Isolated infrastructure

- Neon project name: `SISC Supplier Evaluation`
- Neon project ID: `purple-poetry-76396098`
- Region: `aws-ap-southeast-1` (Singapore)
- Database: `supplier_evaluation`
- Branches: `production` (empty target schema) and `migration-preview` (empty staging schema)
- Vercel: `DATABASE_URL` set as a **server-only Sensitive variable for the
  upgrade Preview Git branch**, pointing to `migration-preview` (not Asylum).
- SQL: `db/migrations/001_supplier_evaluation.sql` and
  `db/migrations/002_firestore_unmapped.sql`; both applied and verified.
- CLI: `scripts/migrate-firestore-to-neon.mjs` for admin-authorized scan and
  lossless JSONB import of Firestore documents.

## Source scope

Known website collections:
`users`, `evaluations`, `purchaseOrders`, `evaluationLinks`,
`evaluationContacts`, and `workspace`.

The migration CLI also traverses other root collections and their subcollections,
storing unmapped records with their Firestore document paths. Original document
IDs and all serializable fields are preserved in JSONB. Typed indexed columns
support future production SQL queries. It does **not** copy file bytes (Cloudinary
or Firebase Storage), passwords, Firebase Auth accounts, Google OAuth
credentials, or the official Google Sheet.

## Security prerequisites

1. The **school's authorized data owner/IT administrator** must approve transfer
   of staff/supplier records to the **new database owner's Neon organization**.
   Verify retention, privacy, backups, role access, and plan/billing.
2. Use an authorized Firebase project admin environment with Application Default
   Credentials (ADC). The importer must not request, log, send, or commit a
   service-account private key. Never paste credential files or source exports
   into chat.
3. Make a protected copy of the current Firestore data. Managed Firestore exports
   are available in Google Cloud console but may require billing and a secured
   Cloud Storage bucket.
4. During the final catch-up transfer, pause writes briefly or re-run and compare
   source counts and IDs to prevent data created during the migration from being
   missed.

## One-time CLI steps (on an authorized school administrator's computer)

The script is intentionally **not** a web endpoint; it cannot be used by
unauthenticated visitors.

```bash
# Clone the upgrade branch and install dependencies for the one-off migration.
npm install --no-save firebase-admin pg

# The authorized admin signs into Google Cloud locally using school credentials.
gcloud auth application-default login

# Set these environment variables locally using the machine's secure environment:
#   FIREBASE_PROJECT_ID=<original Firebase project ID>
#   DATABASE_URL=<direct, unpooled connection to supplier_evaluation migration-preview>
#
# First run only the read-only source scan:
node scripts/migrate-firestore-to-neon.mjs --scan

# After confirming school authorization, a protected Firestore backup, and
# the target database, run:
#   MIGRATION_WRITE_ACK=SISC_APPROVED
node scripts/migrate-firestore-to-neon.mjs --apply
```

The importer rejects any database except `supplier_evaluation` on Neon.
It writes in transactions, creates a migration audit run, records SHA-256
checksums for preserved source documents, and checks written document counts.
It never deletes or updates the original Firestore documents.

## Cutover requires additional work

The existing website still reads and writes Firestore directly. Merely migrating
records does **not** make the live website use PostgreSQL.

Remaining work after a verified Preview import:
- Implement server-side PostgreSQL read/write APIs for the entire current
  Supplier Evaluation workflow, with session and role enforcement.
- Keep Google Sign-In/Firebase Authentication temporarily, or separately migrate
  identity provider accounts and OAuth configuration (passwords are not portable
  from Firebase Auth as plaintext).
- Keep existing evaluation tokens, role-specific links, customer satisfaction,
  and email triggers working without duplicate sends.
- Preserve document references; separately migrate any PO file bytes and
  verify authorized download/preview before moving Cloudinary files.
- Make a final source/destination reconciliation; freeze or replay new changes;
  then change Production configuration in a reviewed rollout.
- Keep old Firestore available for rollback until school owner approves
  decommissioning.

Never enable new PostgreSQL writes from the browser using an exposed
`NEXT_PUBLIC_DATABASE_URL`. The connection string belongs on the server only.
