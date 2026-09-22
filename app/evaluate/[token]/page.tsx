"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileImage, FileText, Loader2, Star, XCircle } from "lucide-react";
import { createPublicRequisitionerEvaluation, getPublicEvaluationLink, type PublicEvaluationLink } from "../../../lib/firestore";

const labels = ["Poor", "Below Average", "Average", "Good", "Excellent"];
type EvaluationCriterion = readonly [string, string, string];

const FOUR_CRITERIA: readonly EvaluationCriterion[] = [
  ["accurate_delivery", "Accurate Delivery / Quality", "Were the items delivered accurately and did they meet the expected quality or specifications?"],
  ["competitive_price", "Competitive Price", "Was the supplier's price reasonable and competitive based on the requested purchase?"],
  ["timeliness", "Timeliness of Delivery", "Was the delivery completed within the agreed delivery period?"],
  ["after_sales", "After Sales Services", "Did the supplier provide adequate support after delivery?"] ,
] as const;

const PURCHASING_CRITERIA: readonly EvaluationCriterion[] = [
  ...FOUR_CRITERIA,
  ["compliance", "Compliance with Regulatory Requirements and School Policies", "Did the supplier comply with applicable regulatory requirements and school policies?"] as const,
];

function isImage(mime?: string) {
  return Boolean(mime && mime.startsWith("image/"));
}

