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
  subscribeEvaluationContacts,
  upsertEvaluationContactCloud,
  subscribeEvaluationLinks,
  subscribePurchaseOrderEvaluations,
  subscribePurchaseOrders,
  updateEvaluationLinkPOCloud,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PublicEvaluationLink,
  type EvaluationContact,
  type EvaluationContactRole,
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
  prfOnly?: boolean;
};

type PrfRecord = {
  prfNumber: string;
  poNumber?: string;
  requisitioner: string;
  email?: string;
  requisitionerEmail?: string;
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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, "").trim();
  const n = Number(text);
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

const calculateDeliveryLeadTime = (orderDate?: string, actualDeliveryDate?: string) => {
  if (!orderDate || !actualDeliveryDate) return null;
  const start = new Date(orderDate);
  const end = new Date(actualDeliveryDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
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
  const [queuePage, setQueuePage] = useState(1);
  const queuePageSize = 50;
  const [queueOnly, setQueueOnly] = useState(true);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [requisitionerEmail, setRequisitionerEmail] = useState("");
  const [amdEmail, setAmdEmail] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [requisitionerLookupOpen, setRequisitionerLookupOpen] = useState(false);
  const [amdLookupOpen, setAmdLookupOpen] = useState(false);
  const [requisitioners, setRequisitioners] = useState<{ name: string; email: string; department?: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [poExtracting, setPoExtracting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [createdLinks, setCreatedLinks] = useState<{ purchaser?: string; requisitioner?: string; amd_personnel?: string }>({});
  const createdLink = createdLinks.requisitioner || createdLinks.amd_personnel || "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedPOs, setSavedPOs] = useState<PurchaseOrder[]>([]);
  const [evaluationContacts, setEvaluationContacts] = useState<EvaluationContact[]>([]);
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
      onNotify(`Google Sheet synced · ${Array.isArray(data.poRecords) ? data.poRecords.length : 0} PO groups · ${Array.isArray(data.prfRecords) ? data.prfRecords.length : 0} PRF records loaded.`);
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
    const stopContacts = subscribeEvaluationContacts((items) => setEvaluationContacts(items), (e) => onNotify(e.message));
    return () => {
      window.clearInterval(timer);
      stopPos();
      stopEvaluations();
      stopLinks();
      stopContacts();
    };
  }, []);

  const savedByPo = useMemo(() => {
    const map = new Map<string, PurchaseOrder>();
    savedPOs.forEach((po) => {
      const key = normalizeKey(po.poNumber);
      if (key) map.set(key, po);
    });
    return map;
  }, [savedPOs]);

  const savedByPrf = useMemo(() => {
    const map = new Map<string, PurchaseOrder>();
    savedPOs.forEach((po) => {
      const key = normalizeKey(po.prfNumber);
      if (key) map.set(key, po);
    });
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

  const submittedByPrf = useMemo(() => {
    const set = new Set<string>();
    evaluationRows.forEach((row) => {
      const prf = normalizeKey(row.prfNo);
      if (!prf) return;
      const role = String(row.evaluatorRole || "").toLowerCase();
      const source = String(row.source || "").toLowerCase();
      if (role === "requisitioner" || source.includes("requisitioner web evaluation")) set.add(prf);
    });
    return set;
  }, [evaluationRows]);

  const pendingLinkByRole = useMemo(() => {
    const map = new Map<string, PublicEvaluationLink>();
    evaluationLinks.forEach((link) => {
      if (link.status !== "pending" || !link.po?.poNumber) return;
      const role = link.evaluatorRole === "amd_personnel" ? "amd_personnel" : link.evaluatorRole === "purchaser" ? "purchaser" : "requisitioner";
      map.set(`${normalizeKey(link.po.poNumber)}::${role}`, link);
    });
    return map;
  }, [evaluationLinks]);

  const getPendingLink = (poNumber: string, role: "purchaser" | "requisitioner" | "amd_personnel") =>
    pendingLinkByRole.get(`${normalizeKey(poNumber)}::${role}`);

  const matchedPrfKeys = useMemo(() => {
    const keys = new Set<string>();
    poRecords.forEach((group) => (group.matches || []).forEach((match) => {
      const key = normalizeKey(match.prfNumber);
      if (key) keys.add(key);
    }));
    return keys;
  }, [poRecords]);

  const prfOnlyRecords = useMemo(() => {
    return prfRecords.filter((item) => {
      const key = normalizeKey(item.prfNumber);
      return Boolean(key) && !matchedPrfKeys.has(key);
    });
  }, [prfRecords, matchedPrfKeys]);

  const prfOnlyGroups = useMemo<PurchaseOrderSheetRecord[]>(() => {
    return prfOnlyRecords
      .filter((item) => !queueOnly || !submittedByPrf.has(normalizeKey(item.prfNumber)))
      .map((item) => ({
        poNumber: item.poNumber || "",
        prfOnly: true,
        matches: [{
          poNumber: item.poNumber || "",
          prfNumber: item.prfNumber,
          itemsDelivered: item.itemDescription || "",
          supplier: "",
          requisitioner: item.requisitioner || "",
          requisitionerEmail: item.requisitionerEmail || item.email || "",
          department: item.department || "",
          purpose: item.purpose || "",
          orderDate: item.orderDate || "",
          expectedDate: item.expectedDate || "",
          actualDeliveryDate: item.actualDeliveryDate || "",
          receivedBy: item.receivedBy || "",
          status: item.status || "Pending",
          buyerName: item.buyerName || "",
        }],
      }));
  }, [prfOnlyRecords, queueOnly, submittedByPrf]);

  useEffect(() => {
    setQueuePage(1);
  }, [query, queueOnly]);

  const records = useMemo(() => {
    const q = query.trim().toLowerCase();
    const poGroups = poRecords.filter((group) => {
      const key = normalizeKey(group.poNumber);
      const hasSubmitted = submittedByPo.has(key);
      if (queueOnly && hasSubmitted) return false;
      if (!q) return true;
      return [group.poNumber, ...group.matches.flatMap((m) => [m.prfNumber, m.supplier, m.itemsDelivered, m.requisitioner, m.department, m.purpose])]
        .join(" ").toLowerCase().includes(q);
    });

    const prfGroups = prfOnlyGroups.filter((group) => {
      if (!q) return true;
      const match: PurchaseOrderSheetMatch = group.matches[0] || { poNumber: group.poNumber || "", prfNumber: "", itemsDelivered: "", supplier: "" };
      return [group.poNumber, match.prfNumber, match.itemsDelivered, match.requisitioner, match.department, match.purpose, match.status]
        .join(" ").toLowerCase().includes(q);
    });

    return [...poGroups, ...prfGroups];
  }, [poRecords, prfOnlyGroups, query, queueOnly, submittedByPo]);

  const queuePageCount = Math.max(1, Math.ceil(records.length / queuePageSize));
  const pagedRecords = useMemo(() => {
    const safePage = Math.min(queuePage, queuePageCount);
    const start = (safePage - 1) * queuePageSize;
    return records.slice(start, start + queuePageSize);
  }, [records, queuePage, queuePageCount]);

  function buildFromSheet(group: PurchaseOrderSheetRecord): PurchaseOrder {
    const matches = group.matches || [];
    const first: PurchaseOrderSheetMatch = matches.find((item) => item.supplier || item.prfNumber || item.itemsDelivered) || matches[0] || { poNumber: group.poNumber || "", prfNumber: "", itemsDelivered: "", supplier: "" };
    const prf = prfRecords.find((p) => p.prfNumber && first.prfNumber && normalizeKey(p.prfNumber) === normalizeKey(first.prfNumber));
    const prfKey = normalizeKey(first.prfNumber || prf?.prfNumber || "");
    const saved = savedByPo.get(normalizeKey(group.poNumber || "")) || savedByPrf.get(prfKey);
    const effectivePoNumber = String(group.poNumber || saved?.poNumber || "").trim();
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
    const id = saved?.id || (effectivePoNumber ? `po-${effectivePoNumber.replace(/[^a-zA-Z0-9_-]/g, "-")}` : `po-prf-${String(first.prfNumber || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    return {
      id,
      poNumber: effectivePoNumber,
      prfNumber: first.prfNumber || prf?.prfNumber || saved?.prfNumber || "",
      requisitioner: first.requisitioner || prf?.requisitioner || saved?.requisitioner || "",
      requisitionerEmail: first.requisitionerEmail || prf?.requisitionerEmail || prf?.email || saved?.requisitionerEmail || "",
      department: first.department || prf?.department || saved?.department || "",
      purpose: first.purpose || prf?.purpose || saved?.purpose || "",
      vendorName: first.supplier || saved?.vendorName || "",
      vendorAttention: first.attention || saved?.vendorAttention || "",
      vendorPhone: first.vendorPhone || saved?.vendorPhone || "",
      vendorEmail: first.vendorEmail || saved?.vendorEmail || "",
      vendorAddress: first.vendorAddress || saved?.vendorAddress || "",
      vendorCity: first.vendorCity || saved?.vendorCity || "",
      deliveryAddress: first.deliveryAddress || saved?.deliveryAddress || "",
      orderDate: first.orderDate || prf?.orderDate || saved?.orderDate || new Date().toISOString().slice(0, 10),
      expectedDate: first.expectedDate || prf?.expectedDate || saved?.expectedDate || "",
      paymentTerms: first.paymentTerms || saved?.paymentTerms || "",
      notes: first.notes || saved?.notes || "",
      subtotal: saved?.subtotal ?? subtotal,
      discountPct: saved?.discountPct ?? amount((first as any).discountPct),
      discountAmt: saved?.discountAmt ?? amount((first as any).discountAmt),
      total: saved?.total ?? total,
      buyerName: first.buyerName || prf?.buyerName || saved?.buyerName || currentUser?.displayName || "",
      buyerEmail: first.buyerEmail || saved?.buyerEmail || currentUser?.email || "",
      approverName: saved?.approverName || "",
      actualDeliveryDate: first.actualDeliveryDate || prf?.actualDeliveryDate || saved?.actualDeliveryDate || "",
      receivedBy: first.receivedBy || prf?.receivedBy || saved?.receivedBy || "",
      status: first.status || prf?.status || saved?.status || "Pending",
      createdAt: saved?.createdAt || new Date().toISOString(),
      source: saved?.source || (group.prfOnly ? "V2 PRF Monitoring" : "Google Sheet"),
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
      deliveryLeadTimeDays: saved?.deliveryLeadTimeDays ?? calculateDeliveryLeadTime(first.orderDate || prf?.orderDate || saved?.orderDate, first.actualDeliveryDate || prf?.actualDeliveryDate || saved?.actualDeliveryDate) ?? undefined,
      pricingSource: saved?.pricingSource || (((first as any).unitPrice || (first as any).lineTotal || (first as any).total) ? "spreadsheet" : undefined),
    };
  }

  const buildFromPrf = (item: PrfRecord): PurchaseOrder => {
    const saved = savedByPrf.get(normalizeKey(item.prfNumber));
    const id = saved?.id || `po-prf-${String(item.prfNumber).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const firstSavedItem = saved?.items?.[0];
    const items: PurchaseOrderLine[] = saved?.items?.length ? saved.items : [{
      line: 1,
      description: item.itemDescription || "",
      unit: firstSavedItem?.unit || "pcs",
      qty: firstSavedItem?.qty || "",
      unitPrice: firstSavedItem?.unitPrice || "",
      itemDiscountPct: firstSavedItem?.itemDiscountPct || 0,
      lineTotal: firstSavedItem?.lineTotal || "",
    }];

    return {
      id,
      poNumber: saved?.poNumber || "",
      prfNumber: item.prfNumber || saved?.prfNumber || "",
      requisitioner: item.requisitioner || saved?.requisitioner || "",
      requisitionerEmail: item.email || saved?.requisitionerEmail || "",
      department: item.department || saved?.department || "",
      purpose: item.purpose || saved?.purpose || "",
      vendorName: saved?.vendorName || "",
      vendorAttention: saved?.vendorAttention || "",
      vendorPhone: saved?.vendorPhone || "",
      vendorEmail: saved?.vendorEmail || "",
      vendorAddress: saved?.vendorAddress || "",
      vendorCity: saved?.vendorCity || "",
      deliveryAddress: saved?.deliveryAddress || "",
      orderDate: saved?.orderDate || new Date().toISOString().slice(0, 10),
      expectedDate: saved?.expectedDate || "",
      paymentTerms: saved?.paymentTerms || "",
      notes: saved?.notes || "",
      subtotal: saved?.subtotal || 0,
      discountPct: saved?.discountPct || 0,
      discountAmt: saved?.discountAmt || 0,
      total: saved?.total || 0,
      buyerName: saved?.buyerName || currentUser?.displayName || "",
      buyerEmail: saved?.buyerEmail || currentUser?.email || "",
      approverName: saved?.approverName || "",
      actualDeliveryDate: saved?.actualDeliveryDate || "",
      receivedBy: saved?.receivedBy || "",
      status: saved?.status || "PRF only · PO not assigned",
      createdAt: saved?.createdAt || new Date().toISOString(),
      source: saved?.source || "V2 PRF Monitoring",
      items,
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
  };

  const findDirectoryContact = (name: string, role?: EvaluationContactRole) => {
    const key = normalizePerson(name);
    if (!key) return undefined;
    return evaluationContacts.find((contact) => normalizePerson(contact.name) === key && (!role || contact.roles.includes(role)))
      || evaluationContacts.find((contact) => normalizePerson(contact.name) === key);
  };

  const allEvaluatorContacts = useMemo(() => {
    const map = new Map<string, { name: string; email: string; department?: string }>();
    evaluationContacts.forEach((item) => {
      if (item?.name && item?.email) map.set(normalizePerson(item.name), { name: item.name, email: item.email, department: item.department });
    });
    requisitioners.forEach((item) => {
      if (!item?.name || !item?.email) return;
      const key = normalizePerson(item.name);
      if (!map.has(key)) map.set(key, item);
    });
    poRecords.forEach((group) => (group.matches || []).forEach((item) => {
      const name = item.requisitioner;
      const email = item.requisitionerEmail;
      if (!name || !email) return;
      const key = normalizePerson(name);
      if (!map.has(key)) map.set(key, { name, email, department: item.department });
    }));
    prfRecords.forEach((item) => {
      const name = item.requisitioner;
      const email = item.requisitionerEmail || item.email;
      if (!name || !email) return;
      const key = normalizePerson(name);
      if (!map.has(key)) map.set(key, { name, email, department: item.department });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [evaluationContacts, requisitioners, poRecords, prfRecords]);

  const requisitionerContacts = useMemo(() => {
    const map = new Map<string, { name: string; email: string; department?: string }>();
    // Sheet sources are authoritative when present; saved directory is fallback.
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
      const email = item.requisitionerEmail || item.email;
      if (!item.requisitioner || !email) return;
      const key = normalizePerson(item.requisitioner);
      if (!map.has(key)) map.set(key, { name: item.requisitioner, email, department: item.department });
    });
    evaluationContacts.forEach((item) => {
      if (!item?.name || !item?.email) return;
      const key = normalizePerson(item.name);
      if (!map.has(key)) map.set(key, { name: item.name, email: item.email, department: item.department });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [requisitioners, poRecords, prfRecords, evaluationContacts]);

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
    const pendingPurchaser = po.poNumber ? getPendingLink(po.poNumber, "purchaser") : undefined;
    const pendingReq = po.poNumber ? getPendingLink(po.poNumber, "requisitioner") : undefined;
    const pendingAmd = po.poNumber ? getPendingLink(po.poNumber, "amd_personnel") : undefined;
    const amdMatch = allEvaluatorContacts.find((item) => normalizePerson(item.name) === normalizePerson(po.receivedBy));
    const reqDirectory = findDirectoryContact(po.requisitioner, "requisitioner");
    const buyerDirectory = findDirectoryContact(po.buyerName, "purchaser");
    setSelectedPo(po);
    setBuyerEmail(pendingPurchaser?.evaluatorEmail || pendingPurchaser?.buyerEmail || po.buyerEmail || buyerDirectory?.email || "");
    setRequisitionerEmail(pendingReq?.evaluatorEmail || pendingReq?.requisitionerEmail || po.requisitionerEmail || reqDirectory?.email || "");
    setAmdEmail(pendingAmd?.evaluatorEmail || pendingAmd?.amdEmail || amdMatch?.email || findDirectoryContact(po.receivedBy, "amd_personnel")?.email || "");
    setCreatedLinks({
      purchaser: pendingPurchaser ? `${window.location.origin}/evaluate/${pendingPurchaser.token}` : "",
      requisitioner: pendingReq ? `${window.location.origin}/evaluate/${pendingReq.token}` : "",
      amd_personnel: pendingAmd ? `${window.location.origin}/evaluate/${pendingAmd.token}` : "",
    });
    setPreviewOpen(true);
  };

  const syncPendingEvaluationLinks = async (po: PurchaseOrder) => {
    const roles = ["purchaser", "requisitioner", "amd_personnel"] as const;
    await Promise.all(roles.map(async (role) => {
      const link = getPendingLink(po.poNumber, role);
      if (link) await updateEvaluationLinkPOCloud(link.token, po);
    }));
  };

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the PO image for detail extraction."));
    reader.readAsDataURL(file);
  });

  const updatePoItem = (index: number, patch: Partial<PurchaseOrderLine>) => {
    setSelectedPo((current) => {
      if (!current) return current;
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, ...patch };
        if ("qty" in patch || "unitPrice" in patch || "itemDiscountPct" in patch) {
          const qty = amount(next.qty);
          const unitPrice = amount(next.unitPrice);
          const discount = amount(next.itemDiscountPct);
          if (qty && unitPrice) next.lineTotal = qty * unitPrice * Math.max(0, 1 - discount / 100);
        }
        return next;
      });
      const grossSubtotal = items.reduce((sum, item) => sum + amount(item.qty) * amount(item.unitPrice), 0);
      const itemDiscounts = items.reduce((sum, item) => sum + amount(item.qty) * amount(item.unitPrice) * amount(item.itemDiscountPct) / 100, 0);
      const netSubtotal = Math.max(0, grossSubtotal - itemDiscounts);
      const overallDiscount = netSubtotal * amount(current.discountPct) / 100;
      const computedTotal = Math.max(0, netSubtotal - overallDiscount);
      return { ...current, items, subtotal: grossSubtotal || current.subtotal, discountAmt: overallDiscount || current.discountAmt, total: computedTotal || current.total };
    });
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
        url: doc.url, publicId: doc.publicId, resourceType: doc.resourceType, format: doc.format,
        name: doc.originalFilename || chosen[index].name, mimeType: chosen[index].type || undefined,
        size: doc.bytes || chosen[index].size, pages: doc.pages,
      }));

      // Read visible PO details from the uploaded official document itself.
      // PDFs are processed as PDFs; multiple image pages are processed one-by-one.
      let extracted: any = null;
      const extractionFiles = chosen.filter((file) =>
        /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "") || file.type === "application/pdf",
      );
      if (extractionFiles.length) {
        setPoExtracting(true);
        try {
          const merged: any = { items: [] };
          const seenItems = new Set<string>();
          for (const sourceFile of extractionFiles.slice(0, 6)) {
            try {
              const documentData = await fileToDataUrl(sourceFile);
              const response = await fetch("/api/gemini-po-extract", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: documentData }),
              });
              const data = await response.json();
              if (!response.ok || !data?.ok || !data?.data) continue;
              const current = data.data;
              for (const key of [
                "poNumber", "supplier", "attention", "vendorPhone", "vendorEmail", "vendorAddress", "vendorCity",
                "deliveryAddress", "orderDate", "expectedDate", "actualDeliveryDate", "paymentTerms", "prfNumber",
                "requisitioner", "purpose", "buyerName", "receivedBy", "status", "subtotal", "discountPct", "discountAmt", "total", "notes",
              ]) {
                if (!merged[key] && current[key] !== undefined && current[key] !== null && String(current[key]).trim()) merged[key] = current[key];
              }
              if (Array.isArray(current.items)) {
                for (const item of current.items) {
                  const key = [item.description, item.qty, item.unit, item.unitPrice, item.lineTotal].map((v) => String(v || "").trim().toLowerCase()).join("|");
                  if (!key.replace(/\|/g, "") || seenItems.has(key)) continue;
                  seenItems.add(key);
                  merged.items.push(item);
                }
              }
            } catch (sourceError) {
              console.warn("PO detail extraction failed for source file:", sourceError);
            }
          }
          extracted = merged.items.length || Object.keys(merged).length > 1 ? merged : null;
        } finally {
          setPoExtracting(false);
        }
      }

      const extractedItems: PurchaseOrderLine[] = Array.isArray(extracted?.items)
        ? extracted.items.map((item: any, index: number) => {
            const qty = item.qty ?? "";
            const unitPrice = item.unitPrice ?? "";
            const discount = item.itemDiscountPct ?? 0;
            const lineTotal = item.lineTotal ?? (amount(qty) * amount(unitPrice) * Math.max(0, 1 - amount(discount) / 100));
            return { line: index + 1, description: String(item.description || ""), unit: String(item.unit || "pcs"), qty, unitPrice, itemDiscountPct: discount, lineTotal };
          }).filter((item: PurchaseOrderLine) => item.description || amount(item.qty) || amount(item.unitPrice) || amount(item.lineTotal))
        : [];
      const extractedSubtotal = amount(extracted?.subtotal) || extractedItems.reduce((sum, item) => sum + amount(item.qty) * amount(item.unitPrice), 0);
      const extractedTotal = amount(extracted?.total) || extractedItems.reduce((sum, item) => sum + amount(item.lineTotal), 0);

      const baseUpdated = {
        ...selectedPo, documentProvider: "cloudinary" as const, documentPages, documentUrl: documentPages[0].url,
        documentName: documentPages.length === 1 ? documentPages[0].name : `${selectedPo.poNumber} · ${documentPages.length} pages`,
        documentMimeType: documentPages[0].mimeType || `application/${documentPages[0].format || "octet-stream"}`,
        documentSize: documentPages.reduce((sum, doc) => sum + Number(doc.size || 0), 0),
        documentUploadedAt: new Date().toISOString(), documentUploadedBy: currentUser?.email || "",
        documentSource: "cloudinary-official-po", documentPath: documentPages[0].publicId,
      } as PurchaseOrder;

      const hasExistingPrice = baseUpdated.items?.some((item) => amount(item.unitPrice) > 0 || amount(item.lineTotal) > 0);
      const enriched: PurchaseOrder = {
        ...baseUpdated,
        poNumber: baseUpdated.poNumber || String(extracted?.poNumber || "").trim(),
        vendorName: baseUpdated.vendorName || String(extracted?.supplier || "").trim(),
        vendorAttention: baseUpdated.vendorAttention || String(extracted?.attention || "").trim(),
        vendorPhone: baseUpdated.vendorPhone || String(extracted?.vendorPhone || "").trim(),
        deliveryAddress: baseUpdated.deliveryAddress || String(extracted?.deliveryAddress || "").trim(),
        orderDate: baseUpdated.orderDate || String(extracted?.orderDate || "").trim(),
        expectedDate: baseUpdated.expectedDate || String(extracted?.expectedDate || "").trim(),
        paymentTerms: baseUpdated.paymentTerms || String(extracted?.paymentTerms || "").trim(),
        prfNumber: baseUpdated.prfNumber || String(extracted?.prfNumber || "").trim(),
        buyerName: baseUpdated.buyerName || String(extracted?.buyerName || "").trim(),
        purpose: baseUpdated.purpose || String(extracted?.purpose || "").trim(),
        notes: baseUpdated.notes || String(extracted?.notes || "").trim(),
        items: extractedItems.length && !hasExistingPrice ? extractedItems : baseUpdated.items,
        subtotal: amount(baseUpdated.subtotal) || extractedSubtotal,
        discountPct: amount(baseUpdated.discountPct) || amount(extracted?.discountPct),
        discountAmt: amount(baseUpdated.discountAmt) || amount(extracted?.discountAmt),
        total: amount(baseUpdated.total) || extractedTotal,
        actualDeliveryDate: baseUpdated.actualDeliveryDate || String(extracted?.actualDeliveryDate || "").trim(),
        receivedBy: baseUpdated.receivedBy || String(extracted?.receivedBy || "").trim(),
        status: baseUpdated.status || String(extracted?.status || "").trim() || "Pending",
        deliveryLeadTimeDays: baseUpdated.deliveryLeadTimeDays ?? calculateDeliveryLeadTime(baseUpdated.orderDate, baseUpdated.actualDeliveryDate || String(extracted?.actualDeliveryDate || "").trim()) ?? undefined,
        pricingSource: (extractedItems.some((item) => amount(item.unitPrice) > 0 || amount(item.lineTotal) > 0) || extractedTotal > 0)
          ? ((hasExistingPrice || amount(baseUpdated.total) > 0) ? "mixed" : "uploaded-po")
          : (baseUpdated.pricingSource || (hasExistingPrice ? "spreadsheet" : undefined)),
      };

      setSelectedPo(enriched);
      await savePurchaseOrderCloud(enriched);
      await syncPendingEvaluationLinks(enriched);
      const priceFound = extractedItems.some((item) => amount(item.unitPrice) > 0 || amount(item.lineTotal) > 0) || extractedTotal > 0;
      onNotify(`Official PO ${enriched.poNumber || "record"} stored in Cloudinary${documentPages.length > 1 ? ` · ${documentPages.length} pages` : ""}${priceFound ? " · pricing extracted from scan" : ""}.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not store the PO document.");
    } finally {
      setUploading(false); setPoExtracting(false); setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const resolveBuyerEmail = () =>
    buyerEmail.trim() || selectedPo?.buyerEmail || findDirectoryContact(selectedPo?.buyerName || "", "purchaser")?.email || "";

  const resolveReqEmail = () =>
    requisitionerEmail.trim() ||
    selectedPo?.requisitionerEmail ||
    requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(selectedPo?.requisitioner))?.email ||
    findDirectoryContact(selectedPo?.requisitioner || "", "requisitioner")?.email ||
    "";

  const resolveAmdEmail = () =>
    amdEmail.trim() ||
    findDirectoryContact(selectedPo?.receivedBy || "", "amd_personnel")?.email ||
    allEvaluatorContacts.find((item) => normalizePerson(item.name) === normalizePerson(selectedPo?.receivedBy))?.email ||
    "";

  const rememberContact = async (role: EvaluationContactRole, name: string, email: string, department?: string) => {
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanName || !cleanEmail.includes("@")) return;
    try {
      await upsertEvaluationContactCloud({
        name: cleanName,
        email: cleanEmail,
        roles: [role],
        department: department || "",
        createdBy: currentUser?.email || "",
      });
    } catch (error) {
      console.warn("Could not remember evaluator email:", error);
    }
  };

  const saveCurrentPo = async () => {
    if (!selectedPo) return;
    if (!selectedPo.poNumber.trim()) {
      onNotify("Enter the PO number before saving the PO record.");
      return;
    }
    const reqEmail = resolveReqEmail();
    const next = {
      ...selectedPo,
      buyerEmail: resolveBuyerEmail(),
      requisitionerEmail: reqEmail,
      deliveryLeadTimeDays: calculateDeliveryLeadTime(selectedPo.orderDate, selectedPo.actualDeliveryDate) ?? undefined,
      pricingSource: selectedPo.pricingSource || (selectedPo.items.some((item) => amount(item.unitPrice) > 0 || amount(item.lineTotal) > 0) || amount(selectedPo.total) > 0 ? "manual" : undefined),
    } as PurchaseOrder;
    setSelectedPo(next);
    await savePurchaseOrderCloud(next);
    await syncPendingEvaluationLinks(next);
    await Promise.all([
      rememberContact("purchaser", next.buyerName, next.buyerEmail),
      rememberContact("requisitioner", next.requisitioner, reqEmail, next.department),
      rememberContact("amd_personnel", next.receivedBy, resolveAmdEmail(), next.department),
    ]);
    onNotify("PO record saved. Evaluator emails have been remembered for future use.");
  };

  const createEvaluationLinks = async () => {
    if (!selectedPo) return;
    if (!selectedPo.poNumber.trim()) {
      onNotify("Enter the PO number first. This PRF has no PO group yet, so the PO number must be typed manually before evaluation links are created.");
      return;
    }
    const buyerAuto = resolveBuyerEmail();
    const reqEmail = resolveReqEmail();
    const amdAuto = resolveAmdEmail();
    const nextLinks: { purchaser?: string; requisitioner?: string; amd_personnel?: string } = {};
    try {
      await Promise.all([
        rememberContact("purchaser", selectedPo.buyerName, buyerAuto),
        rememberContact("requisitioner", selectedPo.requisitioner, reqEmail, selectedPo.department),
        rememberContact("amd_personnel", selectedPo.receivedBy, amdAuto, selectedPo.department),
      ]);
      if (selectedPo.buyerName) {
        const existingPurchaser = getPendingLink(selectedPo.poNumber, "purchaser");
        if (existingPurchaser) {
          nextLinks.purchaser = `${window.location.origin}/evaluate/${existingPurchaser.token}`;
        } else if (buyerAuto) {
          const result = await createEvaluationLinkCloud({
            po: { ...selectedPo, buyerEmail: buyerAuto },
            requisitionerEmail: reqEmail,
            requisitionerName: selectedPo.requisitioner,
            evaluatorRole: "purchaser",
            evaluatorName: selectedPo.buyerName,
            evaluatorEmail: buyerAuto,
            createdBy: currentUser?.email || "",
            workspaceName,
          });
          nextLinks.purchaser = result.url;
        }
      }
      if (selectedPo.requisitioner) {
        const existingReq = getPendingLink(selectedPo.poNumber, "requisitioner");
        if (existingReq) nextLinks.requisitioner = `${window.location.origin}/evaluate/${existingReq.token}`;
        else if (reqEmail) {
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
        if (existingAmd) nextLinks.amd_personnel = `${window.location.origin}/evaluate/${existingAmd.token}`;
        else if (amdAuto) {
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
        nextLinks.purchaser ? "Purchasing / Buyer link ready." : selectedPo.buyerName ? "Purchasing / Buyer link not created." : "No Purchasing / Buyer is set.",
        nextLinks.requisitioner ? "Requisitioner link ready." : selectedPo.requisitioner ? "Requisitioner link not created." : "No requisitioner is set.",
        nextLinks.amd_personnel ? "AMD Personnel link ready." : selectedPo.receivedBy ? "AMD link not created." : "No Received by person is set for AMD evaluation.",
      ].join(" "));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not create the evaluation links.");
    }
  };

  const sendOneEvaluation = async (role: "purchaser" | "requisitioner" | "amd_personnel") => {
    if (!selectedPo?.documentUrl) throw new Error("Store the official PO first. The stored Cloudinary document will be attached automatically.");
    if (!selectedPo.poNumber.trim()) throw new Error("Enter the PO number before sending the evaluation request.");
    const reqEmail = resolveReqEmail();
    const targetEmail = role === "purchaser" ? resolveBuyerEmail() : role === "requisitioner" ? reqEmail : resolveAmdEmail();
    const targetName = role === "purchaser" ? selectedPo.buyerName : role === "requisitioner" ? selectedPo.requisitioner : selectedPo.receivedBy;
    if (!targetName) throw new Error(role === "purchaser" ? "Add a Purchasing / Buyer name before sending." : role === "requisitioner" ? "Add a requisitioner name before sending." : "No Received by person is set for AMD evaluation.");
    if (!targetEmail) throw new Error(role === "purchaser" ? "No Purchasing / Buyer email was found. Enter a manual email or check the Employee sheet." : role === "requisitioner" ? "No requisitioner email was found. Enter a manual email or check the Employee sheet." : "No AMD / Received by email was found. Enter a manual email or check the Employee sheet.");
    await rememberContact(role, targetName, targetEmail, selectedPo.department);

    let link = role === "purchaser" ? createdLinks.purchaser : role === "requisitioner" ? createdLinks.requisitioner : createdLinks.amd_personnel;
    if (!link) {
      const pending = getPendingLink(selectedPo.poNumber, role);
      if (pending) link = `${window.location.origin}/evaluate/${pending.token}`;
    }
    if (!link) {
      const result = await createEvaluationLinkCloud({
        po: { ...selectedPo, buyerEmail: role === "purchaser" ? targetEmail : selectedPo.buyerEmail, requisitionerEmail: reqEmail, deliveryLeadTimeDays: calculateDeliveryLeadTime(selectedPo.orderDate, selectedPo.actualDeliveryDate) ?? undefined },
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
        po: { ...selectedPo, buyerEmail: role === "purchaser" ? targetEmail : selectedPo.buyerEmail, deliveryLeadTimeDays: calculateDeliveryLeadTime(selectedPo.orderDate, selectedPo.actualDeliveryDate) ?? undefined },
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
      if (resolveBuyerEmail() && selectedPo.buyerName) jobs.push(sendOneEvaluation("purchaser"));
      if (resolveReqEmail() && selectedPo.requisitioner) jobs.push(sendOneEvaluation("requisitioner"));
      if (resolveAmdEmail() && selectedPo.receivedBy) jobs.push(sendOneEvaluation("amd_personnel"));
      if (!jobs.length) {
        const missing = selectedPo.receivedBy ? "Enter at least one valid Requisitioner or AMD/Received by email." : "Enter a valid Requisitioner email. AMD will be available when a Received by person is set.";
        throw new Error(missing);
      }
      const results = await Promise.allSettled(jobs);
      const sent = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (sent.length) onNotify(sent.map((item) => `${item.role === "purchaser" ? "Purchasing / Buyer" : item.role === "amd_personnel" ? "AMD" : "Requisitioner"} sent to ${item.recipient} · ${item.attachmentCount} PO file${item.attachmentCount > 1 ? "s" : ""}.`).join(" "));
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
        <div><div className="eyebrow"><span className="eyebrow-dot" /> PO STORAGE & EVALUATION QUEUE</div><h1>Find the PO, store the official document, then send evaluation</h1><p>The Google Sheet remains the source for purchasing details. The official scanned/uploaded PO is stored in Cloudinary and automatically reused for the Purchasing / Buyer, requisitioner, and AMD evaluation emails.</p></div>
        <div className="po-generator-actions"><a className="btn secondary" href="/email-directory"><Mail size={15}/> Email Directory</a><button className="btn secondary" onClick={() => void sync()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> {loading ? "Syncing…" : "Sync Google Sheet"}</button></div>
      </div>

      <div className={`live-sheet-status ${liveError ? "error" : ""}`}><div className="live-sheet-status-main"><span className="live-dot"/><div><b>{liveError ? "Google Sheet needs attention" : fetchedAt ? "Google Sheet connected" : "Connecting to Google Sheet…"}</b><small>{liveError || (fetchedAt ? `Last sync ${new Date(fetchedAt).toLocaleTimeString()} · automatic refresh every 60 seconds` : "Loading PO and PRF details from the configured spreadsheet")}</small></div></div><span className="po-generator-count">{poRecords.length.toLocaleString()} PO groups · {prfRecords.length.toLocaleString()} PRF records</span></div>

      <div className="po-evaluation-tabs"><button className={queueOnly ? "active" : ""} onClick={() => setQueueOnly(true)}>For Supplier Evaluation <span>{poRecords.filter((g) => !submittedByPo.has(normalizeKey(g.poNumber))).length + prfOnlyRecords.filter((item) => !submittedByPrf.has(normalizeKey(item.prfNumber))).length}</span></button><button className={!queueOnly ? "active" : ""} onClick={() => setQueueOnly(false)}>All PO Records <span>{poRecords.length + prfOnlyRecords.length}</span></button></div>

      <div className="panel po-generator-panel">
        <div className="po-generator-toolbar">
          <div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PO, PRF, supplier, requisitioner, item…"/></div>
          <div className="result-count">{records.length.toLocaleString()} records shown</div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>PO Number</th><th>PRF</th><th>Supplier</th><th>Requisitioner</th><th>Document</th><th>Evaluation</th><th /></tr></thead><tbody>
          {pagedRecords.map((group) => {
            const first: PurchaseOrderSheetMatch = group.matches[0] || { poNumber: group.poNumber || "", prfNumber: "", itemsDelivered: "", supplier: "" };
            const saved = savedByPo.get(normalizeKey(group.poNumber)) || savedByPrf.get(normalizeKey(first.prfNumber));
            const poNumber = group.poNumber || saved?.poNumber || "";
            const hasDoc = Boolean(saved?.documentUrl || saved?.documentPages?.length);
            const done = Boolean(submittedByPrf.has(normalizeKey(first.prfNumber)) || (poNumber && submittedByPo.has(normalizeKey(poNumber))));
            const pending = Boolean(poNumber && (getPendingLink(poNumber, "purchaser") || getPendingLink(poNumber, "requisitioner") || getPendingLink(poNumber, "amd_personnel")));
            const status = displayStatus(done, pending, hasDoc);
            return <tr key={`${group.prfOnly ? "prf" : "po"}-${group.poNumber || first.prfNumber}`}>
              <td><span className={poNumber ? "mono" : "badge badge-missing"}>{poNumber || "PO not assigned"}</span></td>
              <td><b>{first.prfNumber || "—"}</b></td>
              <td><b>{first.supplier || saved?.vendorName || "—"}</b></td>
              <td>{first.requisitioner || saved?.requisitioner || "—"}</td>
              <td>{hasDoc ? <span className="badge badge-ready"><FileImage size={12}/> Stored</span> : <span className="badge badge-missing"><UploadCloud size={12}/> Upload needed</span>}</td>
              <td><span className={`badge badge-${status.tone}`}>{status.label}</span></td>
              <td><button className="icon-action po-generate-btn" disabled={!canEdit} onClick={() => selectRecord(group)} title="Open PO storage and evaluation"><Eye size={15}/> Open</button></td>
            </tr>;
          })}
          {!records.length && <tr><td colSpan={7}><div className="empty"><div className="empty-icon">📋</div><div className="empty-title">No PO or PRF records found</div><div className="empty-sub">The search checks PO records and all unmatched PRFs from the V2 monitoring sheet. PRF-only records can be opened and assigned a PO number manually.</div></div></td></tr>}
        </tbody></table></div>
        {records.length > queuePageSize && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, opacity: 0.72 }}>Showing {Math.min(records.length, (queuePage - 1) * queuePageSize + 1)}–{Math.min(records.length, queuePage * queuePageSize)} of {records.length.toLocaleString()} records</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="btn ghost btn-sm" disabled={queuePage <= 1} onClick={() => setQueuePage((p) => Math.max(1, p - 1))}>Previous</button>
            <span style={{ fontSize: 12, minWidth: 80, textAlign: "center" }}>Page {queuePage} / {queuePageCount}</span>
            <button className="btn ghost btn-sm" disabled={queuePage >= queuePageCount} onClick={() => setQueuePage((p) => Math.min(queuePageCount, p + 1))}>Next</button>
          </div>
        </div>}
      </div>

      {previewOpen && selectedPo && <div className="modal-backdrop"><div className="po-generator-modal"><div className="po-generator-modal-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> PO STORAGE {selectedPo.documentUrl ? "· OFFICIAL DOCUMENT STORED" : "· WAITING FOR OFFICIAL DOCUMENT"}</div><h2>{selectedPo.poNumber}</h2><p>{selectedPo.vendorName || "Supplier"} · PRF {selectedPo.prfNumber || "—"}</p></div><button className="icon-button" onClick={() => setPreviewOpen(false)}><X size={18}/></button></div><div className="po-generator-modal-body"><div className="po-preview-card">
        {selectedPo.documentUrl ? <div className="stored-po-viewer"><div className="stored-po-toolbar"><div><b>Official PO stored in Cloudinary</b><span>{selectedPo.documentName || "Stored PO document"}</span></div><a className="btn secondary btn-sm" href={selectedPo.documentUrl} target="_blank" rel="noreferrer">Open document</a></div>{(selectedPo.documentPages || [{ url: selectedPo.documentUrl, name: selectedPo.documentName || "Official PO", mimeType: selectedPo.documentMimeType }]).map((doc, index) => <div className="stored-po-page" key={`${doc.url}-${index}`}><div className="stored-po-page-label">{doc.mimeType === "application/pdf" && doc.pages && doc.pages > 1 ? `${doc.pages}-PAGE PDF` : `PAGE ${index + 1}${selectedPo.documentPages?.length ? ` OF ${selectedPo.documentPages.length}` : ""}`}</div>{doc.mimeType?.startsWith("image/") ? <img src={doc.url} alt={`Official PO ${selectedPo.poNumber} page ${index + 1}`} className="stored-po-image"/> : <iframe title={`Official PO ${selectedPo.poNumber} page ${index + 1}`} className="stored-po-frame" src={doc.url}/>} </div>)}<button className="btn ghost btn-sm replace-po-btn" disabled={!canEdit || uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? `Uploading… ${uploadProgress}%` : "Replace / add PO pages"}</button></div> : <div className="po-empty-document"><div className="po-empty-document-icon"><UploadCloud size={22}/></div><b>No official PO stored yet</b><span>Upload the actual PDF or select multiple page images. The stored document—not a generated template—will be used for the requisitioner email.</span></div>}<input ref={fileInputRef} hidden type="file" accept="application/pdf,image/*" multiple onChange={(e) => e.target.files?.length && void uploadOfficialPo(Array.from(e.target.files))}/></div>
        <aside className="po-send-panel"><div className="section-kicker">TRANSACTION IDENTIFIER</div><h3>PO / PRF details</h3><div className="field"><span>PO Number {selectedPo.poNumber ? "" : "· enter manually when available"}</span><input value={selectedPo.poNumber} onChange={(e) => setSelectedPo({ ...selectedPo, poNumber: e.target.value })} placeholder="Type PO number if the PRF has no PO group yet"/></div>{!selectedPo.poNumber && <div className="po-warning-note"><Search size={14}/><span>This PRF came directly from the V2 monitoring sheet and has no PO group yet. Enter the PO number here when available; the PRF details are already loaded.</span></div>}<div className="section-kicker">EVALUATION WORKFLOW</div><h3>1. Store official PO</h3><p>Upload the actual PO PDF or scan. PDF files can contain multiple pages, and you can also select multiple page images. The stored Cloudinary document is the exact source attached to both evaluator emails.</p><button className="upload-drop-btn" disabled={!canEdit || uploading} onClick={() => fileInputRef.current?.click()}><UploadCloud size={18}/><span>{selectedPo.documentUrl ? "Replace stored PO" : "Upload / Scan PO"}</span><small>PDF, JPG, PNG · up to 25 MB per file · multi-page supported</small></button>{selectedPo.documentUrl && <div className="stored-doc-callout"><CheckCircle2 size={16}/><div><b>PO document stored in Cloudinary</b><span>{selectedPo.documentName || "Official PO"}</span><small>{selectedPo.documentUploadedAt ? `Uploaded ${new Date(selectedPo.documentUploadedAt).toLocaleString()}` : ""}{selectedPo.documentPages?.length ? ` · ${selectedPo.documentPages.length} stored file${selectedPo.documentPages.length > 1 ? "s" : ""}` : ""}</small></div></div>}{uploading && <div className="po-upload-progress"><div><span>Uploading official PO to Cloudinary</span><b>{uploadProgress}%</b></div><i style={{ width: `${uploadProgress}%` }}/></div>}
          <div className="po-delivery-summary"><div><span>Expected delivery</span><b>{selectedPo.expectedDate || "—"}</b></div><div><span>Actual delivery</span><b>{selectedPo.actualDeliveryDate || "—"}</b></div><div><span>Delivery lead time</span><b>{calculateDeliveryLeadTime(selectedPo.orderDate, selectedPo.actualDeliveryDate) !== null ? `${calculateDeliveryLeadTime(selectedPo.orderDate, selectedPo.actualDeliveryDate)} days` : "—"}</b></div><div><span>Status</span><b>{selectedPo.status || "Pending"}</b></div><div><span>Received by</span><b>{selectedPo.receivedBy || "—"}</b></div></div>
          <div className="section-kicker workflow-second" style={{ fontSize: 10.5, lineHeight: 1.2, letterSpacing: ".08em" }}>2. PO details &amp; pricing</div>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface2)", marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, fontSize: 11, color: "#334155" }}>
              <thead><tr>{["Qty", "Unit", "Item / Description", "Unit Price", "Disc %", "Line Total"].map((head, headIndex) => <th key={head} style={{ padding: "8px 9px", textAlign: headIndex === 2 ? "left" : "right", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "#64748b", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{head}</th>)}</tr></thead>
              <tbody>{selectedPo.items.map((item, index) => <tr key={index}>
                <td style={{ padding: 6 }}><input className="po-price-input" style={{ width: "100%", height: 34, padding: "7px 8px", border: "1px solid #d7e2df", borderRadius: 7, background: "#ffffff", color: "#0f172a", fontSize: 12, fontWeight: 600, outline: "none", boxSizing: "border-box" }} value={String(item.qty ?? "")} onChange={(e) => updatePoItem(index, { qty: e.target.value })} /></td>
                <td style={{ padding: 6 }}><input className="po-price-input" style={{ width: "100%", height: 34, padding: "7px 8px", border: "1px solid #d7e2df", borderRadius: 7, background: "#ffffff", color: "#0f172a", fontSize: 12, fontWeight: 600, outline: "none", boxSizing: "border-box" }} value={String(item.unit ?? "")} onChange={(e) => updatePoItem(index, { unit: e.target.value })} /></td>
                <td style={{ padding: 6, minWidth: 220 }}><input className="po-price-input" style={{ width: "100%", height: 34, padding: "7px 8px", border: "1px solid #d7e2df", borderRadius: 7, background: "#ffffff", color: "#0f172a", fontSize: 12, fontWeight: 600, outline: "none", boxSizing: "border-box" }} value={String(item.description ?? "")} onChange={(e) => updatePoItem(index, { description: e.target.value })} /></td>
                <td style={{ padding: 6 }}><input className="po-price-input" style={{ width: "100%", height: 34, padding: "7px 8px", border: "1px solid #d7e2df", borderRadius: 7, background: "#ffffff", color: "#0f172a", fontSize: 12, fontWeight: 600, outline: "none", boxSizing: "border-box" }} inputMode="decimal" value={String(item.unitPrice ?? "")} onChange={(e) => updatePoItem(index, { unitPrice: e.target.value })} /></td>
                <td style={{ padding: 6 }}><input className="po-price-input" style={{ width: "100%", height: 34, padding: "7px 8px", border: "1px solid #d7e2df", borderRadius: 7, background: "#ffffff", color: "#0f172a", fontSize: 12, fontWeight: 600, outline: "none", boxSizing: "border-box" }} inputMode="decimal" value={String(item.itemDiscountPct ?? 0)} onChange={(e) => updatePoItem(index, { itemDiscountPct: e.target.value })} /></td>
                <td style={{ padding: 6 }}><input className="po-price-input" style={{ width: "100%", height: 34, padding: "7px 8px", border: "1px solid #d7e2df", borderRadius: 7, background: "#ffffff", color: "#0f172a", fontSize: 12, fontWeight: 600, outline: "none", boxSizing: "border-box" }} inputMode="decimal" value={String(item.lineTotal ?? "")} onChange={(e) => updatePoItem(index, { lineTotal: e.target.value })} /></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginBottom: 10 }}>
            <label className="field"><span>Subtotal</span><input inputMode="decimal" value={String(selectedPo.subtotal || "")} onChange={(e) => setSelectedPo({ ...selectedPo, subtotal: amount(e.target.value) })} /></label>
            <label className="field"><span>Overall discount %</span><input inputMode="decimal" value={String(selectedPo.discountPct || "")} onChange={(e) => setSelectedPo({ ...selectedPo, discountPct: amount(e.target.value) })} /></label>
            <label className="field"><span>Total amount</span><input inputMode="decimal" value={String(selectedPo.total || "")} onChange={(e) => setSelectedPo({ ...selectedPo, total: amount(e.target.value) })} /></label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "-2px 0 8px", fontSize: 10.5, color: "#64748b" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#0f766e", display: "inline-block" }} />{selectedPo.pricingSource === "uploaded-po" ? "Pricing source: uploaded official PO" : selectedPo.pricingSource === "mixed" ? "Pricing source: supplier spreadsheet + uploaded PO" : selectedPo.pricingSource === "spreadsheet" ? "Pricing source: supplier spreadsheet" : "Pricing source: manual / pending extraction"}</div>
          <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "#64748b", marginBottom: 10 }}>{poExtracting ? "Reading pricing and PO details from the uploaded PDF/image…" : "PDFs and image scans are checked by Gemini for visible PO values. You can correct any value above before saving."}</div><div className="section-kicker workflow-second">2. Purchasing / Buyer evaluation</div><div className="field"><span>Purchasing / Buyer</span><input value={selectedPo.buyerName} onChange={(e) => { const next = e.target.value; const directory = findDirectoryContact(next, "purchaser"); setSelectedPo({ ...selectedPo, buyerName: next, buyerEmail: directory?.email || selectedPo.buyerEmail }); setBuyerEmail(directory?.email || buyerEmail); }} placeholder="Buyer / purchasing holder from PO"/></div><label className="field"><span>Purchasing / Buyer email · auto-resolved from Employee sheet</span><input type="email" value={buyerEmail} onChange={(e) => { setBuyerEmail(e.target.value); setSelectedPo({ ...selectedPo, buyerEmail: e.target.value }); }} placeholder="Auto-filled from sheet or saved Email Directory · manual override allowed"/></label><div className="section-kicker workflow-second">4. Requisitioner evaluation</div><div className="field requisitioner-picker-field"><span>Requisitioner</span><div className="autocomplete-wrap"><div className="po-input-wrap requisitioner-input-wrap"><UserCheck size={14} className="po-search-icon"/><input value={selectedPo.requisitioner} onFocus={() => setRequisitionerLookupOpen(true)} onChange={(e) => { const next = e.target.value; const exact = requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(next)); setSelectedPo({ ...selectedPo, requisitioner: next, requisitionerEmail: exact?.email || "" }); setRequisitionerEmail(exact?.email || ""); setRequisitionerLookupOpen(true); }} onBlur={() => window.setTimeout(() => setRequisitionerLookupOpen(false), 180)} placeholder="Type requisitioner name"/></div>{requisitionerLookupOpen && requisitionerSuggestions.length > 0 && <div className="po-suggestions requisitioner-suggestions">{requisitionerSuggestions.map((item) => <button type="button" key={`${normalizePerson(item.name)}-${item.email}`} onMouseDown={(e) => e.preventDefault()} onClick={() => selectRequisitioner(item)}><div className="po-suggestion-top"><b>{item.name}</b><span>{item.department || "REQUISITIONER"}</span></div><small>{item.email}</small></button>)}</div>}</div></div><label className="field"><span>Requisitioner email · auto-resolved from Employee sheet</span><input type="email" value={requisitionerEmail} onChange={(e) => { setRequisitionerEmail(e.target.value); setSelectedPo({ ...selectedPo, requisitionerEmail: e.target.value }); }} placeholder="Auto-filled from sheet or saved Email Directory · manual override allowed"/></label><div className="section-kicker workflow-second">5. AMD Personnel / Received by evaluation</div><div className="field"><span>Received by / AMD Personnel</span><div className="autocomplete-wrap"><div className="po-input-wrap requisitioner-input-wrap"><UserCheck size={14} className="po-search-icon"/><input value={selectedPo.receivedBy} onFocus={() => setAmdLookupOpen(true)} onChange={(e) => { const next = e.target.value; const exact = requisitionerContacts.find((item) => normalizePerson(item.name) === normalizePerson(next)); setSelectedPo({ ...selectedPo, receivedBy: next }); setAmdEmail(exact?.email || ""); setAmdLookupOpen(true); }} onBlur={() => window.setTimeout(() => setAmdLookupOpen(false), 180)} placeholder="Type Received by / AMD personnel name"/></div>{amdLookupOpen && requisitionerContacts.filter((item) => { const q = normalizePerson(selectedPo.receivedBy); return !q || normalizePerson(item.name).includes(q) || item.email.toLowerCase().includes(q); }).slice(0,8).map((item) => <div className="po-suggestions requisitioner-suggestions" key={`${normalizePerson(item.name)}-${item.email}`}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setSelectedPo({ ...selectedPo, receivedBy: item.name }); setAmdEmail(item.email); setAmdLookupOpen(false); }}><div className="po-suggestion-top"><b>{item.name}</b><span>{item.department || "AMD / EMPLOYEE"}</span></div><small>{item.email}</small></button></div>)}</div></div><label className="field"><span>AMD / Received by email · auto-resolved from Employee sheet</span><input type="email" value={amdEmail} onChange={(e) => setAmdEmail(e.target.value)} placeholder="Auto-filled from sheet or saved Email Directory · manual override allowed"/></label><div style={{ margin: "-2px 0 10px", fontSize: 12, opacity: 0.78 }}>Missing an email in the spreadsheet? <a href="/email-directory" style={{ fontWeight: 700 }}>Save it once in Email Directory</a> and it will be reused automatically.</div><div className="po-action-stack"><button className="btn secondary" onClick={() => void saveCurrentPo()}><CheckCircle2 size={16}/> Save PO + remember emails</button><button className="btn secondary" onClick={() => void createEvaluationLinks()}><UserCheck size={16}/> Create evaluation links</button><button className="btn primary" disabled={sending || !selectedPo.documentUrl} onClick={() => void sendEmail()}><Send size={16}/> {sending ? "Sending…" : "Send PO + evaluations"}</button></div>{!selectedPo.documentUrl && <div className="po-warning-note"><UploadCloud size={14}/><span>Send stays locked until an official PO is stored, so the system cannot accidentally attach a generated or outdated document.</span></div>}{(createdLinks.purchaser || createdLinks.requisitioner || createdLinks.amd_personnel) && <div className="po-link-box"><small>Evaluation links</small>{createdLinks.purchaser && <div><b>Purchasing / Buyer:</b> <a href={createdLinks.purchaser} target="_blank" rel="noreferrer">{createdLinks.purchaser}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLinks.purchaser!).then(() => onNotify("Purchasing / Buyer link copied."))}><Mail size={13}/> Copy</button></div>}{createdLinks.requisitioner && <div><b>Requisitioner:</b> <a href={createdLinks.requisitioner} target="_blank" rel="noreferrer">{createdLinks.requisitioner}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLinks.requisitioner!).then(() => onNotify("Requisitioner link copied."))}><Mail size={13}/> Copy</button></div>}{createdLinks.amd_personnel && <div style={{marginTop:8}}><b>AMD Personnel:</b> <a href={createdLinks.amd_personnel} target="_blank" rel="noreferrer">{createdLinks.amd_personnel}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLinks.amd_personnel!).then(() => onNotify("AMD Personnel link copied."))}><Mail size={13}/> Copy</button></div>}</div>}<div className="po-source-note"><Sparkles size={14}/><span>Purchasing / Buyer, Requisitioner, and AMD Personnel each receive a separate one-time evaluation link. Purchasing / Buyer uses the five-criterion flow; Requisitioner and AMD use the four-criterion flow. All use the same official Cloudinary PO attachment, while results are saved separately by evaluator role.</span></div></aside></div></div></div>}
    </div>
  );
}
