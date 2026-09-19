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
  actualDeliveryDate: string;
  receivedBy: string;
  status: string;
  subtotal: number | string;
  discountPct: number | string;
  discountAmt: number | string;
  total: number | string;
};

type PurchaseOrderRecord = { poNumber: string; matches: PurchaseOrderMatch[] };
type PrfRecord = {
  prfNumber: string;
  poNumber?: string;
  requisitioner: string;
  requisitionerEmail: string;
  department: string;
  itemDescription: string;
  purpose: string;
  orderDate?: string;
  expectedDate?: string;
  actualDeliveryDate?: string;
  receivedBy?: string;
  status?: string;
  buyerName?: string;
  sourceSheet?: string;
};

type FetchResult = { rows: CsvRow[]; error?: string };

// PRIMARY SOURCE: the Supplier Evaluation workbook.
const DEFAULT_SHEET_ID = "1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA";
const DEFAULT_PO_SHEET = "PO for Evaluation";
const DEFAULT_PRF_SHEET = "PRF Details v2";
const DEFAULT_EMPLOYEE_SHEET = "Employee";
const DEFAULT_REQUISITIONER_SHEET = "Requisitioner Details";

// SECONDARY SOURCE: the separate V2 PRF/SRF monitoring workbook.
const DEFAULT_V2_SHEET_ID = "1h4OvmGWLzhUf2A9xk8uOmeVQgrKV1Xug42n9LH77Avw";
const DEFAULT_V2_PRF_SHEETS = [
  "PRF - SISC",
  "PRF-TROPICAL PALMS",
  "PRF-SMIS",
  "PRF-SSLC",
  "PRF-TREX",
  "PRF-ACT",
  "PRF-ASAT",
  "PRF-SGEN",
  "PRF-SISFU",
  "PRF-CMIP",
  "PRF - AFSL",
  "PRF-SVILLE EDUVISION",
  "PRF-AASHPI",
];

// Optional historical/source-of-truth sheets retained for compatibility with the supplied Apps Script workflow.
const DEFAULT_LEGACY_PO_SHEET = "POs";
const DEFAULT_LEGACY_ITEM_SHEET = "Items";
const DEFAULT_LEGACY_REQUEST_SHEET = "Requests";

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
  return rows.filter((row) => row.some((cell) => clean(cell))).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? "")]))
  );
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

async function safeFetchCsv(sheetId: string, sheetName: string, explicitUrl?: string): Promise<FetchResult> {
  try {
    return { rows: await fetchCsv(sheetId, sheetName, explicitUrl) };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : `Unable to read ${sheetName}.` };
  }
}

function emptyMatch(poNumber: string): PurchaseOrderMatch {
  return {
    poNumber,
    prfNumber: "",
    itemsDelivered: "",
    supplier: "",
    deliveryAddress: "",
    expectedDate: "",
    orderDate: "",
    paymentTerms: "",
    attention: "",
    vendorPhone: "",
    vendorEmail: "",
    vendorAddress: "",
    vendorCity: "",
    notes: "",
    buyerName: "",
    buyerEmail: "",
    requisitioner: "",
    requisitionerEmail: "",
    department: "",
    purpose: "",
    quantity: "",
    unit: "",
    unitPrice: "",
    lineTotal: "",
    itemDiscountPct: "",
    actualDeliveryDate: "",
    receivedBy: "",
    status: "Pending",
    subtotal: "",
    discountPct: "",
    discountAmt: "",
    total: "",
  };
}

function mergeInto(map: Map<string, PurchaseOrderRecord>, match: PurchaseOrderMatch) {
  const key = normalize(match.poNumber);
  if (!key) return;
  const current = map.get(key) || { poNumber: match.poNumber, matches: [] };
  const signature = [match.prfNumber, match.itemsDelivered, match.supplier, match.quantity, match.unit, match.unitPrice, match.lineTotal].map(normalize).join("|");
  const existing = current.matches.find((item) =>
    [item.prfNumber, item.itemsDelivered, item.supplier, item.quantity, item.unit, item.unitPrice, item.lineTotal].map(normalize).join("|") === signature
  );
  if (!existing) current.matches.push(match);
  else {
    (Object.keys(match) as (keyof PurchaseOrderMatch)[]).forEach((field) => {
      const value = match[field];
      const currentValue = existing[field];
      if ((currentValue === "" || currentValue === undefined || currentValue === null) && value !== "") (existing as any)[field] = value;
    });
  }
  map.set(key, current);
}

