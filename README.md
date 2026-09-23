# Requisitioner Directory + Email Routing Fix

This patch adds the full possible-requisitioner directory from the supplied
`Requisitioner Details` sheet and fixes the nullable Firestore `db` TypeScript
error.

Imported records: 901

Important source separation:
- Purchasing / Buyer: keep using the existing Buyer / evaluator contacts.
- AMD / Received by: keep using the existing Employee / AMD contacts already maintained in the system.
- Requisitioner: use this full possible-requisitioner directory as a fallback.

Files:
- lib/requisitioner-directory-data.ts
- lib/requisitioner-directory.ts
- components/PurchaseOrderGenerator.tsx
- app/email-directory/page.tsx
- app/globals.css

The Email Directory page now has a read-only "Possible Requisitioners" section
showing the full imported list. The PO Storage requisitioner picker also uses
this directory, so a requisitioner can be found even when the live API/PO record
does not already contain the email.

The send flow still resolves the three evaluator roles separately:
1. Purchasing / Buyer -> existing purchaser directory / buyer data
2. Requisitioner -> this possible-requisitioner directory
3. AMD / Received by -> existing AMD / Employee directory

Do not run `git init`.

After copying the files:
    npm.cmd run build

Only commit after the build passes.
