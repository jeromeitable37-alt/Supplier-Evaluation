# Supplier Evaluation — Production release gate (2026-11-10)

## Release intention
Deploy the improved ISO Supplier Evaluation system with separate Purchasing, Requisitioner, and AMD links, official PO attachments, automated results, school Sheet syncing, and weekday-independent daily 9:00 AM Asia/Manila reminders.

## Verified
- Vercel **Preview** build compiles and deploys successfully.
- Sir JC's one-recipient Gmail test and Purchasing evaluation-link email arrived (user-verified).
- Preview Neon contains historical records, but is **not** the live Firestore source of truth.
- `vercel.json` schedule is `0 1 * * *` UTC (9 AM Philippine time); Vercel Hobby may execute within the hour.
- Reminder logic requires an existing successfully sent evaluation request, a pending and unexpired link, no submitted role, and no email attempt that Manila day; respects per-day cap. Cron endpoint is Production-only and requires `CRON_SECRET`.
- Production-side Neon evaluation submit persists a single submitted record before attempting school Sheet delivery. Failure queues a retry instead of asking for another submission.

## Blocking release conditions found 2026-11-10
1. **Neon production branch has ZERO users, evaluations, POs, links, and migration snapshots.** Preview imports are stale and include test links; do not copy preview test state as if it were current Firestore data.
2. **The official Purchasing Supplier Evaluation workbook still has an `anyone` / `reader` sharing permission**. Under the school owner's account, use Share > General access > Restricted (preserve named users and school-domain access) before syncing student/staff identities and scores. Confirm permissions again before cutover.
3. **Production Vercel lacks `CRON_SECRET` and `FIREBASE_SERVICE_ACCOUNT_JSON`**. If Production remains on Firestore, the authorized Firebase service account is required for secure server-side reminders and Firestore-verified Sheet sync. Do not place keys in GitHub or client-side env vars.
4. **The school Apps Script `sync_evaluation` handler is not yet proven to be deployed**. A successful `send_email` test does not verify the official `WEB_EVALUATIONS` tab or the sheet privacy guard.
5. **Production migration of the latest live Firestore records is not verified**. Execute the read-only Firestore-to-Neon comparison immediately before a fresh authorized import. Preserve user UID/roles, historical evaluation/PO/link IDs, submitted statuses, and permissions. Exclude isolated Preview test records.

## Cutover procedure
1. Authorized school owner restricts workbook link sharing and verifies the deployed Apps Script has `siscIsoSyncEvaluation_`, `siscIsoTestSetup` and the `sync_evaluation` dispatcher. Keep old worksheet tabs unchanged.
2. Back up Firestore; run `scripts/audit-firestore-neon.mjs` with authorized school service credentials; compare results and missing records; run fresh `scripts/migrate-firestore-to-neon.mjs --scan` and `--apply` with the documented acknowledgment against the **production** Neon branch after school authorization. Verify exact counts and hashes, active staff permissions and submitted statuses before enabling.
3. Add secure server-only Vercel **Production** `DATABASE_URL` pointing to the authorized production Neon DB, `CRON_SECRET`, `PMS_WEBHOOK_SECRET`, and verified `GOOGLE_APPS_SCRIPT_EMAIL_URL`. Do not copy the Preview connection string or Preview-only external-write setting. Set `NEXT_PUBLIC_DATA_BACKEND=neon` on Production only **after** the live import reconciles.
4. Review PR #1 and merge to `main`, deploy Vercel Production, verify authorized sign-in, PO listing, PDF access, evaluation-link role and one-time status, safe results, and ISO Letter printout. Verify the school owner approves the output.
5. Confirm one approved Production delivery and `WEB_EVALUATIONS` write; verify idempotent Sheet rows and no unexpected legacy-tab edits. Monitor queued retries.
6. Verify Vercel Cron is registered for `01:00 UTC`, `CRON_SECRET` is configured, and mail sender quota is appropriate. Reminders must stop on submission/expiry and avoid repeating within a Manila calendar day. On Hobby, the time may not be exact.
7. Preserve a known-good Vercel deployment ID for rollback. If a check fails, revert the Production deployment/flags and keep Firestore data untouched while investigating.

## Do not
- Promote isolated Preview test links or scores into the official school database.
- Switch Production to an empty Neon database.
- Enable confidential Sheet writes while its `anyone` permission remains.
- Grant anonymous access to backend admin APIs, Google Drive PO documents or evaluator results.
- Trigger daily reminders from Preview or send bulk mails without recipient verification.
