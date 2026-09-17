"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Mail,
  Printer,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import {
  createEvaluationLinkCloud,
  savePurchaseOrderCloud,
  type PurchaseOrder,
  type PurchaseOrderLine,
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
  const vendorAddress = [po.vendorAddress, po.vendorCity].filter(Boolean).join(", ");
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
<div class="meta-note">Generated automatically from the live purchasing spreadsheet. This document is a system-generated PO preview for evaluation and confirmation.</div>
</body></html>`;
}

export default function PurchaseOrderGenerator({ workspaceName, workspaceAddress, workspaceEmail, currentUser, canEdit, onNotify }: Props) {
  const [poRecords, setPoRecords] = useState<PurchaseOrderSheetRecord[]>([]);
  const [prfRecords, setPrfRecords] = useState<PrfRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [query, setQuery] = useState("");
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [requisitionerEmail, setRequisitionerEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [createdLink, setCreatedLink] = useState("");

  const sync = async () => {
    setLoading(true);
    setLiveError("");
    try {
      const response = await fetch("/api/po-lookup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.message || "Google Sheet is unavailable.");
      setPoRecords(Array.isArray(data.poRecords) ? data.poRecords : []);
      setPrfRecords(Array.isArray(data.prfRecords) ? data.prfRecords : []);
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
    return () => window.clearInterval(timer);
  }, []);

  const records = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = poRecords.map((group) => group).filter((group) => {
      if (!q) return true;
      return [group.poNumber, ...group.matches.flatMap((m) => [m.prfNumber, m.supplier, m.itemsDelivered, m.requisitioner, m.department])]
        .join(" ").toLowerCase().includes(q);
    });
    return all.slice(0, 100);
  }, [poRecords, query]);

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
    return {
      id: `po-${String(group.poNumber).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      poNumber: group.poNumber,
      prfNumber: first.prfNumber || prf?.prfNumber || "",
      requisitioner: first.requisitioner || prf?.requisitioner || "",
      department: first.department || prf?.department || "",
      purpose: first.purpose || prf?.purpose || "",
      vendorName: first.supplier || "",
      vendorAttention: first.attention || "",
      vendorPhone: first.vendorPhone || "",
      vendorEmail: first.vendorEmail || "",
      vendorAddress: first.vendorAddress || "",
      vendorCity: first.vendorCity || "",
      deliveryAddress: first.deliveryAddress || "",
      orderDate: first.orderDate || new Date().toISOString().slice(0, 10),
      expectedDate: first.expectedDate || "",
      paymentTerms: first.paymentTerms || "",
      notes: first.notes || "",
      subtotal,
      discountPct: 0,
      discountAmt: 0,
      total,
      buyerName: first.buyerName || currentUser?.displayName || "",
      buyerEmail: first.buyerEmail || currentUser?.email || "",
      approverName: "",
      status: "Pending",
      actualDeliveryDate: "",
      receivedBy: "",
      createdAt: new Date().toISOString(),
      source: "Google Sheet",
      items,
    };
  }

  const selectRecord = (group: PurchaseOrderSheetRecord) => {
    const po = buildFromSheet(group);
    setSelectedPo(po);
    setRequisitionerEmail("");
    setCreatedLink("");
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
    setSending(true);
    try {
      let link = createdLink;
      if (!link) {
        await saveGeneratedPo();
        const result = await createEvaluationLinkCloud({ po: selectedPo, requisitionerEmail: requisitionerEmail.trim(), createdBy: currentUser?.email || "", workspaceName });
        link = result.url;
        setCreatedLink(link);
      }
      if (!requisitionerEmail.trim()) {
        const subject = encodeURIComponent(`[SISC] Supplier Evaluation Request — ${selectedPo.poNumber}`);
        const body = encodeURIComponent(`Hello ${selectedPo.requisitioner || "Requisitioner"},\n\nPlease review the generated Purchase Order ${selectedPo.poNumber} and complete the supplier evaluation here:\n${link}\n\nThank you.`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
        return;
      }
      const response = await fetch("/api/send-evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: requisitionerEmail.trim(),
          name: selectedPo.requisitioner,
          po: selectedPo,
          evaluationUrl: link,
          workspace: { name: workspaceName, address: workspaceAddress, email: workspaceEmail },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        const subject = encodeURIComponent(`[SISC] Supplier Evaluation Request — ${selectedPo.poNumber}`);
        const body = encodeURIComponent(`Hello ${selectedPo.requisitioner || "Requisitioner"},\n\nPlease review the generated Purchase Order ${selectedPo.poNumber} and complete the supplier evaluation here:\n${link}\n\nThank you.`);
        window.location.href = `mailto:${encodeURIComponent(requisitionerEmail.trim())}?subject=${subject}&body=${body}`;
        onNotify("Email service is not configured, so your mail app was opened with the generated evaluation request.");
      } else {
        onNotify("Evaluation email sent to the requisitioner.");
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not send the evaluation request.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> PURCHASE ORDER GENERATOR</div><h1>Generate PO from the live spreadsheet</h1><p>No scanning is required for new POs. Select the spreadsheet record and the system builds the PO using the same form structure as the existing paper PO.</p></div>
        <div className="po-generator-actions"><button className="btn secondary" onClick={() => void sync()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> {loading ? "Syncing…" : "Sync Google Sheet"}</button></div>
      </div>

      <div className={`live-sheet-status ${liveError ? "error" : ""}`}><div className="live-sheet-status-main"><span className="live-dot"/><div><b>{liveError ? "Google Sheet needs attention" : fetchedAt ? "Google Sheet connected" : "Connecting to Google Sheet…"}</b><small>{liveError || (fetchedAt ? `Last sync ${new Date(fetchedAt).toLocaleTimeString()} · automatic refresh every 60 seconds` : "Loading PO and PRF details from the configured spreadsheet")}</small></div></div><span className="po-generator-count">{poRecords.length.toLocaleString()} PO groups · {prfRecords.length.toLocaleString()} PRF records</span></div>

      <div className="panel po-generator-panel">
        <div className="po-generator-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PO, PRF, supplier, requisitioner, item…"/></div><div className="result-count">{records.length.toLocaleString()} shown</div></div>
        <div className="table-wrap"><table><thead><tr><th>PO Number</th><th>PRF</th><th>Supplier</th><th>Requisitioner</th><th>Items / Details</th><th>Delivery</th><th /></tr></thead><tbody>{records.map((group) => { const first = group.matches[0] || {} as PurchaseOrderSheetMatch; return <tr key={group.poNumber}><td><span className="mono">{group.poNumber}</span></td><td>{first.prfNumber || "—"}</td><td><b>{first.supplier || "—"}</b></td><td>{first.requisitioner || "—"}</td><td><span className="table-truncate">{group.matches.map((m) => m.itemsDelivered).filter(Boolean).join(" · ") || "No item text"}</span></td><td>{fmtDate(first.expectedDate) || "—"}</td><td><button className="icon-action po-generate-btn" disabled={!canEdit} onClick={() => selectRecord(group)} title="Generate PO"><FileText size={15}/> Generate</button></td></tr>; })}{!records.length && <tr><td colSpan={7}><div className="empty"><div className="empty-icon">📄</div><div className="empty-title">No PO records found</div><div className="empty-sub">Sync the Google Sheet or change your search.</div></div></td></tr>}</tbody></table></div>
      </div>

      {previewOpen && selectedPo && <div className="modal-backdrop"><div className="po-generator-modal"><div className="po-generator-modal-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> GENERATED PURCHASE ORDER</div><h2>{selectedPo.poNumber}</h2><p>{selectedPo.vendorName || "Supplier"} · PRF {selectedPo.prfNumber || "—"}</p></div><button className="icon-button" onClick={() => setPreviewOpen(false)}><X size={18}/></button></div><div className="po-generator-modal-body"><div className="po-preview-card"><div className="po-paper" dangerouslySetInnerHTML={{ __html: buildPurchaseOrderHtml(selectedPo, { name: workspaceName, address: workspaceAddress, email: workspaceEmail }) }}/></div><aside className="po-send-panel"><div className="section-kicker">NEXT STEP</div><h3>Send to requisitioner</h3><p>The generated PO becomes the reference document for the requisitioner evaluation. The response is written into the same Firebase evaluation register.</p><label className="field"><span>Requisitioner</span><input value={selectedPo.requisitioner} onChange={(e) => setSelectedPo({ ...selectedPo, requisitioner: e.target.value })}/></label><label className="field"><span>Requisitioner email</span><input type="email" value={requisitionerEmail} onChange={(e) => setRequisitionerEmail(e.target.value)} placeholder="name@southville.edu.ph"/></label><div className="po-action-stack"><button className="btn primary" onClick={() => void saveGeneratedPo()}><CheckCircle2 size={16}/> Save generated PO</button><button className="btn secondary" onClick={openPrint}><Printer size={16}/> Print / Save as PDF</button><button className="btn secondary" onClick={() => void createLink()}><UserCheck size={16}/> Create evaluation link</button><button className="btn primary" disabled={sending} onClick={() => void sendEmail()}><Send size={16}/> {sending ? "Sending…" : "Send evaluation request"}</button></div>{createdLink && <div className="po-link-box"><small>Evaluation link</small><a href={createdLink} target="_blank" rel="noreferrer">{createdLink}</a><button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(createdLink).then(() => onNotify("Evaluation link copied."))}><Mail size={13}/> Copy link</button></div>}<div className="po-source-note"><Sparkles size={14}/><span>Generated from live PO/PRF spreadsheet data. Existing Scan & Extract and manual evaluation features remain available.</span></div></aside></div></div></div>}
    </div>
  );
}
