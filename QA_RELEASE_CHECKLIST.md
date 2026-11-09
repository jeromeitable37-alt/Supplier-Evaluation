# Supplier Evaluation — Final QA & Production Release Gates
Last updated: November 9, 2026

## Current verified state

**User-confirmed PASS (Preview):** Google Sign-In, dashboard, 1,383 historical
evaluations, 6 historical POs, reports/ratings, admin access/permissions.

**Backend confirmed:** 1,430 imported Firestore snapshots remain on
Neon `migration-preview`. Neon `production` is schema-only/empty; live
application still uses Firestore.

**Not yet verified:** authenticated create/edit/delete, role denial, new
evaluation link/public submission, duplicate replay, test PO file storage,
scheduled email, external school email/Sheet sync, same-day Firestore delta,
final backup and rollback. A Vercel READY build is not proof of these flows.

## A. Run non-destructive security smoke test

From Google Cloud Shell in the `Supplier-Evaluation` folder:

```bash
git pull --ff-only
node scripts/qa-preview-http.mjs
```

This makes thirteen anonymous, **non-destructive** HTTP requests to the
fixed Vercel upgrade Preview hostname. It verifies that private APIs return
401, unknown public links return 404, and external school side effects return
503. It never requires personal credentials or real record values.

**Expected:** `13 PASS; 0 FAIL`. If any check fails, stop and investigate.
This is *not* a substitute for authenticated functional QA.

## B. Controlled functional tests — Preview only

Use fictional QA-only supplier/PO numbers (for example,
`QA-PO-NOV09-01`), no real school names, staff emails, uploaded files, or
actual supplier transactions. Maintain a QA register of generated test IDs
privately, separate from school production data.

1. **Evaluations CRUD:** Create a QA evaluation; refresh the page; confirm it
   persisted in Neon and appears in dashboards and reports. Edit a field;
   refresh and confirm the update; delete **only this QA-created record**.
   Confirm totals return to the initial value and the corresponding report is
   refreshed. Never use `Clear All`.
2. **Purchase orders:** Create a fictional QA purchase order; verify it
   persists and appears in PO Storage. Edit and refresh. **Do not upload**
   a test PO to existing Cloudinary/Drive/Firebase Storage until isolated
   test file storage is approved; external file providers may be live.
3. **Public evaluation:** Create a QA PO and QA evaluation links for each
   evaluator role—requisitioner, AMD personnel, and purchaser. Copy the
   link privately. Open it in a private browser. Submit a score below 4 with
   its required remark, and include Customer Satisfaction for requisitioner.
   Confirm one SQL evaluation is saved, the link changes to submitted, and
   a second POST cannot create a second evaluation. Do not send links
   to real staff or trigger production email.
4. **Permissions:** Use authorized test staff accounts to check that
   viewers cannot edit/delete; inactive/pending users cannot access data;
   approved staff receive only assigned permissions; admin-only tools
   require admin. A profile edit must never activate a pending account by
   default.
5. **Report and print:** Verify saved QA ratings appear correctly in totals,
   supplier summaries, charts, PDF/print output and filtering; compare
   calculations with the evaluation and PO details.
6. **Error paths:** Refresh and retry after a safe test create/update;
   invalid link, empty ratings, and malformed requests must fail without
   partial records or duplicate submissions.

To protect imported school history, bulk import and Clear All are disabled
on Neon Preview until separately approved. The historical snapshots table
remains unchanged by QA application writes. Keep track of QA-created data
for authorized cleanup before cutover.

## C. External integrations — must be isolated for QA

These are intentionally **disabled on Neon Preview** while
`NEON_PREVIEW_EXTERNAL_WRITES_ENABLED` is absent:

- sending evaluator emails through school Apps Script;
- synchronization to the *official* Google Sheet;
- scheduled evaluation reminder emails.

Before enabling *test* external writes, the authorized school owner must
approve (1) a test recipient inbox, (2) a **separate copy of the Google
Sheet** with its own Apps Script endpoint and access controls, and (3)
rate limits and retry/reconciliation checks. Protect original sheets,
real recipients and production PO Drive. When tests pass, restore the
external-write switch to OFF and document the verified versions.

**Do not use real evaluator addresses or the existing official Apps Script
endpoint as a test destination.**

## D. Current Firestore source delta (read-only)

The original migration verified 1,430 records **at that time**. Firestore
may now contain added, changed or removed documents. The upgraded repo
includes an audited, read-only comparison tool:

```bash
cd ~/Supplier-Evaluation
git pull --ff-only
# Paste a NEW, unexposed, DIRECT connection string for Neon migration-preview
# into the terminal's hidden prompt; never put it into chat or shell history.
read -r -s -p "Paste Neon migration-preview URL: " DATABASE_URL
echo
export DATABASE_URL
FIREBASE_PROJECT_ID=supplier-evaluation-pro node scripts/audit-firestore-neon.mjs
unset DATABASE_URL
```

The tool uses existing authorized Cloud Shell Firestore ADC, compares every
current source document with the immutable verified Neon snapshot, and prints
**counts only**: same/new/changed/missing. No staff/supplier data or IDs are
logged. The script **never modifies either database**.

Interpret results:
- All three difference counts = 0: baseline matches current Firestore at
  the instant of the scan (it does not prove safe cutover yet).
- Any added/changed/missing: freeze or replay the source delta under school
  approval; reconcile IDs and payloads and verify again. Do not blindly
  rerun the `--apply` importer into a QA-mutated Preview branch.
- Exit code 2 means differences found; code 1 means an audit error.

## E. Production deployment / rollback gate (not yet authorized)

All items below must be true **before** live cutover:
- School data owner confirms legal basis, ownership of Neon org and account,
  retention, backups, billing, staff access and audit requirements.
- Protected Firestore backup and recovery test completed; Neon backup and
  recovery procedure confirmed for school plan.
- Preview CRUD + anonymous denial + public single-use + report + outbound
  email/Sheet integration QA all passed with recorded evidence.
- Test data is isolated or cleaned up; all current Firestore new/changed/
  deleted records are reconciled with a **fresh** destination.
- Production Neon branch receives a separate, verified authorized import;
  **do not** just point Production to the QA-mutated Preview database.
- Production-only server credential is securely configured on Vercel and
  rotated if exposed; neither database URL nor passwords are placed in
  `NEXT_PUBLIC_*`, repo commits, screenshots or chat.
- The current application DB helper **pins the Preview Neon hostname** as a
  safety measure. Production cutover therefore requires an explicitly
  reviewed production endpoint allowlist and configuration update before
  switching `NEXT_PUBLIC_DATA_BACKEND` to Neon.
- Confirm Google Authentication authorized domains; PO document retrieval,
  original official Sheet, script permissions, evaluator links, reminders
  and webhook secrets. Set up monitoring and error alerts.
- Define write-freeze/catch-up window, migration audit evidence, validation
  checklist, assigned rollback owner and a tested rollback procedure.
- Obtain explicit go-live authorization. Keep original Firestore data and
  access available for rollback; do not delete legacy collections during
  migration.

**Status today: Preview builds and the six read-only user checks PASS.
Live Production cutover is NOT approved and has NOT been performed.**
