"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileImage,
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UploadCloud,
  UserCheck,
  X,
} from "lucide-react";
import {
  createEvaluationLinkCloud,
  savePurchaseOrderCloud,
  subscribeEvaluationLinks,
  subscribePurchaseOrderEvaluations,
  subscribePurchaseOrders,
  updateEvaluationLinkPOCloud,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PublicEvaluationLink,
} from "../lib/firestore";
import { cloudinaryConfigured, getCloudinarySetupMessage, uploadPoDocumentToCloudinary, type CloudinaryPoDocument } from "../lib/cloudinary";

export type PurchaseOrderSheetMatch = {
  poNumber: string;
  prfNumber: string;
  itemsDelivered: string;
  supplier: string;
  deliveryAddress?: string;
  expectedDate?: string;
  orderDate?: string;
  paymentTerms?: string;
  attention?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  vendorAddress?: string;
  vendorCity?: string;
  notes?: string;
  buyerName?: string;
  buyerEmail?: string;
  requisitioner?: string;
  requisitionerEmail?: string;
  department?: string;
  purpose?: string;
  quantity?: number | string;
  unit?: string;
  unitPrice?: number | string;
  lineTotal?: number | string;
  itemDiscountPct?: number | string;
  actualDeliveryDate?: string;
  receivedBy?: string;
  status?: string;
};

export type PurchaseOrderSheetRecord = {
  poNumber: string;
  matches: PurchaseOrderSheetMatch[];
};

type PrfRecord = {
  prfNumber: string;
  requisitioner: string;
  email?: string;
  department: string;
  itemDescription: string;
  purpose: string;
};

type Props = {
  workspaceName: string;
  workspaceAddress?: string;
  workspaceEmail?: string;
  currentUser?: { uid: string; email?: string; displayName?: string } | null;
  canEdit: boolean;
  onNotify: (message: string) => void;
};

