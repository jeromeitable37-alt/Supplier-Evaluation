# Supplier Evaluation: Firestore → Dedicated Neon PostgreSQL

**State as of November 9, 2026:** first authorized migration completed to
`migration-preview`; **1,430 / 1,430 Firestore documents verified with zero
mismatched records**. The live website still uses Firestore. The isolated
Neon `production` branch has not received these records.

## Isolated infrastructure

- Neon project name: `SISC Supplier Evaluation`
- Neon project ID: `purple-poetry-76396098`
- Region: `aws-ap-southeast-1` (Singapore)
- Database: `supplier_evaluation`
- Branches: `production` (empty target schema) and `migration-preview` (1,430-document verified staging snapshot)
- Vercel: `DATABASE_URL` stored as a **server-only Sensitive variable scoped to
  the upgrade Preview Git branch**, pointing to `migration-preview` (not Asylum).
  The preview role password was rotated after accidental disclosure and the
  branch-scoped Preview environment variable was updated. Never publish URLs.
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

## Verified first import (November 9, 2026)

Run #1 state: `verified`. Independently checked in Neon:

| Collection | Source documents | Neon typed records |
| --- | ---: | ---: |
| evaluations | 1,383 | 1,383 |
| evaluationContacts | 17 | 17 |
| evaluationLinks | 17 | 17 |
| purchaseOrders | 6 | 6 |
| users | 5 | 5 |
| workspace | 2 | 2 |
| **Total** | **1,430** | **1,430** |

The importer also saved **1,430 snapshots**, reported **0 JSON payload
mismatches**, **0 unexpected rows**, and **0 unmapped documents**. Existing
Firestore documents were not changed by the import. This is a snapshot,
not continuous synchronization; the source may change afterward.

## Protected read-only website pilot

The upgrade branch exposes `/neon-pilot` and `/api/neon-pilot`.
This restricted route requires an existing Firebase ID token authenticated by
Firebase Identity Toolkit plus a matching **active administrator** profile in
Neon. It returns only server-side aggregate counts and migration audit status,
never raw supplier/staff records or database credentials. It is restricted to
the `migration-preview` Neon endpoint, not Production. Database credentials
remain server-only in Vercel Preview; the client uses Firebase Auth.

No data is written through this pilot. Production stays on Firestore until all
CRUD workflows and public evaluation links have secured PostgreSQL replacements,
the latest source delta has been reconciled, and the school owner approves cutover.

## Preview SQL evaluations explorer (November 9, 2026)

After the read-only audit screen was validated through Firebase Google login,
we added an admin-only SQL record explorer **inside** `/neon-pilot`:

- `/api/neon-evaluations`: paginated server-side SQL summaries (25 per page),
  literal substring search by supplier, PO number, PRF number, or record ID.
- `components/NeonEvaluationExplorer.tsx`: searchable, paginated view of
  imported evaluations, with supplier, PO/PRF number, date, final rating,
  and recommendation. No write actions.
- Shared auth module `lib/server/neonPreviewAccess.ts`: Firebase token
  verification against the original project, active administrator lookup in
  Neon, and fail-closed database hostname pinning to `migration-preview`.
- `/api/neon-pilot` reuses the same access check. No secret is sent to
  the browser. Queries are parameterized, capped, and cache-disabled.

Vercel Preview build for commit `c1066b7` succeeded. This is an initial
**read-only data view** from PostgreSQL, not a complete production CRUD
migration. Live writes remain on Firestore. A final reconciliation is required.

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
