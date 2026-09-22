FINAL FIX — PURCHASING + REQUISITIONER + AMD EMAIL WORKFLOW

IMPORTANT BEFORE BUILDING:
Delete any old PATCH_FILES folder from your project root. It is an old helper
folder and must not be inside the Next.js project because Vercel will compile
.ts files inside it.

Replace these files from this ZIP:
  app/api/send-evaluation/route.ts
  app/evaluate/[token]/page.tsx
  components/PurchaseOrderGenerator.tsx
  lib/firestore.ts

The public evaluation page uses:
  Purchasing / Buyer = 5 criteria (includes Compliance)
  Requisitioner = 4 criteria
  AMD Personnel = 4 criteria

The evaluation queue recognizes separate role links. Email sending uses the
Google Apps Script variables already configured in Vercel:
  GOOGLE_APPS_SCRIPT_EMAIL_URL
  GOOGLE_APPS_SCRIPT_SECRET

Keep your .env.local, .git, node_modules, and existing project files.
