"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Edit3, Mail, Plus, Search, Trash2, Users, X } from "lucide-react";
import { firebaseConfigured, subscribeAuth } from "../../lib/firebase";
import {
  deleteEvaluationContactCloud,
  ensureUserProfile,
  subscribeEvaluationContacts,
  upsertEvaluationContactCloud,
  type EvaluationContact,
  type EvaluationContactRole,
} from "../../lib/firestore";

const roleOptions: Array<{ value: EvaluationContactRole; label: string }> = [
  { value: "purchaser", label: "Purchasing / Buyer" },
  { value: "requisitioner", label: "Requisitioner" },
  { value: "amd_personnel", label: "AMD / Received by" },
];

function roleLabel(role: EvaluationContactRole) {
  return roleOptions.find((item) => item.value === role)?.label || role;
}

export default function EmailDirectoryPage() {
  const [contacts, setContacts] = useState<EvaluationContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EvaluationContact | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | EvaluationContactRole>("all");
  const [form, setForm] = useState({ name: "", email: "", roles: ["requisitioner"] as EvaluationContactRole[], department: "", notes: "" });

  useEffect(() => {
    if (!firebaseConfigured()) {
      setError("Firebase is not configured. Please sign in through the main system after configuring Firebase.");
      setLoading(false);
      return;
    }
    const stopAuth = subscribeAuth(async (user) => {
      setAuthReady(true);
      if (!user) {
        setAllowed(false);
        setLoading(false);
        setError("Please sign in to the Purchasing Supplier Evaluation System first.");
        return;
      }
      try {
        const profile = await ensureUserProfile();
        const canUse = profile.active && (profile.role === "admin" || profile.permissions.includes("create_evaluations") || profile.permissions.includes("edit_evaluations"));
        setAllowed(canUse);
        if (!canUse) setError("Your account does not have permission to manage evaluator email contacts.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your account permissions.");
      } finally {
        setLoading(false);
      }
    });
    return () => stopAuth();
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const stop = subscribeEvaluationContacts(
      (items) => setContacts(items),
      (e) => setError(e.message || "Could not read the Email Directory."),
    );
    return () => stop();
  }, [allowed]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesQuery = !q || [contact.name, contact.email, contact.department, contact.notes, ...(contact.roles || [])].join(" ").toLowerCase().includes(q);
      const matchesRole = roleFilter === "all" || (contact.roles || []).includes(roleFilter);
      return matchesQuery && matchesRole;
    });
  }, [contacts, query, roleFilter]);

  function openNew() {
    setEditing(null);
    setForm({ name: "", email: "", roles: ["requisitioner"], department: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(contact: EvaluationContact) {
    setEditing(contact);
    setForm({ name: contact.name, email: contact.email, roles: contact.roles?.length ? contact.roles : ["requisitioner"], department: contact.department || "", notes: contact.notes || "" });
    setFormOpen(true);
  }

  function toggleRole(role: EvaluationContactRole) {
    setForm((current) => ({
      ...current,
      roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role],
    }));
  }

  async function save() {
    if (!form.name.trim()) return setError("Contact name is required.");
    if (!form.email.trim().includes("@")) return setError("Enter a valid email address.");
    if (!form.roles.length) return setError("Select at least one evaluator role.");
    setSaving(true);
    setError("");
    try {
      await upsertEvaluationContactCloud({
        name: form.name,
        email: form.email,
        roles: form.roles,
        department: form.department,
        notes: form.notes,
        replaceRoles: Boolean(editing),
      });
      setFormOpen(false);
      setEditing(null);
      setNotice("Evaluator contact saved. The email can now be reused automatically from PO Storage.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this contact.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(contact: EvaluationContact) {
    if (!confirm(`Delete ${contact.name} from the Email Directory?`)) return;
    try {
      await deleteEvaluationContactCloud(contact.id);
      setNotice(`${contact.name} removed from the Email Directory.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this contact.");
    }
  }

  if (loading || !authReady) {
    return <div className="public-eval-shell"><div className="public-eval-card center"><Mail size={30}/><h1>Loading Email Directory</h1><p>Checking your Firebase account and permissions…</p></div></div>;
  }

  if (!allowed) {
    return <div className="public-eval-shell"><div className="public-eval-card center"><Users size={42}/><h1>Access unavailable</h1><p>{error || "You are not allowed to manage evaluator contacts."}</p><a className="btn primary" href="/">Return to Purchasing System</a></div></div>;
  }

  return <div className="email-directory-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot"/> EVALUATOR EMAIL DIRECTORY</div>
        <h1>Saved evaluator emails</h1>
        <p>Save an email once when it is missing from the spreadsheet. PO Storage will reuse this directory as a fallback for Purchasing / Buyer, Requisitioner, and AMD / Received by.</p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a className="btn secondary" href="/">← Back to system</a>
        <button className="btn primary" onClick={openNew}><Plus size={16}/> Add contact</button>
      </div>
    </div>

    {notice && <div className="panel" style={{ padding: "12px 16px", marginBottom: 14, borderColor: "#a7f3d0", background: "#ecfdf5", color: "#065f46", display: "flex", alignItems: "center", gap: 8 }}><CheckCircle2 size={17}/>{notice}</div>}
    {error && <div className="panel" style={{ padding: "12px 16px", marginBottom: 14, borderColor: "#fecdd3", background: "#fff1f2", color: "#9f1239" }}>{error}</div>}

    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="po-generator-toolbar" style={{ marginBottom: 0 }}>
        <div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, department…"/></div>
        <select className="inp" style={{ maxWidth: 210 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
          <option value="all">All evaluator roles</option>
          {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
        <div className="result-count">{filtered.length.toLocaleString()} contacts</div>
      </div>
    </div>

    <div className="panel">
      <div className="panel-head"><div><div className="section-kicker">SAVED CONTACTS</div><h2>Email Directory</h2><p>Spreadsheet data remains the first source; these saved contacts are reusable fallbacks.</p></div><Mail size={18} className="muted-icon"/></div>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Evaluator role(s)</th><th>Department</th><th>Notes</th><th /></tr></thead><tbody>
        {filtered.map((contact) => <tr key={contact.id}>
          <td><b>{contact.name}</b></td>
          <td><a href={`mailto:${contact.email}`} style={{ fontWeight: 700 }}>{contact.email}</a></td>
          <td><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{(contact.roles || []).map((role) => <span key={role} className="pill blue">{roleLabel(role)}</span>)}</div></td>
          <td>{contact.department || "—"}</td>
          <td style={{ maxWidth: 280 }}>{contact.notes || "—"}</td>
          <td><div className="row-actions"><button className="icon-action" title="Edit" onClick={() => openEdit(contact)}><Edit3 size={15}/></button><button className="icon-action danger" title="Delete" onClick={() => void remove(contact)}><Trash2 size={15}/></button></div></td>
        </tr>)}
        {!filtered.length && <tr><td colSpan={6}><div className="empty"><div className="empty-icon">✉️</div><div className="empty-title">No saved evaluator contacts</div><div className="empty-sub">Add a contact here or enter a manual email inside PO Storage. Saved manual emails are remembered automatically.</div></div></td></tr>}
      </tbody></table></div>
    </div>

    {formOpen && <div className="modal-backdrop"><div className="detail-modal" style={{ maxWidth: 720 }}>
      <div className="detail-top"><div><div className="eyebrow"><span className="eyebrow-dot"/> EMAIL DIRECTORY</div><h2>{editing ? "Edit evaluator contact" : "Add evaluator contact"}</h2><p>This contact will be reused when a spreadsheet email is unavailable.</p></div><button className="icon-button" onClick={() => !saving && setFormOpen(false)}><X size={18}/></button></div>
      <div className="detail-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label className="field"><span>Full name</span><input value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} placeholder="Evaluator full name"/></label>
          <label className="field"><span>Email address</span><input type="email" value={form.email} onChange={(e) => setForm((x) => ({ ...x, email: e.target.value }))} placeholder="name@sgen.edu.ph"/></label>
          <label className="field"><span>Department</span><input value={form.department} onChange={(e) => setForm((x) => ({ ...x, department: e.target.value }))} placeholder="Purchasing / Department"/></label>
          <label className="field"><span>Notes</span><input value={form.notes} onChange={(e) => setForm((x) => ({ ...x, notes: e.target.value }))} placeholder="Optional note"/></label>
        </div>
        <div style={{ marginTop: 18 }}><div className="section-kicker">APPLIES TO</div><div style={{ display: "grid", gap: 8, marginTop: 10 }}>{roleOptions.map((role) => <label key={role.value} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer" }}><input type="checkbox" checked={form.roles.includes(role.value)} onChange={() => toggleRole(role.value)}/><span><b>{role.label}</b><small style={{ display: "block", opacity: .68 }}>{role.value === "purchaser" ? "Five-criterion Purchasing / Buyer evaluation" : "Four-criterion evaluator flow"}</small></span></label>)}</div></div>
      </div>
      <div className="detail-footer"><span style={{ opacity: .7 }}>Saved emails are fallback contacts; spreadsheet values are still preferred when available.</span><div><button className="btn secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button><button className="btn primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save contact"}</button></div></div>
    </div></div>}
  </div>;
}
