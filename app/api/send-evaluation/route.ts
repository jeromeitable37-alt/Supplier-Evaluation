import { NextResponse } from "next/server";

const DEFAULT_SHEET_ID = "1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA";
const DEFAULT_EMPLOYEE_SHEET = "Employee";
const DEFAULT_REQUISITIONER_SHEET = "Requisitioner Details";

type CsvRow = Record<string, string>;

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
    if (ch === "," && !quoted) { row.push(cell); cell = ""; continue; }
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

async function resolveRequisitionerEmail(name: string, fallback?: string) {
  const clean = String(name || "").trim().toLowerCase();
  if (!clean) return String(fallback || "").trim().toLowerCase();
  try {
    const rows = await fetchEmployees();
    const exact = rows.find((row) => {
      const rowName = pick(row, ["f_name", "full_name", "name", "employee name", "requisitioner", "requisitioner name"]).trim().toLowerCase();
      return rowName === clean;
    });
    const email = exact ? pick(exact, ["email", "employee email", "requisitioner email"]).trim().toLowerCase() : "";
    if (email.includes("@")) return email;
  } catch {}
  return String(fallback || "").trim().toLowerCase();
}

function safeFilename(name: string, fallback: string) {
  return String(name || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-160) || fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, po, evaluationUrl, poDocumentUrl, poDocumentName, poDocuments, requisitionerName, requisitionerEmail, workspace } = body || {};
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) return NextResponse.json({ ok: false, configured: false, message: "RESEND_API_KEY and RESEND_FROM_EMAIL are not configured." }, { status: 503 });
    if (!evaluationUrl || !po?.poNumber) return NextResponse.json({ ok: false, message: "Missing evaluation details." }, { status: 400 });

    const resolvedTo = await resolveRequisitionerEmail(requisitionerName || name || po.requisitioner, requisitionerEmail || po.requisitionerEmail || "");
    if (!resolvedTo || !resolvedTo.includes("@")) {
      return NextResponse.json({ ok: false, message: `No email was found for requisitioner “${requisitionerName || name || po.requisitioner || ""}”. Check the Employee or Requisitioner Details sheet.`, emailResolved: false }, { status: 400 });
    }

    const docs = Array.isArray(poDocuments) && poDocuments.length
      ? poDocuments
      : (poDocumentUrl ? [{ url: poDocumentUrl, name: poDocumentName || `${po.poNumber}.pdf`, mimeType: po.documentMimeType }] : []);
    if (!docs.length) return NextResponse.json({ ok: false, message: "Store the official PO document before sending." }, { status: 400 });

    const attachments = docs.filter((doc: any) => doc?.url).map((doc: any) => ({
      path: String(doc.url),
      filename: safeFilename(String(doc.name || `${po.poNumber}.pdf`), `${po.poNumber}.pdf`),
    }));
    if (!attachments.length) return NextResponse.json({ ok: false, message: "The stored PO document could not be attached." }, { status: 400 });

    const safeName = String(name || po.requisitioner || "Requisitioner").replace(/[<>]/g, "");
    const subject = `[${workspace?.name || "SISC"}] Supplier Evaluation Request — ${po.poNumber}`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:700px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#4f247c;padding:22px 26px;color:#fff"><div style="font-size:11px;opacity:.78;text-transform:uppercase;letter-spacing:1px">${workspace?.name || "Southville International School and Colleges"}</div><div style="font-size:22px;font-weight:700;margin-top:5px">Supplier Evaluation Request</div><div style="font-size:12px;opacity:.75;margin-top:3px">PO ${po.poNumber} · ${po.vendorName || "Supplier"}</div></div><div style="padding:26px"><p style="margin:0 0 14px">Hello <strong>${safeName}</strong>,</p><p style="line-height:1.6;margin:0 0 18px">Please review the attached official Purchase Order and complete the supplier evaluation for this transaction. The attachment is the same official PO stored by the Purchasing Office.</p><table style="width:100%;border-collapse:collapse;margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px"><tr><td style="padding:9px 12px;font-weight:700">PO Number</td><td style="padding:9px 12px">${po.poNumber}</td></tr><tr><td style="padding:9px 12px;font-weight:700">PRF No.</td><td style="padding:9px 12px">${po.prfNumber || "—"}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Supplier</td><td style="padding:9px 12px">${po.vendorName || "—"}</td></tr><tr><td style="padding:9px 12px;font-weight:700">Delivery Date</td><td style="padding:9px 12px">${po.expectedDate || "—"}</td></tr><tr><td style="padding:9px 12px;font-weight:700">PO Status</td><td style="padding:9px 12px">${po.status || "Pending"}</td></tr></table><div style="text-align:center;margin:26px 0"><a href="${evaluationUrl}" style="display:inline-block;background:#2a895b;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:700">Open PO & Complete Evaluation</a></div><p style="font-size:12px;color:#6b7280;line-height:1.55;margin:0">The evaluation includes the delivery/quality, price, timeliness, and after-sales criteria used by the current supplier-evaluation workflow. Your unique link can be submitted once.</p></div></div></body></html>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [resolvedTo], subject, html, attachments }),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ ok: false, configured: true, message: data?.message || "Email provider rejected the request." }, { status: response.status });
    return NextResponse.json({ ok: true, id: data?.id || "", attached: true, recipient: resolvedTo, attachmentCount: attachments.length, emailResolved: true });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Unable to send evaluation email." }, { status: 500 });
  }
}