const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `Php ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Php —";
};

const amount = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeKey = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizePerson = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const fmtDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
};

function numberToWords(value: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (!Number.isFinite(value) || value < 0) return "";
  const n = Math.round(value * 100) / 100;
  const pesos = Math.floor(n);
  const centavos = Math.round((n - pesos) * 100);
  const below1000 = (num: number): string => {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ""}`;
    return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ` ${below1000(num % 100)}` : ""}`;
  };
  let result = "";
  if (pesos >= 1000000) result += `${below1000(Math.floor(pesos / 1000000))} Million `;
  if (pesos >= 1000) result += `${below1000(Math.floor((pesos % 1000000) / 1000))} Thousand `;
  result += below1000(pesos % 1000);
  if (!result.trim()) result = "Zero";
  result = `${result.trim()} Pesos`;
  return `${result} And ${String(centavos).padStart(2, "0")} Centavos`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildPurchaseOrderHtml(po: PurchaseOrder, workspace: { name: string; address?: string; email?: string }) {
  const rows = po.items.map((item) => {
    const total = amount(item.lineTotal) || (amount(item.qty) * amount(item.unitPrice));
    return `<tr>
      <td class="tc">${escapeHtml(item.qty || "")}</td>
      <td class="tc">${escapeHtml(item.unit || "")}</td>
      <td class="tl">${escapeHtml(item.description || "")}</td>
      <td class="tr">${item.unitPrice ? money(item.unitPrice) : ""}</td>
      <td class="tc">${item.itemDiscountPct ? `${amount(item.itemDiscountPct).toFixed(2)}%` : "—"}</td>
      <td class="tr">${total ? money(total) : ""}</td>
    </tr>`;
  }).join("");
  const itemDiscountTotal = po.items.reduce((sum, item) => {
    const gross = amount(item.qty) * amount(item.unitPrice);
    return sum + gross * amount(item.itemDiscountPct) / 100;
  }, 0);
  const netSubtotal = Math.max(0, amount(po.subtotal) - itemDiscountTotal);
  const discountAmount = amount(po.discountAmt) || netSubtotal * amount(po.discountPct) / 100;
  const total = amount(po.total) || netSubtotal - discountAmount;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(po.poNumber)}</title>
<style>
@page { size: Letter; margin: .4in .5in .6in; }
*{box-sizing:border-box;margin:0;padding:0} body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;background:#fff}
.lh-wrap{display:table;width:100%;margin-bottom:5pt}.lh-left{display:table-cell;width:60%;vertical-align:top;text-align:center}.lh-name{font-size:12pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.lh-addr{font-size:8pt;line-height:1.7;margin-top:3pt;color:#333}.lh-right{display:table-cell;width:40%;vertical-align:top;text-align:right}.po-box{border:2px solid #000;text-align:center;padding:6pt 14pt;display:inline-block}.po-box-num{font-size:11pt;font-weight:700}.hdr-rule{border:0;border-top:2px solid #000;margin:6pt 0 8pt}
.vnd-wrap{display:table;width:100%;border:1px solid #aaa;margin-bottom:7pt}.vnd-left{display:table-cell;width:58%;vertical-align:top;padding:6pt 8pt;border-right:1px solid #aaa}.vnd-right{display:table-cell;width:42%;vertical-align:top;padding:6pt 8pt}.f-row{display:table;width:100%;margin-bottom:4pt}.f-lbl{display:table-cell;white-space:nowrap;font-size:8pt;font-weight:700;color:#444;padding-right:6pt;width:1%}.f-val{display:table-cell;font-size:8.5pt;border-bottom:1px solid #bbb;width:100%;vertical-align:bottom;padding-bottom:1pt}.f-val-nb{display:table-cell;font-size:8.5pt;width:100%;vertical-align:bottom}.deliver-note{font-size:8.5pt;margin-bottom:5pt;font-style:italic}
table.items{width:100%;border-collapse:collapse;border:1px solid #000}table.items thead th{font-size:8.5pt;font-weight:700;padding:4pt 5pt;border:1px solid #000;text-align:center;background:#fff}table.items tbody td{font-size:8.5pt;padding:3pt 5pt;border-right:1px solid #000;border-bottom:1px solid #ddd;vertical-align:top}.tl{text-align:left}.tc{text-align:center}.tr{text-align:right}.nothing-follows{text-align:center;font-size:8pt;font-weight:700;border:1px solid #000;border-top:none;padding:3pt 5pt;letter-spacing:.5px}
.bot-wrap{display:table;width:100%;border:1px solid #000;border-top:none}.bot-left{display:table-cell;width:55%;vertical-align:top;padding:6pt 8pt;border-right:1px solid #000;font-size:8.5pt;line-height:1.8}.bot-right{display:table-cell;width:45%;vertical-align:top}.tot-row{display:table;width:100%;border-bottom:1px solid #ddd}.tot-row:last-child{border-bottom:none}.tot-lbl{display:table-cell;padding:3pt 7pt;font-size:8.5pt}.tot-val{display:table-cell;padding:3pt 7pt;text-align:right;font-size:8.5pt;white-space:nowrap;border-left:1px solid #ddd;min-width:80pt}.tot-final .tot-lbl,.tot-final .tot-val{font-weight:700;font-size:9.5pt;border-top:2px solid #000;padding-top:4pt}.words-box{border:1px solid #000;border-top:none;padding:4pt 8pt;font-size:8pt}.words-lbl{font-weight:700}
.sig-wrap{display:table;width:100%;margin-top:14pt}.sig-col{display:table-cell;width:33.3%;padding-right:12pt;vertical-align:top;font-size:8.5pt}.sig-col:last-child{padding-right:0}.sig-title{font-weight:700;font-size:8.5pt;margin-bottom:14pt}.sig-name{font-size:9pt;font-weight:700;min-height:12pt}.sig-line{border-top:1px solid #000;padding-top:2pt;font-size:7.5pt}.sig-date{margin-top:6pt;font-size:8pt}.sig-date span{display:inline-block;border-bottom:1px solid #000;width:80pt}.meta-note{font-size:7pt;color:#666;margin-top:9pt}
</style></head><body>
<div class="lh-wrap"><div class="lh-left"><div class="lh-name">${escapeHtml(workspace.name || "SISC")}</div><div class="lh-addr">${escapeHtml(workspace.address || "")}${workspace.address && workspace.email ? "<br>" : ""}${escapeHtml(workspace.email || "")}</div></div><div class="lh-right"></div></div>
<div class="lh-wrap"><div class="lh-name" style="display:table-cell;width:60%;vertical-align:top;text-align:left;padding-top:25px">PURCHASE ORDER</div><div class="lh-right"><div class="po-box"><div class="po-box-num">${escapeHtml(po.poNumber)}</div></div></div></div>
<hr class="hdr-rule">
<div class="vnd-wrap"><div class="vnd-left"><div class="f-row"><div class="f-lbl">Company Name:</div><div class="f-val">${escapeHtml(po.vendorName)}</div></div><div class="f-row"><div class="f-lbl">Attention:</div><div class="f-val">${escapeHtml(po.vendorAttention || "")}</div></div><div class="f-row"><div class="f-lbl">Tel. / Fax No.:</div><div class="f-val">${escapeHtml(po.vendorPhone || "")}</div></div><div class="f-row"><div class="f-lbl">Delivery Address:</div><div class="f-val">${escapeHtml(po.deliveryAddress || "")}</div></div></div><div class="vnd-right"><div class="f-row"><div class="f-lbl">Date:</div><div class="f-val-nb">${escapeHtml(fmtDate(po.orderDate))}</div></div><div class="f-row"><div class="f-lbl">Delivery Date:</div><div class="f-val-nb">${escapeHtml(fmtDate(po.expectedDate))}</div></div><div class="f-row"><div class="f-lbl">Terms:</div><div class="f-val-nb">${escapeHtml(po.paymentTerms || "")}</div></div></div></div>
<div class="deliver-note">Please deliver to us the following items:</div>
<table class="items"><thead><tr><th style="width:50pt">Qty</th><th style="width:45pt">Unit</th><th>Particulars</th><th style="width:75pt">Unit Price</th><th style="width:45pt">Disc %</th><th style="width:80pt">Total Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="nothing-follows">*********************** N O T H I N G &nbsp; F O L L O W S **************************</div>
<div class="bot-wrap"><div class="bot-left">${po.prfNumber ? `<div><b>PRF No.:</b> ${escapeHtml(po.prfNumber)}</div>` : ""}${po.purpose ? `<div><b>Purpose:</b> ${escapeHtml(po.purpose)}</div>` : ""}${po.requisitioner ? `<div><b>Requisitioner:</b> ${escapeHtml(po.requisitioner)}</div>` : ""}${po.notes ? `<div style="margin-top:4pt"><b>Notes:</b> ${escapeHtml(po.notes)}</div>` : ""}</div><div class="bot-right"><div class="tot-row"><div class="tot-lbl">Subtotal:</div><div class="tot-val">${money(po.subtotal || netSubtotal)}</div></div>${itemDiscountTotal > 0 ? `<div class="tot-row"><div class="tot-lbl">Item Discounts:</div><div class="tot-val">- ${money(itemDiscountTotal)}</div></div>` : ""}${itemDiscountTotal > 0 ? `<div class="tot-row"><div class="tot-lbl">Net Subtotal:</div><div class="tot-val">${money(netSubtotal)}</div></div>` : ""}<div class="tot-row"><div class="tot-lbl">Overall Discount${amount(po.discountPct) > 0 ? ` (${amount(po.discountPct)}%)` : ""}:</div><div class="tot-val">${discountAmount ? money(discountAmount) : ""}</div></div><div class="tot-row"><div class="tot-lbl">Tax Amount:</div><div class="tot-val"></div></div><div class="tot-row tot-final"><div class="tot-lbl">Total:</div><div class="tot-val">${money(total)}</div></div></div></div>
<div class="words-box"><span class="words-lbl">Total Amount in words:</span> ${escapeHtml(numberToWords(total))}</div>
<div class="sig-wrap"><div class="sig-col"><div class="sig-title">Prepared by:</div><div class="sig-name">Name: ${escapeHtml(po.buyerName || "")}</div><div class="sig-line"></div><div class="sig-date">Date: <span></span></div></div><div class="sig-col"><div class="sig-title">Verified/Approved by:</div><div class="sig-name">Name: ${escapeHtml(po.approverName || "")}</div><div class="sig-line"></div><div class="sig-date">Date: <span></span></div></div><div class="sig-col"><div class="sig-title">Conforme:</div><div class="sig-name">Name: ${escapeHtml(po.requisitioner || "")}</div><div class="sig-line"></div><div class="sig-date">Date: <span></span></div></div></div>
<div class="meta-note">Generated automatically from purchasing data. For evaluation, the uploaded official PO document is used as the transaction's source document.</div>
</body></html>`;
}

