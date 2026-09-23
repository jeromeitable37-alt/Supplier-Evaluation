# Email Directory / Requisitioner Fix V7

This patch fixes the current TypeScript error caused by passing nullable `db`
directly into `doc(...)` inside the requisitioner directory seeder.

It also replaces the short requisitioner seed with the full `Requisitioner Details`
directory from the supplied Purchasing Supplier Evaluation workbook.

Included:
- `lib/requisitioner-directory.ts`
- 901 possible requisitioner contacts
- search/find helpers
- safe optional Firestore seeder using `requireDb(db)`
- Purchasing / Buyer and AMD / Received by are NOT mixed into this list

Expected workflow:
- Purchasing / Buyer email -> existing evaluator / Employee directory
- Requisitioner email -> this full possible-requisitioner directory (plus live sheet data)
- AMD / Received by email -> existing evaluator / Employee directory

Copy `lib/requisitioner-directory.ts` into your project, replacing the current
file with the same name.

Then run:
    npm.cmd run build

Do not push until the build passes.
