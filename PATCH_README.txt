PURCHASING SUPPLIER EVALUATION SYSTEM — COMPLETE WORKFLOW FIX

This patch preserves the existing layout/workflow and adds the missing reusable email and delivery-time behavior.

FILES TO OVERWRITE / ADD
1. components/PurchaseOrderGenerator.tsx
2. lib/firestore.ts
3. app/evaluate/[token]/page.tsx
4. app/api/send-evaluation/route.ts
5. firestore.rules
6. app/email-directory/page.tsx (NEW)

WHAT IS FIXED
• All PRF records from the V2 monitoring source are treated as supplier-evaluation queue records when they do not yet have a matching PO group.
• PRF-only rows are shown in the main For Supplier Evaluation queue, not in a separate PRF-only section.
• Searching checks PO, PRF, supplier, requisitioner, department, purpose, and item/description.
• A PRF without a PO can be opened and the PO number can be typed manually when it becomes available.
• Saved PO records can be recovered by PRF number.
• The queue uses pagination so thousands of V2 PRFs do not render as thousands of DOM rows at once.
• The PO dialog now shows delivery lead time in days, calculated from PO date/order date to actual delivery date, matching the Apps Script analytics concept.
• Timeliness of Delivery remains an evaluation criterion.
• Delivery lead time is copied into the public evaluation record and displayed in evaluator emails.
• Purchasing / Buyer, Requisitioner, and AMD / Received by emails can be saved once in the new Email Directory.
• Spreadsheet emails remain the preferred source when present; Email Directory is the reusable fallback.
• Manual email addresses entered in PO Storage are remembered automatically when the PO is saved, links are created, or an evaluation email is sent.
• The Email Directory supports one contact for one or multiple evaluator roles.
• Public evaluation submissions are permitted for purchaser, requisitioner, and AMD roles, each with the correct criteria count.
• Purchasing uses 5 criteria including Compliance; Requisitioner and AMD use the 4 delivery/quality, price, timeliness, and after-sales criteria.
• The existing Google Apps Script mailer remains the email provider. No new mail service is required.

ENVIRONMENT VARIABLES
NO ENVIRONMENT VARIABLE CHANGES ARE REQUIRED FOR THIS PATCH.
Keep the current Google Sheets, V2 sheet, Cloudinary, Google Apps Script mailer, Firebase, and app URL variables already configured in the project.

APPLY
1. Extract this ZIP into:
   C:\Users\Itabl\Downloads\supplier-evaluation-pro-final\final_work
2. Overwrite the existing files and add the new app/email-directory/page.tsx file.
3. Make sure the old PATCH_FILES folder is NOT present in the project.
4. Run:
   npm.cmd run build
5. If the build succeeds:
   git add .
   git commit -m "Complete PRF queue email directory and delivery workflow"
   git push origin main

FIRESTORE RULES
The patch includes updated firestore.rules. Vercel deployment does not automatically deploy Firestore rules unless your deployment pipeline explicitly does so.
From the project directory, deploy the rules with your existing Firebase CLI setup, for example:
   firebase deploy --only firestore:rules

The new collection is:
   evaluationContacts

The collection is restricted to signed-in staff/admin users who have create_evaluations or edit_evaluations permission.

TEST CASES
A. Search 106629 in PO Storage → For Supplier Evaluation. It should appear directly in the main queue even when there is no matching PO group.
B. Open the PRF-only row. The PO Number field is editable and can be typed manually.
C. Enter evaluator names/emails and save the PO. The emails should appear in Email Directory and be reused on the next matching transaction.
D. Create/send evaluation links for Purchasing / Buyer, Requisitioner, and AMD. Each gets its own one-time link and the official Cloudinary PO attachment.
E. Public evaluation: Purchasing shows 5 criteria; Requisitioner and AMD show 4.
F. When an actual delivery date exists, Delivery lead time appears in the workflow/public evaluation and is stored with the evaluation.
