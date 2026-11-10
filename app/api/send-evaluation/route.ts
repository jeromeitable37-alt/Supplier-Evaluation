import { NextResponse } from "next/server";
import { appSession, requirePermission, appPool, AppAccessError } from "../../../lib/server/neonAppAuth";
import { officialPoAttachmentName } from "../../../lib/poAttachmentName";

const DEFAULT_SHEET_ID = "1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA";
const DEFAULT_EMPLOYEE_SHEET = "Employee";
const DEFAULT_REQUISITIONER_SHEET = "Requisitioner Details";

type CsvRow = Record<string, string>;
type EvaluationRole = "requisitioner" | "amd_personnel" | "purchaser";

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { row.push(cell); cell = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some((x) => x.trim())) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
}

function pick(row: CsvRow, names: string[]) {
  for (const name of names) {
    const key = name.toLowerCase();
    if (row[key]) return row[key];
  }
  return "";
}

async function fetchSheet(sheetId: string, sheetName: string, directUrl?: string): Promise<CsvRow[]> {
  const url = directUrl || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return [];
  const text = await response.text();
  if (/^\s*<(!doctype|html|head|body)/i.test(text)) return [];
  return parseCsv(text);
}

async function fetchEmployees(): Promise<CsvRow[]> {
  const sheetId = process.env.GOOGLE_SUPPLIER_SHEET_ID || DEFAULT_SHEET_ID;
  const employeeSheet = process.env.GOOGLE_SUPPLIER_EMPLOYEE_SHEET || DEFAULT_EMPLOYEE_SHEET;
  const requisitionerSheet = process.env.GOOGLE_SUPPLIER_REQUISITIONER_SHEET || DEFAULT_REQUISITIONER_SHEET;
  const directUrl = process.env.GOOGLE_SUPPLIER_EMPLOYEE_CSV_URL;
  const [employeeRows, requisitionerRows] = await Promise.all([
    fetchSheet(sheetId, employeeSheet, directUrl).catch(() => []),
    fetchSheet(sheetId, requisitionerSheet).catch(() => []),
  ]);
  return [...employeeRows, ...requisitionerRows];
}