function buildFlatPoRecords(rows: CsvRow[]): PurchaseOrderRecord[] {
  const grouped = new Map<string, PurchaseOrderRecord>();
  for (const row of rows) {
    const poNumber = pick(row, ["PO Number", "PO No", "PO #", "Purchase Order", "P.O. Number", "PO", "po_number"]);
    if (!poNumber) continue;
    mergeInto(grouped, {
      poNumber,
      prfNumber: pick(row, ["PRF Number", "PRF No", "PRF #", "PRF", "PRF No.", "prf_no", "prf_srf_no"]),
      itemsDelivered: pick(row, ["Items Delivered", "Item/s Delivered", "Items", "Item Description", "Particulars", "Particular", "description"]),
      supplier: pick(row, ["Supplier", "Supplier Name", "Vendor", "Company Name", "vendor_name"]),
      deliveryAddress: pick(row, ["Delivery Address", "Delivery To", "Ship To", "Address", "delivery_address"]),
      expectedDate: pick(row, ["Delivery Date", "Expected Date", "Expected Delivery", "Delivery", "expected_date"]),
      orderDate: pick(row, ["Date", "Order Date", "PO Date", "Created Date", "created_at"]),
      paymentTerms: pick(row, ["Terms", "Payment Terms", "Terms of Payment", "payment_terms"]),
      attention: pick(row, ["Attention", "Contact Person", "Contact"]),
      vendorPhone: pick(row, ["Tel. / Fax No.", "Tel/Fax", "Phone", "Telephone", "Contact Number"]),
      vendorEmail: pick(row, ["Supplier Email", "Vendor Email", "Email"]),
      vendorAddress: pick(row, ["Supplier Address", "Vendor Address", "Company Address"]),
      vendorCity: pick(row, ["City", "Supplier City", "Vendor City"]),
      notes: pick(row, ["Notes", "Remarks", "Instructions"]),
      buyerName: pick(row, ["Buyer", "Buyer Name", "Purchaser", "Prepared By", "buyer_name"]),
      buyerEmail: pick(row, ["Buyer Email", "Purchaser Email"]),
      requisitioner: pick(row, ["Requisitioner", "Requisitioner Name"]),
      requisitionerEmail: pick(row, ["Requisitioner Email", "Employee Email"]),
      department: pick(row, ["Department"]),
      purpose: pick(row, ["Purpose"]),
      quantity: pickNumber(row, ["Qty", "Quantity", "qty"]),
      unit: pick(row, ["Unit", "UOM"]),
      unitPrice: pickNumber(row, ["Unit Price", "Price", "unit_price"]),
      lineTotal: pickNumber(row, ["Total Amount", "Line Total", "Amount", "line_total"]),
      itemDiscountPct: pickNumber(row, ["Disc %", "Discount %", "Item Discount %", "item_discount_pct"]),
      actualDeliveryDate: pick(row, ["Actual Delivery Date", "Actual Delivery", "Delivery Received Date", "actual_delivery_date"]),
      receivedBy: pick(row, ["Received By", "Received by", "Received", "received_by"]),
      status: pick(row, ["Status", "Delivery Status", "PO Status", "status"]) || "Pending",
      subtotal: pickNumber(row, ["Subtotal", "Sub Total", "subtotal"]),
      discountPct: pickNumber(row, ["Discount %", "Overall Discount %", "discount_pct"]),
      discountAmt: pickNumber(row, ["Discount Amount", "Discount Amt", "discount_amt"]),
      total: pickNumber(row, ["Grand Total", "PO Total", "Total", "Total Amount", "total"]),
    });
  }
  return Array.from(grouped.values()).map((record) => ({ ...record, matches: record.matches.length ? record.matches : [emptyMatch(record.poNumber)] }));
}

