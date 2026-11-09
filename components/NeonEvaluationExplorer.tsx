"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Database, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { User } from "firebase/auth";

type Evaluation = {
  id: string;
  supplier: string;
  evaluation_date: string;
  po_number: string;
  prf_number: string;
  final_rating: number | null;
  recommendation: string;
  source: string;
};
type ResponseData = {
  ok: true;
  branch: string;
  readOnly: true;
  page: number;
  pageSize: number;
  total: number;
  items: Evaluation[];
};
const panel: CSSProperties = {
  border: "1px solid rgba(146,179,183,.23)",
  background: "rgba(13,30,40,.88)",
  borderRadius: 16,
  padding: 22,
  marginBottom: 22,
};
const control: CSSProperties = {
  border: "1px solid #34616b", color: "#ecf8f8", background: "#0c2632",
  borderRadius: 9, padding: "10px 12px", fontSize: 14,
};
const button: CSSProperties = {
  border: "1px solid #347c77", background: "#18463f",
  color: "#d2f7ef", padding: "10px 15px", borderRadius: 9,
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const columns: { key: keyof Evaluation; label: string }[] = [
  { key: "supplier", label: "Supplier" },
  { key: "po_number", label: "PO number" },
  { key: "prf_number", label: "PRF number" },
  { key: "evaluation_date", label: "Evaluation date" },
  { key: "final_rating", label: "Rating" },
  { key: "recommendation", label: "Recommendation" },
];

export default function NeonEvaluationExplorer({ user }: { user: User }) {
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState<ResponseData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      setBusy(true);
      setError("");
      try {
        const idToken = await user.getIdToken();
        if (cancelled) return;
        const params = new URLSearchParams({ page: String(page) });
        if (search) params.set("search", search);
        const response = await fetch("/api/neon-evaluations?" + params.toString(), {
          headers: { Authorization: "Bearer " + idToken },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json() as ResponseData | { ok: false; message: string };
        if (!response.ok || !body.ok) {
          throw new Error(body.ok ? "Neon records could not be read." : body.message);
        }
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err.message : "Unable to read Neon evaluations.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [user, page, search, nonce]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchText.trim());
    setNonce((current) => current + 1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section style={panel} aria-label="Neon evaluation records preview">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div style={{ color: "#92dfcb", fontSize: 12, fontWeight: 700, letterSpacing: ".05em", display: "flex", alignItems: "center", gap: 7 }}>
            <Database size={14} /> POSTGRESQL • MIGRATION-PREVIEW
          </div>
          <h2 style={{ fontSize: 21, margin: "8px 0" }}>Evaluations from Neon</h2>
          <p style={{ margin: "0 0 14px", color: "#aec7d1", fontSize: 14, lineHeight: 1.5 }}>
            Paginated SQL records from the migrated snapshot, not Firebase.
            Read-only; edits and new submissions still belong to the live system.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9ce5d4", fontSize: 13 }}>
          <ShieldCheck size={17} /> Admin-only
        </div>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginBottom: 17 }}>
        <label htmlFor="neon-eval-search" style={{ fontSize: 13, color: "#a9c3c9" }}>Search supplier, PO, PRF or record ID</label>
        <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
          <input id="neon-eval-search" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            maxLength={90} placeholder="Supplier or PO number" style={{ ...control, flex: "1 1 220px", minWidth: 160 }} />
          <button type="submit" style={button}><Search size={14} style={{ display: "inline", verticalAlign: "middle" }} /> Search</button>
          <button type="button" onClick={() => setNonce((n) => n + 1)} disabled={busy} style={button}
            title="Reload records from Neon"><RefreshCw size={15} style={{ display: "inline", verticalAlign: "middle" }} /> Refresh</button>
        </div>
      </form>
      {error && <p role="alert" style={{ color: "#ffb9a9", fontSize: 14 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", color: "#a9c3c9", fontSize: 13, marginBottom: 10, gap: 10 }}>
        <span>{busy ? "Loading from Neon…" : data ? data.total.toLocaleString() + " matching evaluations" : "No data loaded"}</span>
        <span>Read-only snapshot</span>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #284957", borderRadius: 10 }}>
        <table style={{ width: "100%", minWidth: 690, borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead style={{ background: "#153440", color: "#d6f6f2" }}>
            <tr>{columns.map(({ key, label }) =>
              <th key={key} scope="col" style={{ padding: "12px 11px", whiteSpace: "nowrap" }}>{label}</th>
            )}</tr>
          </thead>
          <tbody>
            {data?.items.map((record, index) => (
              <tr key={record.id} style={{ borderTop: "1px solid #274350", background: index % 2 ? "#0b2430" : "transparent" }}>
                {columns.map(({ key }) => (
                  <td key={key} style={{ padding: "11px", color: "#d8e6ee", verticalAlign: "top", maxWidth: key === "supplier" ? 210 : 170, overflowWrap: "anywhere" }}>
                    {key === "final_rating"
                      ? (typeof record.final_rating === "number" ? record.final_rating.toFixed(2) : "—")
                      : (record[key] || "—")}
                  </td>
                ))}
              </tr>
            ))}
            {!busy && data && data.items.length === 0 && <tr><td colSpan={columns.length} style={{ textAlign: "center", padding: 22, color: "#bbccd2" }}>No matching evaluations.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 15 }}>
          <span style={{ fontSize: 13, color: "#b2c6ce" }}>Page {data.page} of {totalPages} · {data.pageSize} rows per page</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy || page <= 1} style={{ ...button, opacity: busy || page <= 1 ? .5 : 1 }}
              onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={14} style={{ display: "inline" }} /> Previous</button>
            <button type="button" disabled={busy || page >= totalPages} style={{ ...button, opacity: busy || page >= totalPages ? .5 : 1 }}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next <ChevronRight size={14} style={{ display: "inline" }} /></button>
          </div>
        </div>
      )}
    </section>
  );
}
