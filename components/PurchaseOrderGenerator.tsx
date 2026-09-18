"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileImage,
  FileText,
  Mail,
  Printer,
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
  uploadPurchaseOrderDocumentCloud,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PublicEvaluationLink,
} from "../lib/firestore";

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
@page { size: Letter; margin: .25in .35in .4in; }
*{box-sizing:border-box;margin:0;padding:0} body{font-family:Arial,Helvetica,sans-serif;font-size:8.5pt;color:#000;background:#fff;line-height:1.2}
.lh-wrap{display:table;width:100%;margin-bottom:3pt}.brand-head{display:flex;align-items:center;justify-content:center;gap:8pt}.brand-head img{width:48pt;height:48pt;object-fit:contain}.po-label{font-size:7.5pt;font-weight:700;letter-spacing:.6px;margin-bottom:2pt}.lh-left{display:table-cell;width:72%;vertical-align:middle;text-align:center}.lh-name{font-size:11pt;font-weight:700;text-transform:uppercase;letter-spacing:.45px}.lh-addr{font-size:7.2pt;line-height:1.35;margin-top:2pt;color:#333}.lh-right{display:table-cell;width:28%;vertical-align:middle;text-align:right}.po-box{border:1.5px solid #000;text-align:center;padding:5pt 12pt;display:inline-block;min-width:112px}.po-box-num{font-size:10.5pt;font-weight:700}.hdr-rule{border:0;border-top:1.5px solid #000;margin:4pt 0 6pt}
.vnd-wrap{display:table;width:100%;border:1px solid #aaa;margin-bottom:5pt}.vnd-left{display:table-cell;width:58%;vertical-align:top;padding:4pt 6pt;border-right:1px solid #aaa}.vnd-right{display:table-cell;width:42%;vertical-align:top;padding:4pt 6pt}.f-row{display:table;width:100%;margin-bottom:2.5pt}.f-lbl{display:table-cell;white-space:nowrap;font-size:7.2pt;font-weight:700;color:#444;padding-right:6pt;width:1%}.f-val{display:table-cell;font-size:7.7pt;border-bottom:1px solid #bbb;width:100%;vertical-align:bottom;padding-bottom:1pt}.f-val-nb{display:table-cell;font-size:7.7pt;width:100%;vertical-align:bottom}.deliver-note{font-size:7.8pt;margin-bottom:4pt;font-style:italic}
table.items{width:100%;border-collapse:collapse;border:1px solid #000;table-layout:fixed}table.items thead th{font-size:7.5pt;font-weight:700;padding:3pt 4pt;border:1px solid #000;text-align:center;background:#fff}table.items tbody td{font-size:7.5pt;padding:2.5pt 4pt;border-right:1px solid #000;border-bottom:1px solid #ddd;vertical-align:top}.tl{text-align:left}.tc{text-align:center}.tr{text-align:right}.nothing-follows{text-align:center;font-size:7.2pt;font-weight:700;border:1px solid #000;border-top:none;padding:2.5pt 4pt;letter-spacing:.5px}
.bot-wrap{display:table;width:100%;border:1px solid #000;border-top:none}.bot-left{display:table-cell;width:55%;vertical-align:top;padding:4pt 6pt;border-right:1px solid #000;font-size:7.7pt;line-height:1.45}.bot-right{display:table-cell;width:45%;vertical-align:top}.tot-row{display:table;width:100%;border-bottom:1px solid #ddd}.tot-row:last-child{border-bottom:none}.tot-lbl{display:table-cell;padding:2.5pt 5pt;font-size:7.5pt}.tot-val{display:table-cell;padding:2.5pt 5pt;text-align:right;font-size:7.5pt;white-space:nowrap;border-left:1px solid #ddd;min-width:80pt}.tot-final .tot-lbl,.tot-final .tot-val{font-weight:700;font-size:8.5pt;border-top:1.5px solid #000;padding-top:4pt}.words-box{border:1px solid #000;border-top:none;padding:3pt 6pt;font-size:7.3pt}.words-lbl{font-weight:700}
.sig-wrap{display:table;width:100%;margin-top:8pt}.sig-col{display:table-cell;width:33.3%;padding-right:8pt;vertical-align:top;font-size:7.7pt}.sig-col:last-child{padding-right:0}.sig-title{font-weight:700;font-size:7.5pt;margin-bottom:8pt}.sig-name{font-size:8pt;font-weight:700;min-height:12pt}.sig-line{border-top:1px solid #000;padding-top:2pt;font-size:7.5pt}.sig-date{margin-top:3pt;font-size:7.2pt}.sig-date span{display:inline-block;border-bottom:1px solid #000;width:80pt}.meta-note{font-size:6.2pt;color:#666;margin-top:5pt}
</style></head><body>
<div class="lh-wrap"><div class="lh-left"><div class="brand-head"><img src="/sisc-logo.png" alt="SISC logo"><div><div class="lh-name">${escapeHtml(workspace.name || "Southville International School and Colleges")}</div><div class="lh-addr">${escapeHtml(workspace.address || "")}${workspace.address && workspace.email ? "<br>" : ""}${escapeHtml(workspace.email || "")}</div></div></div></div><div class="lh-right"><div class="po-box"><div class="po-label">PURCHASE ORDER</div><div class="po-box-num">${escapeHtml(po.poNumber)}</div></div></div></div>

<hr class="hdr-rule">
<div class="vnd-wrap"><div class="vnd-left"><div class="f-row"><div class="f-lbl">Company Name:</div><div class="f-val">${escapeHtml(po.vendorName)}</div></div><div class="f-row"><div class="f-lbl">Attention:</div><div class="f-val">${escapeHtml(po.vendorAttention || "")}</div></div><div class="f-row"><div class="f-lbl">Tel. / Fax No.:</div><div class="f-val">${escapeHtml(po.vendorPhone || "")}</div></div><div class="f-row"><div class="f-lbl">Delivery Address:</div><div class="f-val">${escapeHtml(po.deliveryAddress || "")}</div></div></div><div class="vnd-right"><div class="f-row"><div class="f-lbl">Date:</div><div class="f-val-nb">${escapeHtml(fmtDate(po.orderDate))}</div></div><div class="f-row"><div class="f-lbl">Delivery Date:</div><div class="f-val-nb">${escapeHtml(fmtDate(po.expectedDate))}</div></div><div class="f-row"><div class="f-lbl">Terms:</div><div class="f-val-nb">${escapeHtml(po.paymentTerms || "")}</div></div></div></div>
<div class="deliver-note">Please deliver to us the following items:</div>
<table class="items"><thead><tr><th style="width:38pt">Qty</th><th style="width:40pt">Unit</th><th>Particulars</th><th style="width:70pt">Unit Price</th><th style="width:42pt">Disc %</th><th style="width:74pt">Total Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="nothing-follows">*********************** N O T H I N G &nbsp; F O L L O W S **************************</div>
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
  const [requisitionerLookupOpen, setRequisitionerLookupOpen] = useState(false);
  const [requisitioners, setRequisitioners] = useState<{ name: string; email: string; department?: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
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
      const reqAvg = Number(row.requisitionerAvg || 0);
      const source = String(row.source || "").toLowerCase();
      if (role === "requisitioner" || source.includes("requisitioner web evaluation") || reqAvg > 0) set.add(po);
    });
    return set;
  }, [evaluationRows]);

  const pendingLinkByPo = useMemo(() => {
    const map = new Map<string, PublicEvaluationLink>();
    evaluationLinks.forEach((link) => {
      if (link.status === "pending" && link.po?.poNumber) map.set(normalizeKey(link.po.poNumber), link);
    });
    return map;
  }, [evaluationLinks]);

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
    return all.slice(0, 200);
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
    const subtotal = items.reduce((sum, item) => sum + amount(item.qty) * amount(item.unitPrice), 0);
    const total = items.reduce((sum, item) => sum + (amount(item.lineTotal) || amount(item.qty) * amount(item.unitPrice)), 0);
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
      subtotal: saved?.subtotal || subtotal,
      discountPct: saved?.discountPct || 0,
      discountAmt: saved?.discountAmt || 0,
      total: saved?.total || total,
      buyerName: first.buyerName || saved?.buyerName || currentUser?.displayName || "",
      buyerEmail: first.buyerEmail || saved?.buyerEmail || currentUser?.email || "",
      approverName: saved?.approverName || "",
      status: saved?.status || "Pending",
      actualDeliveryDate: saved?.actualDeliveryDate || "",
      receivedBy: saved?.receivedBy || "",
      createdAt: saved?.createdAt || new Date().toISOString(),
      source: saved?.source || "Google Sheet",
      items: saved?.items?.length ? saved.items : items,
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
    const pending = pendingLinkByPo.get(normalizeKey(po.poNumber));
    setSelectedPo(po);
    setRequisitionerEmail(pending?.requisitionerEmail || po.requisitionerEmail || "");
    setCreatedLink(pending ? `${window.location.origin}/evaluate/${pending.token}` : "");
    setPreviewOpen(true);
  };

  const openPrint = () => {
    if (!selectedPo) return;
    const win = window.open("", "_blank", "width=1000,height=900");
    if (!win) {
      onNotify("Please allow pop-ups to print the PO.");
      return;
    }
    win.document.write(buildPurchaseOrderHtml(selectedPo, { name: workspaceName, address: workspaceAddress, email: workspaceEmail }));
    win.document.close();
    setTimeout(() => win.print(), 350);
  };

  const saveGeneratedPo = async () => {
    if (!selectedPo) throw new Error("No purchase order is selected.");
    try {
      await savePurchaseOrderCloud(selectedPo);
      onNotify(`${selectedPo.poNumber} saved to the system.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the generated PO.";
      onNotify(message);
      throw error;
    }
  };

  const uploadOfficialPo = async (file: File) => {
    if (!selectedPo) return;
    setUploading(true);
    try {
      const metadata = await uploadPurchaseOrderDocumentCloud({ po: selectedPo, file, uploadedBy: currentUser?.email || "" });
      const updated = { ...selectedPo, ...metadata } as PurchaseOrder;
      setSelectedPo(updated);
      await savePurchaseOrderCloud(updated);
      const pending = pendingLinkByPo.get(normalizeKey(updated.poNumber));
      if (pending) await updateEvaluationLinkPOCloud(pending.token, updated);
      onNotify(`Official PO ${updated.poNumber} was stored successfully.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not store the PO document.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const createLink = async () => {
    if (!selectedPo) return;
    if (!selectedPo.requisitioner) {
      onNotify("Add a requisitioner name before creating the evaluation link.");
      return;
    }
    try {
      await saveGeneratedPo();
      const result = await createEvaluationLinkCloud({
        po: selectedPo,
        requisitionerEmail: requisitionerEmail.trim(),
        createdBy: currentUser?.email || "",
        workspaceName,
      });
      setCreatedLink(result.url);
      onNotify("Requisitioner evaluation link created.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not create the evaluation link.");
    }
  };

  const sendEmail = async () => {
    if (!selectedPo) return;
    if (!selectedPo.documentUrl) {
      onNotify("Upload and store the official PO first. That stored document will be attached to the evaluation email.");
      return;
    }
    if (!requisitionerEmail.trim()) {
      onNotify("Add the requisitioner's email before sending.");
      return;
    }
    setSending(true);
    try {
      let link = createdLink;
      if (!link) {
        const result = await createEvaluationLinkCloud({ po: selectedPo, requisitionerEmail: requisitionerEmail.trim(), createdBy: currentUser?.email || "", workspaceName });
        link = result.url;
        setCreatedLink(link);
      }
      const response = await fetch("/api/send-evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: requisitionerEmail.trim(),
          name: selectedPo.requisitioner,
          po: selectedPo,
          poDocumentUrl: selectedPo.documentUrl,
          poDocumentName: selectedPo.documentName || `${selectedPo.poNumber}.pdf`,
          evaluationUrl: link,
          workspace: { name: workspaceName, address: workspaceAddress, email: workspaceEmail },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Email service rejected the request.");
      onNotify("Evaluation email sent with the official PO attachment.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not send the evaluation request.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> PURCHASE ORDER & EVALUATION QUEUE</div><h1>Find the PO, store the official document, then send evaluation</h1><p>The Google Sheet remains the source for purchasing details. The official scanned/uploaded PO is stored once in Firebase Storage and automatically reused for the requisitioner evaluation.</p></div>
        <div className="po-generator-actions"><button className="btn secondary" onClick={() => void sync()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> {loading ? "Syncing…" : "Sync Google Sheet"}</button></div>
      </div>

      <div className={`live-sheet-status ${liveError ? "error" : ""}`}><div className="live-sheet-status-main"><span className="live-dot"/><div><b>{liveError ? "Google Sheet needs attention" : fetchedAt ? "Google Sheet connected" : "Connecting to Google Sheet…"}</b><small>{liveError || (fetchedAt ? `Last sync ${new Date(fetchedAt).toLocaleTimeString()} · automatic refresh every 60 seconds` : "Loading PO and PRF details from the configured spreadsheet")}</small></div></div><span className="po-generator-count">{poRecords.length.toLocaleString()} PO groups · {prfRecords.length.toLocaleString()} PRF records</span></div>

      <div className="po-evaluation-tabs"><button className={queueOnly ? "active" : ""} onClick={() => setQueueOnly(true)}>For Supplier Evaluation <span>{poRecords.filter((g) => !submittedByPo.has(normalizeKey(g.poNumber))).length}</span></button><button className={!queueOnly ? "active" : ""} onClick={() => setQueueOnly(false)}>All PO Records <span>{poRecords.length}</span></button></div>

      <div className="panel po-generator-panel">
        <div className="po-generator-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PO, PRF, supplier, requisitioner, item…"/></div><div className="result-count">{records.length.toLocaleString()} shown</div></div>
        <div className="table-wrap"><table><thead><tr><th>PO Number</th><th>PRF</th><th>Supplier</th><th>Requisitioner</th><th>Document</th><th>Evaluation</th><th /></tr></thead><tbody>{records.map((group) => { const first = group.matches[0] || {} as PurchaseOrderSheetMatch; const saved = savedByPo.get(normalizeKey(group.poNumber)); const hasDoc = Boolean(saved?.documentUrl); const pending = pendingLinkByPo.has(normalizeKey(group.poNumber)); const done = submittedByPo.has(normalizeKey(group.poNumber)); const status = displayStatus(done, pending, hasDoc); return <tr key={group.poNumber}><td><span className="mono">{group.poNumber}</span></td><td>{first.prfNumber || "—"}</td><td><b>{first.supplier || "—"}</b></td><td>{first.requisitioner || "—"}</td><td>{hasDoc ? <span className="badge badge-ready"><FileImage size={12}/> Stored</span> : <span className="badge badge-missing"><UploadCloud size={12}/> Upload needed</span>}</td><td><span className={`badge badge-${status.tone}`}>{status.label}</span></td><td><button className="icon-action po-generate-btn" disabled={!canEdit} onClick={() => selectRecord(group)} title="Open PO evaluation action"><Eye size={15}/> Open</button></td></tr>; })}{!records.length && <tr><td colSpan={7}><div className="empty"><div className="empty-icon">📋</div><div className="empty-title">No POs in this queue</div><div className="empty-sub">A PO leaves the evaluation queue automatically after a requisitioner evaluation is submitted.</div></div></td></tr>}</tbody></table></div>
      </div>

      {previewOpen && selectedPo && <div className="modal-backdrop"><div className="po-generator-modal"><div className="po-generator-modal-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> PURCHASE ORDER {selectedPo.documentUrl ? "· OFFICIAL DOCUMENT STORED" : "· TEMPLATE PREVIEW"}</div><h2>{selectedPo.poNumber}</h2><p>{selectedPo.vendorName || "Supplier"} · PRF {selectedPo.prfNumber || "—"}</p></div><button className="icon-button" onClick={() => setPreviewOpen(false)}><X size={18}/></button></div><div className="po-generator-modal-body"><div className="po-preview-card">
        {selectedPo.documentUrl ? <div className="stored-po-viewer"><div className="stored-po-toolbar"><div><b>Official scanned/uploaded PO</b><span>{selectedPo.documentName || "Stored PO document"}</span></div><a className="btn secondary btn-sm" href={selectedPo.documentUrl} target="_blank" rel="noreferrer">Open full document</a></div>{selectedPo.documentMimeType?.startsWith("image/") ? <img src={selectedPo.documentUrl} alt={`Official PO ${selectedPo.poNumber}`} className="stored-po-image"/> : <iframe title={`Official PO ${selectedPo.poNumber}`} className="stored-po-frame" src={selectedPo.documentUrl}/>}<button className="btn ghost btn-sm replace-po-btn" disabled={!canEdit || uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? "Uploading…" : "Replace stored PO"}</button></div> : <div className="po-paper" dangerouslySetInnerHTML={{ __html: buildPurchaseOrderHtml(selectedPo, { name: workspaceName, address: workspaceAddress, email: workspaceEmail }) }}/>}<input ref={fileInputRef} hidden type="file" accept="application/pdf,image/*" onChange={(e) => e.target.files?.[0] && void uploadOfficialPo(e.target.files[0])}/></div>
        <aside className="po-send-panel"><div className="section-kicker">EVALUATION WORKFLOW</div><h3>1. Store official PO</h3><p>Upload the actual PO scan or PDF. It becomes the document attached to this transaction and to the requisitioner's evaluation email.</p><button className="upload-drop-btn" disabled={!canEdit || uploading} onClick={() => fileInputRef.current?.click()}><UploadCloud size={18}/><span>{selectedPo.documentUrl ? "Replace stored PO" : "Upload / Scan PO"}</span><small>PDF, JPG, PNG · max 12 MB</small></button>{selectedPo.documentUrl && <div className="stored-doc-callout"><CheckCircle2 size={16}/><div><b>PO document stored</b><span>{selectedPo.documentName || "Official PO"}</span><small>{selectedPo.documentUploadedAt ? `Uploaded ${new Date(selectedPo.documentUploadedAt).toLocaleString()}` : ""}</small></div></div>}
          <div className="section-kicker workflow-second">2. Send to requisitioner</div><div className="field requisitioner-picker-field"><span>Requisitioner</span><div className="autocomplete-wrap"><div className="po-input-wrap requisitioner-input-wrap"><UserCheck size={14} className="po-search-icon"/><input value={selectedPo.requisitioner} onFocus={() => setRequisitionerLookupOpen(true)} onChange={(e) => { const next = e.target.value; const exact = requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(next)); setSelectedPo({ ...selectedPo, requisitioner: next, requisitionerEmail: exact?.email || "" }); setRequisitionerEmail(exact?.email || ""); setRequisitionerLookupOpen(true); }} onBlur={() => window.setTimeout(() => setRequisitionerLookupOpen(false), 180)} placeholder="Type requisitioner name"/></div>{requisitionerLookupOpen && requisitionerSuggestions.length > 0 && <div className="po-suggestions requisitioner-suggestions">{requisitionerSuggestions.map((item) => <button type="button" key={`${normalizePerson(item.name)}-${item.email}`} onMouseDown={(e) => e.preventDefault()} onClick={() => selectRequisitioner(item)}><div className="po-suggestion-top"><b>{item.name}</b><span>{item.department || "REQUISITIONER"}</span></div><small>{item.email}</small></button>)}</div>}</div></div><label className="field"><span>Requisitioner email</span><input type="email" value={requisitionerEmail} onChange={(e) => { setRequisitionerEmail(e.target.value); setSelectedPo({ ...selectedPo, requisitionerEmail: e.target.value }); }} placeholder="Auto-filled from Employee sheet"/></label><div className="po-action-stack"><button className="btn secondary" onClick={() => void saveGeneratedPo()}><CheckCircle2 size={16}/> Save PO record</button><button className="btn secondary" onClick={openPrint}><Printer size={16}/> View generated PO</button><button className="btn secondary" onClick={() => void createLink()}><UserCheck size={16}/> Create evaluation link</button><button className="btn primary" disabled={sending || !selectedPo.documentUrl} onClick={() => void sendEmail()}><Send size={16}/> {sending ? "Sending…" : "Send PO + evaluation"}</button></div>{!selectedPo.documentUrl && <div className="po-warning-note"><UploadCloud size={14}/><span>Send is locked until the official PO is stored, so the wrong/old PO cannot accidentally be attached.</span></div>}{createdLink && <div className="po-link-box"><small>Evaluation link</small><a href={createdLink} target="_blank" rel="noreferrer">{createdLink}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLink).then(() => onNotify("Evaluation link copied."))}><Mail size={13}/> Copy link</button></div>}<div className="po-source-note"><Sparkles size={14}/><span>Existing Scan & Extract, manual evaluation, Google Sheet sync, annual summaries, and other system features remain available. The official PO is now the source document for the requisitioner step.</span></div></aside></div></div></div>}
    </div>
  );
}
