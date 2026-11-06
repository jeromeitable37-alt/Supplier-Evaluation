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
5. `scripts/southville-iso-integration.gs` is a non-disruptive extension for the bound Apps Script project. The companion `scripts/southville-evaluation-webhook.gs` goes in the existing empty `ven.gs` and supplies the project's only `doPost(e)` for email + sync. The extension creates `WEB_EVALUATIONS` after safe authorization, upserting by evaluation ID without changing the historical `DATABASE`.
6. A printable per-PO ISO worksheet is available at `/print-evaluation/PO_NUMBER`, linked from PO Storage. Scores from the 3 roles are combined by PO; missing submissions display **INCOMPLETE**; names and dates are supplied from records, but signature/approval lines remain blank for authorized signing.

## Owner setup — use the existing Google Sheet Apps Script

**The actual school Code.gs has manual evaluation helpers but NO doPost(e).
The ven.gs file is empty. Keep the existing Code.gs untouched.**

1. Signed in as the authorized school account, open the official Sheet →
   **Extensions → Apps Script**.
2. Keep **Code.gs** unchanged. The user has already pasted
   `scripts/southville-iso-integration.gs` into a new
   **SupplierEvaluationISO.gs** file.
3. Open the currently **empty ven.gs** and paste the companion file:
   `scripts/southville-evaluation-webhook.gs`.
   This is the ONLY new `doPost(e)` and `doGet(e)` in the project. It routes
   the website's legacy/default email requests and the new sync requests.
   It does not replace the existing manual form functions.
4. Save. Under **Project settings → Script properties**, configure
   `SUPPLIER_SHEET_ID` to
   `1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA` and
   `PMS_WEBHOOK_SECRET` to a randomly generated secret of 24+ characters,
   or reuse `EMAIL_WEBHOOK_SECRET` if already configured and long enough.
   The Vercel server-only sender secret must match the effective value.
   Do not share the secret in chats, logs, or GitHub.
5. Run the `siscWebhookCheckSetup` function manually in the Apps Script
   editor. This verifies the spreadsheet is accessible and reads the
   remaining mail recipient quota without sending emails or changing sheets.
   The check may request permission for Spreadsheet and Mail services.
6. Run `siscIsoTestSetup` separately. This checks the file permissions.
   **Known blocker:** The official workbook currently allows
   **Anyone with the link: Viewer**. The ISO extension refuses to save named
   evaluations to a broadly accessible workbook.
7. Coordinate with the school owner before restricting the official Sheet.
   Current website code obtains data through unauthenticated CSV endpoints;
   those readers need an authorized private replacement before changing
   sharing. Don't make the Sheet private abruptly and break PO lookup.
8. After privacy and compatibility checks, deploy **New deployment → Web app**,
   choose **Execute as: Me**, and authorize only appropriate access.
   Since Vercel server calls the web app, it needs an approved accessible
   endpoint with its separate shared secret. The resulting /exec URL goes
   into the server-only Vercel `GOOGLE_APPS_SCRIPT_EMAIL_URL`.
9. Run one internal send test and one evaluation sync test in a controlled
   environment before any production cutover. The existing 8 AM scheduled
   reminder still needs to be verified separately.

**This branch is not deployed to Production.** No live email sender, Drive
storage, historical Sheet data, or user permissions were changed.

## School-controlled Google Drive PO archive

- Sir GC's authorized Southville Drive can hold PO attachment files. Prefer
  an institution-managed Shared Drive where supported; no Google Drive plan
  is automatically unlimited.
- For the future upload/proxy integration, have Sir GC create a private folder
  and grant the minimum necessary access. Record its ID in the Script Property
  `PO_DRIVE_FOLDER_ID` only once approved.
- The `siscIsoTestSetup` function tests read access to that folder if
  configured. This is NOT a Drive uploader, and existing Cloudinary uploads
  remain unchanged until the protected file pipeline passes integration tests.
- Do not place sensitive POs or signatures in the public Sheet, and never
  grant external evaluators unrestricted access to Sir GC's Drive.

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
