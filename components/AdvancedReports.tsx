"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, CalendarDays, CheckCircle2, Clock3, DollarSign, FileBarChart2, RefreshCw, Truck, Users } from "lucide-react";
import { subscribeEvaluationLinks, type PublicEvaluationLink } from "../lib/firestore";

type Rating = number | null;
type Evaluation = {
  id: string; prfNo: string; poNumber: string; itemsDelivered: string; evaluationDate: string; supplier: string; address: string; remarks: string;
  purchasing: Rating[]; requisitioner: Rating[]; amd: Rating[]; purchasingAvg: number; requisitionerAvg: number; amdAvg: number; finalRating: number; recommendation: string; createdAt: string; source?: string;
};
type Match = Record<string, any> & { poNumber?: string };
type Group = { poNumber: string; matches: Match[] };

const criteria = [
  ["accurate_delivery","Accurate Delivery / Quality"],
  ["competitive_price","Competitive Price"],
  ["timeliness","Timeliness of Delivery"],
  ["after_sales","After Sales Services"],
  ["compliance","Compliance with Regulatory Requirements and School Policies"],
] as const;
const n = (v: unknown) => { const x=Number(v); return Number.isFinite(x)?x:0; };
const dateOf=(v:unknown)=>{const d=new Date(String(v||""));return Number.isNaN(d.getTime())?null:d;};
const ayOf=(v:unknown)=>{const d=dateOf(v);if(!d)return"";const sy=d.getMonth()>=6?d.getFullYear():d.getFullYear()-1;return`AY ${sy}–${sy+1}`;};
const avg=(xs:number[])=>xs.length?Math.round((xs.reduce((a,b)=>a+b,0)/xs.length)*100)/100:null;
const money=(v:number)=>`Php ${v.toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const norm=(v:unknown)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const fmtDate=(v:unknown)=>{const d=dateOf(v);return d?d.toLocaleDateString("en-PH",{year:"numeric",month:"short",day:"numeric"}):"—";};

function totalForGroup(group: Group) {
  const matches = Array.isArray(group.matches) ? group.matches : [];
  const explicitTotals = matches.map((m) => n(m.total ?? m.grandTotal ?? m.approvedAmount ?? m.auditedAmount)).filter((v) => v > 0);
  if (explicitTotals.length) {
    const uniqueTotals = Array.from(new Set(explicitTotals.map((v) => Math.round(v * 100) / 100)));
    return uniqueTotals.length === 1 ? uniqueTotals[0] : uniqueTotals.reduce((a, b) => a + b, 0);
  }
  const lineTotals = matches.reduce((sum, m) => sum + n(m.lineTotal), 0);
  if (lineTotals > 0) return lineTotals;
  return matches.reduce((sum, m) => {
    const qty = n(m.quantity);
    const unitPrice = n(m.unitPrice);
    return sum + (qty > 0 && unitPrice > 0 ? qty * unitPrice : 0);
  }, 0);
}
function currentAYs(){const now=new Date();const start=now.getMonth()>=6?now.getFullYear():now.getFullYear()-1;return Array.from({length:5},(_,i)=>`AY ${start-i}–${start-i+1}`);}

function BarChart({ data, moneyValues=false, maxItems=24 }: { data:{label:string;value:number}[]; moneyValues?:boolean; maxItems?:number }) {
  const rows=data.slice(-maxItems); const max=Math.max(1,...rows.map(x=>x.value));
  if(!rows.length)return <div className="empty"><div className="empty-title">No chart data</div><div className="empty-sub">Data will appear when records are available.</div></div>;
  return <div className="analytics-bars">{rows.map((x,i)=><div className="analytics-bar-col" key={`${x.label}-${i}`}><b>{moneyValues?money(x.value):x.value.toLocaleString()}</b><div className="analytics-bar-track"><i style={{height:`${Math.max(6,x.value/max*100)}%`}}/></div><span>{x.label}</span></div>)}</div>;
}
function ScorePill({ value }: {value:number|null}) { return <span className={`analytics-score ${value===null?"empty":value>=4.5?"excellent":value>=4?"good":value>=3.5?"mid":"low"}`}>{value===null?"—":value.toFixed(2)}</span>; }
function MiniProgress({ value, max=5 }: {value:number|null;max?:number}) { const pct=value===null?0:Math.max(0,Math.min(100,value/max*100)); return <div className="analytics-progress"><i style={{width:`${pct}%`}}/></div>; }

export default function AdvancedReports({ records }: { records: Evaluation[]; monthly: any[] }) {
  const [groups,setGroups]=useState<Group[]>([]); const [links,setLinks]=useState<PublicEvaluationLink[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const [ayFilter,setAyFilter]=useState("all"); const [poView,setPoView]=useState<"monthly"|"ay">("monthly"); const [vendorFilter,setVendorFilter]=useState("all");
  const ayLabels=useMemo(currentAYs,[]);

  useEffect(()=>{let alive=true;const load=async()=>{try{const res=await fetch("/api/po-lookup",{cache:"no-store"});const data=await res.json();if(!res.ok||!data?.ok)throw new Error(data?.message||"Could not load PO analytics data.");if(alive){setGroups(Array.isArray(data.poRecords)?data.poRecords:[]);setError("");}}catch(e){if(alive)setError(e instanceof Error?e.message:"Could not load PO analytics data.");}finally{if(alive)setLoading(false);}};void load();const t=window.setInterval(()=>void load(),60000);return()=>{alive=false;window.clearInterval(t);};},[]);
  useEffect(()=>subscribeEvaluationLinks(setLinks,(e)=>setError(e.message)),[]);

  const evalRows=useMemo(()=>records.filter(r=>r.finalRating>0),[records]);
  const vendors=useMemo(()=>Array.from(new Set(evalRows.map(r=>r.supplier).filter(Boolean))).sort(),[evalRows]);
  const filteredEvals=useMemo(()=>vendorFilter==="all"?evalRows:evalRows.filter(r=>r.supplier===vendorFilter),[evalRows,vendorFilter]);

  const scorecard=useMemo(()=>vendors.map(v=>{const rs=evalRows.filter(r=>r.supplier===v);const score=(key:keyof Evaluation)=>avg(rs.map(r=>n(r[key] as number)).filter(x=>x>0));const trend:any={};ayLabels.forEach(ay=>{trend[ay]=avg(rs.filter(r=>ayOf(r.evaluationDate||r.createdAt)===ay).map(r=>n(r.finalRating)).filter(x=>x>0));});return{vendor:v,total:rs.length,overall:score("finalRating"),accurate_delivery:avg(rs.map(r=>n(r.purchasing[0])).filter(x=>x>0).concat(rs.map(r=>n(r.requisitioner[0])).filter(x=>x>0),rs.map(r=>n(r.amd[0])).filter(x=>x>0))),competitive_price:avg(rs.map(r=>n(r.purchasing[1])).filter(x=>x>0).concat(rs.map(r=>n(r.requisitioner[1])).filter(x=>x>0),rs.map(r=>n(r.amd[1])).filter(x=>x>0))),timeliness:avg(rs.map(r=>n(r.purchasing[2])).filter(x=>x>0).concat(rs.map(r=>n(r.requisitioner[2])).filter(x=>x>0),rs.map(r=>n(r.amd[2])).filter(x=>x>0))),after_sales:avg(rs.map(r=>n(r.purchasing[3])).filter(x=>x>0).concat(rs.map(r=>n(r.requisitioner[3])).filter(x=>x>0),rs.map(r=>n(r.amd[3])).filter(x=>x>0))),compliance:avg(rs.map(r=>n(r.purchasing[4])).filter(x=>x>0)),trend};}).filter(x=>x.overall!==null).sort((a,b)=>(b.overall||0)-(a.overall||0)),[vendors,evalRows,ayLabels]);

  const curAY=ayLabels[0],prevAY=ayLabels[1];
  const ayComparison=useMemo(()=>scorecard.map(v=>({vendor:v.vendor,cur:v.trend[curAY]??null,prev:v.trend[prevAY]??null,delta:v.trend[curAY]!==null&&v.trend[prevAY]!==null?Math.round((v.trend[curAY]-v.trend[prevAY])*100)/100:null})).filter(v=>v.cur!==null||v.prev!==null),[scorecard,curAY,prevAY]);
  const criteriaTop=useMemo(()=>criteria.map(([key,label])=>({key,label,rows:scorecard.filter(v=>v[key]!==null).sort((a,b)=>(b[key]||0)-(a[key]||0)).slice(0,3)})),[scorecard]);

  const participation=useMemo(()=>ayLabels.map(ay=>{const rows=links.filter(l=>ayOf(l.createdAt)===ay);const roles:any={purchaser:[0,0],requisitioner:[0,0],amd_personnel:[0,0]};rows.forEach(l=>{const role=l.evaluatorRole||"requisitioner";if(roles[role]){roles[role][0]++;if(l.status==="submitted")roles[role][1]++;}});return{ay,roles};}),[links,ayLabels]);
  const completion=useMemo(()=>scorecard.map(v=>{const sent=links.filter(l=>String(l.po?.vendorName||"")===v.vendor).length;const sub=links.filter(l=>String(l.po?.vendorName||"")===v.vendor&&l.status==="submitted").length;return{vendor:v.vendor,sent,submitted:sub,rate:sent?Math.round(sub/sent*100):0};}).sort((a,b)=>b.rate-a.rate),[scorecard,links]);

  const poRows=useMemo(()=>groups.map(g=>{const m=(g.matches||[])[0]||{};return{po:g.poNumber,supplier:String(m.supplier||""),total:totalForGroup(g),status:String(m.status||"Pending"),orderDate:m.orderDate||"",expectedDate:m.expectedDate||"",actualDate:m.actualDeliveryDate||"",prf:m.prfNumber||"",requisitioner:m.requisitioner||""};}),[groups]);
  const poStats=useMemo(()=>{let spend=0;const status:any={Pending:0,"Partial Delivery":0,Delivered:0};const overdue:any={};const lead:any={};for(const p of poRows){spend+=p.total;const s=p.status.toLowerCase();if(s.includes("partial"))status["Partial Delivery"]++;else if(s.includes("delivered")||s==="done")status.Delivered++;else status.Pending++;const exp=dateOf(p.expectedDate);if(exp){exp.setHours(0,0,0,0);const today=new Date();today.setHours(0,0,0,0);if(exp<today&&!s.includes("delivered")&&!s.includes("done")){const days=Math.floor((today.getTime()-exp.getTime())/86400000);overdue[p.supplier]=overdue[p.supplier]||[];overdue[p.supplier].push(days);}}const a=dateOf(p.orderDate),b=dateOf(p.actualDate);if(a&&b){const d=Math.round((b.getTime()-a.getTime())/86400000);if(d>=0&&d<365){lead[p.supplier]=lead[p.supplier]||[];lead[p.supplier].push(d);}}}const overdueRows=Object.entries(overdue).map(([vendor,arr])=>{const days=arr as number[];const avgDays=Math.round(days.reduce((a,b)=>a+b,0)/days.length);return{vendor,count:days.length,avgDays,severity:avgDays>30?"Critical":avgDays>14?"High":avgDays>7?"Medium":"Low"};}).sort((a,b)=>b.count-a.count||b.avgDays-a.avgDays);const leadRows=Object.entries(lead).map(([vendor,arr])=>{const days=arr as number[];const avgDays=Math.round(days.reduce((a,b)=>a+b,0)/days.length);return{vendor,days:avgDays,count:days.length,speed:avgDays<=7?"Fast":avgDays<=14?"Normal":avgDays<=30?"Slow":"Very Slow"};}).sort((a,b)=>a.days-b.days);return{spend,status,overdueRows,leadRows};},[poRows]);
  const spendMonthly=useMemo(()=>{const map:any={};poRows.forEach(p=>{const d=dateOf(p.orderDate);if(!d)return;const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;map[key]=(map[key]||0)+p.total;});return Object.keys(map).sort().map(k=>({label:k,value:map[k]}));},[poRows]);
  const spendAY=useMemo(()=>ayLabels.map(ay=>({label:ay,value:poRows.filter(p=>ayOf(p.orderDate)===ay).reduce((s,p)=>s+p.total,0)})),[poRows,ayLabels]);
  const volumeMonthly=useMemo(()=>{const map:any={};poRows.forEach(p=>{const d=dateOf(p.orderDate);if(!d)return;const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;map[key]=(map[key]||0)+1;});return Object.keys(map).sort().map(k=>({label:k,value:map[k]}));},[poRows]);
  const volumeAY=useMemo(()=>ayLabels.map(ay=>({label:ay,value:poRows.filter(p=>ayOf(p.orderDate)===ay).length})),[poRows,ayLabels]);
  const valueVsScore=useMemo(()=>filteredEvals.map(r=>{const po=poRows.find(p=>p.po===r.poNumber);return po&&po.total>0?{po:po.po,vendor:r.supplier,total:po.total,score:r.finalRating}:null;}).filter(Boolean) as {po:string;vendor:string;total:number;score:number}[],[filteredEvals,poRows]);
  const maxValue=Math.max(1,...valueVsScore.map(x=>x.total));

  const filteredParticipation=ayFilter==="all"?participation:participation.filter(x=>x.ay===ayFilter);
  const currentScorecard=ayFilter==="all"?scorecard:scorecard.filter(v=>v.trend[ayFilter]!==null);

  return <div>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> PERFORMANCE ANALYTICS</div><h1>Reports & Ratings</h1><p>Supplier performance, evaluator participation, purchasing spend, delivery status, and academic-year analytics.</p></div><div className="heading-badge"><FileBarChart2 size={15}/><span>{loading?"Loading…":`${poRows.length.toLocaleString()} POs analyzed`}</span></div></div>
    {error&&<div className="panel warning-panel"><AlertCircle size={18}/><div><b>Some live analytics data needs attention</b><p>{error}</p></div></div>}

    <div className="panel analytics-controls"><div><span>Academic Year</span><select value={ayFilter} onChange={e=>setAyFilter(e.target.value)}><option value="all">All Academic Years</option>{ayLabels.map(a=><option key={a}>{a}</option>)}</select></div><div><span>Supplier</span><select value={vendorFilter} onChange={e=>setVendorFilter(e.target.value)}><option value="all">All suppliers</option>{vendors.map(v=><option key={v}>{v}</option>)}</select></div><div><span>PO chart view</span><select value={poView} onChange={e=>setPoView(e.target.value as any)}><option value="monthly">Monthly</option><option value="ay">Academic Year</option></select></div><button className="btn secondary" onClick={()=>location.reload()}><RefreshCw size={14}/> Refresh</button></div>

    <section className="stats-grid advanced-stats-grid">
      <Metric icon={<Users size={18}/>} label="Evaluated Vendors" value={currentScorecard.length.toLocaleString()} meta="Rated supplier records"/>
      <Metric icon={<CheckCircle2 size={18}/>} label="Total Evaluations" value={filteredEvals.length.toLocaleString()} meta="Submitted/rated records"/>
      <Metric icon={<BarChart3 size={18}/>} label="Average Score" value={currentScorecard.length?`${(currentScorecard.reduce((s,v)=>s+(v.overall||0),0)/currentScorecard.length).toFixed(2)} / 5`:"—"} meta={ayFilter==="all"?"All available AYs":ayFilter}/>
      <Metric icon={<Clock3 size={18}/>} label="Pending Responses" value={String((links.filter(l=>l.status!=="submitted").length)||0)} meta="Evaluation links awaiting submission"/>
      <Metric icon={<DollarSign size={18}/>} label="Total PO Spend" value={money(poStats.spend)} meta="PO / approved source value"/>
      <Metric icon={<Truck size={18}/>} label="Delivered POs" value={String(poStats.status.Delivered||0)} meta={`${poStats.leadRows.length} suppliers with lead-time data`}/>
    </section>

    <section className="panel"><div className="panel-head"><div><div className="section-kicker">SUPPLIER SCORECARD</div><h2>Supplier performance by criterion</h2><p>Scores are aggregated from submitted evaluator records, matching the five-criterion Purchasing flow and four-criterion Requisitioner/AMD flow.</p></div></div><div className="table-wrap"><table className="analytics-table"><thead><tr><th>Supplier</th><th>Accuracy</th><th>Price</th><th>Timeliness</th><th>After Sales</th><th>Compliance</th><th>Overall</th><th>Evaluations</th></tr></thead><tbody>{currentScorecard.map(v=><tr key={v.vendor}><td><b>{v.vendor}</b></td><td><ScorePill value={v.accurate_delivery}/></td><td><ScorePill value={v.competitive_price}/></td><td><ScorePill value={v.timeliness}/></td><td><ScorePill value={v.after_sales}/></td><td><ScorePill value={v.compliance}/></td><td><ScorePill value={v.overall}/></td><td>{v.total}</td></tr>)}{!currentScorecard.length&&<tr><td colSpan={8}><Empty/></td></tr>}</tbody></table></div></section>

    <section className="content-grid"><div className="panel"><div className="panel-head"><div><div className="section-kicker">SCORE TREND</div><h2>Supplier score trend by AY</h2><p>Current and previous academic-year averages.</p></div></div><div className="table-wrap"><table className="analytics-table"><thead><tr><th>Supplier</th>{ayLabels.map(a=><th key={a}>{a.replace("AY ","")}</th>)}</tr></thead><tbody>{currentScorecard.map(v=><tr key={v.vendor}><td><b>{v.vendor}</b></td>{ayLabels.map(a=><td key={a}><ScorePill value={v.trend[a]??null}/></td>)}</tr>)}{!currentScorecard.length&&<tr><td colSpan={6}><Empty/></td></tr>}</tbody></table></div></div>
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">AY COMPARISON</div><h2>{curAY} vs {prevAY}</h2><p>Difference between the two most recent academic years.</p></div></div><div className="analytics-compare-list">{ayComparison.map(v=><div className="analytics-compare" key={v.vendor}><div><b>{v.vendor}</b><small>{prevAY} → {curAY}</small></div><div className="analytics-compare-values"><ScorePill value={v.prev}/><span>→</span><ScorePill value={v.cur}/>{v.delta!==null&&<span className="analytics-delta">{v.delta>0?"+":""}{v.delta.toFixed(2)}</span>}</div></div>)}{!ayComparison.length&&<Empty/>}</div></div></section>

    <section className="content-grid"><div className="panel"><div className="panel-head"><div><div className="section-kicker">CRITERIA ANALYSIS</div><h2>Criteria performance</h2><p>Leading supplier averages for each evaluation criterion.</p></div></div>{criteriaTop.map(c=><div className="criterion-analytics" key={c.key}><div className="criterion-analytics-head"><b>{c.label}</b></div>{c.rows.map(v=><div className="criterion-vendor" key={v.vendor}><span>{v.vendor}</span><MiniProgress value={v[c.key]}/><strong>{(v[c.key] as number).toFixed(2)}</strong></div>)}</div>)}</div>
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">RECOMMENDATION DISTRIBUTION</div><h2>Evaluation recommendations</h2><p>Distribution across submitted records.</p></div></div><RecommendationBars records={filteredEvals}/></div></section>

    <section className="panel"><div className="panel-head"><div><div className="section-kicker">EVALUATOR PARTICIPATION</div><h2>Sent vs submitted by role</h2><p>Purchasing / Buyer, Requisitioner, and AMD responses by academic year.</p></div></div><div className="table-wrap"><table className="analytics-table"><thead><tr><th>Academic Year</th><th>Role</th><th>Sent</th><th>Submitted</th><th>Completion</th></tr></thead><tbody>{filteredParticipation.flatMap(p=>(["purchaser","requisitioner","amd_personnel"] as const).map((role,i)=>{const x=p.roles[role] as [number,number];if(!x[0])return null;const rate=Math.round(x[1]/x[0]*100);return <tr key={`${p.ay}-${role}`}><td>{i===0?p.ay:""}</td><td>{role==="purchaser"?"Purchasing / Buyer":role==="amd_personnel"?"AMD Personnel":"Requisitioner"}</td><td>{x[0]}</td><td>{x[1]}</td><td><MiniProgress value={rate} max={100}/><b>{rate}%</b></td></tr>;})).filter(Boolean)}{!filteredParticipation.some(p=>(["purchaser","requisitioner","amd_personnel"] as const).some(r=>(p.roles[r] as [number,number])[0]>0))&&<tr><td colSpan={5}><Empty/></td></tr>}</tbody></table></div></section>

    <section className="panel"><div className="panel-head"><div><div className="section-kicker">COMPLETION RATE</div><h2>Evaluator response completion by supplier</h2><p>Based on evaluation links created and submitted.</p></div></div><div className="analytics-completion-grid">{completion.slice(0,12).map(v=><div className="analytics-completion-card" key={v.vendor}><div><b>{v.vendor}</b><small>{v.submitted} submitted / {v.sent} sent</small></div><strong>{v.rate}%</strong><MiniProgress value={v.rate} max={100}/></div>)}{!completion.length&&<Empty/>}</div></section>

    <section className="panel"><div className="panel-head"><div><div className="section-kicker">PO ANALYTICS</div><h2>Spending overview</h2><p>PO value over time using the same source data as the purchasing workflow.</p></div></div><BarChart data={poView==="ay"?spendAY:spendMonthly} moneyValues/></section>
    <section className="content-grid"><div className="panel"><div className="panel-head"><div><div className="section-kicker">PO VOLUME TREND</div><h2>Purchase orders over time</h2><p>PO count by month or academic year.</p></div></div><BarChart data={poView==="ay"?volumeAY:volumeMonthly}/></div>
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">ORDER STATUS</div><h2>Order status breakdown</h2><p>Current PO delivery status.</p></div></div><StatusBreakdown status={poStats.status}/></div></section>

    <section className="content-grid"><div className="panel"><div className="panel-head"><div><div className="section-kicker">OVERDUE ANALYSIS</div><h2>Past-due POs by supplier</h2><p>Expected date has passed while the PO is not marked delivered.</p></div></div><div className="analytics-list">{poStats.overdueRows.map(v=><div className="analytics-list-row" key={v.vendor}><div><b>{v.vendor||"Unassigned supplier"}</b><small>{v.avgDays} average days overdue · {v.severity}</small></div><span className="analytics-alert-count">{v.count}</span></div>)}{!poStats.overdueRows.length&&<Empty/>}</div></div>
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">DELIVERY LEAD TIME</div><h2>Average days from PO to delivery</h2><p>Delivered POs with both order and actual delivery dates.</p></div></div><div className="analytics-list">{poStats.leadRows.slice(0,12).map(v=><div className="analytics-list-row" key={v.vendor}><div><b>{v.vendor||"Unassigned supplier"}</b><small>{v.count} deliveries</small></div><div><strong>{v.days} days</strong><small>{v.speed}</small></div></div>)}{!poStats.leadRows.length&&<Empty/>}</div></div></section>

    <section className="panel"><div className="panel-head"><div><div className="section-kicker">PO VALUE VS SCORE</div><h2>Purchase value and supplier score</h2><p>Each point represents a submitted evaluation with a matching PO value.</p></div></div><div className="analytics-scatter">{valueVsScore.slice(0,80).map((p,i)=><div key={`${p.po}-${i}`} className="scatter-point" title={`${p.vendor} · ${p.po} · ${money(p.total)} · Score ${p.score.toFixed(2)}`} style={{left:`${Math.max(2,Math.min(98,p.total/maxValue*96+2))}%`,bottom:`${Math.max(4,Math.min(96,p.score/5*92+4))}%`}}/>)}{!valueVsScore.length&&<Empty/>}<div className="scatter-axis-x">PO value</div><div className="scatter-axis-y">Score</div></div></section>

    <section className="panel annual-summary-panel"><div className="panel-head"><div><div className="section-kicker">ACADEMIC YEAR SUMMARY</div><h2>Evaluation averages by academic year</h2><p>July 1 through June 30.</p></div><CalendarDays size={18} className="muted-icon"/></div><div className="table-wrap"><table><thead><tr><th>Academic Year</th><th>Evaluations</th><th>Final Avg.</th><th>Requisitioner</th><th>Purchasing</th><th>AMD</th></tr></thead><tbody>{ayLabels.map(ay=>{const rs=filteredEvals.filter(r=>ayOf(r.evaluationDate||r.createdAt)===ay);return <tr key={ay}><td><b>{ay}</b></td><td>{rs.length}</td><td>{avg(rs.map(r=>r.finalRating).filter(x=>x>0))?.toFixed(2)||"—"}</td><td>{avg(rs.map(r=>r.requisitionerAvg).filter(x=>x>0))?.toFixed(2)||"—"}</td><td>{avg(rs.map(r=>r.purchasingAvg).filter(x=>x>0))?.toFixed(2)||"—"}</td><td>{avg(rs.map(r=>r.amdAvg).filter(x=>x>0))?.toFixed(2)||"—"}</td></tr>})}</tbody></table></div></section>
  </div>;
}

function Metric({icon,label,value,meta}:{icon:React.ReactNode;label:string;value:string;meta:string}){return <div className="stat-card advanced-stat"><div className="stat-icon">{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{meta}</small></div><div className="stat-line"/></div>;}
function Empty(){return <div className="empty"><div className="empty-icon">◌</div><div className="empty-title">No data available</div><div className="empty-sub">Complete or sync records to populate this section.</div></div>;}
function StatusBreakdown({status}:{status:Record<string,number>}){const total=Math.max(1,(status.Pending||0)+(status["Partial Delivery"]||0)+(status.Delivered||0));const p=Math.round((status.Pending||0)/total*100);const pp=Math.round((status["Partial Delivery"]||0)/total*100);const rows=[['Pending',status.Pending||0],['Partial Delivery',status['Partial Delivery']||0],['Delivered',status.Delivered||0]];return <div className="status-breakdown"><div className="status-donut" style={{background:`conic-gradient(var(--amber) 0 ${p}%, #0ea5e9 ${p}% ${p+pp}%, var(--emerald) ${p+pp}% 100%)`}}><div><strong>{total}</strong><span>Total POs</span></div></div><div className="status-legend">{rows.map(([label,value])=><div key={label as string}><span className={`status-dot ${String(label).toLowerCase().replace(/ /g,'-')}`}/><div><b>{label as string}</b><small>{value as number} · {Math.round((value as number)/total*100)}%</small></div></div>)}</div></div>;}
function RecommendationBars({records}:{records:Evaluation[]}){const names=['Strongly Recommended','Recommended','Acceptable','Acceptable w/ some Reservation','Not Recommended'];return <div className="analytics-list">{names.map(name=>{const count=records.filter(r=>r.recommendation===name).length;const pct=records.length?Math.round(count/records.length*100):0;return <div className="analytics-rec-row" key={name}><div><b>{name}</b><small>{count} record{count===1?'':'s'}</small></div><div className="analytics-rec-track"><i style={{width:`${pct}%`}}/></div><strong>{pct}%</strong></div>})}</div>;}
