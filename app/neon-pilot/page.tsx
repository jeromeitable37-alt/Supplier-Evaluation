"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, Database, LockKeyhole, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { firebaseConfigured, signInWithGoogle, subscribeAuth } from "../../lib/firebase";
import type { User } from "firebase/auth";

type PilotData = {
  ok: true;
  branch: string;
  readOnly: boolean;
  audit: {
    id: number;
    state: string;
    sourceDocuments: number;
    copiedDocuments: number;
    completedAt: string | null;
    countsMatch: boolean;
  } | null;
  counts: {
    snapshots: number;
    extra_snapshots: number;
    evaluations: number;
    purchase_orders: number;
    users: number;
    evaluation_links: number;
    evaluation_contacts: number;
    workspace: number;
  };
};

const backdrop: CSSProperties = {
  minHeight: "100vh",
  color: "#e8eef8",
  background: "radial-gradient(circle at top left, #123c41 0, #07121d 45%, #060b12 100%)",
  padding: "32px 18px 80px",
  fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
};
const panel: CSSProperties = {
  background: "rgba(13, 30, 40, 0.88)",
  border: "1px solid rgba(146, 179, 183, 0.23)",
  borderRadius: 16,
  padding: 22,
};
const buttonStyle: CSSProperties = {
  cursor: "pointer",
  color: "#082321",
  background: "#7be1cd",
  border: 0,
  borderRadius: 10,
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 700,
};
const metricLabel: Record<keyof PilotData["counts"], string> = {
  snapshots: "Source snapshots",
  evaluations: "Evaluations",
  evaluation_links: "Evaluation links",
  evaluation_contacts: "Evaluation contacts",
  purchase_orders: "Purchase orders",
  users: "User profiles",
  workspace: "Workspace documents",
  extra_snapshots: "Unmapped snapshots",
};
const metrics: (keyof PilotData["counts"])[] = [
  "snapshots", "evaluations", "evaluation_links", "evaluation_contacts",
  "purchase_orders", "users", "workspace", "extra_snapshots",
];

export default function NeonPilotPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PilotData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (signedIn: User) => {
    setLoading(true);
    setError("");
    try {
      const idToken = await signedIn.getIdToken();
      const response = await fetch("/api/neon-pilot", {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      const body = await response.json() as PilotData | { ok: false; message: string };
      if (!response.ok || !body.ok) {
        throw new Error(!body.ok ? body.message : "Preview data could not be loaded.");
      }
      setData(body);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Unable to check Neon.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stop = subscribeAuth((next) => {
      setUser(next);
      setAuthReady(true);
      setData(null);
      setError("");
      if (next) void load(next);
    });
    return () => stop();
  }, [load]);

  async function login() {
    setError("");
    try { await signInWithGoogle(); }
    catch (err) { setError(err instanceof Error ? err.message : "Google Sign-In failed."); }
  }

  const auditOk = Boolean(data?.audit?.countsMatch);
  return (
    <main style={backdrop}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <a href="/" style={{ display: "inline-flex", gap: 8, color: "#a4e9da", alignItems: "center", textDecoration: "none", marginBottom: 30 }}>
          <ArrowLeft size={17} /> Back to Supplier Evaluation
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, display: "grid", placeItems: "center", background: "#123f43" }}>
            <Database size={29} color="#7be1cd" />
          </div>
          <div>
            <div style={{ color: "#83d3c5", fontSize: 12, letterSpacing: "0.1em", fontWeight: 700 }}>SISC SUPPLIER EVALUATION</div>
            <h1 style={{ fontSize: "clamp(24px, 4vw, 36px)", margin: "5px 0", lineHeight: 1.15 }}>Neon migration pilot</h1>
          </div>
        </div>
        <p style={{ color: "#a6bac5", maxWidth: 750, lineHeight: 1.6, marginBottom: 24 }}>
          Secure, read-only verification of the migrated Firestore snapshot on the isolated
          <strong style={{ color: "#c4efdf" }}> migration-preview </strong> Neon branch.
          The live Supplier Evaluation website still uses Firestore.
        </p>
        <section style={{ ...panel, marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#b8d9dc", flexWrap: "wrap" }}>
            <LockKeyhole size={18} />
            <strong>Administrator access required</strong>
          </div>
          {!authReady ? <p style={{ color: "#9eb5c1" }}>Checking your Google session…</p> :
            !firebaseConfigured() ? <p>Firebase login is not configured for this preview.</p> :
            !user ? (
              <div style={{ marginTop: 16 }}>
                <p style={{ color: "#a6bac5" }}>Sign in using an active Purchasing administrator account.</p>
                <button style={buttonStyle} onClick={() => void login()}>Continue with Google</button>
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 15 }}>
                <span style={{ color: "#b6c9d3", overflowWrap: "anywhere" }}>Signed in: {user.email}</span>
                <button style={{ ...buttonStyle, display: "inline-flex", alignItems: "center", gap: 8 }}
                  disabled={loading} onClick={() => void load(user)}>
                  <RefreshCw size={16} /> {loading ? "Checking…" : "Refresh verification"}
                </button>
              </div>
            )}
          {error && (
            <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "#ffcfb7", marginTop: 15 }}>
              <TriangleAlert size={18} style={{ flexShrink: 0 }} /> <span>{error}</span>
            </div>
          )}
        </section>
        {data && (
          <>
            <section style={{ ...panel, marginBottom: 22 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                {auditOk ? <CheckCircle2 size={26} color="#7be1cd" /> : <TriangleAlert size={26} color="#ffb970" />}
                <div>
                  <div style={{ fontWeight: 750, fontSize: 19 }}>{auditOk ? "Migration counts verified" : "Migration counts require review"}</div>
                  <div style={{ fontSize: 13, color: "#a6bac5", marginTop: 3 }}>
                    Run #{data.audit?.id ?? "—"} · Status: {data.audit?.state ?? "not found"}
                    {data.audit?.completedAt ? " · Completed: " + new Date(data.audit.completedAt).toLocaleString("en-PH") : ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 22 }}>
                <div><div style={{ color: "#9eb5c1", fontSize: 13 }}>Read from Firebase</div>
                  <strong style={{ fontSize: 30 }}>{(data.audit?.sourceDocuments ?? 0).toLocaleString()}</strong></div>
                <div><div style={{ color: "#9eb5c1", fontSize: 13 }}>Saved in Neon</div>
                  <strong style={{ fontSize: 30 }}>{(data.audit?.copiedDocuments ?? 0).toLocaleString()}</strong></div>
              </div>
            </section>
            <section style={{ ...panel, marginBottom: 22 }}>
              <h2 style={{ margin: "0 0 18px", fontSize: 19 }}>Migrated records by collection</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                {metrics.map((name) => (
                  <div key={name} style={{ borderRadius: 12, padding: 16, background: "#0a202d", border: "1px solid #1b4550" }}>
                    <div style={{ color: "#aac3c9", fontSize: 13 }}>{metricLabel[name]}</div>
                    <div style={{ fontWeight: 750, fontSize: 28, marginTop: 7 }}>{Number(data.counts[name] ?? 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        <div style={{ display: "flex", gap: 10, color: "#b8d4d0", alignItems: "center", lineHeight: 1.55, fontSize: 13 }}>
          <ShieldCheck size={19} style={{ flexShrink: 0 }} />
          No PostgreSQL passwords are sent to this page. This pilot never changes records in either database.
        </div>
      </div>
    </main>
  );
}