function displayStatus(hasSubmitted: boolean, pendingLink: boolean, hasDocument: boolean) {
  if (hasSubmitted) return { label: "Evaluation completed", tone: "done" };
  if (pendingLink) return { label: "Sent · awaiting response", tone: "pending" };
  if (hasDocument) return { label: "Ready to send", tone: "ready" };
  return { label: "Needs PO document", tone: "missing" };
}

export default function PurchaseOrderGenerator({ workspaceName, workspaceAddress, workspaceEmail, currentUser, canEdit, onNotify }: Props) {
  const [poRecords, setPoRecords] = useState<PurchaseOrderSheetRecord[]>([]);
  const [prfRecords, setPrfRecords] = useState<PrfRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [query, setQuery] = useState("");
  const [queueOnly, setQueueOnly] = useState(true);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [requisitionerEmail, setRequisitionerEmail] = useState("");
  const [amdEmail, setAmdEmail] = useState("");
  const [requisitionerLookupOpen, setRequisitionerLookupOpen] = useState(false);
  const [amdLookupOpen, setAmdLookupOpen] = useState(false);
  const [requisitioners, setRequisitioners] = useState<{ name: string; email: string; department?: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [createdLinks, setCreatedLinks] = useState<{ requisitioner?: string; amd_personnel?: string }>({});
  const createdLink = createdLinks.requisitioner || createdLinks.amd_personnel || "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedPOs, setSavedPOs] = useState<PurchaseOrder[]>([]);
  const [evaluationRows, setEvaluationRows] = useState<Record<string, unknown>[]>([]);
  const [evaluationLinks, setEvaluationLinks] = useState<PublicEvaluationLink[]>([]);

  const sync = async () => {
    setLoading(true);
    setLiveError("");
    try {
      const response = await fetch("/api/po-lookup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Google Sheet is unavailable.");
      setPoRecords(Array.isArray(data.poRecords) ? data.poRecords : []);
      setPrfRecords(Array.isArray(data.prfRecords) ? data.prfRecords : []);
      setRequisitioners(Array.isArray(data.requisitioners) ? data.requisitioners : []);
      setFetchedAt(data.fetchedAt || new Date().toISOString());
      onNotify(`Google Sheet synced · ${Array.isArray(data.poRecords) ? data.poRecords.length : 0} PO groups loaded.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync the Google Sheet.";
      setLiveError(message);
      onNotify(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void sync();
    const timer = window.setInterval(() => void sync(), 60_000);
    const stopPos = subscribePurchaseOrders((items) => setSavedPOs(items), (e) => onNotify(e.message));
    const stopEvaluations = subscribePurchaseOrderEvaluations((items) => setEvaluationRows(items), (e) => onNotify(e.message));
    const stopLinks = subscribeEvaluationLinks((items) => setEvaluationLinks(items), (e) => onNotify(e.message));
    return () => {
      window.clearInterval(timer);
      stopPos();
      stopEvaluations();
      stopLinks();
    };
  }, []);

  const savedByPo = useMemo(() => {
    const map = new Map<string, PurchaseOrder>();
    savedPOs.forEach((po) => map.set(normalizeKey(po.poNumber), po));
    return map;
  }, [savedPOs]);

  const submittedByPo = useMemo(() => {
    const set = new Set<string>();
    evaluationRows.forEach((row) => {
      const po = normalizeKey(row.poNumber);
      if (!po) return;
      const role = String(row.evaluatorRole || "").toLowerCase();
      const source = String(row.source || "").toLowerCase();
      if (role === "requisitioner" || source.includes("requisitioner web evaluation")) set.add(po);
    });
    return set;
  }, [evaluationRows]);

  const pendingLinkByRole = useMemo(() => {
    const map = new Map<string, PublicEvaluationLink>();
    evaluationLinks.forEach((link) => {
      if (link.status !== "pending" || !link.po?.poNumber) return;
      const role = link.evaluatorRole === "amd_personnel" ? "amd_personnel" : "requisitioner";
      map.set(`${normalizeKey(link.po.poNumber)}::${role}`, link);
    });
    return map;
  }, [evaluationLinks]);

  const getPendingLink = (poNumber: string, role: "requisitioner" | "amd_personnel") =>
    pendingLinkByRole.get(`${normalizeKey(poNumber)}::${role}`);

  const records = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = poRecords.filter((group) => {
      const key = normalizeKey(group.poNumber);
      const hasSubmitted = submittedByPo.has(key);
      if (queueOnly && hasSubmitted) return false;
      if (!q) return true;
      return [group.poNumber, ...group.matches.flatMap((m) => [m.prfNumber, m.supplier, m.itemsDelivered, m.requisitioner, m.department])]
        .join(" ").toLowerCase().includes(q);
    });
    return all;
  }, [poRecords, query, queueOnly, submittedByPo]);

  function buildFromSheet(group: PurchaseOrderSheetRecord): PurchaseOrder {
    const matches = group.matches || [];
    const first = matches.find((item) => item.supplier || item.prfNumber || item.itemsDelivered) || matches[0] || {};
    const prf = prfRecords.find((p) => p.prfNumber && first.prfNumber && p.prfNumber.toLowerCase() === first.prfNumber.toLowerCase());
    const rows: PurchaseOrderLine[] = matches
      .filter((row) => row.itemsDelivered || row.unitPrice || row.quantity)
      .map((row, index) => {
        const qty = row.quantity ?? "";
        const unitPrice = row.unitPrice ?? "";
        const calculated = amount(qty) * amount(unitPrice);
        return {
          line: index + 1,
          description: row.itemsDelivered || prf?.itemDescription || "",
          unit: row.unit || "pcs",
          qty,
          unitPrice,
          itemDiscountPct: row.itemDiscountPct ?? 0,
          lineTotal: row.lineTotal ?? (calculated || ""),
        };
      });
    const items = rows.length ? rows : [{ line: 1, description: first.itemsDelivered || prf?.itemDescription || "", unit: first.unit || "pcs", qty: first.quantity ?? "", unitPrice: first.unitPrice ?? "", itemDiscountPct: first.itemDiscountPct ?? 0, lineTotal: first.lineTotal ?? "" }];
    const calculatedSubtotal = items.reduce((sum, item) => sum + amount(item.qty) * amount(item.unitPrice), 0);
    const calculatedTotal = items.reduce((sum, item) => sum + (amount(item.lineTotal) || amount(item.qty) * amount(item.unitPrice)), 0);
    const sheetSubtotal = amount((first as any).subtotal);
    const sheetTotal = amount((first as any).total);
    const subtotal = sheetSubtotal || calculatedSubtotal;
    const total = sheetTotal || calculatedTotal;
    const id = `po-${String(group.poNumber).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const saved = savedByPo.get(normalizeKey(group.poNumber));
    return {
      id,
      poNumber: group.poNumber,
      prfNumber: first.prfNumber || prf?.prfNumber || saved?.prfNumber || "",
      requisitioner: first.requisitioner || prf?.requisitioner || saved?.requisitioner || "",
      requisitionerEmail: first.requisitionerEmail || prf?.email || saved?.requisitionerEmail || "",
      department: first.department || prf?.department || saved?.department || "",
      purpose: first.purpose || prf?.purpose || saved?.purpose || "",
      vendorName: first.supplier || saved?.vendorName || "",
      vendorAttention: first.attention || saved?.vendorAttention || "",
      vendorPhone: first.vendorPhone || saved?.vendorPhone || "",
      vendorEmail: first.vendorEmail || saved?.vendorEmail || "",
      vendorAddress: first.vendorAddress || saved?.vendorAddress || "",
      vendorCity: first.vendorCity || saved?.vendorCity || "",
      deliveryAddress: first.deliveryAddress || saved?.deliveryAddress || "",
      orderDate: first.orderDate || saved?.orderDate || new Date().toISOString().slice(0, 10),
      expectedDate: first.expectedDate || saved?.expectedDate || "",
      paymentTerms: first.paymentTerms || saved?.paymentTerms || "",
      notes: first.notes || saved?.notes || "",
      subtotal: saved?.subtotal ?? subtotal,
      discountPct: saved?.discountPct ?? amount((first as any).discountPct),
      discountAmt: saved?.discountAmt ?? amount((first as any).discountAmt),
      total: saved?.total ?? total,
      buyerName: first.buyerName || saved?.buyerName || currentUser?.displayName || "",
      buyerEmail: first.buyerEmail || saved?.buyerEmail || currentUser?.email || "",
      approverName: saved?.approverName || "",
      actualDeliveryDate: first.actualDeliveryDate || saved?.actualDeliveryDate || "",
      receivedBy: first.receivedBy || saved?.receivedBy || "",
      status: first.status || saved?.status || "Pending",
      createdAt: saved?.createdAt || new Date().toISOString(),
      source: saved?.source || "Google Sheet",
      items: saved?.items?.length ? saved.items : items,
      documentProvider: saved?.documentProvider,
      documentPages: saved?.documentPages,
      documentUrl: saved?.documentUrl,
      documentPath: saved?.documentPath,
      documentName: saved?.documentName,
      documentMimeType: saved?.documentMimeType,
      documentSize: saved?.documentSize,
      documentUploadedAt: saved?.documentUploadedAt,
      documentUploadedBy: saved?.documentUploadedBy,
      documentSource: saved?.documentSource,
    };
  }

  const requisitionerContacts = useMemo(() => {
    const map = new Map<string, { name: string; email: string; department?: string }>();
    requisitioners.forEach((item) => {
      if (!item?.name || !item?.email) return;
      map.set(normalizePerson(item.name), item);
    });
    poRecords.forEach((group) => (group.matches || []).forEach((item) => {
      if (!item.requisitioner || !item.requisitionerEmail) return;
      const key = normalizePerson(item.requisitioner);
      if (!map.has(key)) map.set(key, { name: item.requisitioner, email: item.requisitionerEmail, department: item.department });
    }));
    prfRecords.forEach((item) => {
      if (!item.requisitioner || !item.email) return;
      const key = normalizePerson(item.requisitioner);
      if (!map.has(key)) map.set(key, { name: item.requisitioner, email: item.email, department: item.department });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [requisitioners, poRecords, prfRecords]);

  const requisitionerSuggestions = useMemo(() => {
    const q = normalizePerson(selectedPo?.requisitioner || "");
    const filtered = q ? requisitionerContacts.filter((item) => normalizePerson(item.name).includes(q) || item.email.toLowerCase().includes(q)) : requisitionerContacts;
    return filtered.slice(0, 8);
  }, [selectedPo?.requisitioner, requisitionerContacts]);

  const selectRequisitioner = (item: { name: string; email: string }) => {
    if (!selectedPo) return;
    setSelectedPo({ ...selectedPo, requisitioner: item.name, requisitionerEmail: item.email });
    setRequisitionerEmail(item.email);
    setRequisitionerLookupOpen(false);
  };

  const selectRecord = (group: PurchaseOrderSheetRecord) => {
    const po = buildFromSheet(group);
    const pendingReq = getPendingLink(po.poNumber, "requisitioner");
    const pendingAmd = getPendingLink(po.poNumber, "amd_personnel");
    const amdMatch = requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(po.receivedBy));
    setSelectedPo(po);
    setRequisitionerEmail(pendingReq?.evaluatorEmail || pendingReq?.requisitionerEmail || po.requisitionerEmail || "");
    setAmdEmail(pendingAmd?.evaluatorEmail || pendingAmd?.amdEmail || amdMatch?.email || "");
    setCreatedLinks({
      requisitioner: pendingReq ? `${window.location.origin}/evaluate/${pendingReq.token}` : "",
      amd_personnel: pendingAmd ? `${window.location.origin}/evaluate/${pendingAmd.token}` : "",
    });
    setPreviewOpen(true);
  };

  const uploadOfficialPo = async (files: File[]) => {
    if (!selectedPo) return;
    const chosen = files.filter(Boolean);
    if (!chosen.length) return;
    if (!cloudinaryConfigured()) {
      onNotify(getCloudinarySetupMessage());
      return;
    }
    const totalBytes = chosen.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 50 * 1024 * 1024) {
      onNotify("The selected PO pages are larger than 50 MB total. Please compress the scans or upload fewer pages at once.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const folder = `sisc-purchase-orders/${String(selectedPo.poNumber || selectedPo.id).replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
      const progress = chosen.map(() => 0);
      const uploaded = await Promise.all(chosen.map((file, index) => uploadPoDocumentToCloudinary(file, folder, (percent) => {
        progress[index] = percent;
        const average = progress.reduce((sum, value) => sum + value, 0) / progress.length;
        setUploadProgress(Math.round(average));
      })));
      const documentPages = uploaded.map((doc, index) => ({
        url: doc.url,
        publicId: doc.publicId,
        resourceType: doc.resourceType,
        format: doc.format,
        name: doc.originalFilename || chosen[index].name,
        mimeType: chosen[index].type || undefined,
        size: doc.bytes || chosen[index].size,
        pages: doc.pages,
      }));
      const first = documentPages[0];
      const updated = {
        ...selectedPo,
        documentProvider: "cloudinary" as const,
        documentPages,
        documentUrl: first.url,
        documentName: documentPages.length === 1 ? first.name : `${selectedPo.poNumber} · ${documentPages.length} pages`,
        documentMimeType: first.mimeType || `application/${first.format || "octet-stream"}`,
        documentSize: documentPages.reduce((sum, doc) => sum + Number(doc.size || 0), 0),
        documentUploadedAt: new Date().toISOString(),
        documentUploadedBy: currentUser?.email || "",
        documentSource: "cloudinary-official-po",
        documentPath: first.publicId,
      } as PurchaseOrder;
      setSelectedPo(updated);
      await savePurchaseOrderCloud(updated);
      const pendingReq = getPendingLink(updated.poNumber, "requisitioner");
      const pendingAmd = getPendingLink(updated.poNumber, "amd_personnel");
      await Promise.all([
        pendingReq ? updateEvaluationLinkPOCloud(pendingReq.token, updated) : Promise.resolve(),
        pendingAmd ? updateEvaluationLinkPOCloud(pendingAmd.token, updated) : Promise.resolve(),
      ]);
      onNotify(`Official PO ${updated.poNumber} stored in Cloudinary${documentPages.length > 1 ? ` · ${documentPages.length} pages` : ""}.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not store the PO document.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const resolveReqEmail = () =>
    requisitionerEmail.trim() ||
    requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(selectedPo?.requisitioner))?.email ||
    selectedPo?.requisitionerEmail ||
    "";

  const resolveAmdEmail = () =>
    amdEmail.trim() ||
    requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(selectedPo?.receivedBy))?.email ||
    "";

  const createEvaluationLinks = async () => {
    if (!selectedPo) return;
    const reqEmail = resolveReqEmail();
    const amdAuto = resolveAmdEmail();
    const nextLinks: { requisitioner?: string; amd_personnel?: string } = {};
    try {
      if (selectedPo.requisitioner) {
        const existingReq = getPendingLink(selectedPo.poNumber, "requisitioner");
        if (existingReq) {
          nextLinks.requisitioner = `${window.location.origin}/evaluate/${existingReq.token}`;
        } else {
          const result = await createEvaluationLinkCloud({
            po: { ...selectedPo, requisitionerEmail: reqEmail },
            requisitionerEmail: reqEmail,
            requisitionerName: selectedPo.requisitioner,
            evaluatorRole: "requisitioner",
            evaluatorName: selectedPo.requisitioner,
            evaluatorEmail: reqEmail,
            createdBy: currentUser?.email || "",
            workspaceName,
          });
          nextLinks.requisitioner = result.url;
        }
      }
      if (selectedPo.receivedBy) {
        const existingAmd = getPendingLink(selectedPo.poNumber, "amd_personnel");
        if (existingAmd) {
          nextLinks.amd_personnel = `${window.location.origin}/evaluate/${existingAmd.token}`;
        } else {
          const result = await createEvaluationLinkCloud({
            po: { ...selectedPo, requisitionerEmail: reqEmail },
            requisitionerEmail: reqEmail,
            requisitionerName: selectedPo.requisitioner,
            evaluatorRole: "amd_personnel",
            evaluatorName: selectedPo.receivedBy,
            evaluatorEmail: amdAuto,
            amdName: selectedPo.receivedBy,
            amdEmail: amdAuto,
            createdBy: currentUser?.email || "",
            workspaceName,
          });
          nextLinks.amd_personnel = result.url;
        }
      }
      setCreatedLinks(nextLinks);
      onNotify([
        nextLinks.requisitioner ? "Requisitioner link ready." : "Requisitioner link not created.",
        nextLinks.amd_personnel ? "AMD Personnel link ready." : selectedPo.receivedBy ? "AMD link not created." : "No Received by person is set for AMD evaluation.",
      ].join(" "));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not create the evaluation links.");
    }
  };

  const sendOneEvaluation = async (role: "requisitioner" | "amd_personnel") => {
    if (!selectedPo?.documentUrl) throw new Error("Store the official PO first. The stored Cloudinary document will be attached automatically.");
    const reqEmail = resolveReqEmail();
    const targetEmail = role === "requisitioner" ? reqEmail : resolveAmdEmail();
    const targetName = role === "requisitioner" ? selectedPo.requisitioner : selectedPo.receivedBy;
    if (!targetName) throw new Error(role === "requisitioner" ? "Add a requisitioner name before sending." : "No Received by person is set for AMD evaluation.");
    if (!targetEmail) throw new Error(role === "requisitioner" ? "No requisitioner email was found. Enter a manual email or check the Employee sheet." : "No AMD / Received by email was found. Enter a manual email or check the Employee sheet.");

    let link = role === "requisitioner" ? createdLinks.requisitioner : createdLinks.amd_personnel;
    if (!link) {
      const pending = getPendingLink(selectedPo.poNumber, role);
      if (pending) link = `${window.location.origin}/evaluate/${pending.token}`;
    }
    if (!link) {
      const result = await createEvaluationLinkCloud({
        po: { ...selectedPo, requisitionerEmail: reqEmail },
        requisitionerEmail: reqEmail,
        requisitionerName: selectedPo.requisitioner,
        evaluatorRole: role,
        evaluatorName: targetName,
        evaluatorEmail: targetEmail,
        amdName: selectedPo.receivedBy,
        amdEmail: role === "amd_personnel" ? targetEmail : resolveAmdEmail(),
        createdBy: currentUser?.email || "",
        workspaceName,
      });
      link = result.url;
      setCreatedLinks((prev) => ({ ...prev, [role]: link }));
    }

    const response = await fetch("/api/send-evaluation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: targetName,
        evaluatorRole: role,
        evaluatorName: targetName,
        evaluatorEmail: targetEmail,
        requisitionerName: selectedPo.requisitioner,
        requisitionerEmail: reqEmail,
        amdName: selectedPo.receivedBy,
        amdEmail: role === "amd_personnel" ? targetEmail : resolveAmdEmail(),
        po: selectedPo,
        poDocumentUrl: selectedPo.documentUrl,
        poDocumentName: selectedPo.documentName || `${selectedPo.poNumber}.pdf`,
        poDocuments: (selectedPo.documentPages || [{ url: selectedPo.documentUrl, name: selectedPo.documentName || `${selectedPo.poNumber}.pdf`, mimeType: selectedPo.documentMimeType }]).map((doc) => ({ url: doc.url, name: doc.name, mimeType: doc.mimeType })),
        evaluationUrl: link,
        workspace: { name: workspaceName, address: workspaceAddress, email: workspaceEmail },
      }),
    });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Email service rejected the request.");
    return { role, recipient: data?.recipient || targetEmail, attachmentCount: data?.attachmentCount || 1, link };
  };

  const sendEmail = async () => {
    if (!selectedPo) return;
    if (!selectedPo.documentUrl) {
      onNotify("Store the official PO first. The stored Cloudinary document will be attached automatically.");
      return;
    }
    setSending(true);
    try {
      const jobs: Promise<any>[] = [];
      if (resolveReqEmail() && selectedPo.requisitioner) jobs.push(sendOneEvaluation("requisitioner"));
      if (resolveAmdEmail() && selectedPo.receivedBy) jobs.push(sendOneEvaluation("amd_personnel"));
      if (!jobs.length) {
        const missing = selectedPo.receivedBy ? "Enter at least one valid Requisitioner or AMD/Received by email." : "Enter a valid Requisitioner email. AMD will be available when a Received by person is set.";
        throw new Error(missing);
      }
      const results = await Promise.allSettled(jobs);
      const sent = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (sent.length) onNotify(sent.map((item) => `${item.role === "amd_personnel" ? "AMD" : "Requisitioner"} sent to ${item.recipient} · ${item.attachmentCount} PO file${item.attachmentCount > 1 ? "s" : ""}.`).join(" "));
      if (failed.length) onNotify(failed.map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason)).join(" "));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not send the evaluation requests.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> PO STORAGE & EVALUATION QUEUE</div><h1>Find the PO, store the official document, then send evaluation</h1><p>The Google Sheet remains the source for purchasing details. The official scanned/uploaded PO is stored in Cloudinary and automatically reused for the requisitioner evaluation email.</p></div>
        <div className="po-generator-actions"><button className="btn secondary" onClick={() => void sync()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> {loading ? "Syncing…" : "Sync Google Sheet"}</button></div>
      </div>

      <div className={`live-sheet-status ${liveError ? "error" : ""}`}><div className="live-sheet-status-main"><span className="live-dot"/><div><b>{liveError ? "Google Sheet needs attention" : fetchedAt ? "Google Sheet connected" : "Connecting to Google Sheet…"}</b><small>{liveError || (fetchedAt ? `Last sync ${new Date(fetchedAt).toLocaleTimeString()} · automatic refresh every 60 seconds` : "Loading PO and PRF details from the configured spreadsheet")}</small></div></div><span className="po-generator-count">{poRecords.length.toLocaleString()} PO groups · {prfRecords.length.toLocaleString()} PRF records</span></div>

      <div className="po-evaluation-tabs"><button className={queueOnly ? "active" : ""} onClick={() => setQueueOnly(true)}>For Supplier Evaluation <span>{poRecords.filter((g) => !submittedByPo.has(normalizeKey(g.poNumber))).length}</span></button><button className={!queueOnly ? "active" : ""} onClick={() => setQueueOnly(false)}>All PO Records <span>{poRecords.length}</span></button></div>

      <div className="panel po-generator-panel">
        <div className="po-generator-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PO, PRF, supplier, requisitioner, item…"/></div><div className="result-count">{records.length.toLocaleString()} shown</div></div>
        <div className="table-wrap"><table><thead><tr><th>PO Number</th><th>PRF</th><th>Supplier</th><th>Requisitioner</th><th>Document</th><th>Evaluation</th><th /></tr></thead><tbody>{records.map((group) => { const first = group.matches[0] || {} as PurchaseOrderSheetMatch; const saved = savedByPo.get(normalizeKey(group.poNumber)); const hasDoc = Boolean(saved?.documentUrl || saved?.documentPages?.length); const pending = pendingLinkByPo.has(normalizeKey(group.poNumber)); const done = submittedByPo.has(normalizeKey(group.poNumber)); const status = displayStatus(done, pending, hasDoc); return <tr key={group.poNumber}><td><span className="mono">{group.poNumber}</span></td><td>{first.prfNumber || "—"}</td><td><b>{first.supplier || "—"}</b></td><td>{first.requisitioner || "—"}</td><td>{hasDoc ? <span className="badge badge-ready"><FileImage size={12}/> Stored</span> : <span className="badge badge-missing"><UploadCloud size={12}/> Upload needed</span>}</td><td><span className={`badge badge-${status.tone}`}>{status.label}</span></td><td><button className="icon-action po-generate-btn" disabled={!canEdit} onClick={() => selectRecord(group)} title="Open PO storage and evaluation"><Eye size={15}/> Open</button></td></tr>; })}{!records.length && <tr><td colSpan={7}><div className="empty"><div className="empty-icon">📋</div><div className="empty-title">No POs in this queue</div><div className="empty-sub">A PO leaves the evaluation queue automatically after a requisitioner evaluation is submitted.</div></div></td></tr>}</tbody></table></div>
      </div>

      {previewOpen && selectedPo && <div className="modal-backdrop"><div className="po-generator-modal"><div className="po-generator-modal-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> PO STORAGE {selectedPo.documentUrl ? "· OFFICIAL DOCUMENT STORED" : "· WAITING FOR OFFICIAL DOCUMENT"}</div><h2>{selectedPo.poNumber}</h2><p>{selectedPo.vendorName || "Supplier"} · PRF {selectedPo.prfNumber || "—"}</p></div><button className="icon-button" onClick={() => setPreviewOpen(false)}><X size={18}/></button></div><div className="po-generator-modal-body"><div className="po-preview-card">
        {selectedPo.documentUrl ? <div className="stored-po-viewer"><div className="stored-po-toolbar"><div><b>Official PO stored in Cloudinary</b><span>{selectedPo.documentName || "Stored PO document"}</span></div><a className="btn secondary btn-sm" href={selectedPo.documentUrl} target="_blank" rel="noreferrer">Open document</a></div>{(selectedPo.documentPages || [{ url: selectedPo.documentUrl, name: selectedPo.documentName || "Official PO", mimeType: selectedPo.documentMimeType }]).map((doc, index) => <div className="stored-po-page" key={`${doc.url}-${index}`}><div className="stored-po-page-label">{doc.mimeType === "application/pdf" && doc.pages && doc.pages > 1 ? `${doc.pages}-PAGE PDF` : `PAGE ${index + 1}${selectedPo.documentPages?.length ? ` OF ${selectedPo.documentPages.length}` : ""}`}</div>{doc.mimeType?.startsWith("image/") ? <img src={doc.url} alt={`Official PO ${selectedPo.poNumber} page ${index + 1}`} className="stored-po-image"/> : <iframe title={`Official PO ${selectedPo.poNumber} page ${index + 1}`} className="stored-po-frame" src={doc.url}/>} </div>)}<button className="btn ghost btn-sm replace-po-btn" disabled={!canEdit || uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? `Uploading… ${uploadProgress}%` : "Replace / add PO pages"}</button></div> : <div className="po-empty-document"><div className="po-empty-document-icon"><UploadCloud size={22}/></div><b>No official PO stored yet</b><span>Upload the actual PDF or select multiple page images. The stored document—not a generated template—will be used for the requisitioner email.</span></div>}<input ref={fileInputRef} hidden type="file" accept="application/pdf,image/*" multiple onChange={(e) => e.target.files?.length && void uploadOfficialPo(Array.from(e.target.files))}/></div>
        <aside className="po-send-panel"><div className="section-kicker">EVALUATION WORKFLOW</div><h3>1. Store official PO</h3><p>Upload the actual PO PDF or scan. PDF files can contain multiple pages, and you can also select multiple page images. The stored Cloudinary document is the exact source attached to both evaluator emails.</p><button className="upload-drop-btn" disabled={!canEdit || uploading} onClick={() => fileInputRef.current?.click()}><UploadCloud size={18}/><span>{selectedPo.documentUrl ? "Replace stored PO" : "Upload / Scan PO"}</span><small>PDF, JPG, PNG · up to 25 MB per file · multi-page supported</small></button>{selectedPo.documentUrl && <div className="stored-doc-callout"><CheckCircle2 size={16}/><div><b>PO document stored in Cloudinary</b><span>{selectedPo.documentName || "Official PO"}</span><small>{selectedPo.documentUploadedAt ? `Uploaded ${new Date(selectedPo.documentUploadedAt).toLocaleString()}` : ""}{selectedPo.documentPages?.length ? ` · ${selectedPo.documentPages.length} stored file${selectedPo.documentPages.length > 1 ? "s" : ""}` : ""}</small></div></div>}{uploading && <div className="po-upload-progress"><div><span>Uploading official PO to Cloudinary</span><b>{uploadProgress}%</b></div><i style={{ width: `${uploadProgress}%` }}/></div>}
          <div className="po-delivery-summary"><div><span>Expected delivery</span><b>{selectedPo.expectedDate || "—"}</b></div><div><span>Actual delivery</span><b>{selectedPo.actualDeliveryDate || "—"}</b></div><div><span>Status</span><b>{selectedPo.status || "Pending"}</b></div><div><span>Received by</span><b>{selectedPo.receivedBy || "—"}</b></div></div><div className="section-kicker workflow-second">2. Requisitioner evaluation</div><div className="field requisitioner-picker-field"><span>Requisitioner</span><div className="autocomplete-wrap"><div className="po-input-wrap requisitioner-input-wrap"><UserCheck size={14} className="po-search-icon"/><input value={selectedPo.requisitioner} onFocus={() => setRequisitionerLookupOpen(true)} onChange={(e) => { const next = e.target.value; const exact = requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(next)); setSelectedPo({ ...selectedPo, requisitioner: next, requisitionerEmail: exact?.email || "" }); setRequisitionerEmail(exact?.email || ""); setRequisitionerLookupOpen(true); }} onBlur={() => window.setTimeout(() => setRequisitionerLookupOpen(false), 180)} placeholder="Type requisitioner name"/></div>{requisitionerLookupOpen && requisitionerSuggestions.length > 0 && <div className="po-suggestions requisitioner-suggestions">{requisitionerSuggestions.map((item) => <button type="button" key={`${normalizePerson(item.name)}-${item.email}`} onMouseDown={(e) => e.preventDefault()} onClick={() => selectRequisitioner(item)}><div className="po-suggestion-top"><b>{item.name}</b><span>{item.department || "REQUISITIONER"}</span></div><small>{item.email}</small></button>)}</div>}</div></div><label className="field"><span>Requisitioner email · auto-resolved from Employee sheet</span><input type="email" value={requisitionerEmail} onChange={(e) => { setRequisitionerEmail(e.target.value); setSelectedPo({ ...selectedPo, requisitionerEmail: e.target.value }); }} placeholder="Auto-filled from Employee sheet · manual override allowed"/></label><div className="section-kicker workflow-second">3. AMD Personnel / Received by evaluation</div><div className="field"><span>Received by / AMD Personnel</span><div className="autocomplete-wrap"><div className="po-input-wrap requisitioner-input-wrap"><UserCheck size={14} className="po-search-icon"/><input value={selectedPo.receivedBy} onFocus={() => setAmdLookupOpen(true)} onChange={(e) => { const next = e.target.value; const exact = requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(next)); setSelectedPo({ ...selectedPo, receivedBy: next }); setAmdEmail(exact?.email || ""); setAmdLookupOpen(true); }} onBlur={() => window.setTimeout(() => setAmdLookupOpen(false), 180)} placeholder="Type Received by / AMD personnel name"/></div>{amdLookupOpen && requisitionerContacts.filter((item) => { const q = normalizePerson(selectedPo.receivedBy); return !q || normalizePerson(item.name).includes(q) || item.email.toLowerCase().includes(q); }).slice(0,8).map((item) => <div className="po-suggestions requisitioner-suggestions" key={`${normalizePerson(item.name)}-${item.email}`}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setSelectedPo({ ...selectedPo, receivedBy: item.name }); setAmdEmail(item.email); setAmdLookupOpen(false); }}><div className="po-suggestion-top"><b>{item.name}</b><span>{item.department || "AMD / EMPLOYEE"}</span></div><small>{item.email}</small></button></div>)}</div></div><label className="field"><span>AMD / Received by email · auto-resolved from Employee sheet</span><input type="email" value={amdEmail} onChange={(e) => setAmdEmail(e.target.value)} placeholder="Auto-filled from Employee sheet · manual override allowed"/></label><div className="po-action-stack"><button className="btn secondary" onClick={() => void savePurchaseOrderCloud({ ...selectedPo, requisitionerEmail: resolveReqEmail() })}><CheckCircle2 size={16}/> Save PO record</button><button className="btn secondary" onClick={() => void createEvaluationLinks()}><UserCheck size={16}/> Create evaluation links</button><button className="btn primary" disabled={sending || !selectedPo.documentUrl} onClick={() => void sendEmail()}><Send size={16}/> {sending ? "Sending…" : "Send PO + evaluations"}</button></div>{!selectedPo.documentUrl && <div className="po-warning-note"><UploadCloud size={14}/><span>Send stays locked until an official PO is stored, so the system cannot accidentally attach a generated or outdated document.</span></div>}{(createdLinks.requisitioner || createdLinks.amd_personnel) && <div className="po-link-box"><small>Evaluation links</small>{createdLinks.requisitioner && <div><b>Requisitioner:</b> <a href={createdLinks.requisitioner} target="_blank" rel="noreferrer">{createdLinks.requisitioner}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLinks.requisitioner!).then(() => onNotify("Requisitioner link copied."))}><Mail size={13}/> Copy</button></div>}{createdLinks.amd_personnel && <div style={{marginTop:8}}><b>AMD Personnel:</b> <a href={createdLinks.amd_personnel} target="_blank" rel="noreferrer">{createdLinks.amd_personnel}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLinks.amd_personnel!).then(() => onNotify("AMD Personnel link copied."))}><Mail size={13}/> Copy</button></div>}</div>}<div className="po-source-note"><Sparkles size={14}/><span>Requisitioner and AMD Personnel each receive a separate one-time evaluation link. Both use the same official Cloudinary PO attachment, while their four-criterion results are saved separately in the evaluation records.</span></div></aside></div></div></div>}
    </div>
  );
}
