V7 SOURCE-SEPARATION + BUILD FIX

Replace exactly:
  components/PurchaseOrderGenerator.tsx
  lib/requisitioner-directory.ts

Source rules after this patch:
1. Purchasing / Buyer email -> existing Employee/evaluator directory.
2. Requisitioner email -> pasted possible-requisitioner directory (901 entries), with live sheet data able to add names not already listed.
3. AMD / Received by email -> existing Employee/evaluator directory, filtered to amd_personnel.
4. AMD name autocomplete no longer searches the possible-requisitioner list.
5. The three evaluation links/emails remain separate by evaluator role.

The build error in lib/requisitioner-directory.ts is fixed by narrowing db before using doc(), collection(), and writeBatch().

After copying, run:
  npm.cmd run build

Only push after the build passes.
