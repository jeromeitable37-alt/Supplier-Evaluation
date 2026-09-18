import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CsvRow = Record<string, string>;

type RequisitionerContact = { name: string; email: string; department: string };

type PurchaseOrderMatch = {
  poNumber: string;
  prfNumber: string;
  itemsDelivered: string;
  supplier: string;
  deliveryAddress: string;
  expectedDate: string;
  orderDate: string;
  paymentTerms: string;
  attention: string;
  vendorPhone: string;
  vendorEmail: string;
  vendorAddress: string;
  vendorCity: string;
  notes: string;
  buyerName: string;
  buyerEmail: string;
  requisitioner: string;
  requisitionerEmail: string;
  department: string;
  purpose: string;
  quantity: number | string;
  unit: string;
  unitPrice: number | string;
  lineTotal: number | string;
  itemDiscountPct: number | string;
};

type PurchaseOrderRecord = { poNumber: string; matches: PurchaseOrderMatch[] };
type PrfRecord = { prfNumber: string; requisitioner: string; requisitionerEmail: string; department: string; itemDescription: string; purpose: string };

const DEFAULT_SHEET_ID = "1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA";
const DEFAULT_PO_SHEET = "PO for Evaluation";
const DEFAULT_PRF_SHEET = "PRF Details v2";
const DEFAULT_EMPLOYEE_SHEET = "Employee";

function normalize(value: unknown) { return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function clean(value: unknown) { return String(value ?? "").replace(/\u0000/g, "").trim(); }
function numberish(value: unknown): number | string {
  const text = clean(value).replace(/₱|Php|PHP|,/g, "");
  if (!text) return "";
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  row.push(cell);
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function toObjects(csv: string): CsvRow[] {
  const rows = parseCsv(csv);
  const headers = (rows.shift() || []).map(clean);
  return rows.filter((row) => row.some((cell) => clean(cell))).map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? "")])));
}
function normalizeHeader(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function pick(row: CsvRow, candidates: string[]) {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const wanted = normalizeHeader(candidate);
    const found = entries.find(([key]) => normalizeHeader(key) === wanted);
    if (found?.[1]) return clean(found[1]);
  }
  return "";
}
function pickNumber(row: CsvRow, candidates: string[]) { return numberish(pick(row, candidates)); }

async function fetchCsv(sheetId: string, sheetName: string, explicitUrl?: string) {
  const url = explicitUrl || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "text/csv,*/*" } });
  const text = await response.text();
  const looksLikeHtml = /^\s*<(!doctype|html|head|body)/i.test(text);
  if (!response.ok || looksLikeHtml) throw new Error(`Google Sheet source unavailable for ${sheetName}. Make the spreadsheet readable by the deployed app or configure a CSV/Apps Script URL.`);
  return toObjects(text);
}

function buildPoRecords(rows: CsvRow[]): PurchaseOrderRecord[] {
  const grouped = new Map<string, PurchaseOrderMatch[]>();
  for (const row of rows) {
    const poNumber = pick(row, ["PO Number", "PO No", "PO #", "Purchase Order", "P.O. Number", "PO"]);
    if (!poNumber) continue;
    const match: PurchaseOrderMatch = {
      poNumber,
      prfNumber: pick(row, ["PRF Number", "PRF No", "PRF #", "PRF", "PRF No."]),
      itemsDelivered: pick(row, ["Items Delivered", "Item/s Delivered", "Items", "Item Description", "Particulars", "Particular"]),
      supplier: pick(row, ["Supplier", "Supplier Name", "Vendor", "Company Name"]),
      deliveryAddress: pick(row, ["Delivery Address", "Delivery To", "Ship To", "Address"]),
      expectedDate: pick(row, ["Delivery Date", "Expected Date", "Expected Delivery", "Delivery"]),
      orderDate: pick(row, ["Date", "Order Date", "PO Date", "Created Date"]),
      paymentTerms: pick(row, ["Terms", "Payment Terms", "Terms of Payment"]),
      attention: pick(row, ["Attention", "Contact Person", "Contact"]),
      vendorPhone: pick(row, ["Tel. / Fax No.", "Tel/Fax", "Phone", "Telephone", "Contact Number"]),
      vendorEmail: pick(row, ["Supplier Email", "Vendor Email", "Email"]),
      vendorAddress: pick(row, ["Supplier Address", "Vendor Address", "Company Address"]),
      vendorCity: pick(row, ["City", "Supplier City", "Vendor City"]),
      notes: pick(row, ["Notes", "Remarks", "Instructions"]),
      buyerName: pick(row, ["Buyer", "Buyer Name", "Purchaser", "Prepared By"]),
      buyerEmail: pick(row, ["Buyer Email", "Purchaser Email"]),
      requisitioner: pick(row, ["Requisitioner", "Requisitioner Name"]),
      requisitionerEmail: pick(row, ["Requisitioner Email", "Employee Email", "Email"]),
      department: pick(row, ["Department"]),
      purpose: pick(row, ["Purpose"]),
      quantity: pickNumber(row, ["Qty", "Quantity"]),
      unit: pick(row, ["Unit", "UOM"]),
      unitPrice: pickNumber(row, ["Unit Price", "Price"]),
      lineTotal: pickNumber(row, ["Total Amount", "Line Total", "Amount"]),
      itemDiscountPct: pickNumber(row, ["Disc %", "Discount %", "Item Discount %"]),
    };
    const key = normalize(poNumber);
    const list = grouped.get(key) || [];
    const signature = [match.prfNumber, match.itemsDelivered, match.supplier, match.quantity, match.unitPrice, match.lineTotal].map(normalize).join("|");
    if (!list.some((item) => [item.prfNumber, item.itemsDelivered, item.supplier, item.quantity, item.unitPrice, item.lineTotal].map(normalize).join("|") === signature)) list.push(match);
    grouped.set(key, list);
  }
  return Array.from(grouped.values()).map((matches) => ({ poNumber: matches[0].poNumber, matches })).sort((a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }));
}

