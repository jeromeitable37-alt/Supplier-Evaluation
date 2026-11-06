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
5. `scripts/southville-iso-integration.gs` is a **non-disruptive extension** for the existing bound Apps Script project. A one-branch dispatcher in the *existing* `doPost(e)` routes `sync_evaluation` to it. The extension creates `WEB_EVALUATIONS` only after safe authorization and **upserts by evaluation ID**, without touching the historical `DATABASE`.
6. A printable per-PO ISO worksheet is available at `/print-evaluation/PO_NUMBER`, linked from PO Storage. Scores from the 3 roles are combined by PO; missing submissions display **INCOMPLETE**; names and dates are supplied from records, but signature/approval lines remain blank for authorized signing.

## Owner setup — add an extension to the EXISTING bound Apps Script project

**Do NOT replace the current Apps Script code. Do NOT create another doPost(e).**
The official Google Sheet already has an Apps Script project. Keep its existing
automations, existing email sender, triggers, and other functions intact.

1. Sign into the authorized school account (SGEN Editor, or approved Southville
   Workspace account). Open the existing official Sheet, then
   **Extensions → Apps Script**. If there are multiple script projects, verify
   that this is the one handling the current evaluation email web-app URL.
2. In its file sidebar, click **+ → Script**, name the new file
   `SupplierEvaluationISO`, and paste the content of
   `scripts/southville-iso-integration.gs` from this branch. **Do not
   overwrite Code.gs**. This extension deliberately has NO doPost(e).
3. Keep the existing doPost(e) mail logic unchanged EXCEPT for one safe
   conditional action route inserted after the JSON request is parsed into
   variable `request` and before existing send-email-specific validation:

   ```javascript
   if (request.action === 'sync_evaluation') {
     try {
       return ContentService
         .createTextOutput(JSON.stringify(siscIsoSyncEvaluation_(request)))
         .setMimeType(ContentService.MimeType.JSON);
     } catch (err) {
       return ContentService
         .createTextOutput(JSON.stringify({ok:false,message:String(err && err.message || err)}))
         .setMimeType(ContentService.MimeType.JSON);
     }
   }
   ```

   If the current doPost(e) parses JSON under a different variable name, or
   performs other operations first, **inspect its actual source and adapt the
   single dispatch branch instead of blindly pasting over other code**.
4. Script Properties must contain `SUPPLIER_SHEET_ID` =
   `1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA`.
   The extension intentionally **reuses the existing**
   `PMS_WEBHOOK_SECRET` or `EMAIL_WEBHOOK_SECRET` (24+ characters). Never
   publish the secret or store it in client-side JavaScript.
5. Run `siscIsoTestSetup` in the editor. It checks access only, does NOT
   create a tab, modify existing rows, or send an email.
6. **Sharing/privacy blocker:** The live official workbook is currently
   shared with **Anyone with the link: Viewer**. This is NOT suitable for
   confidential evaluator names, email addresses, and ratings. The extension
   refuses to write private evaluations until this setting is restricted.
   Changing sharing can also break existing unauthenticated Google Sheet CSV
   readers in `app/api/send-evaluation`, `app/api/po-lookup`, and similar
   routes. First migrate those reads to authorized server-side access or a
   safe non-confidential published directory, then coordinate the sharing
   change with the workbook owner; do not restrict access blindly.
7. If and when the privacy/read integration is ready, deploy a new script
   version from the authorized SGEN/school account with **Execute as: Me** and
   appropriate access for the website backend. Set its resulting /exec URL
   and matching secret in Vercel *server-only* Production env variables.
   Test one approved account/PO before any bulk email or production cutover.
8. Verify the true mail From account, the Google Sheet upsert, duplicate
   protection, and that existing sender behavior and cron reminders work.

**Important:** The school account's From address depends on who executes the
deployment; a display name cannot change it. A school address also does not
guarantee Inbox over Spam. Ask IT to check domain authentication and
deliverability.

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
