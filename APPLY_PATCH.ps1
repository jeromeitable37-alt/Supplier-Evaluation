$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$pagePath = Join-Path $root "app\page.tsx"
$routePath = Join-Path $root "app\api\evaluation\dispatch\route.ts"
$patchRoute = Join-Path $root "PATCH_FILES\app\api\evaluation\dispatch\route.ts"
if (!(Test-Path $pagePath)) { throw "Run this from your Purchasing-management-system project root. Missing app\page.tsx" }
if (!(Test-Path $patchRoute)) { throw "Missing PATCH_FILES\app\api\evaluation\dispatch\route.ts" }
$backup = Join-Path $root (".backup-purchasing-email-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item $pagePath (Join-Path $backup "page.tsx")
if (Test-Path $routePath) { Copy-Item $routePath (Join-Path $backup "dispatch-route.ts") }
Copy-Item $patchRoute $routePath -Force
$page = Get-Content -Raw -Encoding UTF8 $pagePath
$page = [regex]::Replace($page, 'incoming\.forEach\(item => byId\.set\(item\.id, \{ \Q...byId.get(item)\E, \Q...item\E \}\)\);', 'incoming.forEach(item => byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item }));', 1)
$newBlock = @'
  async function dispatchEvaluation(order: PurchaseOrder) {
    const targets = [
      {
        role: "purchaser",
        name: String(order.buyerName || order.preparedBy || "").trim(),
        email: String(
          order.buyerName
            ? buyers.find((buyer) => String(buyer.name || "").trim().toLowerCase() === String(order.buyerName || "").trim().toLowerCase())?.email || ""
            : ""
        ).trim(),
      },
      {
        role: "requisitioner",
        name: String(order.requisitioner || "").trim(),
        email: String(
          order.requisitionerEmail ||
          employees.find((employee) => String(employee.name || "").trim().toLowerCase() === String(order.requisitioner || "").trim().toLowerCase())?.email || ""
        ).trim(),
      },
      {
        role: "amd",
        name: String(order.receivedBy || "").trim(),
        email: String(
          String(order.receivedBy || "").includes("@")
            ? order.receivedBy
            : employees.find((employee) => String(employee.name || "").trim().toLowerCase() === String(order.receivedBy || "").trim().toLowerCase())?.email || ""
        ).trim(),
      },
    ].filter((target) => target.name || target.email);

    if (!targets.length) {
      onError("PO saved, but no Purchasing, Requisitioner, or AMD evaluator is assigned.");
      return;
    }

    setSendingEval(order.id);
    try {
      const results = await Promise.allSettled(
        targets.map(async (target) => {
          const response = await fetch("/api/evaluation/dispatch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: target.email,
              poNumber: order.poNumber,
              prfNo: order.prfNo,
              vendorName: order.vendorName,
              evaluatorName: target.name,
              evaluatorRole: target.role,
              expectedDeliveryDate: order.expectedDate,
              actualDeliveryDate: order.actualDeliveryDate,
              totalAmount: order.total,
            }),
          });
          const result = await response.json();
          if (!response.ok || !result?.ok) throw new Error(result?.message || `Could not send ${target.role} evaluation.`);
          return { target, result };
        })
      );

      const sent = results.filter((item) => item.status === "fulfilled" && item.value.result?.sent);
      const failed = results.filter((item) => item.status === "rejected");

      if (failed.length) {
        const details = failed.map((item) => item.status === "rejected" ? item.reason?.message || "Unknown email error" : "").filter(Boolean).join(" | ");
        onError(sent.length ? `${sent.length} evaluation email(s) sent. Some failed: ${details}` : `Evaluation emails were not sent: ${details}`);
        return;
      }

      if (sent.length) {
        onError(`Evaluation emails sent for ${sent.map((item) => item.status === "fulfilled" ? `${item.value.result.evaluatorName || item.value.target.name}` : "").filter(Boolean).join(", ")}.`);
      } else {
        onError("Evaluation records were created, but Google Apps Script email sending is not configured yet.");
      }
    } catch (error: any) {
      onError(error?.message || "Could not send supplier evaluations.");
    } finally {
      setSendingEval(null);
    }
  }

  async function save() {
'@
$pattern = '(?s)  async function dispatchEvaluation\(order: PurchaseOrder\) \{.*?\r?\n  \}\r?\n\r?\n  async function save\(\) \{'
if ($page -notmatch $pattern) { throw "Could not find OrdersPage dispatchEvaluation block. No app/page.tsx change was made." }
$page = [regex]::Replace($page, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newBlock }, 1)
Set-Content -Path $pagePath -Value $page -Encoding UTF8
Write-Host "Patch applied. Backup: $backup" -ForegroundColor Green
Write-Host "Next: npm run build" -ForegroundColor Cyan
