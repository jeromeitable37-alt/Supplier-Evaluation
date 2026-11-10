# SISC Supplier Evaluation — Integrated Site & School Rollout Handoff
**Status:** Preview software integration deployed, school-facing connections gated pending authorized approval and controlled end-to-end QA.
**Date:** 10 November 2026
**Branch:** `upgrade/iso-evaluation-sync-20261106`
**Preview:** `https://supplier-evaluation-git-upgrad-3d7613-jeromes-projects-ce3c618b.vercel.app/`

## Verified milestones

- User-confirmed existing browser views: Google Sign-In, Dashboard, **1,383 evaluations**, **6 purchase orders**, reports/calculations, administrator permissions.
- Secure anonymous HTTP test: **13 PASS, 0 FAIL, 0 BLOCKED**. Access-limited APIs return 401; invalid public tokens 404; disabled external delivery routes 503.
- Admin-only PostgreSQL rollback QA screenshot: **14 PASS, 0 FAIL**. Tests temporary Create/Read/Update/Delete, PO status changes, duplicate evaluation and link claim, transaction rollback and preserved source snapshots. **Not full browser form QA.**
- Neon migration-preview: initial verified snapshot **1,430 of 1,430** (1,383 evals, 17 links, 17 contacts, 6 POs, 5 users, 2 workspace). Original Firebase Firestore is still the **live Production database**. Neon Production branch is not in use.

## Integrated features — code deployed to upgrade Preview

1. **Data Center & access:** Original Supplier Evaluation admin website now uses role-checked, server-only Neon Postgres for evaluations, POs, profiles, settings, and contacts on Preview. Firebase Auth remains; inactive accounts require approval. Sheet Delivery panel shows synced/queued/processing/failed, with an authorized retry button only if real delivery has been approved and enabled. Bulk import and Clear All are disabled in Preview to protect the baseline.
2. **PO search and live-sheet data:** Existing `PO for Evaluation`, `PRF Details v2`, additional V2 business-unit PRF tabs and requisitioner lookup are retained. PRF-only entries remain searchable. Because private employee/PRF data should not be anonymous, the Neon Preview `/api/po-lookup` requires signed-in Purchasing permissions.
3. **Evaluator links:** Buyer/Purchasing (five criteria, including compliance), AMD and Requisitioner (four criteria). For new links the server creates 30-day expiring random tokens, serializes requests by PO/PRF and role, reuses pending links for the same recipient, blocks duplicates after submission and safely rotates expired unsubmitted links. Failed attempts cannot manufacture a 'sent' email state.
4. **Public evaluation:** Mandatory score 1-5 for each role's criteria; required explanation below 4; Requisitioner-only Customer Satisfaction for Purchasing Timeliness/Accuracy is stored separately. One submission per token is enforced by Postgres row lock + unique evaluation ID. Link expiry also limits private PO access. Dates and individual evaluator roles are stored for ISO and reports.
5. **Automatic Sheet sync code:** Submissions are committed to Neon first. An idempotent, server-side webhook upsert is attempted immediately **only when the school-approved external-delivery feature is ON**. Otherwise the evaluation is durably queued. A daily authorized job retries unsuccessful syncs with bounded attempts; Data Center shows queue state. The original `DATABASE` tab is never overwritten. The separate `WEB_EVALUATIONS` tab is used for web submissions. The current Preview switch is OFF to avoid real school writes.
6. **Official PO archives:** The main PO Storage UI now prefers the school-owned private Drive flow when the approved server-side switch is enabled. Each file is a PDF/JPEG/PNG/WebP up to 8 MiB; metadata and file ID are stored in the PO. Admins preview private files through authenticated `/api/po-drive-file`; external evaluators only see the linked file through token-scoped `/api/public-po-file`, which rechecks that file belongs to the evaluation and the school Apps Script itself verifies the approved folder. Private Drive URLs/file IDs are not published directly. Existing Cloudinary documents remain readable and the current live Firebase flow is unchanged. The Preview Drive switch is OFF.
7. **School email:** The role-specific Apps Script message uses the official linked PO, never a browser-supplied arbitrary attachment; Drive fileId or existing Cloudinary PO can be attached. Rate-limited resend, server-side recipient validation, and daily pending reminders are staged; the Preview external-delivery switch is OFF.
8. **ISO print:** Existing `SISC/EOMSF-PUR-006 REV.000 6/29/26` printable Letter layout remains, with PO/PRF, three evaluator columns, recommendations, signatures reserved for authorized real people, and a separate Requisitioner Customer Satisfaction section. Document Control still needs to approve the printout's correspondence to the official controlled form.
9. **Private Sheet compatibility:** `scripts/southville-private-sheet-lookup.gs` adds a **read-only, allowlisted** Apps Script action to return bounded rows of the official/V2 workbook while keeping the sheet private. The accompanying `scripts/southville-evaluation-webhook.gs` adds a `read_sheet_rows` dispatch action to the EXISTING authenticated webhook. No change to `Code.gs`. Preview switch `GOOGLE_SHEET_PRIVATE_LOOKUP_ENABLED` is OFF until that Apps Script version is installed and read-tested by the school.

## Direct connector checks on 10 November 2026

