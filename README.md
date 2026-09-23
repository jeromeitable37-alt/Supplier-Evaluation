# Purchasing Supplier Evaluation System — PO Storage Layout Fix V6

This patch is UI-only for the PO Storage & Evaluation modal.

## Included files
- `components/PurchaseOrderGenerator.tsx`
- `app/globals.css`

## Changes
- Larger and clearer Transaction Identifier / PO-PRF heading hierarchy.
- Larger workflow titles and readable workflow description text.
- Cleaner spacing between workflow sections.
- Wider right-side workflow panel on desktop.
- Delivery summary redesigned into consistent cards.
- PO pricing table given fixed minimum width and stronger cell spacing so headers do not run together.
- Pricing inputs standardized to the same control height and typography.
- Pricing totals, source text, email hints, buttons, warning notes, evaluation links, and final explanation are all scaled to match the main SISC UI.
- Responsive behavior preserved for tablet/mobile.

No data logic, Firebase, Cloudinary, Gemini, Google Sheets, email, or evaluation workflow logic was changed.
