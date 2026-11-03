# Change the real supplier-evaluation sender to do.not.reply.southville@gmail.com

## Why changing the display name is not enough

The Supplier Evaluation website sends manual requests and automatic 8 AM reminders
to a Google Apps Script web app. The web app sends from the Google account that
authorizes/deploys it when its deployment is set to **Execute as: Me**.

The website's `senderName` field only changes the display name.
It **cannot** make a message appear from an unrelated Gmail address.

The website now labels its messages **Southville Supplier Evaluation**.
To change the *actual* From address, complete the migration below.

## 1. Deploy the email sender under the new Gmail account

1. Sign in to **do.not.reply.southville@gmail.com** using your own authorized login.
2. Open https://script.google.com and create a **New project**.
3. Copy the reference code in [scripts/southville-evaluation-email.gs](scripts/southville-evaluation-email.gs)
   into the Apps Script editor and save it.
   If you have a working existing Apps Script sender with additional features,
   instead make a copy of that script into the new Gmail account, verify its email
   attachment behavior, and deploy it from the new account.
4. In **Project Settings → Script properties**, add `EMAIL_WEBHOOK_SECRET`
   with a long random secret. Do not store it in GitHub or share it in chat.
   It must match the production Vercel `GOOGLE_APPS_SCRIPT_SECRET` value.
5. Select **Deploy → New deployment → Web app**, **Execute as: Me**,
   and **Who has access: Anyone** (server-to-server access).
   The endpoint requires the separate shared secret and rejects requests without it.
   Review authorization prompts and authorize Gmail/MailApp and URLFetch permissions.
6. Copy the **Web app /exec URL**. Only use the URL of this new deployment.

The reference script accepts the same request fields as the website:
`secret`, `to`, `subject`, `htmlBody`, `textBody`, `senderName`,
and `attachments`. It downloads the stored official PO attachments from Cloudinary
and sends the email via the deploying account.

**Security note:** Because Google Apps Script web-app access may be public,
protect the URL with the configured shared secret. Anyone with that secret could
otherwise send email through your account; rotate it if exposed.
Do not paste email account passwords or service credentials in the repository.

## 2. Update the production environment on Vercel

Go to [Vercel Supplier Evaluation](https://vercel.com/jeromes-projects-ce3c618b/supplier-evaluation)
→ **Settings → Environment Variables**.

- Change `GOOGLE_APPS_SCRIPT_EMAIL_URL` (Production) to the newly deployed URL.
- Ensure `GOOGLE_APPS_SCRIPT_SECRET` (Production) matches the Apps Script property.
- Keep `CRON_SECRET` and `FIREBASE_SERVICE_ACCOUNT_JSON` as previously configured.
  They control automatic reminders and are unrelated to the sender identity.
- Redeploy the **Production** project after updating the environment.

Both the website's manual evaluation email API and the 8 AM reminder job use
the same `GOOGLE_APPS_SCRIPT_EMAIL_URL`, so both switch at once.

## 3. Verify the From address

1. Send **one** test evaluation request to a mailbox you control. Avoid using
   the automatic cron endpoint for testing because it may email all pending recipients.
2. Open the message and inspect the actual **From** field. It must show:
   `Southville Supplier Evaluation <do.not.reply.southville@gmail.com>`.
3. Confirm the official PO attachment is included and the evaluation link opens.
4. Confirm an evaluation submitted through the link stops receiving reminders.
5. Check Vercel Cron Jobs and function logs after the next 8 AM run.

If it still displays the previous sender, verify that the **new script**, not the
old script, was deployed while signed in to the `do.not.reply.southville@gmail.com` account.
GmailApp supports a different `from` only for an already verified alias of
the script's authorized Gmail account; the web app cannot spoof an arbitrary Gmail address.

**Status:** GitHub contains the sender display-name update and the reference
Apps Script implementation. The sender-account migration is **not complete**
until the new Google Apps Script web app has been deployed under the new Gmail
account and the Vercel Production URL/secret are configured and verified.