function normalizeName(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function resolveEmployeeEmail(name: string, fallback?: string) {
  const clean = normalizeName(name);
  const supplied = String(fallback || "").trim().toLowerCase();
  if (supplied.includes("@")) return supplied;
  if (!clean) return supplied;
  try {
    const rows = await fetchEmployees();
    const exact = rows.find((row) => {
      const rowName = pick(row, ["f_name", "full_name", "name", "employee name", "requisitioner", "requisitioner name", "received by", "buyer", "buyer name"]).trim();
      return normalizeName(rowName) === clean;
    });
    const resolved = exact ? pick(exact, ["email", "employee email", "requisitioner email", "work email", "email address", "buyer email"]).trim().toLowerCase() : "";
    if (resolved.includes("@")) return resolved;
  } catch {}
  return supplied;
}

function roleLabel(role: EvaluationRole) {
  if (role === "purchaser") return "Purchasing / Buyer Evaluation";
  if (role === "amd_personnel") return "AMD Personnel Evaluation";
  return "Requisitioner Evaluation";
}

function safeText(value: unknown) {
  return String(value ?? "").replace(/[<>]/g, "");
}

function roleBody(role: EvaluationRole) {
  if (role === "purchaser") return "purchasing / buyer";
  if (role === "amd_personnel") return "AMD personnel";
  return "requisitioner";
}

async function sendViaAppsScript(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: Array<{ url?: string; fileId?: string; name: string; mimeType?: string }>;
}) {
  const url = String(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL || "").trim();
  const secret = String(process.env.PMS_WEBHOOK_SECRET || process.env.GOOGLE_APPS_SCRIPT_SECRET || "").trim();
  if (!url || !secret) {
    throw new Error("Google Apps Script email is not configured. Add GOOGLE_APPS_SCRIPT_EMAIL_URL and PMS_WEBHOOK_SECRET in Vercel.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      secret,
      to: input.to,
      subject: input.subject,
      htmlBody: input.html,
      textBody: input.text,
      senderName: "Southville Supplier Evaluation",
      attachments: input.attachments,
    }),
  });

  const raw = await response.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch {}
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `Google Apps Script returned ${response.status}.`);
  }
  return data;
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_DATA_BACKEND === "neon" &&
      process.env.NEON_PREVIEW_EXTERNAL_WRITES_ENABLED !== "true") {
    return NextResponse.json({ok:false,message:"School email delivery is disabled in Neon Preview until an approved test is configured."},{status:503});
  }
  let claimedToken = "";
  try {
    let body = await request.json();
    if (process.env.NEXT_PUBLIC_DATA_BACKEND === "neon") {
      const session = await appSession(request);
      requirePermission(session,"create_evaluations");
      const submittedUrl = String(body?.evaluationUrl || "");
      let parsed: URL;
      try { parsed = new URL(submittedUrl); }
      catch { throw new AppAccessError("Invalid evaluation link.",400); }
      const requestUrl=new URL(request.url);
      if(parsed.protocol!=="https:"||parsed.host!==requestUrl.host ||
        !/^\/evaluate\/[a-zA-Z0-9]{10,40}$/.test(parsed.pathname)) {
        throw new AppAccessError("Evaluation link must belong to this system.",403);
      }
      const token=parsed.pathname.split("/").pop() || "";
      const found=await appPool().query("SELECT payload FROM se_evaluation_links WHERE token=$1",[token]);
      const link=found.rows[0]?.payload as Record<string,any>|undefined;
      if(!link||link.status!=="pending"||!link.po?.poNumber||!link.evaluatorEmail){
        throw new AppAccessError("The evaluation link is unavailable or already completed.",409);
      }
      const expiry=typeof link.expiresAt==="string"?Date.parse(link.expiresAt):NaN;
      if(Number.isFinite(expiry)&&expiry<=Date.now())throw new AppAccessError(
        "This evaluation link has expired. Create a new link after authorization.",410);

      // Disallow changing recipient, document URLs, PO metadata and link role
      // through an untrusted browser request. Reconstruct from trusted SQL.
      // Atomic per-link email claim: no concurrent or rapid repeat sends.
      // One resend is allowed after the ten-minute cooldown.
      const now=new Date();
      const expiredSending=new Date(now.getTime()-2*60*1000).toISOString();
      const cooldown=new Date(now.getTime()-10*60*1000).toISOString();
      const sending=await appPool().query(
        "UPDATE se_evaluation_links SET payload=payload || $2::jsonb,imported_at=now() "+
        "WHERE token=$1 AND link_status='pending' AND "+
        "(COALESCE(payload->>'emailSendStatus','') <> 'sending' "+
        "OR COALESCE(payload->>'emailSendingStartedAt','') < $3) AND "+
        "(COALESCE(payload->>'lastEmailSentAt','') < $4) RETURNING token",
        [token,JSON.stringify({emailSendStatus:"sending",emailSendingStartedAt:now.toISOString()}),
         expiredSending,cooldown],
      );
      if(sending.rowCount!==1){
        throw new AppAccessError("Email request is already processing or was sent recently. Please try later.",429);
      }
      claimedToken=token;
      const storedPo=link.po as Record<string,any>;
      body = {
        name:link.evaluatorName||"Evaluator",
        evaluatorRole:link.evaluatorRole||"requisitioner",
        evaluatorName:link.evaluatorName||"Evaluator",
        evaluatorEmail:link.evaluatorEmail,
        requisitionerName:link.requisitionerName,
        requisitionerEmail:link.requisitionerEmail,
        amdName:link.amdName,amdEmail:link.amdEmail,
        po:storedPo,
        poDocumentUrl:storedPo.documentUrl,
        poDocumentName:storedPo.documentName||String(storedPo.poNumber)+".pdf",
        poDocuments:storedPo.documentPages||[{
          url:storedPo.documentUrl,
          fileId:storedPo.documentFileId,
          name:storedPo.documentName||String(storedPo.poNumber)+".pdf",
          mimeType:storedPo.documentMimeType,
        }],
        evaluationUrl:submittedUrl,
        workspace:{name:link.workspaceName||"Southville International School and Colleges"},
      };
    }
    const {
      name,
      po,
      evaluationUrl,
      poDocumentUrl,
      poDocumentName,
      poDocuments,
      evaluatorRole,
      evaluatorName,
      evaluatorEmail,
      requisitionerName,
      requisitionerEmail,
      amdName,
      amdEmail,
      workspace,
    } = body || {};

    const role: EvaluationRole =
      evaluatorRole === "purchaser" || evaluatorRole === "amd_personnel"
        ? evaluatorRole
        : "requisitioner";

    if (!evaluationUrl || !po?.poNumber) {
      return NextResponse.json({ ok: false, message: "Missing evaluation details." }, { status: 400 });
    }

    const targetName = String(
      evaluatorName
      || (role === "purchaser" ? po.buyerName : role === "amd_personnel" ? amdName : requisitionerName)
      || (role === "amd_personnel" ? po.receivedBy : role === "purchaser" ? po.buyerName : po.requisitioner)
      || name
      || "",
    ).trim();

    const directEmail = role === "purchaser"
      ? String(evaluatorEmail || po.buyerEmail || "").trim().toLowerCase()
      : String(evaluatorEmail || (role === "amd_personnel" ? amdEmail : requisitionerEmail) || (role === "amd_personnel" ? "" : po.requisitionerEmail || "")).trim().toLowerCase();

    const resolvedTo = await resolveEmployeeEmail(targetName, directEmail);
    if (!resolvedTo || !resolvedTo.includes("@")) {
      return NextResponse.json({
        ok: false,
        message: `No email was found for ${role === "purchaser" ? "Purchasing / Buyer" : role === "amd_personnel" ? "AMD / Received by" : "requisitioner"} “${targetName}”. Check the Employee sheet or enter a manual email address.`,
        emailResolved: false,
        evaluatorRole: role,
      }, { status: 400 });
    }

    const docs = Array.isArray(poDocuments) && poDocuments.length
      ? poDocuments
      : (poDocumentUrl ? [{ url: poDocumentUrl, name: poDocumentName || `${po.poNumber}.pdf`, mimeType: po.documentMimeType }] : []);
    const attachments = docs.filter((doc: any) => doc?.fileId || doc?.url)
      .map((doc: any, index: number) => ({
      ...(doc?.fileId ? {fileId:String(doc.fileId)} : {url:String(doc.url)}),
      name: officialPoAttachmentName({
        poNumber: po.poNumber, index, originalName: doc.name,
        mimeType: doc.mimeType, url: doc.url,
      }),
      mimeType: doc.mimeType ? String(doc.mimeType) : undefined,
    }));
    if (!attachments.length) {
      return NextResponse.json({ ok: false, message: "Store the official PO document before sending." }, { status: 400 });
    }

    const displayName = safeText(targetName || (role === "purchaser" ? "Purchasing / Buyer" : role === "amd_personnel" ? "AMD Personnel" : "Requisitioner"));
    const label = roleLabel(role);
    const bodyLabel = roleBody(role);
    const leadTimeDays = po.deliveryLeadTimeDays ?? (() => {
      const start = po.orderDate ? new Date(po.orderDate).getTime() : NaN;
      const end = po.actualDeliveryDate ? new Date(po.actualDeliveryDate).getTime() : NaN;
      return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : null;
    })();
    const leadTimeText = leadTimeDays === null || leadTimeDays === undefined ? "—" : `${leadTimeDays} day${leadTimeDays === 1 ? "" : "s"}`;
    const subject = `Supplier Evaluation Request | PO ${String(po.poNumber).replace(/[\r\n]/g, " ")} | ${label.replace(" Evaluation", "")}`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:700px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#4f247c;padding:22px 26px;color:#fff"><div style="font-size:11px;opacity:.78;text-transform:uppercase;letter-spacing:1px">${safeText(workspace?.name || "Southville International School and Colleges")}</div><div style="font-size:22px;font-weight:700;margin-top:5px">${label}</div><div style="font-size:12px;opacity:.75;margin-top:3px">PO ${safeText(po.poNumber)} · ${safeText(po.vendorName || "Supplier")}</div></div><div style="padding:26px"><p style="margin:0 0 14px">Hello <strong>${displayName}</strong>,</p><p style="line-height:1.6;margin:0 0 18px">Please review the attached official Purchase Order and complete your ${bodyLabel} supplier evaluation for this transaction. The attachment is the same official PO stored by the Purchasing Office.</p><table style="width:100%;border-collapse:collapse;margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb"><tr><td style="padding:9px 12px;font-weight:700">PO Number</td><td style="padding:9px 12px">${safeText(po.poNumber)}</td></tr><tr><td style="padding:9px 12px;font-weight:700">PRF No.</td><td style="padding:9px 12px">${safeText(po.prfNumber || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Supplier</td><td style="padding:9px 12px">${safeText(po.vendorName || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Delivery Date</td><td style="padding:9px 12px">${safeText(po.expectedDate || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Received by</td><td style="padding:9px 12px">${safeText(po.receivedBy || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Delivery lead time</td><td style="padding:9px 12px">${safeText(leadTimeText)}</td></tr></table><div style="text-align:center;margin:26px 0"><a href="${String(evaluationUrl).replace(/"/g, '&quot;')}" style="display:inline-block;background:#2a895b;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:700">Open PO &amp; Complete Evaluation</a></div><p style="font-size:12px;color:#6b7280;line-height:1.55;margin:0">${role === "purchaser" ? "Purchasing / Buyer evaluations include the additional compliance criterion." : "This evaluation uses the four delivery/quality, price, timeliness, and after-sales criteria."} The unique link can be submitted once.</p></div></div></body></html>`;
    const text = [
      `Hello ${targetName || "Evaluator"},`,
      `Please review the attached official Purchase Order and complete your ${bodyLabel} supplier evaluation for this transaction.`,
      `PO Number: ${po.poNumber}`,
      `PRF No.: ${po.prfNumber || "—"}`,
      `Supplier: ${po.vendorName || "—"}`,
      `Delivery Date: ${po.expectedDate || "—"}`,
      `Received by: ${po.receivedBy || "—"}`,
      `Delivery lead time: ${leadTimeText}`,
      `Open PO & Complete Evaluation: ${evaluationUrl}`,
      "The official PO is attached. This evaluation link can be submitted once.",
    ].join("\n\n");

    const sent = await sendViaAppsScript({ to: resolvedTo, subject, html, text, attachments });
    if (claimedToken) {
      const now=new Date().toISOString();
      await appPool().query(
        "UPDATE se_evaluation_links SET payload=payload || $2::jsonb || "+
        "CASE WHEN COALESCE(payload->>'emailSentAt','')='' "+
        "THEN jsonb_build_object('emailSentAt',$3::text) ELSE '{}'::jsonb END,"+
        "imported_at=now() WHERE token=$1",
        [claimedToken,JSON.stringify({emailSendStatus:"sent",
          lastEmailSentAt:now,lastEmailRecipient:resolvedTo}),now],
      );
    }
    return NextResponse.json({
      ok: true,
      sent: true,
      attached: true,
      recipient: resolvedTo,
      attachmentCount: attachments.length,
      emailResolved: true,
      evaluatorRole: role,
      provider: "google-apps-script",
      providerMessage: sent?.message || "Email sent through Google Apps Script.",
    });
  } catch (error) {
    if (claimedToken) {
      try {
        await appPool().query(
          "UPDATE se_evaluation_links SET payload=payload || $2::jsonb,imported_at=now() WHERE token=$1",
          [claimedToken,JSON.stringify({emailSendStatus:"failed"})],
        );
      } catch { /* Keep original send error */ }
    }
    const status = error instanceof AppAccessError ? error.status : 502;
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Unable to send evaluation email." }, { status });
  }
}
