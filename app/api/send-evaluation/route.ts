import { NextResponse } from "next/server";
import { buildSupplierEvaluationEmail } from "../../../lib/evaluationEmailTemplate";

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

function roleLabel(role: EvaluationRole) {
  if (role === "purchaser") return "Purchasing / Buyer Evaluation";
  if (role === "amd_personnel") return "AMD Personnel Evaluation";
  return "Requisitioner Evaluation";
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

    const { subject, html, text } = buildSupplierEvaluationEmail({
      recipientName: targetName || (role === "purchaser" ? "Purchasing / Buyer" : role === "amd_personnel" ? "AMD Personnel" : "Requisitioner"),
      roleLabel: roleLabel(role),
      poNumber: String(po.poNumber),
      supplierName: String(po.vendorName || ""),
      evaluationUrl: String(evaluationUrl),
      schoolName: String(workspace?.name || "Southville International School and Colleges"),
    });

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
