# Automatic 8:00 AM Philippine-time evaluation emails

This project now has a secure Vercel Cron route:
- Schedule: `0 0 * * *` (UTC = 08:00 Asia/Manila)
- Endpoint: `GET /api/cron/evaluation-reminders`
- Production only; the schedule is registered by `vercel.json`.

## How it behaves

Each morning, the job reads `evaluationLinks` from Firestore and processes records with `status: "pending"`. It includes Purchasing/Buyer, Requisitioner, and AMD/Received-by evaluators.

For each eligible link, the job:
1. Checks that a valid recipient email and stored official PO attachment are available.
2. Checks that a corresponding evaluation has not already been submitted.
3. Ensures the recipient has not already been emailed or claimed by another scheduler run on the same Manila calendar day.
4. Emails the recipient the **same** individual evaluation link, with the official PO attachment, using the existing Google Apps Script sender.
5. Records successful send timestamps and a reminder counter.

After a successful form submission, `evaluationLinks/{token}.status` changes to `submitted`. The scheduler stops sending to that link. It does **not** generate new links or overwrite evaluation answers.

For pending links that were created but never emailed, the first scheduled email acts as the initial request; later emails are reminders. Staff email sends from the existing PO Storage page now also record the first-send timestamp.

Optional: set `remindersEnabled: false` on an evaluation link to exclude it from automatic email.

To minimize accidental mass emailing, the default limit is 100 messages per day. Set `MAX_DAILY_EVALUATION_EMAILS` to adjust the limit (1–250). The scheduler processes older pending emails first.

## Required Vercel environment variables

Go to **Vercel → Project → Settings → Environment Variables** and configure these for **Production**:

| Variable | Value |
| --- | --- |
| `CRON_SECRET` | A randomly generated secret of at least 16 characters. Vercel automatically adds it as a Bearer authorization header for its cron request. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | The full JSON for a Firestore-authorized Firebase service account, stored **only** as a Vercel secret. |
| `GOOGLE_APPS_SCRIPT_EMAIL_URL` | Your existing deployed Google Apps Script email endpoint URL. |
| `GOOGLE_APPS_SCRIPT_SECRET` | Your existing matching Google Apps Script authentication secret. |
| `MAX_DAILY_EVALUATION_EMAILS` | Optional; defaults to 100. |

For Firebase service-account JSON, open the **Firebase Console → Project settings → Service accounts** and generate a service account private key, or use a properly restricted existing service account with Firestore access. Never put private keys, service-account JSON, or cron secrets in GitHub or a `NEXT_PUBLIC_` variable. The file is not part of the repository.

**Redeploy to Production** after adding environment variables; adding a secret alone does not always update an already running deployment.

## Verify without emailing anyone immediately

1. In Vercel, open **Project → Settings → Cron Jobs** and confirm `/api/cron/evaluation-reminders` is scheduled.
2. Check deployment logs after the first scheduled 8 AM run.
3. Confirm that an eligible `evaluationLinks` record has `lastEmailSentAt`, `lastReminderAt`, and `reminderCount`, while a submitted record receives no new reminder.
4. Check that the Gmail / Google Apps Script account has sufficient sending quota and access to PO attachments.
5. If testing manually, invoke the protected endpoint only with the configured Bearer secret. **It sends real emails** and is not a dry run.

The cron endpoint returns aggregate counts (`checked`, `pending`, `sent`, `failed`, `skipped`, `deferred`) in its JSON response. Failed attempts are recorded to avoid repeated sends within the same day.

**Scheduling precision:** Vercel Hobby plan may run once at any time between 08:00 and 08:59 AM Philippine time. Vercel Pro provides minute-level timing.
