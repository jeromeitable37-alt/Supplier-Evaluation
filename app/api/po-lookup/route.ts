import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CsvRow = Record<string, string>;

type PurchaseOrderMatch = {
  poNumber: string;
  prfNumber: string;
  itemsDelivered: string;
  supplier: string;
};

type PurchaseOrderRecord = {
  poNumber: string;
  matches: PurchaseOrderMatch[];
};

type PrfRecord = {
  prfNumber: string;
  requisitioner: string;
  department: string;
  itemDescription: string;
  purpose: string;
};

const DEFAULT_SHEET_ID = "1XjBq3f-zM8QUkgLPlDccbz9c1Jy8L0JTJUOrZ0skfHA";
const DEFAULT_PO_SHEET = "PO for Evaluation";
const DEFAULT_PRF_SHEET = "PRF Details v2";

function normalize(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function toObjects(csv: string): CsvRow[] {
  const rows = parseCsv(csv);
  const headers = (rows.shift() || []).map(clean);
  return rows
    .filter((row) => row.some((cell) => clean(cell)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index] ?? "")])));
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(row: CsvRow, candidates: string[]) {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const wanted = normalizeHeader(candidate);
    const found = entries.find(([key]) => normalizeHeader(key) === wanted);
    if (found?.[1]) return clean(found[1]);
  }
  return "";
}

async function fetchCsv(sheetId: string, sheetName: string, explicitUrl?: string) {
  const url = explicitUrl || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "text/csv,*/*" },
  });

  const text = await response.text();
  const looksLikeHtml = /^\s*<(!doctype|html|head|body)/i.test(text);
  if (!response.ok || looksLikeHtml) {
    throw new Error(`Google Sheet source unavailable for ${sheetName}. Make the spreadsheet readable by the deployed app or configure a CSV/Apps Script URL.`);
  }

  return toObjects(text);
}

function buildPoRecords(rows: CsvRow[]): PurchaseOrderRecord[] {
  const grouped = new Map<string, PurchaseOrderMatch[]>();

  for (const row of rows) {
    const poNumber = pick(row, ["PO Number", "PO No", "PO #", "Purchase Order", "P.O. Number"]);
    if (!poNumber) continue;

    const match: PurchaseOrderMatch = {
      poNumber,
      prfNumber: pick(row, ["PRF Number", "PRF No", "PRF #", "PRF"]),
      itemsDelivered: pick(row, ["Items Delivered", "Item/s Delivered", "Items", "Item Description"]),
      supplier: pick(row, ["Supplier", "Supplier Name", "Vendor"]),
    };

    const key = normalize(poNumber);
    if (!grouped.has(key)) grouped.set(key, []);
    const list = grouped.get(key)!;
    const duplicate = list.some((item) =>
      [item.prfNumber, item.itemsDelivered, item.supplier].map(normalize).join("|") ===
      [match.prfNumber, match.itemsDelivered, match.supplier].map(normalize).join("|")
    );
    if (!duplicate) list.push(match);
  }

  return Array.from(grouped.values())
    .map((matches) => ({ poNumber: matches[0].poNumber, matches }))
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }));
}

function buildPrfRecords(rows: CsvRow[]): PrfRecord[] {
  const map = new Map<string, PrfRecord>();

  for (const row of rows) {
    const prfNumber = pick(row, ["PRF NO.", "PRF NO", "PRF Number", "PRF #", "PRF"]);
    if (!prfNumber) continue;

    const record: PrfRecord = {
      prfNumber,
      requisitioner: pick(row, ["REQUISITIONER", "Requisitioner Name", "Requisitioner"]),
      department: pick(row, ["DEPARTMENT", "Department"]),
      itemDescription: pick(row, ["ITEM DESCRIPTION", "Item Description", "Items Delivered", "Item/s Delivered"]),
      purpose: pick(row, ["PURPOSE", "PURPOSE ", "Purpose"]),
    };

    const key = normalize(prfNumber);
    if (!map.has(key) || Object.values(map.get(key)!).filter(Boolean).length < Object.values(record).filter(Boolean).length) {
      map.set(key, record);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.prfNumber.localeCompare(b.prfNumber, undefined, { numeric: true }));
}

export async function GET() {
  const sheetId = process.env.GOOGLE_SUPPLIER_SHEET_ID || DEFAULT_SHEET_ID;
  const poSheet = process.env.GOOGLE_SUPPLIER_PO_SHEET || DEFAULT_PO_SHEET;
  const prfSheet = process.env.GOOGLE_SUPPLIER_PRF_SHEET || DEFAULT_PRF_SHEET;

  const poUrl = process.env.GOOGLE_SUPPLIER_PO_CSV_URL;
  const prfUrl = process.env.GOOGLE_SUPPLIER_PRF_CSV_URL;

  try {
    const [poRows, prfRows] = await Promise.all([
      fetchCsv(sheetId, poSheet, poUrl),
      fetchCsv(sheetId, prfSheet, prfUrl),
    ]);

    return NextResponse.json(
      {
        ok: true,
        source: "google-sheets",
        fetchedAt: new Date().toISOString(),
        spreadsheetId: sheetId,
        poSheet,
        prfSheet,
        poRecords: buildPoRecords(poRows),
        prfRecords: buildPrfRecords(prfRows),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: "google-sheets",
        message: error instanceof Error ? error.message : "Unable to read Google Sheets.",
      },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
