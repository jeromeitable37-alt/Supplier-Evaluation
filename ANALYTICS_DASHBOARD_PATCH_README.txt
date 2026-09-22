PURCHASING SUPPLIER EVALUATION SYSTEM
ADVANCED DASHBOARD + REPORTS / RATINGS PATCH

Basis:
- Reimplements the analytics/reporting areas present in the supplied Apps Script.
- Keeps the current Next.js/Firebase/Google Sheets architecture.
- Does not require new ENV variables.

Added/expanded:
Dashboard
- Total POs
- Total PO value
- Vendors
- Pending POs
- Delivered POs
- Overdue POs
- Recent PO activity
- Recent supplier evaluation activity
- Monthly average evaluation chart
- Live Google Sheet refresh every 60 seconds

Reports & Ratings
- Academic Year filter (July 1–June 30), current + 4 prior AYs
- Supplier scorecard by Accuracy, Price, Timeliness, After Sales, Compliance, Overall
- Supplier score trend by AY
- Current AY vs previous AY comparison
- Criteria performance section
- Recommendation distribution
- Evaluator participation: sent vs submitted by Purchasing/Buyer, Requisitioner, AMD
- Completion rate by supplier
- PO spending overview (monthly or AY)
- PO volume trend (monthly or AY)
- Order status breakdown: Pending / Partial Delivery / Delivered
- Overdue analysis with average days overdue and severity
- Delivery lead time with speed indicator
- PO value vs supplier score visualization
- AY summary table

Data behavior:
- Evaluation analytics use submitted/rated Firebase records.
- PO analytics use live Google Sheet data returned by /api/po-lookup.
- No static/mock analytics values are introduced.
- Missing values remain blank/— instead of being guessed.

Apply:
1. Extract this patch into the existing final_work folder.
2. Overwrite the included app/page.tsx and app/globals.css.
3. Copy the two new components into components/.
4. Run: npm.cmd run build
5. After a successful build, commit and push to main.

No new ENV variables are required.