function calculateLeadTimeDays(orderDate?: string, actualDeliveryDate?: string) {
  if (!orderDate || !actualDeliveryDate) return null;
  const start = new Date(orderDate);
  const end = new Date(actualDeliveryDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function parseAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, "").trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function moneyText(value: unknown) {
  const n = parseAmount(value);
  return n > 0 ? `Php ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export default function EvaluationPage() {
  const token = typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean).pop() || "" : "";
  const [link, setLink] = useState<PublicEvaluationLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const record = await getPublicEvaluationLink(token);
        if (!record) throw new Error("This evaluation link is invalid or has expired.");
        setLink(record);
        setSubmitted(record.status === "submitted");
      } catch (e) {
        setError(e instanceof Error ? e.message : "This evaluation link is unavailable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const evaluatorRole = link?.evaluatorRole === "purchaser" ? "purchaser" : link?.evaluatorRole === "amd_personnel" ? "amd_personnel" : "requisitioner";
  const activeCriteria = evaluatorRole === "purchaser" ? PURCHASING_CRITERIA : FOUR_CRITERIA;
  const evaluatorName = link?.evaluatorName || (evaluatorRole === "purchaser" ? link?.po.buyerName : evaluatorRole === "amd_personnel" ? link?.po.receivedBy : link?.requisitionerName) || (evaluatorRole === "purchaser" ? "Purchasing / Buyer" : evaluatorRole === "amd_personnel" ? "AMD Personnel" : "Requisitioner");
  const evaluatorLabel = evaluatorRole === "purchaser" ? "Purchasing / Buyer" : evaluatorRole === "amd_personnel" ? "AMD Personnel" : "Requisitioner";

  const overall = useMemo(() => {
    const values = activeCriteria.map(([id]) => scores[id]).filter((value) => value >= 1);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : 0;
  }, [scores, activeCriteria]);

  const submit = async () => {
    if (!link) return;
    setSubmitError("");
    const missing = activeCriteria.some(([id]) => !scores[id]);
    if (missing) {
      setSubmitError(`Please rate all ${activeCriteria.length} criteria before submitting.`);
      return;
    }
    setSubmitting(true);
    try {
      await createPublicRequisitionerEvaluation({ token, link, scores, comments, overall });
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not submit your evaluation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="public-eval-shell"><div className="public-eval-card center"><Loader2 className="spin" size={28}/><h1>Loading evaluation</h1><p>Checking your secure evaluation link…</p></div></div>;
  if (error || !link) return <div className="public-eval-shell"><div className="public-eval-card center"><XCircle size={46}/><h1>Evaluation unavailable</h1><p>{error || "This evaluation link is not available."}</p></div></div>;

  const po = link.po;
  const officialDocument = po.documentUrl || "";
  const leadTimeDays = po.deliveryLeadTimeDays ?? calculateLeadTimeDays(po.orderDate, po.actualDeliveryDate);
  const itemAmounts = (po.items || []).map((item) => {
    const qty = parseAmount(item.qty);
    const unitPrice = parseAmount(item.unitPrice);
    const lineTotal = parseAmount(item.lineTotal) || (qty * unitPrice);
    return { ...item, qty, unitPrice, lineTotal };
  });
  const computedItemTotal = itemAmounts.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
  const displayTotal = parseAmount(po.total) || computedItemTotal || parseAmount(po.subtotal) || 0;
  return <div className="public-eval-shell"><div className="public-eval-wrap">
    <section className="public-eval-header"><div className="public-eval-logo"><img src="/sisc-logo.png" alt="Southville International School and Colleges"/></div><div><small>{link.workspaceName || "Southville International School and Colleges"}</small><h1>Supplier Evaluation</h1><p>{evaluatorLabel} confirmation and supplier feedback</p></div></section>
    <section className="public-po-summary"><div><span>PO Number</span><strong>{po.poNumber}</strong></div><div><span>Supplier</span><strong>{po.vendorName || "—"}</strong></div><div><span>PRF No.</span><strong>{po.prfNumber || "—"}</strong></div><div><span>Delivery Date</span><strong>{po.expectedDate || "—"}</strong></div><div><span>Total Amount</span><strong>Php {parseAmount(displayTotal).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div><div><span>Requisitioner</span><strong>{po.requisitioner || link.requisitionerName || "—"}</strong></div></section>
    <section className="public-delivery-strip"><div><span>Expected delivery</span><strong>{po.expectedDate || "—"}</strong></div><div><span>Actual delivery</span><strong>{po.actualDeliveryDate || "—"}</strong></div><div><span>Delivery lead time</span><strong>{leadTimeDays !== null ? `${leadTimeDays} day${leadTimeDays === 1 ? "" : "s"}` : "—"}</strong></div><div><span>PO status</span><strong>{po.status || "Pending"}</strong></div><div><span>Received by</span><strong>{po.receivedBy || "—"}</strong></div></section>

    <section className="public-po-pricing" style={{ background: "#ffffff", border: "1px solid #dfe9e6", borderRadius: 14, marginBottom: 18, overflow: "hidden", boxShadow: "0 3px 14px rgba(15, 23, 42, 0.04)" }}>
      <div style={{ padding: "15px 18px", borderBottom: "1px solid #e8efed", display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div><b style={{ display: "block", fontSize: 14, lineHeight: 1.25, color: "#0f172a" }}>Purchase Details &amp; Pricing</b><small style={{ display: "block", marginTop: 4, color: "#64748b", fontSize: 11, lineHeight: 1.45 }}>Transaction values attached to this evaluator link.</small></div>
        <div style={{ textAlign: "right" }}><strong style={{ display: "block", color: "#0f766e", fontSize: 16, lineHeight: 1.2, whiteSpace: "nowrap" }}>{displayTotal > 0 ? moneyText(displayTotal) : "Price not recorded"}</strong><small style={{ display: "block", marginTop: 4, color: "#94a3b8", fontSize: 10 }}>{po.pricingSource === "uploaded-po" ? "Read from uploaded PO" : po.pricingSource === "mixed" ? "Spreadsheet + uploaded PO" : po.pricingSource === "spreadsheet" ? "From supplier spreadsheet" : displayTotal > 0 ? "Saved transaction value" : "Waiting for PO pricing"}</small></div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Qty", "Unit", "Item / Description", "Unit Price", "Line Total"].map((head) => <th key={head} style={{ padding: "9px 12px", textAlign: head === "Item / Description" ? "left" : "right", color: "#64748b", fontSize: 9.5, lineHeight: 1.2, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{head}</th>)}</tr></thead>
          <tbody>
            {itemAmounts.filter((item) => item.description || item.qty || item.unitPrice || item.lineTotal).map((item, index) => <tr key={`${item.line}-${index}`}>
              <td style={{ padding: "9px 12px", textAlign: "right", borderBottom: "1px solid #f1f5f9", color: "#334155" }}>{item.qty || "—"}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", borderBottom: "1px solid #f1f5f9", color: "#334155" }}>{item.unit || "—"}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}>{item.description || "—"}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap", color: "#0f766e", fontWeight: 600 }}>{item.unitPrice > 0 ? moneyText(item.unitPrice) : "—"}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap", color: "#0f172a", fontWeight: 700 }}>{item.lineTotal > 0 ? moneyText(item.lineTotal) : "—"}</td>
            </tr>)}
            {!itemAmounts.some((item) => item.description || item.qty || item.unitPrice || item.lineTotal) && <tr><td colSpan={5} style={{ padding: 18, textAlign: "center", color: "#94a3b8", fontSize: 11 }}>No item pricing has been recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 18px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
        <div style={{ minWidth: 230, display: "flex", justifyContent: "space-between", gap: 28, fontSize: 12.5 }}><span style={{ color: "#64748b" }}>Total Amount</span><b style={{ color: "#0f172a", fontSize: 14 }}>{displayTotal > 0 ? moneyText(displayTotal) : "—"}</b></div>
      </div>
    </section>

    <section className="public-po-paper">
      <div className="public-po-paper-head"><b>{officialDocument ? "Official Purchase Order" : "Generated Purchase Order"}</b><span>{officialDocument ? "Stored transaction document" : "System template preview"}</span></div>
      {officialDocument ? <>
        <div className="public-official-doc-head"><span>{isImage(po.documentMimeType) ? <FileImage size={15}/> : <FileText size={15}/>}</span><div><b>{po.documentName || `PO-${po.poNumber}`}</b><small>The official PO stored by the Purchasing Office is shown here. Multiple PDF pages or uploaded page images are supported.</small></div><a href={officialDocument} target="_blank" rel="noreferrer">Open</a></div>
        {(po.documentPages?.length ? po.documentPages : [{ url: officialDocument, name: po.documentName || `PO-${po.poNumber}`, mimeType: po.documentMimeType }]).map((doc, index) => <div className="public-official-page" key={`${doc.url}-${index}`}><div className="public-official-page-label">PAGE {index + 1}{po.documentPages?.length ? ` OF ${po.documentPages.length}` : ""}</div>{isImage(doc.mimeType) ? <img src={doc.url} alt={`Official purchase order ${po.poNumber} page ${index + 1}`} className="public-official-image"/> : <iframe title={`Official purchase order ${po.poNumber} page ${index + 1}`} className="public-po-frame" src={doc.url}/>}</div>)}
      </> : <div className="public-generated-warning"><b>Official PO not attached yet</b><span>The purchasing office must store the official PO before this evaluation link is sent.</span></div>}
      <div className="public-po-footer"><span>Purpose: {po.purpose || "—"}</span><b>Total: {displayTotal > 0 ? `Php ${displayTotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</b></div>
    </section>

    {submitted ? <section className="public-eval-success"><CheckCircle2 size={50}/><h2>Evaluation Submitted</h2><p>Thank you, {evaluatorName}. Your supplier evaluation for <strong>{po.poNumber}</strong> has been recorded in the system.</p></section> : <><section className="public-eval-intro"><div><span className="eyebrow-dot"/><span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", lineHeight: 1.2 }}>PLEASE RATE THE DELIVERED PURCHASE</span></div><h2 style={{ fontSize: 24, lineHeight: 1.15, margin: "8px 0 6px" }}>{evaluatorLabel} supplier evaluation</h2><p>Please rate each criterion from 1 (Poor) to 5 (Excellent). Your responses are saved with this purchase transaction under your evaluator role.</p></section><section className="public-eval-criteria">{activeCriteria.map(([id, title, desc]) => <div className={`public-criterion ${scores[id] ? "rated" : ""}`} key={id}><div><h3>{title}</h3><p>{desc}</p></div><div className="public-stars">{[1,2,3,4,5].map((n) => <button type="button" key={n} onClick={() => setScores((prev) => ({ ...prev, [id]: n }))} aria-label={`${title}: ${labels[n-1]}`} className={scores[id] && n <= scores[id] ? "active" : ""}><Star size={27} fill="currentColor"/></button>)}</div>{scores[id] ? <small>{scores[id]} / 5 — {labels[scores[id] - 1]}</small> : <small>Not rated</small>}</div>)}</section><section className="public-comments"><label>Additional comments <span>(optional)</span><textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Please add any comments about the delivery, quality, or supplier service."/></label><div className="public-submit-row"><div><span>Current average</span><strong>{overall ? overall.toFixed(1) : "—"} / 5</strong></div><button className="btn primary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit Evaluation"}</button></div>{submitError && <div className="public-eval-error">{submitError}</div>}</section></>}
    <footer className="public-eval-footer">This evaluation link is unique to the intended evaluator. One completed submission is allowed for this transaction.</footer>
  </div></div>;
}