function buildLegacyStructuredPoRecords(poRows: CsvRow[], itemRows: CsvRow[], requestRows: CsvRow[]): PurchaseOrderRecord[] {
  const itemsByPo = new Map<string, CsvRow[]>();
  itemRows.forEach((row) => {
    const poNumber = pick(row, ["PO Number", "PO No", "PO #", "Purchase Order", "PO", "po_number"]);
    if (!poNumber) return;
    const key = normalize(poNumber);
    const list = itemsByPo.get(key) || [];
    list.push(row);
    itemsByPo.set(key, list);
  });

  const requestByPo = new Map<string, CsvRow>();
  requestRows.forEach((row) => {
    const poNumber = pick(row, ["PO Number", "PO No", "PO #", "Purchase Order", "PO", "po_number"]);
    if (!poNumber) return;
    requestByPo.set(normalize(poNumber), row);
  });

  const output = new Map<string, PurchaseOrderRecord>();
  for (const row of poRows) {
    const poNumber = pick(row, ["PO Number", "PO No", "PO #", "Purchase Order", "P.O. Number", "PO", "po_number"]);
    if (!poNumber) continue;
    const request = requestByPo.get(normalize(poNumber));
    const base = emptyMatch(poNumber);
    base.supplier = pick(row, ["Vendor Name", "Supplier", "Supplier Name", "Vendor", "Company Name", "vendor_name"]);
    base.deliveryAddress = pick(row, ["Delivery Address", "Delivery To", "Ship To", "delivery_address"]);
    base.expectedDate = pick(row, ["Expected Date", "Delivery Date", "Expected Delivery", "expected_date"]);
    base.orderDate = pick(row, ["Order Date", "PO Date", "Date", "created_at"]);
    base.notes = pick(row, ["Notes", "Remarks", "notes"]);
    base.paymentTerms = pick(row, ["Terms", "Payment Terms", "Terms of Payment", "payment_terms"]);
    base.subtotal = pickNumber(row, ["Subtotal", "Sub Total", "subtotal"]);
    base.discountPct = pickNumber(row, ["Discount %", "Overall Discount %", "discount_pct"]);
    base.discountAmt = pickNumber(row, ["Discount Amount", "Discount Amt", "discount_amt"]);
    base.total = pickNumber(row, ["Grand Total", "PO Total", "Total", "Total Amount", "total"]);
    base.status = pick(row, ["Status", "PO Status", "Delivery Status", "status"]) || "Pending";
    base.actualDeliveryDate = pick(row, ["Actual Delivery Date", "Actual Delivery", "actual_delivery_date"]);
    base.receivedBy = pick(row, ["Received By", "Received by", "received_by"]);
    base.buyerName = pick(row, ["Buyer Name", "Buyer", "Purchaser", "buyer_name"]);
    base.buyerEmail = pick(row, ["Buyer Email", "Purchaser Email", "buyer_email"]);

    if (request) {
      base.requisitioner = pick(request, ["Requisitioner", "Requisitioner Name", "requisitioner"]);
      base.requisitionerEmail = pick(request, ["Requisitioner Email", "Employee Email", "Email", "requisitioner_email"]);
      base.department = pick(request, ["Department", "department"]);
      base.purpose = pick(request, ["Purpose", "purpose"]);
      base.prfNumber = pick(request, ["PRF/SRF No.", "PRF No.", "PRF No", "PRF Number", "PRF #", "PRF", "prf_srf_no"]);
    }

    const itemRowsForPo = itemsByPo.get(normalize(poNumber)) || [];
    if (!itemRowsForPo.length) {
      base.itemsDelivered = pick(row, ["Items Delivered", "Item/s Delivered", "Items", "Item Description", "Particulars", "description"]);
      base.quantity = pickNumber(row, ["Qty", "Quantity", "qty"]);
      base.unit = pick(row, ["Unit", "UOM"]);
      base.unitPrice = pickNumber(row, ["Unit Price", "Price", "unit_price"]);
      base.lineTotal = pickNumber(row, ["Total Amount", "Line Total", "Amount", "total"]);
      base.itemDiscountPct = pickNumber(row, ["Disc %", "Discount %", "Item Discount %", "item_discount_pct"]);
      mergeInto(output, base);
      continue;
    }

    itemRowsForPo.forEach((itemRow) => {
      const line = { ...base };
      line.itemsDelivered = pick(itemRow, ["Description", "Item Description", "Items Delivered", "Item/s Delivered", "Particulars", "Particular", "description"]);
      line.quantity = pickNumber(itemRow, ["Qty", "Quantity", "qty"]);
      line.unit = pick(itemRow, ["Unit", "UOM"]);
      line.unitPrice = pickNumber(itemRow, ["Unit Price", "Price", "unit_price"]);
      line.itemDiscountPct = pickNumber(itemRow, ["Item Discount %", "Disc %", "Discount %", "item_discount_pct"]);
      line.lineTotal = pickNumber(itemRow, ["Line Total", "Total Amount", "Amount", "line_total"]);
      mergeInto(output, line);
    });
  }
  return Array.from(output.values());
}

