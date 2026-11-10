"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import {
  subscribePurchaseOrderEvaluations,
  subscribePurchaseOrders,
  type PurchaseOrder,
} from "../../../lib/firestore";

type Evaluation = Record<string, any>;
type Role = "purchaser" | "requisitioner" | "amd_personnel";
const criteria = [
  ["accurate_delivery", "A. Accurate delivery / Quality"],
  ["competitive_price", "B. Competitive Price"],
  ["timeliness", "C. Timeliness of Delivery"],
  ["after_sales", "D. After Sales Service"],
  ["compliance", "E. Compliance with Regulatory Requirements and School Policies"],
] as const;
const roles: Role[] = ["purchaser", "requisitioner", "amd_personnel"];
const roleTitles: Record<Role, string> = {
  purchaser: "Purchasing",
  requisitioner: "Requisitioner",
  amd_personnel: "AMD",
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function safeScore(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? String(n) : "—";
}

function rating(row: Evaluation | undefined, role: Role, index: number): string {
  if (!row) return "—";
  if (index === 4 && role !== "purchaser") return "N/A";
  const key = index === 0 ? "accurate_delivery" : index === 1 ? "competitive_price" :
    index === 2 ? "timeliness" : index === 3 ? "after_sales" : "compliance";
  const newer = row.scores?.[key];
  if (newer !== undefined) return safeScore(newer);
  const legacyKey = role === "purchaser" ? "purchasing" : role === "requisitioner" ? "requisitioner" : "amd";
  return safeScore(Array.isArray(row[legacyKey]) ? row[legacyKey][index] : undefined);
}

function average(row: Evaluation | undefined, role: Role): number | null {
  if (!row) return null;
  const values = criteria.map((_, index) => rating(row, role, index))
    .filter((value) => /^[1-5]$/.test(value)).map(Number);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function recommendation(score: number | null): string {
  if (score === null) return "Pending evaluations";
  if (score >= 4.5) return "Strongly Recommended";
  if (score >= 4) return "Recommended";
  if (score >= 3.5) return "Acceptable";
  if (score >= 3) return "Acceptable with Some Reservation";
  return "Not Recommended";
}

export default function PrintEvaluationPage() {
  const [records, setRecords] = useState<Evaluation[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const slug = typeof window === "undefined" ? "" : window.location.pathname.split("/").filter(Boolean).pop() || "";
  let poNumber = slug;
  try { poNumber = decodeURIComponent(slug); } catch {}

  useEffect(() => {
    let resolved = 0;
    const markReady = () => { resolved++; if (resolved >= 2) setLoading(false); };
    let seenEvaluations = false;
    let seenOrders = false;
    const onError = (err: Error) => { setError(err.message || "Access to the evaluation is unavailable."); setLoading(false); };
    let stopEvaluations: (() => void) | undefined;
    let stopOrders: (() => void) | undefined;
    try {
      stopEvaluations = subscribePurchaseOrderEvaluations((items) => {
        setRecords(items as Evaluation[]);
        if (!seenEvaluations) { seenEvaluations = true; markReady(); }
      }, onError);
      stopOrders = subscribePurchaseOrders((items) => {
        setPurchaseOrders(items);
        if (!seenOrders) { seenOrders = true; markReady(); }
      }, onError);
    } catch (e) { onError(e instanceof Error ? e : new Error("Please sign in to the Purchasing system.")); }
    return () => { stopEvaluations?.(); stopOrders?.(); };
  }, []);

  const matched = useMemo(() => records.filter((record) =>
    asText(record.poNumber).toLowerCase() === poNumber.toLowerCase() &&
    roles.includes(record.evaluatorRole as Role) &&
    Boolean(record.submittedAt || record.createdAt)
  ), [records, poNumber]);

  const selected = useMemo(() => {
    const byRole: Partial<Record<Role, Evaluation>> = {};
    [...matched].sort((a, b) => asText(b.submittedAt || b.createdAt).localeCompare(asText(a.submittedAt || a.createdAt)))
      .forEach((row) => {
        const role = row.evaluatorRole as Role;
        if (!byRole[role]) byRole[role] = row;
      });
    return byRole;
  }, [matched]);

  const po = purchaseOrders.find((row) => asText(row.poNumber).toLowerCase() === poNumber.toLowerCase());
  const source = selected.purchaser || selected.requisitioner || selected.amd_personnel;
  const full = roles.every((role) => Boolean(selected[role]));
  const means = roles.map((role) => average(selected[role], role));
  const finalScore = full && means.every((n) => n !== null)
    ? means.reduce<number>((total, n) => total + Number(n), 0) / 3 : null;
  const satisfaction = selected.requisitioner?.customerSatisfaction || {};
  const itemDetails = po?.items?.map((item) => [item.qty, item.unit, item.description].filter(Boolean).join(" ")).join("; ")
    || asText(source?.itemsDelivered);
  const remarksFor = (criterion: string) => roles.map((role) => {
    const record = selected[role];
    const reason = asText(record?.ratingRemarks?.[criterion]);
    return reason ? roleTitles[role] + ": " + reason : "";
  }).filter(Boolean).join(" | ");

  if (loading) return <main style={{ padding: 28 }}>Loading recorded evaluations…</main>;
  if (error) return <main style={{ padding: 28 }}>Unable to open this report: {error}</main>;
  if (!matched.length && !po) return <main style={{ padding: 28 }}>
    No stored purchase order or submitted supplier evaluation was found for PO {poNumber}.
    Return to PO Storage and save the PO first.
  </main>;

  return <div className="iso-print-page">
    <div className="iso-toolbar">
      <a href="/">← Purchasing dashboard</a>
      <span>{full ? "All three roles submitted" : "Incomplete — pending evaluator response"}</span>
      <button type="button" onClick={() => window.print()}><Printer size={16}/> Print / Save PDF</button>
    </div>
    <article className="iso-paper">
      <header className="iso-heading">
        <img src="/sisc-logo.png" alt="Southville logo"/>
        <div><strong>SOUTHVILLE INTERNATIONAL SCHOOL AND COLLEGES</strong><h1>SUPPLIER EVALUATION FORM</h1></div>
      </header>
      <div className="iso-code"><span>SISC/EOMSF-PUR-006 · REV.000 6/29/26</span><span>Evaluation Date: <b>{asText(source?.evaluationDate || source?.submittedAt).slice(0, 10) || "—"}</b></span></div>
      {!full && <div className="iso-draft">INCOMPLETE RECORD — DO NOT FILE AS A FULLY APPROVED EVALUATION</div>}
      <div className="iso-detail-grid">
        <table className="iso-detail"><tbody>
          <tr><th>Company Name:</th><td>{asText(po?.vendorName || source?.supplier) || "—"}</td></tr>
          <tr><th>Address:</th><td>{asText(po?.vendorAddress || source?.address) || "—"}</td></tr>
          <tr><th>Item/s Delivered:</th><td>{itemDetails || "—"}</td></tr>
        </tbody></table>
        <table className="iso-detail"><tbody>
          <tr><th>PRF No.:</th><td>{asText(po?.prfNumber || source?.prfNo) || "—"}</td></tr>
          <tr><th>PO Number:</th><td>{poNumber}</td></tr>
          <tr><th>Remarks:</th><td>{asText(source?.remarks || po?.notes) || "—"}</td></tr>
        </tbody></table>
        <table className="iso-detail"><tbody>
          <tr><th colSpan={2} className="iso-detail-title">Requisitioner Details</th></tr>
          <tr><th>Requisitioner Name:</th><td>{asText(po?.requisitioner || selected.requisitioner?.evaluatorName) || "—"}</td></tr>
          <tr><th>Email Address:</th><td>{asText(po?.requisitionerEmail || selected.requisitioner?.evaluatorEmail) || "—"}</td></tr>
        </tbody></table>
      </div>
      <table className="iso-criteria"><thead><tr>
        <th style={{ width: "36%" }}>CRITERIA</th><th>Purchasing</th><th>Requisitioner</th><th>AMD</th>
        <th style={{ width: "30%" }}>REMARKS — Reasons for items rated below 4</th>
      </tr></thead><tbody>
        {criteria.map(([key, label], index) => <tr key={key}>
          <td>{label}</td>{roles.map((role) => <td className="iso-center" key={role}>{rating(selected[role], role, index)}</td>)}
          <td className="iso-comment">{remarksFor(key) || " "}</td>
        </tr>)}
        <tr className="iso-average"><th>AVERAGE</th>{roles.map((role) => <td className="iso-center" key={role}>{average(selected[role], role)?.toFixed(2) || "—"}</td>)}<td/>
        </tr>
        <tr className="iso-average"><th>FINAL RATING</th><td colSpan={3} className="iso-center"><strong>{finalScore?.toFixed(2) || "Pending"}</strong></td><td>{recommendation(finalScore)}</td></tr>
      </tbody></table>

      <div className="iso-rubrics">
        <div><h2>RUBRICS</h2><table><tbody>
          <tr><th>5</th><td>Excellent — conforms to all supplier requirements</td></tr>
          <tr><th>4</th><td>Very Good — conforms to requirements</td></tr>
          <tr><th>3</th><td>Good — 1–2 deviations</td></tr>
          <tr><th>2</th><td>Fair — 3–4 nonconformance issues</td></tr>
          <tr><th>1</th><td>Poor — 6 or more nonconformance issues</td></tr>
        </tbody></table></div>
        <div><h2>RECOMMENDATIONS</h2><table><tbody>
          <tr><th>4.5–5.0</th><td>Strongly Recommended</td></tr>
          <tr><th>4.0–4.49</th><td>Recommended</td></tr>
          <tr><th>3.5–3.99</th><td>Acceptable</td></tr>
          <tr><th>3.0–3.49</th><td>Acceptable with Some Reservation</td></tr>
          <tr><th>Below 3.0</th><td>Not Recommended</td></tr>
        </tbody></table></div>
      </div>
      <p className="iso-note">This form is used after delivery, per transaction with the supplier. Scores were recorded through unique evaluator links. Supplier and Purchasing-service scores are separate.</p>
      <div className="iso-signatures">
        <div><b>CONFORMED BY:</b><div className="iso-signline"/>Supplier representative name and signature</div>
        <div><b>EVALUATOR:</b><small>Purchasing: {asText(selected.purchaser?.evaluatorName) || "Pending"}</small><div className="iso-signline"/>Name and signature</div>
        <div><b>NOTED BY:</b><div className="iso-signline"/>Next Level Head / Manager</div>
        <div><b>APPROVED BY:</b><div className="iso-signline"/>President</div>
      </div>
      <section className="iso-customer-section">
        <h2 className="iso-cs-title">CUSTOMER SATISFACTION RATING</h2>
      <p className="iso-cs-note">To be filled out by the requisitioner after completion of delivery — Purchasing Office service</p>
      <table className="iso-cs"><thead><tr><th>Criteria (5 highest; 1 poor)</th><th>Rating</th><th>Comments and Suggestions</th></tr></thead>
        <tbody>
          <tr><td>1. Timeliness</td><td className="iso-center">{safeScore(satisfaction.timeliness)}</td><td rowSpan={2}>{asText(satisfaction.comments) || " "}</td></tr>
          <tr><td>2. Accuracy</td><td className="iso-center">{safeScore(satisfaction.accuracy)}</td></tr>
        </tbody>
      </table>
      <div className="iso-cs-signs">
        <div><b>EVALUATED BY:</b><small>{asText(satisfaction.evaluatedBy || selected.requisitioner?.evaluatorName) || "Pending"}</small><div className="iso-signline"/>Name and Signature of Requisitioner</div>
        <div><b>EVALUATED BY:</b><div className="iso-signline"/>Next Level Head / Manager</div>
      </div>
      </section>
      <footer>System-generated filing copy based on the Southville Supplier Evaluation worksheet.
        Document Control must verify the controlled revision and authorized signatories before official use.
        PO {poNumber}</footer>
    </article>
    <style>{`
      .iso-print-page{min-height:100vh;background:#e7e8ed;padding:20px;font-family:Arial,sans-serif;color:#101010}
      .iso-toolbar{max-width:860px;margin:0 auto 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px}
      .iso-toolbar a{color:#4c2380;text-decoration:none}.iso-toolbar button{display:flex;align-items:center;gap:8px;background:#4c2380;color:white;border:0;border-radius:8px;padding:10px 14px;cursor:pointer}
      .iso-paper{background:#fff;max-width:816px;margin:auto;min-height:1056px;padding:28px;box-shadow:0 5px 25px #0002;font:11px/1.3 "Times New Roman",serif}
      .iso-heading{display:flex;border:1px solid #000;align-items:center;text-align:center}.iso-heading img{width:74px;height:70px;object-fit:contain;border-right:1px solid #000;padding:7px}.iso-heading>div{flex:1}.iso-heading strong{font-size:13px}.iso-heading h1{font-size:15px;margin:8px 0 4px}
      .iso-code{display:flex;justify-content:space-between;border:1px solid #000;border-top:0;padding:5px 7px;font-size:10px}.iso-draft{font:700 11px Arial,sans-serif;letter-spacing:.04em;color:#9a3412;text-align:center;border:1px dashed #9a3412;padding:5px;margin:7px 0}
      .iso-paper table{width:100%;border-collapse:collapse;table-layout:fixed}.iso-paper th,.iso-paper td{border:1px solid #000;padding:5px;overflow-wrap:anywhere;vertical-align:top}
      .iso-detail-grid{display:grid;grid-template-columns:1.34fr 1fr 1.2fr;gap:0;border-left:1px solid #000;border-bottom:1px solid #000}
      .iso-detail{border-collapse:collapse;width:100%;table-layout:fixed;min-width:0}
      .iso-detail th,.iso-detail td{padding:6px 5px;border:0;border-right:1px solid #000;border-top:1px solid #000;vertical-align:top;font-size:10px;overflow-wrap:anywhere}
      .iso-detail th{font-weight:600;width:39%}.iso-detail td{width:61%;min-height:20px}
      .iso-detail-title{background:#f6f6f6;text-align:center;font-weight:700!important;width:100%!important}
      .iso-detail tr:nth-child(2) td,.iso-detail tr:nth-child(3) td{height:27px}
      .iso-criteria{margin-top:10px}.iso-criteria thead th{text-align:center}.iso-center{text-align:center}.iso-comment{font-size:10px}.iso-average th{text-align:right}.iso-rubrics{display:grid;grid-template-columns:2fr 1.2fr;gap:20px;margin-top:14px}.iso-rubrics h2{font-size:11px;margin:0 0 4px}.iso-rubrics th{width:19%}.iso-rubrics td{font-size:9px}.iso-note{font-size:9px;margin:10px 0 14px}
      .iso-signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;break-inside:avoid}.iso-signatures>div:first-child{grid-column:1/-1;width:35%;margin-bottom:3px}.iso-signatures>div{min-height:52px}.iso-signatures small,.iso-cs-signs small{display:block;margin-top:4px}.iso-signline{border-bottom:1px solid black;height:25px;margin:0 0 3px}
      .iso-customer-section{margin-top:18px;padding-top:9px;border-top:1px solid #000;break-inside:avoid;page-break-inside:avoid}
      .iso-criteria tr,.iso-rubrics,.iso-signatures{break-inside:avoid;page-break-inside:avoid}
      .iso-cs-title{text-align:center;margin:19px 0 4px;font-size:13px}.iso-cs-note{text-align:center;font-size:10px}.iso-cs th:first-child{width:38%}.iso-cs th:nth-child(2){width:16%}.iso-cs td{height:31px}.iso-cs-signs{display:grid;grid-template-columns:1fr 1fr;gap:45px;margin-top:16px}.iso-cs-signs>div{min-height:68px}.iso-paper footer{font-size:9px;text-align:center;margin-top:17px;color:#555}
      @media print{@page{size:letter;margin:0.35in}.iso-print-page{background:#fff;padding:0}.iso-toolbar{display:none}.iso-paper{box-shadow:none;padding:0;width:auto;max-width:none;min-height:0}.iso-paper table{font-size:10px}.iso-detail th,.iso-detail td{font-size:9px}.iso-customer-section{break-before:page;page-break-before:always;margin-top:0;border-top:0;padding-top:8px}.iso-print-page,.iso-paper{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    `}</style>
  </div>;
}
