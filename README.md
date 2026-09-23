# Purchasing Supplier Evaluation — V8 Email Directory Source Fix

This patch combines the V6 PO Storage layout fix with the Email Directory synchronization/source behavior requested.

## What changed
- PO Storage automatically imports the full contact list returned by the configured Employee / Requisitioner Google Sheet into the existing Firestore Email Directory once per page load.
- Imported contacts are stored as reusable evaluator contacts for Purchasing / Buyer, Requisitioner, and AMD / Received by lookup.
- During evaluation-link creation and email sending, the system uses the Email Directory as the evaluator-email source.
- If a user manually types an email, the system saves that address into the Email Directory first, then resolves the address from the directory before creating the link or sending the email.
- Existing PO, Gemini extraction, Cloudinary document, evaluation-link, and email-send functionality is preserved.
- The visible evaluator-email labels now say "from Email Directory".

## Files
- `components/PurchaseOrderGenerator.tsx`
- `app/globals.css` (included from V6 so this patch can replace the prior V6 folder safely)

## Source-list note
The directory is populated from the same configured Employee / Requisitioner source that the current system already uses. This avoids creating a second hardcoded copy of the employee list and lets future spreadsheet additions flow into the system.
