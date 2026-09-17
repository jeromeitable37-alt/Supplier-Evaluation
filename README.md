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

## Important fix: New Evaluation modal
The New Evaluation action now opens the Evaluation Details modal correctly. The previous navigation helper cleared the editor state immediately after creating a blank evaluation, so the app only navigated to the Evaluations page. This is fixed by opening the editor before changing the page without clearing the new draft.

## Generated Purchase Order workflow

The existing Supplier Evaluation Pro pages remain in place. A new **PO Generator** page was added alongside the existing Scan & Extract/manual evaluation workflow.

### What was added

- **Live Google Sheet PO generation:** the PO Generator reads `PO for Evaluation` and `PRF Details v2` through `/api/po-lookup` and maps the detailed supplier, requisitioner, delivery, terms, item, quantity, price, discount, and total fields when those columns are available.
- **Paper-PO-style document:** generated POs follow the same one-page structure used by the supplied reference PO: company header, PO number, vendor block, date/delivery/terms, line-item table, PRF/requisitioner/purpose, totals, amount in words, and signature/conforme areas.
- **No scan required for new POs:** scanning/OCR is preserved, but it is no longer required when the needed details already exist in the live spreadsheet.
- **Firebase purchase order storage:** generated POs are saved in `purchaseOrders` and remain separate from the historical `evaluations` collection.
- **Requisitioner evaluation link:** every generated PO can create a unique `/evaluate/<token>` URL. The requisitioner rates the same four criteria used by the supplied Apps Script: Accurate Delivery / Quality, Competitive Price, Timeliness of Delivery, and After Sales Services. The submitted result is written back into the existing evaluation register as `source: Requisitioner web evaluation`.
- **One submission per link:** the evaluation link is marked submitted after the evaluation is stored.
- **Automatic evaluation request email:** when Resend is configured, the system sends the request automatically. Without Resend credentials, the system falls back to opening a pre-filled email message in the user's mail app.
- **Academic Year summary:** Reports & Ratings now includes five July-to-June Academic Years, including **AY 2025–2026**, with evaluation count and average Final / Requisitioner / Purchasing / AMD ratings.
- **Automatic Google Sheet refresh:** the PO Generator refreshes the live PO/PRF source when opened and every 60 seconds while it remains open.

### Supplier-evaluation reference behavior

The supplied Apps Script uses the July 1–June 30 academic-year definition and averages submitted evaluation criteria by vendor and Academic Year. fileciteturn14file2L826-L910 The supplied evaluator form uses four requisitioner/AMD criteria and adds Compliance only for the purchaser. fileciteturn14file1L391-L451

### Vercel setup

Create `.env.local` locally or add the same variables in Vercel Project Settings → Environment Variables. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are optional; Firebase and the Google Sheet source are the important values for the generated-PO workflow.

After deploying the updated `firestore.rules`, the public evaluator can read one tokenized `evaluationLinks` document and submit one matching public evaluation record. Existing authenticated evaluation permissions are unchanged.

## Official PO document storage + requisitioner evaluation

PO Generator now supports the official-document workflow used by the purchasing office:

1. Search the Google Sheet PO/PRF record.
2. Open the PO from **For Supplier Evaluation**.
3. Upload or scan the official PO as PDF/JPG/PNG.
4. The file is stored in Firebase Storage and its metadata is saved with the purchase-order record in Firestore.
5. When **Send PO + evaluation** is used, the same stored PO document is attached to the Resend email and shown on the public requisitioner evaluation page.
6. After submission, that PO is removed automatically from the **For Supplier Evaluation** queue and remains in evaluation history/reports.

### Firebase rules

Deploy both Firestore and Storage rules from the project directory:

```bash
firebase deploy --only firestore:rules,storage
```

### Resend

Set these Vercel environment variables:

```env
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

Resend supports remote URL attachments, which the system uses for the stored PO document.

### Optional Gemini document extraction

For future/optional scan-to-fields assistance, set:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
```