function buildPrfRecords(rows: CsvRow[], sourceSheet = "") : PrfRecord[] {
  const map = new Map<string, PrfRecord>();
  for (const row of rows) {
    const prfNumber = pick(row, ["PRF NO.", "PRF NO", "PRF Number", "PRF #", "PRF"]);
    if (!prfNumber) continue;
    const record: PrfRecord = {
      prfNumber,
      poNumber: pick(row, ["PO NUMBER", "PO Number", "PO No", "PO #", "Purchase Order", "PO", "po_number"]),
      requisitioner: pick(row, ["REQUISITIONER", "Requisitioner Name", "Requisitioner"]),
      requisitionerEmail: pick(row, ["REQUISITIONER EMAIL", "Requisitioner Email", "Employee Email", "Email"]),
      department: pick(row, ["DEPARTMENT", "Department"]),
      itemDescription: pick(row, ["ITEM DESCRIPTION", "Item Description", "Items Delivered", "Item/s Delivered"]),
      purpose: pick(row, ["PURPOSE", "PURPOSE ", "Purpose"]),
      sourceSheet,
    };
    const key = normalize(prfNumber);
    const current = map.get(key);
    if (!current || Object.values(current).filter(Boolean).length < Object.values(record).filter(Boolean).length) map.set(key, record);
  }
  return Array.from(map.values()).sort((a, b) => a.prfNumber.localeCompare(b.prfNumber, undefined, { numeric: true }));
}

function buildV2PrfRecords(sheetName: string, rows: CsvRow[]): PrfRecord[] {
  const result: PrfRecord[] = [];
  for (const row of rows) {
    const prfNumber = pick(row, ["PRF NO.", "PRF NO", "PRF Number", "PRF #", "PRF"]);
    if (!prfNumber) continue;
    result.push({
      prfNumber,
      poNumber: pick(row, ["PO NUMBER", "PO Number", "PO No", "PO #", "Purchase Order", "PO", "po_number"]),
      requisitioner: pick(row, ["REQUISITIONER", "Requisitioner Name", "Requisitioner"]),
      requisitionerEmail: pick(row, ["REQUISITIONER EMAIL", "Requisitioner Email", "Employee Email", "Email"]),
      department: pick(row, ["DEPARTMENT", "Department"]),
      itemDescription: pick(row, ["ITEM DESCRIPTION", "Item Description", "Items Delivered", "Item/s Delivered", "SCOPE OF WORK"]),
      purpose: pick(row, ["PURPOSE", "PURPOSE ", "Purpose"]),
      orderDate: pick(row, ["DATE OF PO", "PO DATE", "DATE PO", "Date of PO"]),
      expectedDate: pick(row, ["DELIVERY DATE", "Delivery Date", "Expected Delivery", "Expected Date"]),
      actualDeliveryDate: pick(row, ["ACTUAL DELIVERY DATE", "Actual Delivery Date", "Actual Delivery"]),
      receivedBy: pick(row, ["DELIVERY RECEIVED BY", "DELIVERY RECEIVED BY ", "RECEIVED BY", "Received By"]),
      status: pick(row, ["STATUS IN PURCHASING", "PO STATUS", "STATUS", "PRF STATUS"]) || "Pending",
      buyerName: pick(row, ["PURCHASER ASSIGNED", "PURCHASER", "BUYER", "Purchaser Assigned"]),
      sourceSheet: sheetName,
    });
  }
  return result;
}