- **Official school workbook privacy:** Google Drive metadata still reports
  an `anyone` / `reader` permission for the existing
  `PURCHASING SUPPLIER EVALUATION` workbook, alongside more limited permissions.
  This is **not private** yet. No permission was changed. Restricting it before
  the deployed site's old CSV workflow has been replaced could break live PO/PRF
  lookup and school operations.
- **Approved school PO archive:** The named Drive folder was **not accessible
  to the connected account** (Drive returned 404). This does not prove that the
  folder does not exist: only Sir GC's authorized school account may have access.
  The code and school webhook folder checks are ready, but no Drive upload or
  privacy test was performed on the actual folder.
- **External integration switches:** `NEXT_PUBLIC_DATA_BACKEND=neon` and a
  sensitive server-side `DATABASE_URL` are present only for this Vercel Preview
  branch. `NEON_PREVIEW_EXTERNAL_WRITES_ENABLED` and
  `GOOGLE_SHEET_PRIVATE_LOOKUP_ENABLED` have not been configured; the existing
  `PO_DRIVE_UPLOAD_ENABLED` is not enabled. Real school emails, private Drive
  uploads and official Sheet writes are therefore **not live** in Preview.

## School-owner-only activation checklist (not yet performed)

These steps require Sir GC/Southville's authorized Google Workspace/Apps Script and School Procurement/Quality approval. **Do not paste service secrets or data into GitHub/ChatGPT.**

1. In the **same existing** school Apps Script project, back up the original script version. Ensure there is **exactly one `doPost(e)`** entry point. Keep `Code.gs`, existing functions, and official workbook intact. Update the existing webhook file (not a second `doPost`) from `scripts/southville-evaluation-webhook.gs`; add `scripts/southville-iso-integration.gs`, `scripts/southville-po-drive-storage.gs`, and `scripts/southville-private-sheet-lookup.gs` where not already installed. Avoid replacing an already customized working script without reviewing differences.
2. In Apps Script **Script Properties**, review `SUPPLIER_SHEET_ID`, optional `SUPPLIER_V2_SHEET_ID`, approved `PO_DRIVE_FOLDER_ID`, and the server-side webhook secret. Do not log their values. Run read-only `siscWebhookCheckSetup`, `siscIsoTestSetup`, `siscDriveCheckFolderSetup`, `siscPrivateLookupCheckSetup`. Ensure official Sheet and PO archive folder are private and accessible to the executing school account. Restricting Sheet sharing must be coordinated so legacy CSV PO lookup is replaced safely.
3. **Redeploy** that existing Apps Script web app as an updated version under the approved school execution account. Verify the deployed version exposes allowed `read_sheet_rows`, `get_po_file`, `upload_po`, `send_email`, `sync_evaluation`. No anonymous reading of private staff data; all non-health actions require the shared secret. Verify Apps Script quotas and execution limits.
4. Use **separate school-approved TEST inboxes**, a **TEST copy of the Google Sheet**, and a private **TEST PO folder** for controlled integration QA. Do not target official supplier addresses/official Sheet until tests pass. Configure isolated Preview secrets and endpoints in Vercel *server-only*. Review flags `GOOGLE_SHEET_PRIVATE_LOOKUP_ENABLED`, `PO_DRIVE_UPLOAD_ENABLED`, and `NEON_PREVIEW_EXTERNAL_WRITES_ENABLED` one by one. If the official Drive folder has sensitive documents, do not enable QA uploads to it.
5. Validate *real browser* end-to-end: authorized admin uploads a dummy PO, checks staff-private preview, creates a role-specific link, sends only to the approved TEST inbox with exact PO attachment, opens the link, submits buyer/AMD/Requisitioner ratings, tests required comments and Customer Satisfaction, verifies duplicate submission is blocked, checks auto-upsert into the TEST `WEB_EVALUATIONS` tab exactly once, simulates webhook outage and confirms retries, then checks ISO print. Restore flags OFF when not actively testing.
6. Run the read-only `scripts/audit-firestore-neon.mjs` against current Firestore and immutable initial Neon snapshot under authorized credentials. It compares **all IDs/payloads at that moment** and reports only count of same/new/changed/missing. New Firestore changes since the original import must be reconciled under school approval. Back up both systems, test restore and rollback.
7. Only with authorized approval, import the **reconciled production snapshot** into the separate Neon Production branch, configure a production-only server credential, refactor the current Preview-only hostname pin for the reviewed Production endpoint, and re-run secure end-to-end tests. Explicit school go-live approval is required. Do **not** repoint the live Production URL to a QA-mutated database or delete Firestore data for this migration.

## Operational notes

- Vercel SSO protection on Preview remains enabled. Public evaluator flows require an appropriate Vercel access strategy during QA; otherwise a recipient without Vercel team membership may hit a Vercel login page before the app. Do not expose the whole Preview merely to make tests pass; use a controlled test deployment or separately reviewed protection rule.
- The migration Preview `DATABASE_URL` is private and pinned to a dedicated Preview-only Neon endpoint; no client-side DB password.
- External file services have their own limits; the school must manage quotas, retention, malware review, access restrictions, consent and audit logs. A successful Vercel build is not full ISO certification.
- This handoff documents code and safety gates; it does **not** mean the school owner has deployed Apps Script, tested private Drive, approved publication, or performed the final Firestore cutover.