function buildPrfRecords(rows: CsvRow[]): PrfRecord[] {
  const map = new Map<string, PrfRecord>();
  for (const row of rows) {
    const prfNumber = pick(row, ["PRF NO.", "PRF NO", "PRF Number", "PRF #", "PRF"]);
    if (!prfNumber) continue;
    const record: PrfRecord = {
      prfNumber,
      requisitioner: pick(row, ["REQUISITIONER", "Requisitioner Name", "Requisitioner"]),
      requisitionerEmail: pick(row, ["REQUISITIONER EMAIL", "Requisitioner Email", "Employee Email", "Email"]),
      department: pick(row, ["DEPARTMENT", "Department"]),
      itemDescription: pick(row, ["ITEM DESCRIPTION", "Item Description", "Items Delivered", "Item/s Delivered"]),
      purpose: pick(row, ["PURPOSE", "PURPOSE ", "Purpose"]),
    };
    const key = normalize(prfNumber);
    if (!map.has(key) || Object.values(map.get(key)!).filter(Boolean).length < Object.values(record).filter(Boolean).length) map.set(key, record);
  }
  return Array.from(map.values()).sort((a, b) => a.prfNumber.localeCompare(b.prfNumber, undefined, { numeric: true }));
}

function buildRequisitionerContacts(rows: CsvRow[]): RequisitionerContact[] {
  const map = new Map<string, RequisitionerContact>();
  for (const row of rows) {
    const name = pick(row, ["f_name", "full_name", "name", "employee name", "requisitioner", "requisitioner name"]);
    const email = pick(row, ["email", "employee email", "requisitioner email"]);
    const department = pick(row, ["department"]);
    if (!name || !email || !email.includes("@")) continue;
    const key = name.toLowerCase().trim();
    if (!map.has(key)) map.set(key, { name, email: email.toLowerCase(), department });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  const sheetId = process.env.GOOGLE_SUPPLIER_SHEET_ID || DEFAULT_SHEET_ID;
  const poSheet = process.env.GOOGLE_SUPPLIER_PO_SHEET || DEFAULT_PO_SHEET;
  const prfSheet = process.env.GOOGLE_SUPPLIER_PRF_SHEET || DEFAULT_PRF_SHEET;
  const employeeSheet = process.env.GOOGLE_SUPPLIER_EMPLOYEE_SHEET || DEFAULT_EMPLOYEE_SHEET;
  const poUrl = process.env.GOOGLE_SUPPLIER_PO_CSV_URL;
  const prfUrl = process.env.GOOGLE_SUPPLIER_PRF_CSV_URL;
  const employeeUrl = process.env.GOOGLE_SUPPLIER_EMPLOYEE_CSV_URL;
  try {
    const [poRows, prfRows] = await Promise.all([fetchCsv(sheetId, poSheet, poUrl), fetchCsv(sheetId, prfSheet, prfUrl)]);
    let employeeRows: CsvRow[] = [];
    try { employeeRows = await fetchCsv(sheetId, employeeSheet, employeeUrl); } catch { employeeRows = []; }
    return NextResponse.json({ ok: true, source: "google-sheets", fetchedAt: new Date().toISOString(), spreadsheetId: sheetId, poSheet, prfSheet, employeeSheet, poRecords: buildPoRecords(poRows), prfRecords: buildPrfRecords(prfRows), requisitioners: buildRequisitionerContacts(employeeRows) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ ok: false, source: "google-sheets", message: error instanceof Error ? error.message : "Unable to read Google Sheets." }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