function mergePrfRecords(...sources: PrfRecord[][]): PrfRecord[] {
  const map = new Map<string, PrfRecord>();
  for (const source of sources) {
    for (const record of source) {
      const key = normalize(record.prfNumber);
      if (!key) continue;
      const current = map.get(key);
      if (!current) {
        map.set(key, { ...record });
        continue;
      }
      (Object.keys(record) as (keyof PrfRecord)[]).forEach((field) => {
        const value = record[field];
        const existing = current[field];
        if ((existing === "" || existing === undefined || existing === null) && value !== "") (current as any)[field] = value;
      });
      map.set(key, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.prfNumber.localeCompare(b.prfNumber, undefined, { numeric: true }));
}

function buildV2PoRecords(prfRecords: PrfRecord[]): PurchaseOrderRecord[] {
  const grouped = new Map<string, PurchaseOrderRecord>();
  for (const prf of prfRecords) {
    const poNumber = clean(prf.poNumber);
    if (!poNumber) continue;
    const match = emptyMatch(poNumber);
    match.prfNumber = prf.prfNumber;
    match.requisitioner = prf.requisitioner;
    match.requisitionerEmail = prf.requisitionerEmail;
    match.department = prf.department;
    match.purpose = prf.purpose;
    match.itemsDelivered = prf.itemDescription;
    match.orderDate = prf.orderDate || "";
    match.expectedDate = prf.expectedDate || "";
    match.actualDeliveryDate = prf.actualDeliveryDate || "";
    match.receivedBy = prf.receivedBy || "";
    match.status = prf.status || "Pending";
    match.buyerName = prf.buyerName || "";
    mergeInto(grouped, match);
  }
  return Array.from(grouped.values());
}

function mergePoRecordSources(...sources: PurchaseOrderRecord[][]): PurchaseOrderRecord[] {
  const map = new Map<string, PurchaseOrderRecord>();
  for (const source of sources) for (const record of source) for (const match of record.matches.length ? record.matches : [emptyMatch(record.poNumber)]) mergeInto(map, match);
  return Array.from(map.values()).map((record) => ({ ...record, matches: record.matches.length ? record.matches : [emptyMatch(record.poNumber)] }))
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }));
}

function enrichPoRecordsFromPrf(poRecords: PurchaseOrderRecord[], prfRecords: PrfRecord[]): PurchaseOrderRecord[] {
  const poByPrf = new Map<string, PrfRecord>();
  prfRecords.forEach((prf) => poByPrf.set(normalize(prf.prfNumber), prf));
  return poRecords.map((record) => ({
    ...record,
    matches: record.matches.map((match) => {
      const prf = poByPrf.get(normalize(match.prfNumber));
      if (!prf) return match;
      return {
        ...match,
        prfNumber: match.prfNumber || prf.prfNumber,
        requisitioner: match.requisitioner || prf.requisitioner,
        requisitionerEmail: match.requisitionerEmail || prf.requisitionerEmail,
        department: match.department || prf.department,
        purpose: match.purpose || prf.purpose,
        itemsDelivered: match.itemsDelivered || prf.itemDescription,
        orderDate: match.orderDate || prf.orderDate || "",
        expectedDate: match.expectedDate || prf.expectedDate || "",
        actualDeliveryDate: match.actualDeliveryDate || prf.actualDeliveryDate || "",
        receivedBy: match.receivedBy || prf.receivedBy || "",
        status: match.status && match.status !== "Pending" ? match.status : (prf.status || match.status || "Pending"),
        buyerName: match.buyerName || prf.buyerName || "",
      };
    }),
  }));
}

