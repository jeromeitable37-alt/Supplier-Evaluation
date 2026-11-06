"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../../lib/firebase";

type Uploaded = { fileId: string; name: string; mimeType: string; size: number };
const MAX_SIZE = 8 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export default function PoDrivePilot() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [prfNumber, setPrfNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Uploaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  async function upload() {
    setError("");
    setResult(null);
    setShowPreview(false);
    setPreviewUrl("");
    if (!user) { setError("Sign in to the Purchasing website first."); return; }
    if (!poNumber.trim()) { setError("Enter a PO number for this test document."); return; }
    if (!file || !TYPES.includes(file.type) || file.size > MAX_SIZE || file.size === 0) {
      setError("Choose a PDF, JPEG, PNG or WebP file up to 8 MiB."); return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.set("file", file);
      form.set("poNumber", poNumber.trim());
      form.set("prfNumber", prfNumber.trim());
      const response = await fetch("/api/po-drive", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Upload failed.");
      setResult({
        fileId: String(data.fileId),
        name: String(data.name),
        mimeType: String(data.mimeType),
        size: Number(data.size || 0),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!user || !result) return;
    setBusy(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        "/api/po-drive-file?fileId=" + encodeURIComponent(result.fileId),
        { headers: { Authorization: "Bearer " + token }, cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Could not open private PO preview.");
      }
      const blob = await response.blob();
      setPreviewUrl(URL.createObjectURL(blob));
      setShowPreview(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  const panel: React.CSSProperties = {
    maxWidth: 780, padding: "24px", margin: "32px auto",
    background: "white", border: "1px solid #e5e7eb", borderRadius: 16,
    fontFamily: "Arial, sans-serif", color: "#111827"
  };
  const inputStyle: React.CSSProperties = {
    display: "block", boxSizing: "border-box", width: "100%", marginTop: 6,
    border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 12px", fontSize: 14
  };
  const buttonStyle: React.CSSProperties = {
    cursor: "pointer", border: 0, borderRadius: 9,
    padding: "11px 16px", background: "#4f247c", color: "white", fontWeight: 700,
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f7f5fb", padding: 16 }}>
      <section style={panel}>
        <div style={{ fontSize: 12, textTransform: "uppercase", color: "#7044a0", fontWeight: 700, letterSpacing: 1 }}>
          Southville Purchasing · restricted pilot
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 10 }}>Private Google Drive PO Upload Test</h1>
        <p style={{ lineHeight: 1.6, color: "#475569" }}>
          This separate test page verifies a secure upload to the school Drive and a private staff-only preview.
          It does not replace the live PO Storage workflow, attach files to evaluations, or delete Cloudinary files.
          Use a non-confidential sample document until the integration is approved.
        </p>
        {!authReady && <p>Checking school website sign-in…</p>}
        {authReady && !user && <p role="alert">Sign in to the Purchasing website using an authorized admin account first.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginTop: 22 }}>
          <label>PO Number
            <input style={inputStyle} value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="TEST-PO-001" maxLength={100}/>
          </label>
          <label>PRF Number (optional)
            <input style={inputStyle} value={prfNumber} onChange={e => setPrfNumber(e.target.value)} placeholder="TEST-PRF-001" maxLength={100}/>
          </label>
        </div>
        <label style={{ display: "block", marginTop: 18 }}>Official PO sample PDF / image
          <input style={inputStyle} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setFile(e.target.files?.[0] || null)}/>
        </label>
        <p style={{ color: "#64748b", fontSize: 13 }}>Pilot limit: one file, up to 8 MiB. Active Purchasing administrators only.</p>
        <button style={{ ...buttonStyle, opacity: busy || !user ? 0.5 : 1 }} disabled={busy || !user} type="button" onClick={() => void upload()}>
          {busy ? "Processing…" : "Test secure upload"}
        </button>
        {error && <p role="alert" style={{ background: "#fff1f2", padding: 12, borderRadius: 8, color: "#9f1239" }}>{error}</p>}
        {result && (
          <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 14, marginTop: 22 }}>
            <strong>Upload saved to private school Drive</strong>
            <p style={{ margin: "6px 0 12px" }}>{result.name} · {Math.ceil(result.size / 1024)} KB</p>
            <button type="button" style={buttonStyle} disabled={busy} onClick={() => void preview()}>
              Verify private preview
            </button>
          </div>
        )}
        {showPreview && previewUrl && result && (
          <div style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 18 }}>Authenticated preview</h2>
            {result.mimeType.startsWith("image/")
              ? <img alt="Uploaded PO sample" src={previewUrl} style={{ maxWidth: "100%", borderRadius: 8 }} />
              : <iframe title="Uploaded PO preview" src={previewUrl} style={{ width: "100%", height: 520, border: 0 }}/>}
          </div>
        )}
        <p style={{ marginTop: 24, color: "#64748b", fontSize: 12 }}>
          This page is for integration testing only. Do not submit live sensitive purchase orders until
          authorized staff access, sharing controls, attachments and retention have been verified.
        </p>
      </section>
    </main>
  );
}
