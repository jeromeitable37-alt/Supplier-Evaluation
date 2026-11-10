"use client";

import { useState, type CSSProperties } from "react";
import { CheckCircle2, FlaskConical, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import type { User } from "firebase/auth";

type QaResponse = {
  ok: boolean;
  branch?: string;
  passed?: number;
  failed?: number;
  committed?: boolean;
  rolledBack?: boolean;
  externalEffects?: boolean;
  checks?: { name: string; passed: boolean }[];
  message?: string;
  stage?: string;
};

const panel: CSSProperties = {
  background: "rgba(13, 30, 40, 0.88)",
  border: "1px solid rgba(146, 179, 183, 0.23)",
  borderRadius: 16,
  padding: 22,
  marginBottom: 22,
};

export default function NeonRollbackQa({ user }: { user: User }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QaResponse | null>(null);
  const [message, setMessage] = useState("");

  async function runQa() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/neon-qa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ confirm: "RUN_ROLLBACK_QA" }),
        cache: "no-store",
      });
      const body = await response.json() as QaResponse;
      if (!response.ok || !body.ok) {
        setMessage(body.message || "Database rollback QA could not be completed.");
        setResult(body);
      } else {
        setResult(body);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run Preview QA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panel} aria-label="Neon transaction rollback functional QA">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <FlaskConical size={24} color="#81e5d0" />
        <h2 style={{ fontSize: 20, margin: 0 }}>Database Write QA</h2>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#9ce5d6" }}>ROLLBACK ONLY</span>
      </div>
      <p style={{ color: "#bed0d7", fontSize: 14, lineHeight: 1.6, maxWidth: 800 }}>
        Run safe checks for SQL Create, Read, Update, Delete, duplicate IDs, and
        single-use evaluation link protection. The test uses temporary fictional
        records in one PostgreSQL transaction, then rolls it back. It does not
        modify school records, email staff, or sync to Google Sheets.
      </p>
      <button
        onClick={() => void runQa()}
        disabled={busy}
        style={{
          display: "inline-flex", alignItems: "center", gap: 9,
          background: busy ? "#527b74" : "#7be1cd", border: 0,
          color: "#092a25", borderRadius: 10, padding: "12px 18px",
          fontWeight: 750, cursor: busy ? "not-allowed" : "pointer",
        }}>
        {busy ? <Loader2 size={17} className="spin" /> : <FlaskConical size={17} />}
        {busy ? "Checking Neon…" : "Run rollback-only QA"}
      </button>

      {message && <div role="alert" style={{ color: "#ffc5af", display: "flex", alignItems: "center", gap: 9, marginTop: 16 }}>
        <TriangleAlert size={18} /><span>{message} {result?.stage ? "(Stage: " + result.stage + ")" : ""}</span>
      </div>}

      {result?.ok && (
        <div style={{ marginTop: 18, padding: 17, border: "1px solid #35705f", borderRadius: 12, background: "#102c2c" }}>
          <div style={{ color: "#9ce5d6", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 9 }}>
            <CheckCircle2 size={20} /> <strong>{result.passed} checks passed, {result.failed} failed</strong>
          </div>
          <p style={{ color: "#bdd4d0", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <ShieldCheck size={16} /> Committed: No · Rollback completed: {result.rolledBack ? "Yes" : "No"} · External sends: None
          </p>
          <ul style={{ paddingLeft: 18, display: "grid", gap: 8, color: "#dfefed", fontSize: 13 }}>
            {result.checks?.map((check) => (
              <li key={check.name}>{check.name} — {check.passed ? "PASS" : "FAIL"}</li>
            ))}
          </ul>
        </div>
      )}
      <p style={{ color: "#9fbac2", fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>
        This verifies the PostgreSQL transaction layer—not the full browser form workflow.
        Public form submission, external email and official Sheet integrations still require separate authorized QA.
      </p>
    </section>
  );
}