function buildRequisitionerContacts(rows: CsvRow[]): RequisitionerContact[] {
  const map = new Map<string, RequisitionerContact>();
  for (const row of rows) {
    const name = pick(row, ["f_name", "full_name", "name", "employee name", "requisitioner", "requisitioner name", "Full name"]);
    const email = pick(row, ["email", "employee email", "requisitioner email", "Email Address [Required]"]);
    const department = pick(row, ["department"]);
    if (!name || !email || !email.includes("@")) continue;
    const key = name.toLowerCase().trim();
    if (!map.has(key)) map.set(key, { name, email: email.toLowerCase(), department });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parseSheetList(value: string | undefined, fallback: string[]) {
  const parsed = String(value || "").split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

export async function GET() {
  const supplierSheetId = process.env.GOOGLE_SUPPLIER_SHEET_ID || DEFAULT_SHEET_ID;
  const poSheet = process.env.GOOGLE_SUPPLIER_PO_SHEET || DEFAULT_PO_SHEET;
  const prfSheet = process.env.GOOGLE_SUPPLIER_PRF_SHEET || DEFAULT_PRF_SHEET;
  const employeeSheet = process.env.GOOGLE_SUPPLIER_EMPLOYEE_SHEET || DEFAULT_EMPLOYEE_SHEET;
  const requisitionerSheet = process.env.GOOGLE_SUPPLIER_REQUISITIONER_SHEET || DEFAULT_REQUISITIONER_SHEET;

  const v2SheetId = process.env.GOOGLE_SUPPLIER_V2_SHEET_ID || DEFAULT_V2_SHEET_ID;
  const v2PrfSheets = parseSheetList(process.env.GOOGLE_SUPPLIER_V2_PRF_SHEETS, DEFAULT_V2_PRF_SHEETS);

  const legacyPoSheet = process.env.GOOGLE_SUPPLIER_LEGACY_PO_SHEET || DEFAULT_LEGACY_PO_SHEET;
  const legacyItemSheet = process.env.GOOGLE_SUPPLIER_LEGACY_ITEM_SHEET || DEFAULT_LEGACY_ITEM_SHEET;
  const legacyRequestSheet = process.env.GOOGLE_SUPPLIER_LEGACY_REQUEST_SHEET || DEFAULT_LEGACY_REQUEST_SHEET;
  const poUrl = process.env.GOOGLE_SUPPLIER_PO_CSV_URL;
  const prfUrl = process.env.GOOGLE_SUPPLIER_PRF_CSV_URL;
  const employeeUrl = process.env.GOOGLE_SUPPLIER_EMPLOYEE_CSV_URL;

  try {
    // Source #1: Supplier Evaluation workbook.
    const [poRows, prfRows] = await Promise.all([
      fetchCsv(supplierSheetId, poSheet, poUrl),
      fetchCsv(supplierSheetId, prfSheet, prfUrl),
    ]);

    const [employeeResult, requisitionerResult, legacyPoResult, legacyItemResult, legacyRequestResult] = await Promise.all([
      safeFetchCsv(supplierSheetId, employeeSheet, employeeUrl),
      safeFetchCsv(supplierSheetId, requisitionerSheet),
      safeFetchCsv(supplierSheetId, legacyPoSheet),
      safeFetchCsv(supplierSheetId, legacyItemSheet),
      safeFetchCsv(supplierSheetId, legacyRequestSheet),
    ]);

    // Source #2: V2 PRF/SRF workbook. Each business-unit PRF tab follows the same general structure.
    const v2Results = await Promise.all(v2PrfSheets.map(async (sheetName) => ({
      sheetName,
      ...(await safeFetchCsv(v2SheetId, sheetName)),
    })));

    const supplierPrfRecords = buildPrfRecords(prfRows, prfSheet);
    const v2PrfRecords = v2Results.flatMap((result) => buildV2PrfRecords(result.sheetName, result.rows));
    const prfRecords = mergePrfRecords(supplierPrfRecords, v2PrfRecords);

    const mergedFromSheets = mergePoRecordSources(
      buildFlatPoRecords(poRows),
      buildLegacyStructuredPoRecords(legacyPoResult.rows, legacyItemResult.rows, legacyRequestResult.rows),
      buildV2PoRecords(v2PrfRecords),
    );
    const completePoRecords = enrichPoRecordsFromPrf(mergedFromSheets, prfRecords);

    const contacts = buildRequisitionerContacts([...employeeResult.rows, ...requisitionerResult.rows]);
    const v2ReadableSheets = v2Results.filter((result) => !result.error && result.rows.length > 0).map((result) => result.sheetName);
    const v2Errors = v2Results.filter((result) => result.error).map((result) => ({ sheet: result.sheetName, error: result.error }));

    return NextResponse.json({
      ok: true,
      source: "google-sheets-dual-source",
      fetchedAt: new Date().toISOString(),
      supplierSpreadsheetId: supplierSheetId,
      v2SpreadsheetId: v2SheetId,
      poSheet,
      prfSheet,
      employeeSheet,
      requisitionerSheet,
      v2PrfSheets,
      legacySheets: { po: legacyPoSheet, items: legacyItemSheet, requests: legacyRequestSheet },
      poRecords: completePoRecords,
      prfRecords,
      requisitioners: contacts,
      sourceCounts: {
        supplierEvaluationPoRows: poRows.length,
        supplierEvaluationPrfRows: prfRows.length,
        employeeRows: employeeResult.rows.length,
        requisitionerRows: requisitionerResult.rows.length,
        legacyPoRows: legacyPoResult.rows.length,
        legacyItemRows: legacyItemResult.rows.length,
        legacyRequestRows: legacyRequestResult.rows.length,
        v2PrfSheetsConfigured: v2PrfSheets.length,
        v2PrfSheetsReadable: v2ReadableSheets.length,
        v2PrfRows: v2PrfRecords.length,
        v2LinkedPoRows: v2PrfRecords.filter((item) => Boolean(item.poNumber)).length,
      },
      sourceStatus: {
        supplierEvaluation: "connected",
        v2: v2ReadableSheets.length ? "connected" : "no-readable-v2-prf-sheets",
        v2ReadableSheets,
        v2Errors,
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ ok: false, source: "google-sheets-dual-source", message: error instanceof Error ? error.message : "Unable to read Google Sheets." }, {
      status: 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
