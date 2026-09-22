import { NextResponse } from "next/server";

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

function safeFilename(name: string, fallback: string) {
  return String(name || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-160) || fallback;
}

function safeText(value: unknown) {
  return String(value ?? "").replace(/[<>]/g, "");
}

function roleLabel(role: EvaluationRole) {
  if (role === "purchaser") return "Purchasing / Buyer Evaluation";
  if (role === "amd_personnel") return "AMD Personnel Evaluation";
  return "Requisitioner Evaluation";
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
  attachments: Array<{ url: string; name: string; mimeType?: string }>;
}) {
  const url = String(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL || "").trim();
  const secret = String(process.env.GOOGLE_APPS_SCRIPT_SECRET || "").trim();
  if (!url || !secret) {
    throw new Error("Google Apps Script email is not configured. Add GOOGLE_APPS_SCRIPT_EMAIL_URL and GOOGLE_APPS_SCRIPT_SECRET in Vercel.");
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
      senderName: "Purchasing Management System",
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
  try {
    const body = await request.json();
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
    const attachments = docs.filter((doc: any) => doc?.url).map((doc: any) => ({
      url: String(doc.url),
      name: safeFilename(String(doc.name || `${po.poNumber}.pdf`), `${po.poNumber}.pdf`),
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
    const subject = `[${workspace?.name || "SISC"}] ${label} Request — ${po.poNumber}`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:700px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#4f247c;padding:22px 26px;color:#fff"><div style="font-size:11px;opacity:.78;text-transform:uppercase;letter-spacing:1px">${safeText(workspace?.name || "Southville International School and Colleges")}</div><div style="font-size:22px;font-weight:700;margin-top:5px">${label}</div><div style="font-size:12px;opacity:.75;margin-top:3px">PO ${safeText(po.poNumber)} · ${safeText(po.vendorName || "Supplier")}</div></div><div style="padding:26px"><p style="margin:0 0 14px">Hello <strong>${displayName}</strong>,</p><p style="line-height:1.6;margin:0 0 18px">Please review the attached official Purchase Order and complete your ${bodyLabel} supplier evaluation for this transaction. The attachment is the same official PO stored by the Purchasing Office.</p><table style="width:100%;border-collapse:collapse;margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb"><tr><td style="padding:9px 12px;font-weight:700">PO Number</td><td style="padding:9px 12px">${safeText(po.poNumber)}</td></tr><tr><td style="padding:9px 12px;font-weight:700">PRF No.</td><td style="padding:9px 12px">${safeText(po.prfNumber || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Supplier</td><td style="padding:9px 12px">${safeText(po.vendorName || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Delivery Date</td><td style="padding:9px 12px">${safeText(po.expectedDate || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Received by</td><td style="padding:9px 12px">${safeText(po.receivedBy || "—")}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Delivery lead time</td><td style="padding:9px 12px">${safeText(leadTimeText)}</td></tr></table><div style="text-align:center;margin:26px 0"><a href="${String(evaluationUrl).replace(/"/g, '&quot;')}" style="display:inline-block;background:#2a895b;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:700">Open PO &amp; Complete Evaluation</a></div><p style="font-size:12px;color:#6b7280;line-height:1.55;margin:0">${role === "purchaser" ? "Purchasing / Buyer evaluations include the additional compliance criterion." : "This evaluation uses the four delivery/quality, price, timeliness, and after-sales criteria."} The unique link can be submitted once.</p></div></div></body></html>`;
    const text = `Please complete your ${bodyLabel} supplier evaluation for PO ${po.poNumber}.\n\nOpen evaluation: ${evaluationUrl}`;

    const sent = await sendViaAppsScript({ to: resolvedTo, subject, html, text, attachments });
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
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Unable to send evaluation email." }, { status: 500 });
  }
}
