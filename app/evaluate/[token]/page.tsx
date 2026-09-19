"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileImage, FileText, Loader2, Star, XCircle } from "lucide-react";
import { createPublicRequisitionerEvaluation, getPublicEvaluationLink, type PublicEvaluationLink } from "../../../lib/firestore";

const labels = ["Poor", "Below Average", "Average", "Good", "Excellent"];
const criteria = [
  ["accurate_delivery", "Accurate Delivery / Quality", "Were the items delivered accurately and did they meet the expected quality or specifications?"],
  ["competitive_price", "Competitive Price", "Was the supplier's price reasonable and competitive based on the requested purchase?"],
  ["timeliness", "Timeliness of Delivery", "Was the delivery completed within the agreed delivery period?"],
  ["after_sales", "After Sales Services", "Did the supplier provide adequate support after delivery?"] ,
] as const;

function isImage(mime?: string) {
  return Boolean(mime && mime.startsWith("image/"));
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

  const overall = useMemo(() => {
    const values = criteria.map(([id]) => scores[id]).filter((value) => value >= 1);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : 0;
  }, [scores]);

  const submit = async () => {
    if (!link) return;
    setSubmitError("");
    const missing = criteria.some(([id]) => !scores[id]);
    if (missing) {
      setSubmitError("Please rate all four criteria before submitting.");
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
  return <div className="public-eval-shell"><div className="public-eval-wrap">
    <section className="public-eval-header"><div className="public-eval-logo"><img src="/sisc-logo.png" alt="Southville International School and Colleges"/></div><div><small>{link.workspaceName || "Southville International School and Colleges"}</small><h1>Supplier Evaluation</h1><p>Requisitioner confirmation and supplier feedback</p></div></section>
    <section className="public-po-summary"><div><span>PO Number</span><strong>{po.poNumber}</strong></div><div><span>Supplier</span><strong>{po.vendorName || "—"}</strong></div><div><span>PRF No.</span><strong>{po.prfNumber || "—"}</strong></div><div><span>Delivery Date</span><strong>{po.expectedDate || "—"}</strong></div><div><span>Total Amount</span><strong>Php {Number(po.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div><div><span>Requisitioner</span><strong>{po.requisitioner || link.requisitionerName || "—"}</strong></div></section>
    <section className="public-delivery-strip"><div><span>Expected delivery</span><strong>{po.expectedDate || "—"}</strong></div><div><span>Actual delivery</span><strong>{po.actualDeliveryDate || "—"}</strong></div><div><span>PO status</span><strong>{po.status || "Pending"}</strong></div><div><span>Received by</span><strong>{po.receivedBy || "—"}</strong></div></section>

    <section className="public-po-paper">
      <div className="public-po-paper-head"><b>{officialDocument ? "Official Purchase Order" : "Generated Purchase Order"}</b><span>{officialDocument ? "Stored transaction document" : "System template preview"}</span></div>
      {officialDocument ? <>
        <div className="public-official-doc-head"><span>{isImage(po.documentMimeType) ? <FileImage size={15}/> : <FileText size={15}/>}</span><div><b>{po.documentName || `PO-${po.poNumber}`}</b><small>The official PO stored by the Purchasing Office is shown here. Multiple PDF pages or uploaded page images are supported.</small></div><a href={officialDocument} target="_blank" rel="noreferrer">Open</a></div>
        {(po.documentPages?.length ? po.documentPages : [{ url: officialDocument, name: po.documentName || `PO-${po.poNumber}`, mimeType: po.documentMimeType }]).map((doc, index) => <div className="public-official-page" key={`${doc.url}-${index}`}><div className="public-official-page-label">PAGE {index + 1}{po.documentPages?.length ? ` OF ${po.documentPages.length}` : ""}</div>{isImage(doc.mimeType) ? <img src={doc.url} alt={`Official purchase order ${po.poNumber} page ${index + 1}`} className="public-official-image"/> : <iframe title={`Official purchase order ${po.poNumber} page ${index + 1}`} className="public-po-frame" src={doc.url}/>}</div>)}
      </> : <div className="public-generated-warning"><b>Official PO not attached yet</b><span>The purchasing office must store the official PO before this evaluation link is sent.</span></div>}
      <div className="public-po-footer"><span>Purpose: {po.purpose || "—"}</span><b>Total: Php {Number(po.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div>
    </section>

    {submitted ? <section className="public-eval-success"><CheckCircle2 size={50}/><h2>Evaluation Submitted</h2><p>Thank you, {po.requisitioner || link.requisitionerName || "Requisitioner"}. Your supplier evaluation for <strong>{po.poNumber}</strong> has been recorded in the system.</p></section> : <><section className="public-eval-intro"><div><span className="eyebrow-dot"/><span>PLEASE RATE THE DELIVERED PURCHASE</span></div><h2>Supplier evaluation</h2><p>Please rate each criterion from 1 (Poor) to 5 (Excellent). Your responses are saved with this purchase transaction.</p></section><section className="public-eval-criteria">{criteria.map(([id, title, desc]) => <div className={`public-criterion ${scores[id] ? "rated" : ""}`} key={id}><div><h3>{title}</h3><p>{desc}</p></div><div className="public-stars">{[1,2,3,4,5].map((n) => <button type="button" key={n} onClick={() => setScores((prev) => ({ ...prev, [id]: n }))} aria-label={`${title}: ${labels[n-1]}`} className={scores[id] && n <= scores[id] ? "active" : ""}><Star size={27} fill="currentColor"/></button>)}</div>{scores[id] ? <small>{scores[id]} / 5 — {labels[scores[id] - 1]}</small> : <small>Not rated</small>}</div>)}</section><section className="public-comments"><label>Additional comments <span>(optional)</span><textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Please add any comments about the delivery, quality, or supplier service."/></label><div className="public-submit-row"><div><span>Current average</span><strong>{overall ? overall.toFixed(1) : "—"} / 5</strong></div><button className="btn primary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit Evaluation"}</button></div>{submitError && <div className="public-eval-error">{submitError}</div>}</section></>}
    <footer className="public-eval-footer">This evaluation link is unique to the intended requisitioner. One completed submission is allowed for this transaction.</footer>
  </div></div>;
}
