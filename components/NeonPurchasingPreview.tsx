"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ClipboardList, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { User } from "firebase/auth";

type PurchaseOrder = {
  id: string;
  po_number: string;
  prf_number: string;
  vendor_name: string;
  status: string;
  expected_date: string;
  order_date: string;
  total_amount: string;
};
type PurchaseOrdersResult = {
  ok: true;
  items: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
};
type LinkSummary = {
  ok: true;
  total: number;
  groups: { status: string; evaluator_role: string; total: number }[];
};
const panel: CSSProperties = {
  border: "1px solid rgba(146,179,183,.23)",
  background: "rgba(13,30,40,.88)",
  borderRadius: 16,
  padding: 22,
  marginBottom: 22,
};
const button: CSSProperties = {
  border: "1px solid #347c77", background: "#18463f", color: "#d2f7ef",
  padding: "10px 15px", borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer",
};

export default function NeonPurchasingPreview({ user }: { user: User }) {
  const [poSearchText, setPoSearchText] = useState("");
  const [poSearch, setPoSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [orders, setOrders] = useState<PurchaseOrdersResult | null>(null);
  const [linkSummary, setLinkSummary] = useState<LinkSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const token = await user.getIdToken();
      if (signal.aborted) return;
      const params = new URLSearchParams({ page: "1" });
      if (poSearch) params.set("search", poSearch);
      const header = { Authorization: "Bearer " + token };
      const [poRes, linkRes] = await Promise.all([
        fetch("/api/neon-purchase-orders?" + params, { headers: header, signal, cache: "no-store" }),
        fetch("/api/neon-link-summary", { headers: header, signal, cache: "no-store" }),
      ]);
      const poBody = await poRes.json() as PurchaseOrdersResult | { ok: false; message: string };
      const linkBody = await linkRes.json() as LinkSummary | { ok: false; message: string };
      if (!poRes.ok || !poBody.ok) throw new Error(poBody.ok ? "Purchase order query failed." : poBody.message);
      if (!linkRes.ok || !linkBody.ok) throw new Error(linkBody.ok ? "Evaluation link query failed." : linkBody.message);
      if (!signal.aborted) {
        setOrders(poBody);
        setLinkSummary(linkBody);
      }
    } catch (err) {
      if (!signal.aborted) {
        setOrders(null);
        setLinkSummary(null);
        setError(err instanceof Error ? err.message : "Unable to load purchasing preview.");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [user, poSearch]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPoSearch(poSearchText.trim());
    setRefresh((n) => n + 1);
  }

  function formatAmount(value: string) {
    const amount = Number(value);
    return value.trim() !== "" && Number.isFinite(amount)
      ? "PHP " + amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  }

  return (
    <section aria-label="Neon purchasing preview">
      <div style={{ ...panel }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <ClipboardList size={22} color="#83e4d2" />
          <h2 style={{ margin: "0 0 3px", fontSize: 21 }}>Purchase Orders from Neon</h2>
        </div>
        <p style={{ color: "#adc2ce", fontSize: 14, lineHeight: 1.5 }}>
          Migrated purchase order summaries fetched from PostgreSQL. This view cannot upload, edit, delete, or send POs.
        </p>
        <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0" }}>
          <label htmlFor="po-search" style={{ width: "100%", color: "#b9cdd1", fontSize: 13 }}>
            Search PO number, PRF number, or supplier
          </label>
          <input id="po-search" value={poSearchText} onChange={(e) => setPoSearchText(e.target.value)}
            maxLength={90} placeholder="PO / PRF / supplier" style={{
              padding: "10px 12px", borderRadius: 9, border: "1px solid #34616b",
              color: "#eaf5fa", background: "#0c2632", fontSize: 14, flex: "1 1 200px", minWidth: 180,
            }} />
          <button type="submit" style={button}><Search size={14} style={{ display: "inline" }} /> Search</button>
          <button type="button" style={button} disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
            <RefreshCw size={14} style={{ display: "inline" }} /> Refresh
          </button>
        </form>
        {error && <p role="alert" style={{ color: "#ffc5b4" }}>{error}</p>}
        <div style={{ color: "#abc5ce", fontSize: 13, marginBottom: 10 }}>
          {loading ? "Loading records…" : orders ? `${orders.total} matching POs` : "No records loaded"}
        </div>
        <div style={{ overflowX: "auto", border: "1px solid #284957", borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680, textAlign: "left", fontSize: 13 }}>
            <thead style={{ color: "#e7f5f5", background: "#153440" }}>
              <tr>
                {["PO Number", "PRF Number", "Supplier", "Status", "Order Date", "Total"].map((label) =>
                  <th key={label} scope="col" style={{ padding: 12 }}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {orders?.items.map((po) =>
                <tr key={po.id} style={{ borderTop: "1px solid #274350" }}>
                  {[po.po_number, po.prf_number, po.vendor_name, po.status, po.order_date, formatAmount(po.total_amount)].map((value, i) =>
                    <td key={i} style={{ padding: 11, color: "#d2e5e9", overflowWrap: "anywhere", maxWidth: 220 }}>{value || "—"}</td>)}
                </tr>
              )}
              {!loading && orders && orders.items.length === 0 &&
                <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#a7c0c8" }}>No matching purchase orders.</td></tr>}
            </tbody>
          </table>
        </div>
        <p style={{ color: "#9bb7bd", fontSize: 12, marginTop: 12 }}>
          Sensitive attachment URLs and employee emails are not displayed.
        </p>
      </div>
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Evaluation link status</h2>
          <span style={{ color: "#9cd9c9", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13 }}>
            <ShieldCheck size={16} /> Token-free summary
          </span>
        </div>
        <p style={{ fontSize: 14, color: "#aec7d1", marginTop: 11, lineHeight: 1.5 }}>
          Counts grouped by evaluator role and submission status. No secret evaluation tokens are exposed.
        </p>
        <div style={{ marginBottom: 14, fontSize: 24, fontWeight: 750 }}>
          {linkSummary ? linkSummary.total : loading ? "…" : "—"} <span style={{ fontSize: 13, color: "#a7c8c8", fontWeight: 400 }}>total migrated links</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          {linkSummary?.groups.map((group) => (
            <div key={group.status + ":" + group.evaluator_role}
              style={{ background: "#0a202d", border: "1px solid #234552", borderRadius: 10, padding: 13 }}>
              <div style={{ color: "#a9cad0", fontSize: 12, textTransform: "capitalize" }}>{group.status} · {group.evaluator_role.replaceAll("_", " ")}</div>
              <div style={{ fontWeight: 750, fontSize: 25, marginTop: 5 }}>{group.total}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
