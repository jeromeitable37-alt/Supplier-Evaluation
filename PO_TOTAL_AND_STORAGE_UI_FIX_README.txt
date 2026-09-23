PURCHASING SUPPLIER EVALUATION — PO TOTAL + PO STORAGE UI FIX

Files in this package are direct replacements. No git apply and no PowerShell patch script are required.

Replace these files in your project:

app/globals.css
app/email-directory/page.tsx (optional UI copy from previous V3; safe to replace)
components/AdvancedDashboard.tsx
components/AdvancedReports.tsx
components/PurchaseOrderGenerator.tsx

What this version fixes:
- Dashboard Total PO Value reads saved official-PO pricing from Firestore when a matching PO number exists.
- Reports Total PO Spend, spending charts, and PO Value vs Score use the saved official-PO amount as the preferred source.
- Official PO upload already extracts pricing through Gemini; this version connects that saved amount to analytics.
- PO Storage & Evaluation page heading and workflow headings are normalized and numbered 1–5.
- Reduced excessive spacing and made the evaluator/send panel typography consistent with the rest of the SISC design.
- No changes to your Google Sheet structure are required for pricing.

After copying, run:

npm.cmd run build

After a successful build:

git add .
git commit -m "Connect official PO pricing and polish PO storage UI"
git push origin main
