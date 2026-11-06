# Supplier Evaluation ISO Upgrade — Integration & Deployment Checklist

**Status:** Code prepared on a separate GitHub upgrade branch. Not yet authorized or deployed to Production. No old evaluation data should be deleted.

## Source documents audited

- Southville form `SISC/EOMSF-PUR-006 REV.000 (6/29/26)`: 5 supplier criteria for Purchasing, 4 for Requisitioner and AMD (Compliance = N/A for the latter roles), comments and reasons for scores below 4, average, recommendation, handwritten approvals, and a separate **Customer Satisfaction Rating for Purchasing** with Timeliness/Accuracy.
- Official spreadsheet ID: `1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA`.
- Existing tabs include `DATABASE`, `DATA ENTRY FORM (JERIC)`, `DATA ENTRY FORM (VENEDIC)`, `PO for Evaluation`, `PRF Details`, `Requisitioner Details`, and `Summary AY 2025-2026`.
- Existing `DATA ENTRY FORM (JERIC)` uses `=IFERROR(AVERAGE(F24:H24))` for final supplier rating: an average of available Purchasing, Requisitioner, and AMD averages. The print report marks the record incomplete until all three are collected.

## Included in this branch

1. Requisitioner web form collects separate customer satisfaction scores for Purchasing service (Timeliness and Accuracy), each 1–5, plus comments.
2. Each supplier criterion rated below 4 requires a specific explanatory reason.
3. Firestore stores the exact role submission, scores, below-4 reasons, customer satisfaction, actor, and timestamp.
4. `POST /api/sync-evaluation` accepts ONLY an opaque public evaluation token, verifies submitted status and PO/role against trusted Firestore using the existing server-side service account, and forwards verified data to the Apps Script web app.
5. `scripts/southville-iso-integration.gs` preserves the existing `send_email` behavior and adds `sync_evaluation`. It auto-creates `WEB_EVALUATIONS` in the official workbook and safely **upserts by evaluation ID**. It does not touch old `DATABASE` rows or formulas.
6. A printable per-PO ISO worksheet is available at `/print-evaluation/PO_NUMBER`, linked from PO Storage. Scores from the 3 roles are combined by PO; missing submissions display **INCOMPLETE**; names and dates are supplied from records, but signature/approval lines remain blank for authorized signing.

## Owner deployment — school Google account

**Do not send account passwords or verification codes to a developer.**

1. Sign in to the SGEN / officially authorized school Google account that owns or can edit the workbook.
2. Open [Apps Script](https://script.google.com/) → **New project**. Paste `scripts/southville-iso-integration.gs`.
3. Project Settings → Script Properties:
   - `EMAIL_WEBHOOK_SECRET`: a new long random secret of 24+ characters. Keep it private.
   - `SUPPLIER_SHEET_ID`: `1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA`.
4. Deploy → New Deployment → Web app → **Execute as: Me**. Access must allow the website's server request. Because the script requires a separate private shared secret, do not expose that secret in browser code, public repositories, or public Sheet cells.
5. Grant access to Google Sheets, MailApp, and any Drive files the owner will later use as official PO attachments. The actual From account is the one executing the Apps Script, not the `senderName` display label.
6. Copy the deployed `/exec` URL to **Vercel Production env** as `GOOGLE_APPS_SCRIPT_EMAIL_URL`.
7. Set matching `GOOGLE_APPS_SCRIPT_SECRET` (or existing `PMS_WEBHOOK_SECRET`, if that takes precedence). Keep `FIREBASE_SERVICE_ACCOUNT_JSON` and `CRON_SECRET` as server-only secrets.
8. After testing, redeploy to Production. This branch alone changes nothing on the live site.

**Important:** Changing the sender to the school account **cannot guarantee Inbox instead of Spam**. Have school IT verify SPF, DKIM, DMARC, sender domain, and delivery reputation. Include a clear subject, real department signature, and minimal attachments; run one internal and one external test before bulk emailing.

## Test checklist — before enabling on Production

- Test one PO with one evaluator per role; verify all 3 role submissions and that each link becomes Submitted.
- Check the new `WEB_EVALUATIONS` tab has exactly 3 unique ID rows, with no duplicate after re-sync. Compare PO/PRF, role, all 5/4 scores, timestamps, and reasons below 4 against Firestore.
- Ensure customer satisfaction appears only on Requisitioner submission and does **not** affect supplier final rating.
- From PO Storage, click **Print ISO Supplier Evaluation** and use Print / Save as PDF. Verify layout on Letter paper and full supplier/PO data. Signatures must be completed by the real signatories.
- Verify missing role shows an incomplete printout, not a fabricated completed score.
- Test manual and scheduled evaluation emails: real From address, unique link, attached official PO, responses and reminder-stop behavior.
- Check handling when Apps Script is temporarily unavailable: Firestore submission remains saved, browser reports that Sheet sync needs verification.
- Before approval for ISO use, ask the Quality/Document Control office to validate that the generated worksheet is accepted as a reproduction of revision `REV.000`.

## Explicitly not migrated yet — Google Drive storage

Cloudinary remains active in the current live PO upload/view/OCR flow. The new Apps Script email sender can **read an authorized Google Drive file by fileId** when a future secure upload layer supplies it, while still supporting legacy Cloudinary URLs. This does not itself migrate existing files or safely publish private Drive attachments to external evaluators.

A correct Drive migration needs:
1. School-owned private Drive folder with access permissions and retention policy.
2. Authenticated uploads from Purchasing staff (no public upload endpoint exposing the Apps Script secret), size and type validation, malware review if required, and sensible per-file limits.
3. Viewer/proxy for external evaluator links that verifies the evaluator token **without making the whole Drive folder public**.
4. OCR/document preview switched to the authorized Drive delivery method; email attachment retrieval by `fileId`.
5. Gradual migration with checksums, old-file fallback, and only then removal of Cloudinary.

Google Drive storage is **not unlimited**; quota depends on the school account. Google Apps Script and MailApp also have execution, sending and attachment limits. Do not delete existing Cloudinary PO documents before secure Drive previews, uploads, emails, and OCR pass tests.

## Remaining reliability work

The API syncs immediately after a new public submission. If the Apps Script request fails after Firestore saves, the form states that sync is unconfirmed; add a server-side retry/reconciliation job and an admin sync status screen before claiming guaranteed eventual sync. The legacy `DATABASE` tab has 2020 onward historical rows and complex formulas. Explicit mapping and backup are required before migrating `WEB_EVALUATIONS` into that layout.

**Rollout order:** verify new form → verify school-account Apps Script email → verify separate sync tab → validate official printable output → build secure Drive uploader/viewer → controlled production cutover.
