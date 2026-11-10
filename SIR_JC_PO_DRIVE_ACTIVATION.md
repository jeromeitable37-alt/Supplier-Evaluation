# Sir JC — School-owned Google Drive PO Storage Activation

**Status: Website Preview code deployed; school-side access and Apps Script deployment require verification.**  
**Date: November 10, 2026**

## Website work completed
- All **new** PO uploads use only the school-owned Google Drive workflow. The Cloudinary uploader/fallback has been removed.
- Historical PO attachments remain **read-only** until migrated, so existing school records are not deleted.
- New PO uploads use authenticated 1 MiB chunks to work within Vercel function limits. Supports PDF, JPG, PNG and WebP, up to **8 MiB per file**, 20 MiB total for one PO upload.
- Admin previews use authenticated chunk assembly; external evaluators can open only files attached to their individual valid evaluation link. No public school Drive URLs are issued.
- Temporary chunks are stored under the approved private folder. The optional siscDriveCleanupStaging_ school function cleans up abandoned temporary chunks older than 24 hours without touching official POs.
- Three evaluator roles and customer satisfaction are preserved. Email delivery is safely OFF in Preview until a school-approved test inbox and webhook destination are connected.
- Printable evaluation structure now follows the live DATA ENTRY FORM2 school sheet, including three-role averages and separate customer satisfaction.

## School-owner setup — must be done using Sir JC's approved account
1. Open the official **private PO folder** in the school Google Drive account. Confirm Sir JC or the executing Apps Script account has edit/read access and **Anyone with the link** is NOT enabled. The connected ChatGPT Google Drive account could not read the provided folder, which does not prove it is absent.
2. In the **existing** school Apps Script project, back up the source and deployed version. Keep Code.gs and existing school functions intact; use only **one doPost(e)** across the project.
3. Review and update the school project from the following repository files:
   - scripts/southville-evaluation-webhook.gs (new chunk actions and request-size fix)
   - scripts/southville-po-drive-storage.gs (private chunk upload, finalize, preview, cleanup)
   - scripts/southville-iso-integration.gs (Sheet upsert)
   - scripts/southville-private-sheet-lookup.gs (allowlisted private workbook lookup)
4. In Apps Script **Project Settings → Script properties**, verify PO_DRIVE_FOLDER_ID, PMS_WEBHOOK_SECRET, SUPPLIER_SHEET_ID, and SUPPLIER_V2_SHEET_ID where relevant. Keep these values private; the server secret must match Vercel Preview.
5. From the editor, run the **read-only** checks siscDriveCheckFolderSetup(), siscPrivateLookupCheckSetup(), and siscIsoTestSetup(). Resolve any folder permission or workbook privacy issues **before** enabling live writes. The existing official sheet currently has an anyone-link Reader permission; do not abruptly restrict it while the old CSV lookup remains active.
6. Select **Deploy → Manage deployments → Edit → New version → Deploy** under the school account. Confirm the existing Vercel GOOGLE_APPS_SCRIPT_EMAIL_URL points to the reviewed updated web app.
7. In the website PO Storage screen, sign in as an approved admin and click **Check School Drive**. The authenticated server will request a read-only folder diagnostic. If it says the script is unavailable, don't enable uploads.
8. Once the Drive diagnostic is verified and the school owner approves, enable PO_DRIVE_UPLOAD_ENABLED=true **only on this Vercel Preview branch**. Test an invented dummy PO with a harmless PDF or image and verify it opens through View secure page.
9. Set up **approved TEST inboxes** and a separate private TEST Sheet before enabling NEON_PREVIEW_EXTERNAL_WRITES_ENABLED. Test buyer, requisitioner, AMD emails, PO attachments, one-time form submission, customer satisfaction and ISO print. Keep actual school destinations OFF until authorized approval.
10. Only after end-to-end testing, data reconciliation, school approval, and rollback preparation should the team plan the separate Neon Production cutover.

## Important error explanations
- **Drive upload paused**: PO_DRIVE_UPLOAD_ENABLED is OFF or school setup hasn't been verified. No file was stored.
- **Unsupported action / invalid request**: school Apps Script web app may still be running the old webhook version with the 100 KB request cap.
- **403 folder unavailable**: the executing Google account lacks access to the private school-owned folder.
- **413 payload too large**: an old single-request upload flow is still in use. Deploy the new 1 MiB chunk version.
- **Email disabled**: external deliveries are intentionally switched off for Preview to protect real school recipients.
- **Evaluator sees Vercel login**: the Preview URL is access-protected. Use a school-approved external evaluator test plan, not global public access.

**Current acceptance status:** The new branch builds successfully; the real school Drive, email and Google Sheets delivery have **not** passed authorized end-to-end QA yet. Do not call the live site fully migrated until those are verified.
