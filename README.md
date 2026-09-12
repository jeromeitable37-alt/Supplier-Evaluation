# Supplier Evaluation Pro — Firebase + Auth + Profiles + Permissions + AI + Dark Mode

Supplier Evaluation Pro is a Next.js purchasing-office workspace built around your Supplier Evaluation workbook. Firebase Firestore is the cloud source of truth, while Excel is used for import/export and backup.

## Included

- Firebase Authentication: email/password and Google sign-in
- Firebase Firestore real-time supplier evaluation database
- 1,352 historical workbook records in `public/seed-records.json`
- AI document scanner for supplier evaluation forms
- AI Support workspace for summaries, rating explanations, professional remarks and workflow help
- User profile page for every authenticated user
- Role templates: Administrator, Purchasing Staff, Viewer
- Per-user permissions so staff can keep useful tools such as Import/Export Excel
- Administrator Access & Permissions screen
- Light/dark mode
- Emerald, Indigo, Blue, Violet and Amber accent themes
- Excel import/export
- Supplier history and reports

## Local setup

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add your Firebase Web App values.
4. Add `OPENAI_API_KEY` if you want AI OCR and AI Support.
5. In Firebase Authentication, enable Email/Password and Google.
6. Create Firestore Database.
7. Paste the included `firestore.rules` into Firebase Console → Firestore → Rules and publish them.
8. Run `npm run dev` and open `http://localhost:3000`.

## Important: first Admin setup

New accounts are intentionally created as `staff` so a newly registered user cannot make themselves an administrator.

After your first account signs in:

1. Firebase Console → Firestore Database → Data.
2. Create/open collection `users`.
3. Find the document whose ID is your Firebase Authentication UID.
4. Change:

```text
role: admin
active: true
permissions: [all permissions]
```

The easiest option is to open the app's **Access & Permissions** page after promotion. From there you can customize each staff member individually.

For an Administrator profile, the permissions should contain:

```text
view_dashboard
scan_forms
create_evaluations
edit_evaluations
delete_evaluations
view_suppliers
view_reports
import_excel
export_excel
database_management
user_management
activity_logs
ai_support
system_settings
```

## Staff permissions

Default Purchasing Staff permissions include:

```text
view_dashboard
scan_forms
create_evaluations
edit_evaluations
view_suppliers
view_reports
import_excel
export_excel
ai_support
```

That means staff can still perform normal Purchasing work and use Excel when needed, while User Management, Database Management, destructive operations, and System Settings remain restricted.

## Firestore role protection

The included Firestore rules use the authenticated user's `users/{uid}` profile to protect evaluation reads/writes and profile management. Users can edit only their own profile details. Administrators can manage user roles and permissions.

## AI setup

The scanner endpoint and AI Support endpoint use OpenAI's Responses API from server-side Next.js routes. The browser never receives `OPENAI_API_KEY`.

Set:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.6-luna
```

The model defaults to `gpt-5.6-luna`, which supports text and image input through the Responses API. Update the environment variable if you choose another compatible model.

## Vercel

Add the same environment variables in Vercel → Project → Settings → Environment Variables. Your Firebase Web App configuration is public client configuration; keep `OPENAI_API_KEY` secret and server-side.

After deployment, add your Vercel domain to Firebase Authentication → Settings → Authorized domains so Google sign-in works on the deployed site.

## Live Google Sheet lookup

Incoming/new evaluations now use the live shared Supplier Evaluation Google Sheet for PO and PRF lookup. Historical imported records remain unchanged and intentionally do not use live lookup.

Defaults:
- Spreadsheet ID: `1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA`
- PO source: `PO for Evaluation`
- PRF source: `PRF Details v2`

The server endpoint is `/api/po-lookup`. It reads the latest PO and PRF rows, merges them into lookup data, and the editor refreshes this data on open or by pressing **Refresh**.

### Google Sheet access requirement

The deployed server must be able to read the Google Sheet without a user's browser session. The simplest setup is to share the sheet so the data is readable by the deployed app. If your organization's sharing policy prevents direct gviz access, configure `GOOGLE_SUPPLIER_PO_CSV_URL` and `GOOGLE_SUPPLIER_PRF_CSV_URL` to point to read-only CSV/Apps Script endpoints that expose the same columns.

Recommended incoming flow:

`Scan/OCR -> PRF or PO -> live Google Sheet lookup -> auto-fill supplier/items/PRF/PO -> review -> save to Firebase`
