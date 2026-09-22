PURCHASING SUPPLIER EVALUATION SYSTEM — ALL PRF SEARCH FIX

Problem fixed:
The V2 monitoring sheet contains more PRF records than the PO-for-Evaluation groups. Previously, PO Storage searched only poRecords, so valid PRFs such as 106629 could exist in the V2 sheet but return 0 results in the system.

This patch keeps the existing Google Sheet connection and workflow, but makes the PO Storage search also search every PRF record loaded from V2.

Behavior:
- Search matches PO number, PRF, supplier, requisitioner, item, and department as before.
- Search also checks every V2 PRF record's PRF number, requisitioner, email, department, item description, and purpose.
- Matching PRFs appear in a separate "V2 PRF MONITORING RECORDS" section.
- When a PRF has a matching PO group, "Open PO" opens the existing PO workflow.
- When no PO group exists yet, the PRF is still shown with a clear "PRF only · no PO group yet" status. No fake PO number or supplier data is created.
- The existing queue behavior and PO/evaluation workflow are preserved.

Installation:
1. Extract this ZIP into:
   C:\Users\Itabl\Downloads\supplier-evaluation-pro-final\final_work
2. Overwrite:
   components\PurchaseOrderGenerator.tsx
3. Run:
   npm.cmd run build
4. After build succeeds:
   git add .
   git commit -m "Fix PRF search across V2 monitoring records"
   git push origin main
