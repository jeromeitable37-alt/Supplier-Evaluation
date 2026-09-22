"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, CheckCircle2, ClipboardList, Clock3, DollarSign, FileText, RefreshCw, Truck, Users } from "lucide-react";

type Rating = number | null;
type Evaluation = {
  id: string; prfNo: string; poNumber: string; itemsDelivered: string; evaluationDate: string; supplier: string; address: string; remarks: string;
  purchasing: Rating[]; requisitioner: Rating[]; amd: Rating[]; purchasingAvg: number; requisitionerAvg: number; amdAvg: number; finalRating: number; recommendation: string; createdAt: string; source?: string;
};
type Props = { stats: any; recent: Evaluation[]; monthly: any[]; onScan: () => void; onNew: () => void; onView: (x: Evaluation) => void; onViewAll: () => void; canScan: boolean; canCreate: boolean };
type Match = Record<string, any> & { poNumber?: string };
type Group = { poNumber: string; matches: Match[] };

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const norm = (v: unknown) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const asDate = (v: unknown) => { const d = new Date(String(v || "")); return Number.isNaN(d.getTime()) ? null : d; };
const ayOf = (v: unknown) => { const d = asDate(v); if (!d) return ""; const sy = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return `AY ${sy}–${sy + 1}`; };
const fmtMoney = (v: number) => `Php ${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v: unknown) => { const d = asDate(v); return d ? d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—"; };

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta?: string }) {
  return <div className="stat-card advanced-stat"><div className="stat-icon">{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong>{meta && <small>{meta}</small>}</div><div className="stat-line" /></div>;
}

export default function AdvancedDashboard({ stats, recent, monthly, onScan, onNew, onView, onViewAll, canScan, canCreate }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/po-lookup", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.message || "PO analytics unavailable.");
        if (!alive) return;
        setGroups(Array.isArray(data.poRecords) ? data.poRecords : []);
        setSyncedAt(data.fetchedAt || new Date().toISOString());
        setError("");
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Unable to load PO dashboard data."); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const pos = useMemo(() => groups.map((g) => {
    const first = (g.matches || [])[0] || {};
    return { ...first, poNumber: g.poNumber, supplier: first.supplier || "", buyerName: first.buyerName || "", total: n(first.total || first.grandTotal), status: first.status || "Pending", expectedDate: first.expectedDate || "", actualDeliveryDate: first.actualDeliveryDate || "", orderDate: first.orderDate || "", prfNumber: first.prfNumber || "", requisitioner: first.requisitioner || "" };
  }), [groups]);

  const poStats = useMemo(() => {
    const totalValue = pos.reduce((s, p) => s + p.total, 0);
    const pending = pos.filter(p => String(p.status).toLowerCase() === "pending").length;
    const partial = pos.filter(p => String(p.status).toLowerCase().includes("partial")).length;
    const delivered = pos.filter(p => String(p.status).toLowerCase() === "delivered" || String(p.status).toLowerCase() === "done").length;
    const now = new Date(); now.setHours(0,0,0,0);
    const overdue = pos.filter(p => { const d = asDate(p.expectedDate); if (!d) return false; d.setHours(0,0,0,0); const s = String(p.status).toLowerCase(); return d < now && s !== "delivered" && s !== "done"; }).length;
    const lead = pos.map(p => { const a = asDate(p.orderDate), b = asDate(p.actualDeliveryDate); if (!a || !b) return null; const days = Math.round((b.getTime() - a.getTime()) / 86400000); return days >= 0 && days < 365 ? days : null; }).filter((x): x is number => x !== null);
    const avgLead = lead.length ? Math.round(lead.reduce((a,b)=>a+b,0)/lead.length) : 0;
    const vendors = new Set(pos.map(p => String(p.supplier || "").trim()).filter(Boolean)).size;
    return { totalValue, pending, partial, delivered, overdue, avgLead, vendors };
  }, [pos]);

  const recentPOs = useMemo(() => [...pos].sort((a,b) => String(b.orderDate || "").localeCompare(String(a.orderDate || ""))).slice(0, 7), [pos]);
  const maxMonthly = Math.max(1, ...monthly.map((m) => n(m.avg)));

  return <div>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> PURCHASING PERFORMANCE WORKSPACE</div>
        <h1>Good day, Purchasing Team.</h1>
        <p>Monitor purchase orders, supplier evaluations, delivery performance, and evaluator responses in one workspace.</p>
        <div className="hero-actions">{canScan && <button className="btn primary large" onClick={onScan}>Scan a Form</button>}{canCreate && <button className="btn soft large" onClick={onNew}>New Evaluation</button>}<button className="btn ghost large" onClick={onViewAll}>View Reports</button></div>
      </div>
      <div className="hero-art"><div className="hero-orbit one"/><div className="hero-orbit two"/><div className="hero-core"><BarChart3 size={26}/></div><div className="hero-float float-one"><ClipboardList size={16}/><b>{pos.length.toLocaleString()}</b><span>purchase orders</span></div><div className="hero-float float-two"><CheckCircle2 size={16}/><b>{stats.avg ? stats.avg.toFixed(2) : "—"}</b><span>evaluation avg</span></div></div>
    </section>

    <section className="stats-grid advanced-stats-grid">
      <Metric icon={<FileText size={18}/>} label="Total POs" value={loading ? "…" : pos.length.toLocaleString()} meta="Live Google Sheet" />
      <Metric icon={<DollarSign size={18}/>} label="Total PO Value" value={loading ? "…" : fmtMoney(poStats.totalValue)} meta="Current PO source" />
      <Metric icon={<Users size={18}/>} label="Vendors" value={loading ? "…" : poStats.vendors.toLocaleString()} meta="Unique suppliers" />
      <Metric icon={<Clock3 size={18}/>} label="Pending" value={loading ? "…" : poStats.pending.toLocaleString()} meta="Not yet delivered" />
      <Metric icon={<Truck size={18}/>} label="Delivered" value={loading ? "…" : poStats.delivered.toLocaleString()} meta={`${poStats.avgLead ? `${poStats.avgLead} day avg lead` : "Lead time pending"}`} />
      <Metric icon={<AlertCircle size={18}/>} label="Overdue" value={loading ? "…" : poStats.overdue.toLocaleString()} meta="Past expected delivery" />
    </section>

    {error && <div className="panel warning-panel"><AlertCircle size={18}/><div><b>PO dashboard data needs attention</b><p>{error}</p></div></div>}

    <section className="content-grid wide-left">
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">PURCHASE ORDERS</div><h2>Recent PO activity</h2><p>Latest purchasing records loaded from the configured Google Sheet.</p></div>{syncedAt && <span className="muted-note">Synced {new Date(syncedAt).toLocaleTimeString()}</span>}</div><div className="table-wrap"><table><thead><tr><th>PO</th><th>Supplier</th><th>Buyer</th><th>PRF</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>{recentPOs.map((p) => <tr key={p.poNumber} className="click-row"><td><b>{p.poNumber}</b></td><td>{p.supplier || "—"}</td><td>{p.buyerName || "—"}</td><td>{p.prfNumber || "—"}</td><td>{fmtDate(p.orderDate)}</td><td>{p.status || "Pending"}</td><td>{fmtMoney(p.total)}</td></tr>)}{!recentPOs.length && <tr><td colSpan={7}><Empty text="No PO data" sub="The dashboard will populate when the Google Sheet returns purchase-order records."/></td></tr>}</tbody></table></div></div>
      <div className="panel workflow-panel"><div className="panel-head"><div><div className="section-kicker">EVALUATION WORKFLOW</div><h2>Evaluation activity</h2><p>Current website database at a glance.</p></div></div><WorkflowRow label="Evaluations" value={stats.total.toLocaleString()} meta="Saved in Firebase"/><WorkflowRow label="Rated records" value={recordsRated(recent)} meta="Recent activity"/><WorkflowRow label="Average rating" value={stats.avg ? stats.avg.toFixed(2) : "—"} meta="All rated records"/><WorkflowRow label="Overdue POs" value={loading ? "…" : String(poStats.overdue)} meta="Needs monitoring"/></div>
    </section>

    <section className="content-grid">
      <div className="panel chart-panel"><div className="panel-head"><div><div className="section-kicker">EVALUATION TREND</div><h2>Monthly average rating</h2><p>Recent rated evaluation periods.</p></div></div>{monthly.length ? <div className="mini-bar-chart">{monthly.map((m) => <div className="mini-bar-col" key={m.month}><b>{n(m.avg).toFixed(2)}</b><div className="mini-bar-track"><i style={{height:`${Math.max(8,(n(m.avg)/maxMonthly)*100)}%`}}/></div><span>{m.month.slice(5)}</span></div>)}</div> : <Empty text="No monthly ratings" sub="Rated evaluations are needed for the trend chart."/>}</div>
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">RECENT EVALUATIONS</div><h2>Latest supplier feedback</h2><p>Newest records from the website database.</p></div></div><div className="table-wrap"><table><thead><tr><th>Supplier</th><th>PRF</th><th>PO</th><th>Rating</th></tr></thead><tbody>{recent.slice(0,6).map((r)=><tr key={r.id} className="click-row" onClick={()=>onView(r)}><td><b>{r.supplier || "Unknown"}</b><small>{r.itemsDelivered || "No item description"}</small></td><td>{r.prfNo || "—"}</td><td>{r.poNumber || "—"}</td><td>{r.finalRating ? r.finalRating.toFixed(2) : "—"}</td></tr>)}{!recent.length&&<tr><td colSpan={4}><Empty text="No evaluations yet" sub="Create or import supplier evaluations to populate this panel."/></td></tr>}</tbody></table></div></div>
    </section>
  </div>;
}

function recordsRated(rows: Evaluation[]) { return rows.filter(r => r.finalRating > 0).length.toLocaleString(); }
function WorkflowRow({ label, value, meta }: { label:string; value:string; meta:string }) { return <div className="workflow"><div className="workflow-step">•</div><div><b>{label}</b><p>{meta}</p></div><strong>{value}</strong></div>; }
function Empty({ text, sub }: { text:string; sub:string }) { return <div className="empty"><div className="empty-icon">◌</div><div className="empty-title">{text}</div><div className="empty-sub">{sub}</div></div>; }
