# SISC Supplier Evaluation — Integrated Neon Preview

Updated: November 9, 2026

## Status

**Source:** Firebase project `supplier-evaluation-pro` remains the live Production
database. **Target:** dedicated `SISC Supplier Evaluation` Neon project
`purple-poetry-76396098`, database `supplier_evaluation`,
branch `migration-preview`, endpoint `ep-bitter-haze-b3p8g38w`.

The initial importer verified **1,430 / 1,430 records** (1,383 evaluations,
17 links, 17 contacts, 6 POs, 5 users, 2 workspace). Original Firestore data
was not deleted. This is a historical snapshot, **not live sync**.

Vercel Preview Git branch `upgrade/iso-evaluation-sync-20261106` is configured:
- `DATABASE_URL`: Sensitive, server-only, scoped to this Preview branch,
  pointing to the pooled Neon `migration-preview` connection.
- `NEXT_PUBLIC_DATA_BACKEND=neon`: Preview branch only.
- Production has **no Neon data backend cutover flag** and remains Firestore.

## Existing website integration

The **main Supplier Evaluation dashboard** at `/` now routes database calls
through `lib/neonClient.ts` and the authenticated `/api/neon-data` API when
the Preview flag is set. The original `lib/firestore.ts` functions retain a
Firestore fallback for the existing live site.

Implemented Preview flows:
1. Firebase Google/email login kept; validated Firebase ID token on server.
   Access control uses Neon user profile (role, active, permissions), not
   client-supplied claims. Unknown users enter **inactive pending approval**.
2. Supplier evaluations: load, save, edit, bulk Excel import, delete,
   dashboard/reports/suppliers through the existing UI.
3. Purchase orders: load, save, update and attachment metadata. Existing PO
   file providers remain external (Cloudinary/Firebase Storage/optional Drive).
   **File bytes were not migrated to Neon.**
4. Evaluation links: secure random token generation, records list,
   link-PO updates and send metadata; contact directory.
5. Public `/evaluate/[token]`: server-side validation and scoring,
   row-locked atomic single submission on `/api/neon-public/[token]`;
   token cannot be replayed.
6. Official Google Sheet webhook `/api/sync-evaluation`: fetches trusted
   submitted record from Neon, not browser payload; `se_sheet_sync` guards
   repeated/reentrant sends. Original sheet ID and Apps Script configuration
   are retained, but the external sender must still be verified with a
   controlled end-to-end school-approved submission.
7. Purchasing evaluation email API in Preview: requires signed-in Purchasing
   permission, validates a saved link, uses saved recipient/PO/attachments
   instead of untrusted form data, and enforces a 10-minute resend cooldown.
8. Scheduled evaluation reminders: Neon branch support with pending-role
   filtering and daily claim; requires the existing `CRON_SECRET` and
   approved school Apps Script. No live reminder job was triggered for QA.
9. Optional Google Drive PO pilot: admin authorization checks Neon accounts
   when Preview flag is enabled. `PO_DRIVE_UPLOAD_ENABLED` remains false.
10. Preview archive `/neon-pilot` and SQL explorer remain admin-only and
    read-only; live integrated application at `/` is separate.

## Restrictions and release gates

- **Do not deploy as Neon Production yet.** Original Firestore can receive new
  records after the 1,430 snapshot. A final delta replay and source/target
  reconciliation, protected backup, school owner approval and rollback are
  required before cutover.
- Live Firebase Authentication is intentionally retained. No Firebase Auth
  user passwords or Google OAuth secrets were migrated.
- Preview integration was **built successfully on Vercel**, but the signed-in
  end-to-end operations (evaluate -> submit -> email -> Sheets -> reminder,
  admin edit/reports/PO storage) have not been verified across real user flows.
  Avoid sending real evaluator emails or submitting a live token merely for
  testing; use school-approved test records and destinations.
- Legacy site pulls full evaluations list for reports. Preview polling is
  visibility-aware (2-minute interval plus focus and write refresh). Longer
  term, use paginated SQL views or a change stream for scalability.
- Audit trail, disaster recovery, managed Neon credentials/ownership,
  school data retention and availability commitments require separate review
  before declaring ISO-ready Production.
- Do not expose `DATABASE_URL` to clients, logs, screenshots, public GitHub
  or `NEXT_PUBLIC_*` variables.
- Official Supplier Evaluation Sheet and school PO Drive folder were not
  replaced or moved.

## Smoke test (Preview only)

1. Open the Preview site at its stable `...-git-upgrad-...vercel.app/` URL.
2. Sign in with an existing, authorized Purchasing administrator account.
3. Confirm the main dashboard lists migrated evaluations (not just the pilot).
4. Open Evaluations, Reports, Suppliers, PO Storage and Email Directory.
5. Validate read-only historical records and user permissions first.
6. Use a non-live school-authorized test PO/evaluation link and test email
   recipient to exercise create, edit, email, public submit, idempotency and
   official Sheet sync. Confirm any webhook's write controls and recipient.
7. Compare current Firestore totals/IDs with Neon Preview, freeze or replay
   any deltas and obtain release approval before touching Production.

No live Production data was deleted or modified during this integration.
