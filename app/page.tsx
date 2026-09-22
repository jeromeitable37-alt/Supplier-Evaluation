"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  firebaseConfigured,
  subscribeAuth,
  signInWithEmail,
  registerWithEmail,
  signInWithGoogle,
  signOutFirebase,
  resetPassword,
  updateFirebaseProfile,
} from "../lib/firebase";
import {
  clearEvaluationsCloud,
  deleteEvaluationCloud,
  ensureSeedData,
  getWorkspaceSettings,
  saveEvaluationCloud,
  saveManyCloud,
  saveWorkspaceSettings,
  signInToFirebase,
  subscribeEvaluations,
  ensureUserProfile,
  saveUserProfile,
  subscribeUserProfiles,
  updateManagedUser,
  type UserProfile,
  type Permission,
  ALL_ADMIN_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  DEFAULT_VIEWER_PERMISSIONS,
  PERMISSIONS,
} from "../lib/firestore";
import PurchaseOrderGenerator from "../components/PurchaseOrderGenerator";
import AdvancedDashboard from "../components/AdvancedDashboard";
import AdvancedReports from "../components/AdvancedReports";
import {
  Activity,
  ChevronDown,
  Send,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Database,
  KeyRound,
  Download,
  Edit3,
  FileSpreadsheet,
  Filter,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ScanLine,
  Palette,
  Settings,
  UserCircle2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from "lucide-react";

type Rating = number | null;
type Evaluation = {
  id: string;
  prfNo: string;
  poNumber: string;
  itemsDelivered: string;
  evaluationDate: string;
  supplier: string;
  address: string;
  remarks: string;
  purchasing: Rating[];
  requisitioner: Rating[];
  amd: Rating[];
  purchasingAvg: number;
  requisitionerAvg: number;
  amdAvg: number;
  finalRating: number;
  recommendation: string;
  createdAt: string;
  source?: string;
};

type PurchaseOrderMatch = {
  poNumber: string;
  prfNumber: string;
  itemsDelivered: string;
  supplier: string;
};

type PurchaseOrderRecord = {
  poNumber: string;
  matches: PurchaseOrderMatch[];
};

type PrfRecord = {
  prfNumber: string;
  requisitioner: string;
  department: string;
  itemDescription: string;
  purpose: string;
};

type Page = "dashboard" | "evaluations" | "suppliers" | "reports" | "purchase-orders" | "data" | "settings" | "profile" | "ai" | "access";

const criteria = {
  purchasing: [
    "Accurate Delivery / Quality",
    "Competitive Price",
    "Timeliness of Delivery",
    "After Sales Services",
    "Compliance with Regulatory Requirements and School Policies",
  ],
  requisitioner: [
    "Accurate Delivery / Quality",
    "Competitive Price",
    "Timeliness of Delivery",
    "After Sales Services",
  ],
  amd: [
    "Accurate Delivery / Quality",
    "Competitive Price",
    "Timeliness of Delivery",
    "After Sales Services",
  ],
};

const recommendation = (rating: number) =>
  rating >= 4.5
    ? "Strongly Recommended"
    : rating >= 4
      ? "Recommended"
      : rating >= 3.5
        ? "Acceptable"
        : rating >= 3
          ? "Acceptable w/ some Reservation"
          : rating > 0
            ? "Not Recommended"
            : "";

const average = (values: Rating[]) => {
  const valid = values.filter((x): x is number => typeof x === "number" && x > 0);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
};

const normalize = (value: unknown): Rating => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};

function normalizePO(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function compute(e: Evaluation): Evaluation {
  const purchasingAvg = average(e.purchasing);
  const requisitionerAvg = average(e.requisitioner);
  const amdAvg = average(e.amd);
  const group = [purchasingAvg, requisitionerAvg, amdAvg].filter((x) => x > 0);
  const finalRating = group.length ? group.reduce((a, b) => a + b, 0) / group.length : 0;
  return { ...e, purchasingAvg, requisitionerAvg, amdAvg, finalRating, recommendation: recommendation(finalRating) };
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeStableId(e: Evaluation) {
  const source = [e.prfNo, e.poNumber, e.supplier, e.evaluationDate, e.itemsDelivered].join("|").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return `excel-${Math.abs(hash)}-${source.length}`;
}

function blankEvaluation(): Evaluation {
  return compute({
    id: makeId(),
    prfNo: "",
    poNumber: "",
    itemsDelivered: "",
    evaluationDate: new Date().toISOString().slice(0, 10),
    supplier: "",
    address: "",
    remarks: "",
    purchasing: [null, null, null, null, null],
    requisitioner: [null, null, null, null],
    amd: [null, null, null, null],
    purchasingAvg: 0,
    requisitionerAvg: 0,
    amdAvg: 0,
    finalRating: 0,
    recommendation: "",
    createdAt: new Date().toISOString(),
  });
}

function dedupe(items: Evaluation[]) {
  const map = new Map<string, Evaluation>();
  for (const item of items) {
    const key = [item.prfNo, item.poNumber, item.supplier, item.evaluationDate].join("|").toLowerCase();
    const fallback = item.id;
    map.set(key === "|||" ? fallback : key, item);
  }
  return Array.from(map.values());
}

function Pill({ value }: { value: string }) {
  const cls = value === "Strongly Recommended" ? "good" : value === "Recommended" ? "blue" : value.startsWith("Acceptable") ? "warn" : "bad";
  return <span className={`pill ${cls}`}>{value || "Unrated"}</span>;
}

function ratingTone(value: number) {
  if (value >= 4.5) return "excellent";
  if (value >= 4) return "good";
  if (value >= 3.5) return "mid";
  return "low";
}

export default function Home() {
  const [authUser, setAuthUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [records, setRecords] = useState<Evaluation[]>([]);
  const [editing, setEditing] = useState<Evaluation | null>(null);
  const [viewing, setViewing] = useState<Evaluation | null>(null);
  const [query, setQuery] = useState("");
  const [filterRecommendation, setFilterRecommendation] = useState("all");
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [toast, setToast] = useState("");
  const [settings, setSettings] = useState({ office: "Purchasing Office", name: "Purchasing Supplier Evaluation System" });
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [managedUsers, setManagedUsers] = useState<UserProfile[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [accent, setAccent] = useState<"emerald" | "indigo" | "blue" | "violet" | "amber">("emerald");
  const importRef = useRef<HTMLInputElement>(null);
  const fireDbUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const savedTheme = typeof window !== "undefined" ? (window.localStorage.getItem("supplier-theme") as "light" | "dark" | null) : null;
    if (savedTheme === "dark") setTheme("dark");
    const savedAccent = typeof window !== "undefined" ? (window.localStorage.getItem("supplier-accent") as any) : null;
    if (["emerald", "indigo", "blue", "violet", "amber"].includes(savedAccent)) setAccent(savedAccent);
    if (!firebaseConfigured()) {
      setAuthLoading(false);
      setDbError("Firebase is not configured. Create .env.local from .env.example and add your Firebase Web App settings.");
      return;
    }
    const unsubscribe = subscribeAuth(async (user) => {
      setAuthUser(user);
      setAuthLoading(false);
      if (fireDbUnsubRef.current) { fireDbUnsubRef.current(); fireDbUnsubRef.current = null; }
      if ((window as any).__supplierUsersUnsub) { (window as any).__supplierUsersUnsub(); (window as any).__supplierUsersUnsub = null; }
      if (!user) { setFirebaseReady(false); setDbLoading(false); setRecords([]); setUserProfile(null); setManagedUsers([]); return; }
      let cancelled = false;
      try {
        setDbLoading(true);
        await signInToFirebase();
        if (cancelled) return;
        const profile = await ensureUserProfile();
        if (cancelled) return;
        setUserProfile(profile);
        setDbError("");
        if (profile.role === "admin") {
          const stopUsers = subscribeUserProfiles(
            (items) => setManagedUsers(items.sort((a, b) => a.displayName.localeCompare(b.displayName))),
            (error) => console.warn("User profile list unavailable:", error),
          );
          (window as any).__supplierUsersUnsub = stopUsers;
        }
        setFirebaseReady(true);
        await ensureSeedData();
        if (cancelled) return;
        const stop = subscribeEvaluations(
          (items) => {
            if (cancelled) return;
            const normalized = items.map((r: any) => compute({
              ...blankEvaluation(), ...r, id: String(r.id),
              purchasing: Array.isArray(r.purchasing) ? r.purchasing.map(normalize) : [],
              requisitioner: Array.isArray(r.requisitioner) ? r.requisitioner.map(normalize) : [],
              amd: Array.isArray(r.amd) ? r.amd.map(normalize) : [],
            }));
            setRecords(normalized.sort((a, b) => (b.evaluationDate || b.createdAt).localeCompare(a.evaluationDate || a.createdAt)));
            setDbLoading(false);
          },
          (error) => { setDbError(error.message || "Could not read the Firebase database."); setDbLoading(false); },
        );
        fireDbUnsubRef.current = stop;
        const cloudSettings = await getWorkspaceSettings();
        if (!cancelled && cloudSettings) setSettings((current) => ({ ...current, ...(cloudSettings as any) }));
        if (!cancelled) setSettingsLoaded(true);
        return undefined;
      } catch (error: any) {
        setDbError(error?.message || "Firebase connection failed.");
        setDbLoading(false);
      }
    });
    return () => { unsubscribe(); if (fireDbUnsubRef.current) fireDbUnsubRef.current(); if ((window as any).__supplierUsersUnsub) (window as any).__supplierUsersUnsub(); };
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
    if (typeof window !== "undefined") window.localStorage.setItem("supplier-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.dataset.accent = accent;
    if (typeof window !== "undefined") window.localStorage.setItem("supplier-accent", accent);
  }, [accent]);

  useEffect(() => {
    if (!firebaseReady || !settingsLoaded) return;
    const timer = window.setTimeout(() => {
      saveWorkspaceSettings(settings).catch((error) => console.error(error));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settings, firebaseReady, settingsLoaded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const suppliers = useMemo(() => Array.from(new Set(records.map((r) => r.supplier).filter(Boolean))).sort(), [records]);
  const rated = useMemo(() => records.filter((r) => r.finalRating > 0), [records]);
  const stats = useMemo(() => ({
    total: records.length,
    supplierCount: suppliers.length,
    avg: average(rated.map((r) => r.finalRating)),
    strong: records.filter((r) => r.recommendation === "Strongly Recommended").length,
    recommended: records.filter((r) => r.recommendation === "Recommended").length,
    needsAttention: records.filter((r) => r.finalRating > 0 && r.finalRating < 3.5).length,
  }), [records, suppliers, rated]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      const searchable = [r.supplier, r.prfNo, r.poNumber, r.itemsDelivered, r.address, r.remarks].join(" ").toLowerCase();
      const matchQuery = !q || searchable.includes(q);
      const matchRec = filterRecommendation === "all" || r.recommendation === filterRecommendation;
      const matchSupplier = filterSupplier === "all" || r.supplier === filterSupplier;
      const matchFrom = !dateFrom || r.evaluationDate >= dateFrom;
      const matchTo = !dateTo || r.evaluationDate <= dateTo;
      return matchQuery && matchRec && matchSupplier && matchFrom && matchTo;
    });
  }, [records, query, filterRecommendation, filterSupplier, dateFrom, dateTo]);

  const recent = useMemo(() => [...records].sort((a, b) => (b.evaluationDate || b.createdAt).localeCompare(a.evaluationDate || a.createdAt)).slice(0, 7), [records]);

  const monthly = useMemo(() => {
    const bucket = new Map<string, { sum: number; count: number }>();
    rated.forEach((r) => {
      const month = (r.evaluationDate || "").slice(0, 7);
      if (!month) return;
      const current = bucket.get(month) || { sum: 0, count: 0 };
      current.sum += r.finalRating;
      current.count += 1;
      bucket.set(month, current);
    });
    return Array.from(bucket.entries()).sort().slice(-6).map(([month, data]) => ({ month, avg: data.sum / data.count, count: data.count }));
  }, [rated]);

  function notify(text: string) { setToast(text); }
  function navigate(next: Page) { setPage(next); setEditing(null); setViewing(null); }
  function openNewEvaluation() {
    setViewing(null);
    setEditing(blankEvaluation());
    setPage("evaluations");
  }
  async function saveEvaluation(value: Evaluation) {
    if (!firebaseReady) { notify("Connect Firebase before saving an evaluation."); return; }
    try {
      const clean = compute(value);
      await saveEvaluationCloud(clean as unknown as Record<string, unknown>);
      setEditing(null);
      notify("Evaluation saved to Firebase.");
    } catch (error: any) {
      notify(error?.message || "Could not save the evaluation.");
    }
  }
  async function removeEvaluation(id: string) {
    if (!confirm("Delete this evaluation from the Firebase database? This cannot be undone.")) return;
    try {
      await deleteEvaluationCloud(id);
      setViewing(null);
      notify("Evaluation deleted from Firebase.");
    } catch (error: any) {
      notify(error?.message || "Could not delete the evaluation.");
    }
  }

  function rowsForExcel(items: Evaluation[]) {
    return items.map((r) => ({
      "PRF No": r.prfNo,
      "PO Number": r.poNumber,
      "Item/s Delivered": r.itemsDelivered,
      "Evaluation Date": r.evaluationDate,
      Supplier: r.supplier,
      Address: r.address,
      Remarks: r.remarks,
      "Purchasing A": r.purchasing[0],
      "Purchasing B": r.purchasing[1],
      "Purchasing C": r.purchasing[2],
      "Purchasing D": r.purchasing[3],
      "Purchasing E": r.purchasing[4],
      "Purchasing Average": r.purchasingAvg,
      "Requisitioner A": r.requisitioner[0],
      "Requisitioner B": r.requisitioner[1],
      "Requisitioner C": r.requisitioner[2],
      "Requisitioner D": r.requisitioner[3],
      "Requisitioner Average": r.requisitionerAvg,
      "AMD A": r.amd[0],
      "AMD B": r.amd[1],
      "AMD C": r.amd[2],
      "AMD D": r.amd[3],
      "AMD Average": r.amdAvg,
      "Final Rating": r.finalRating,
      Recommendation: r.recommendation,
    }));
  }

  function exportExcel(items = records) {
    const sheet = XLSX.utils.json_to_sheet(rowsForExcel(items));
    sheet["!cols"] = [{ wch: 12 }, { wch: 13 }, { wch: 42 }, { wch: 16 }, { wch: 32 }, { wch: 30 }, { wch: 35 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Supplier Evaluations");
    XLSX.writeFile(book, `supplier-evaluations-${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify(`${items.length.toLocaleString()} records exported to Excel.`);
  }

  async function importExcel(file: File) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const book = XLSX.read(data, { type: "array", cellDates: true });
      const dbName = book.SheetNames.find((n) => n.toLowerCase() === "database") || book.SheetNames[0];
      const sheet = book.Sheets[dbName];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      const imported: Evaluation[] = rows.map((x) => {
        const item = blankEvaluation();
        item.source = "Excel import";
        item.prfNo = String(x["PRF No"] ?? "");
        item.poNumber = String(x["PO Number"] ?? "");
        item.itemsDelivered = String(x["Item/s Delivered"] ?? "");
        item.evaluationDate = x["Evaluation Date"] instanceof Date ? x["Evaluation Date"].toISOString().slice(0, 10) : String(x["Evaluation Date"] ?? "").slice(0, 10);
        item.supplier = String(x.Supplier ?? x["Company Name"] ?? "");
        item.address = String(x.Address ?? "");
        item.remarks = String(x.Remarks ?? x.REMARKS ?? "");
        item.purchasing = ["A", "B", "C", "D", "E"].map((c) => normalize(x[`Purchasing ${c}`] ?? x[`PURCHASING ${c}`] ?? x[c]));
        item.requisitioner = ["A", "B", "C", "D"].map((c) => normalize(x[`Requisitioner ${c}`] ?? x[`REQUISITIONER ${c}`]));
        item.amd = ["A", "B", "C", "D"].map((c) => normalize(x[`AMD ${c}`] ?? x[`AMD_${c}`] ?? x[c]));
        return compute(item);
      }).filter((x) => x.supplier || x.prfNo || x.poNumber);

      const importedWithIds = imported.map((item) => ({ ...item, id: item.id || makeStableId(item) }));
      await saveManyCloud(importedWithIds as unknown as Record<string, unknown>[]);
      if (importRef.current) importRef.current.value = "";
      notify(`${importedWithIds.length.toLocaleString()} Excel records uploaded to Firebase.`);
    } catch (error: any) {
      if (importRef.current) importRef.current.value = "";
      notify(error?.message || "That Excel file could not be imported.");
    }
  }

  async function clearAll() {
    if (!records.length) { notify("There are no evaluations to clear."); return; }
    if (!confirm(`Delete all ${records.length.toLocaleString()} evaluations from Firebase? This cannot be undone.`)) return;
    try {
      await clearEvaluationsCloud(records.map((x) => x.id));
      setViewing(null);
      notify("Firebase evaluation database cleared.");
    } catch (error: any) {
      notify(error?.message || "Could not clear the Firebase database.");
    }
  }

  async function scanFile(file: File) {
    setScanError("");
    setOcrBusy(true);
    try {
      const dataUrl = await compressImage(file);
      const res = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "OCR failed");
      const d = json.data || {};
      const draft = compute({
        ...blankEvaluation(),
        source: "AI scan",
        prfNo: String(d.prfNo ?? ""),
        poNumber: String(d.poNumber ?? ""),
        itemsDelivered: String(d.itemsDelivered ?? ""),
        evaluationDate: String(d.evaluationDate ?? ""),
        supplier: String(d.supplier ?? ""),
        address: String(d.address ?? ""),
        remarks: String(d.remarks ?? ""),
        purchasing: [d.purchasingA, d.purchasingB, d.purchasingC, d.purchasingD, d.purchasingE].map(normalize),
        requisitioner: [d.requisitionerA, d.requisitionerB, d.requisitionerC, d.requisitionerD].map(normalize),
        amd: [d.amdA, d.amdB, d.amdC, d.amdD].map(normalize),
      });
      setEditing(draft);
      setScanOpen(false);
      navigate("evaluations");
      notify("AI scan complete. Review the extracted fields before saving.");
    } catch (error: any) {
      setScanError(error?.message || "The document could not be processed.");
    } finally {
      setOcrBusy(false);
    }
  }

  const hasPermission = (permission: Permission) => userProfile?.role === "admin" || Boolean(userProfile?.permissions?.includes(permission));
  async function askAI(prompt: string) {
    const text = prompt.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiResponse("");
    setAiMessages((current) => [...current, { role: "user", text }]);
    try {
      const context = {
        summary: stats,
        recent: recent.slice(0, 10).map((r) => ({ supplier: r.supplier, item: r.itemsDelivered, rating: r.finalRating, recommendation: r.recommendation, date: r.evaluationDate })),
        suppliers: suppliers.slice(0, 50),
      };
      const response = await fetch("/api/ai-support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, context }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI support failed.");
      const answer = data.answer || "No AI response was returned.";
      setAiResponse(answer);
      setAiMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch (error: any) {
      const message = error?.message || "Could not reach AI support.";
      setAiResponse(message);
      setAiMessages((current) => [...current, { role: "assistant", text: message }]);
    } finally {
      setAiBusy(false);
    }
  }
  const pageTitle = page === "dashboard" ? "Dashboard" : page === "evaluations" ? "Evaluations" : page === "suppliers" ? "Suppliers" : page === "reports" ? "Reports & Ratings" : page === "purchase-orders" ? "PO Storage" : page === "data" ? "Data Center" : page === "settings" ? "Settings" : page === "profile" ? "My Profile" : page === "ai" ? "AI Support" : "Access & Permissions";

  if (authLoading) return <div className="auth-shell"><div className="auth-card auth-loading"><div className="brand-mark logo-brand-mark"><img src="/sisc-logo.png" alt="Southville International School and Colleges" /></div><h1>Loading Purchasing Supplier Evaluation System</h1><p>Checking your secure Firebase session…</p></div></div>;
  if (!authUser) return <AuthScreen onSuccess={() => {}} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? "open" : "closed"}`}>
        <div className="brand">
          <div className="brand-mark logo-brand-mark"><img src="/sisc-logo.png" alt="Southville International School and Colleges" /></div>
          {sidebar && <div><strong>Supplier</strong><span>Evaluation Pro</span></div>}
        </div>
        <div className="workspace-chip">
          <span className="dot" />
          {sidebar ? <><b>{settings.office}</b><small>Website database</small></> : null}
        </div>
        <nav className="side-nav">
          <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active={page === "dashboard"} onClick={() => navigate("dashboard")} compact={!sidebar} />
          {hasPermission("scan_forms") && <NavItem icon={<ScanLine size={18} />} label="Scan & Extract" active={false} onClick={() => setScanOpen(true)} compact={!sidebar} accent />}
          <NavItem icon={<ClipboardList size={18} />} label="Evaluations" active={page === "evaluations"} onClick={() => navigate("evaluations")} compact={!sidebar} />
          <NavItem icon={<FileText size={18} />} label="PO Storage" active={page === "purchase-orders"} onClick={() => navigate("purchase-orders")} compact={!sidebar} />
          <NavItem icon={<Building2 size={18} />} label="Suppliers" active={page === "suppliers"} onClick={() => navigate("suppliers")} compact={!sidebar} />
          <NavItem icon={<BarChart3 size={18} />} label="Reports & Ratings" active={page === "reports"} onClick={() => navigate("reports")} compact={!sidebar} />
          <NavItem icon={<Bot size={18} />} label="AI Support" active={aiOpen || page === "ai"} onClick={() => setAiOpen(true)} compact={!sidebar} />
          <NavItem icon={<UserCircle2 size={18} />} label="My Profile" active={page === "profile"} onClick={() => navigate("profile")} compact={!sidebar} />
          {hasPermission("database_management") && <><div className="nav-divider" /><NavItem icon={<Database size={18} />} label="Data Center" active={page === "data"} onClick={() => navigate("data")} compact={!sidebar} /></>}
          {userProfile?.role === "admin" && <NavItem icon={<Users size={18} />} label="Access & Permissions" active={page === "access"} onClick={() => navigate("access")} compact={!sidebar} />}
        </nav>
        <div className="sidebar-bottom">
          <NavItem icon={<Settings size={18} />} label="Settings" active={page === "settings"} onClick={() => navigate("settings")} compact={!sidebar} />
          {sidebar && <div className="secure-card"><ShieldCheck size={16} /><div><b>Firebase cloud database</b><span>Shared supplier records are stored in Firestore and available from your deployed site.</span></div></div>}
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="top-left"><button className="icon-button" onClick={() => setSidebar((x) => !x)}><Menu size={20} /></button><div className="breadcrumbs"><span>Purchasing</span><b>/</b><strong>{pageTitle}</strong></div></div>
          <div className="top-actions">
            <button className="icon-button" title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><span className="theme-glyph">{theme === "dark" ? "☀" : "☾"}</span></button>
            <div className="user-chip"><div className="user-avatar">{userProfile?.photoURL ? <img src={userProfile.photoURL} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : String(userProfile?.displayName || authUser.displayName || authUser.email || "U").slice(0,1).toUpperCase()}</div><span>{userProfile?.displayName || authUser.email || "Signed in"}</span><button onClick={async () => { await signOutFirebase(); setRecords([]); setSettingsLoaded(false); setUserProfile(null); }}>Sign out</button></div>
            {hasPermission("import_excel") && <><button className="btn ghost" onClick={() => importRef.current?.click()}><Upload size={16} /> Import Excel</button><input ref={importRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} /></>}
            {hasPermission("export_excel") && <button className="btn secondary" onClick={() => exportExcel()}><Download size={16} /> Export</button>}
            {hasPermission("create_evaluations") && <button className="btn primary" onClick={openNewEvaluation}><Plus size={17} /> New Evaluation</button>}
            {hasPermission("create_evaluations") && <button className="btn secondary" onClick={() => navigate("purchase-orders")}><FileText size={16} /> PO Storage</button>}
          </div>
        </header>

        <div className="page-content">
          {dbError && <div className="panel warning-panel firebase-warning"><AlertCircle size={18}/><div><b>Firebase connection needs setup</b><p>{dbError}</p><small>See the Firebase setup steps in the README included with this project.</small></div></div>}
          {page === "dashboard" && <AdvancedDashboard stats={stats} recent={recent} monthly={monthly} onScan={() => setScanOpen(true)} onNew={openNewEvaluation} onView={(r) => setViewing(r)} onViewAll={() => navigate("reports")} canScan={hasPermission("scan_forms")} canCreate={hasPermission("create_evaluations")} />}
          {page === "evaluations" && <Evaluations records={filtered} query={query} setQuery={setQuery} filterRecommendation={filterRecommendation} setFilterRecommendation={setFilterRecommendation} filterSupplier={filterSupplier} setFilterSupplier={setFilterSupplier} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} suppliers={suppliers} onEdit={setEditing} onView={setViewing} onDelete={removeEvaluation} canEdit={hasPermission("edit_evaluations")} canDelete={hasPermission("delete_evaluations")} />}
          {page === "purchase-orders" && <PurchaseOrderGenerator workspaceName="Southville International School and Colleges" workspaceAddress={(settings as any).address || ""} workspaceEmail={(settings as any).email || ""} currentUser={authUser ? { uid: authUser.uid, email: authUser.email || "", displayName: userProfile?.displayName || authUser.displayName || "" } : null} canEdit={hasPermission("create_evaluations")} onNotify={notify} />}
          {page === "suppliers" && <Suppliers records={records} suppliers={suppliers} onViewSupplier={(supplier) => { setFilterSupplier(supplier); navigate("evaluations"); }} />}
          {page === "reports" && <AdvancedReports records={records} monthly={monthly} />}
          {page === "data" && (hasPermission("database_management") ? <DataCenter records={records} onImport={() => importRef.current?.click()} onExport={() => exportExcel()} onClear={clearAll} onRefresh={() => location.reload()} /> : <AccessDenied title="Data Center restricted" text="Your account does not have database management permission." />)}
          {page === "settings" && <SettingsView settings={settings} setSettings={setSettings} onClear={clearAll} theme={theme} setTheme={setTheme} user={authUser} accent={accent} setAccent={setAccent} profile={userProfile} onOpenProfile={() => navigate("profile")} />}
          {page === "profile" && userProfile && <ProfileView profile={userProfile} theme={theme} accent={accent} onAccent={setAccent} onTheme={setTheme} onSave={async (next) => { setProfileSaving(true); try { await saveUserProfile(next); await updateFirebaseProfile(next.displayName, next.photoURL); setUserProfile(next); setDbError(""); notify("Profile updated successfully."); } finally { setProfileSaving(false); } }} />}
          {page === "ai" && <AISupport stats={stats} records={records} prompt={aiPrompt} setPrompt={setAiPrompt} response={aiResponse} busy={aiBusy} onAsk={askAI} />}
          {page === "access" && userProfile?.role === "admin" && <AccessManagement users={managedUsers} currentUser={authUser} onSave={async (next) => { await updateManagedUser(next); notify(`${next.displayName || next.email}'s access updated.`); }} />}
        </div>
      </main>

      {editing && <EvaluationEditor value={editing} onCancel={() => setEditing(null)} onSave={saveEvaluation} supplierDirectory={suppliers} />}
      {viewing && <EvaluationViewer value={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} onDelete={() => removeEvaluation(viewing.id)} canEdit={hasPermission("edit_evaluations")} canDelete={hasPermission("delete_evaluations")} />}
      {scanOpen && <ScanModal busy={ocrBusy} error={scanError} onClose={() => { if (!ocrBusy) setScanOpen(false); }} onFile={scanFile} />}
      {dbLoading && <div className="db-loading"><div className="loader-ring"/><div><b>Connecting to Firebase…</b><span>Loading your supplier evaluation database</span></div></div>}
      {hasPermission("ai_support") && <button className="ai-fab" onClick={() => setAiOpen(true)}><Bot size={16}/> Ask Supplier AI</button>}
      {aiOpen && hasPermission("ai_support") && <AISupportDrawer stats={stats} records={records} prompt={aiPrompt} setPrompt={setAiPrompt} response={aiResponse} busy={aiBusy} messages={aiMessages} onAsk={askAI} onClose={() => setAiOpen(false)} onClear={() => { setAiMessages([]); setAiResponse(""); }} />}
      {toast && <div className="toast"><CheckCircle2 size={17} /> {toast}</div>}
    </div>
  );
}

function compressImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1800;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Image processing failed."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.onerror = () => reject(new Error("The image could not be opened."));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

function NavItem({ icon, label, active, onClick, compact, accent }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; compact: boolean; accent?: boolean }) {
  return (
    <button className={`nav-item ${active ? "active" : ""} ${accent ? "accent" : ""}`} onClick={onClick} title={compact ? label : undefined}>
      <span>{icon}</span>
      {!compact ? <span className="nav-label">{label}{accent ? <Sparkles size={13} /> : null}</span> : null}
    </button>
  );
}

function Dashboard({ stats, recent, monthly, onScan, onNew, onView, onViewAll, canScan, canCreate }: { stats: any; recent: Evaluation[]; monthly: any[]; onScan: () => void; onNew: () => void; onView: (x: Evaluation) => void; onViewAll: () => void; canScan: boolean; canCreate: boolean }) {
  return <div>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> SUPPLIER PERFORMANCE WORKSPACE</div>
        <h1>Good day, Purchasing Team.</h1>
        <p>Review your supplier evaluation history, scan new forms, and keep the entire evaluation workflow in one place.</p>
        <div className="hero-actions">{canScan && <button className="btn primary large" onClick={onScan}><ScanLine size={18} /> Scan a Form</button>}{canCreate && <button className="btn soft large" onClick={onNew}><Plus size={18} /> New Evaluation</button>}</div>
      </div>
      <div className="hero-art"><div className="hero-orbit one" /><div className="hero-orbit two" /><div className="hero-core"><Sparkles size={26} /></div><div className="hero-float float-one"><Database size={16} /><b>{stats.total.toLocaleString()}</b><span>records</span></div><div className="hero-float float-two"><Star size={16} /><b>{stats.avg ? stats.avg.toFixed(2) : "—"}</b><span>avg rating</span></div></div>
    </section>

    <section className="stats-grid">
      <Stat icon={<ClipboardList size={18} />} label="Total evaluations" value={stats.total.toLocaleString()} meta="Saved in website" />
      <Stat icon={<Building2 size={18} />} label="Active suppliers" value={stats.supplierCount.toLocaleString()} meta="Unique supplier names" />
      <Stat icon={<Activity size={18} />} label="Average rating" value={stats.avg ? stats.avg.toFixed(2) : "—"} meta="Across rated records" accent />
      <Stat icon={<CheckCircle2 size={18} />} label="Strongly recommended" value={stats.strong.toLocaleString()} meta={stats.total ? `${Math.round(stats.strong / stats.total * 100)}% of all records` : "No data yet"} />
    </section>

    <section className="content-grid wide-left">
      <div className="panel">
        <div className="panel-head"><div><div className="section-kicker">LATEST ACTIVITY</div><h2>Recent evaluations</h2><p>Your newest supplier records at a glance.</p></div><button className="text-link" onClick={onViewAll}>View all <span>→</span></button></div>
        <div className="table-wrap">
          <table><thead><tr><th>Supplier</th><th>PRF</th><th>PO</th><th>Date</th><th>Rating</th><th>Recommendation</th></tr></thead><tbody>
            {recent.map((r) => <tr key={r.id} onClick={() => onView(r)} className="click-row"><td><div className="supplier-cell"><div className="avatar">{(r.supplier || "?").slice(0,1).toUpperCase()}</div><div><b>{r.supplier || "Unknown supplier"}</b><small>{r.itemsDelivered || "No item description"}</small></div></div></td><td>{r.prfNo || "—"}</td><td>{r.poNumber || "—"}</td><td>{r.evaluationDate || "—"}</td><td><span className={`rating-dot ${ratingTone(r.finalRating)}`}>{r.finalRating ? r.finalRating.toFixed(2) : "—"}</span></td><td><Pill value={r.recommendation} /></td></tr>)}
            {!recent.length && <tr><td colSpan={6}><Empty text="No evaluations yet" sub="Scan a supplier form or create a new evaluation." /></td></tr>}
          </tbody></table>
        </div>
      </div>
      <div className="panel workflow-panel"><div className="panel-head"><div><div className="section-kicker">WORKFLOW</div><h2>From paper to record</h2><p>Designed around your actual purchasing process.</p></div></div><Workflow icon={<Camera size={17} />} step="01" title="Scan the paper" text="Take a photo or upload a clear scanned supplier form."/><Workflow icon={<Sparkles size={17} />} step="02" title="AI extracts details" text="PRF, PO, supplier, items, dates and ratings are prepared for review."/><Workflow icon={<Check size={17} />} step="03" title="Review and save" text="Correct anything needed, then save it into your website database."/><Workflow icon={<Download size={17} />} step="04" title="Export anytime" text="Generate Excel as a report or backup without making Excel your primary database."/></div>
    </section>

    <section className="content-grid">
      <div className="panel chart-panel"><div className="panel-head"><div><div className="section-kicker">TREND</div><h2>Monthly average rating</h2><p>Last six months available in your records.</p></div></div>{monthly.length ? <div className="chart"><div className="chart-y"><span>5.0</span><span>4.0</span><span>3.0</span></div><div className="bars">{monthly.map((m) => <div className="bar-col" key={m.month}><div className="bar-value">{m.avg.toFixed(2)}</div><div className="bar-track"><div className={`bar-fill ${ratingTone(m.avg)}`} style={{ height: `${Math.max(8, (m.avg / 5) * 100)}%` }} /></div><small>{m.month.slice(5)}</small></div>)}</div></div> : <Empty text="No monthly data" sub="Add rated evaluations to see the trend." />}</div>
      <div className="panel insight-panel"><div className="panel-head"><div><div className="section-kicker">QUICK INSIGHTS</div><h2>System snapshot</h2><p>Useful numbers for your review.</p></div></div><Insight icon={<Users size={16} />} label="Recommended" value={`${stats.recommended}`} meta="rating 4.00–4.49"/><Insight icon={<AlertCircle size={16} />} label="Needs attention" value={`${stats.needsAttention}`} meta="rating below 3.50"/><Insight icon={<FileSpreadsheet size={16} />} label="Excel ready" value="1 click" meta="Export current records anytime"/></div>
    </section>
  </div>;
}

function Stat({ icon, label, value, meta, accent }: { icon: React.ReactNode; label: string; value: string; meta: string; accent?: boolean }) {
  return <div className={`stat-card ${accent ? "accent" : ""}`}><div className="stat-icon">{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{meta}</small></div><div className="stat-line" /></div>;
}

function Workflow({ icon, step, title, text }: { icon: React.ReactNode; step: string; title: string; text: string }) {
  return <div className="workflow"><div className="workflow-step">{step}</div><div className="workflow-icon">{icon}</div><div><b>{title}</b><p>{text}</p></div></div>;
}

function Insight({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) { return <div className="insight"><div className="insight-icon">{icon}</div><div><b>{label}</b><small>{meta}</small></div><strong>{value}</strong></div>; }

function Evaluations({ records, query, setQuery, filterRecommendation, setFilterRecommendation, filterSupplier, setFilterSupplier, dateFrom, setDateFrom, dateTo, setDateTo, suppliers, onEdit, onView, onDelete, canEdit, canDelete }: any) {
  return <div><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> EVALUATION REGISTER</div><h1>Supplier evaluations</h1><p>Search, filter, review, and update your complete evaluation history.</p></div><div className="heading-badge"><Database size={15} /><span>Website database</span></div></div>
    <div className="panel filters-panel"><div className="filter-top"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search supplier, PRF, PO, item..." /></div><div className="result-count">{records.length.toLocaleString()} results</div></div><div className="filter-grid"><label><span>Recommendation</span><select value={filterRecommendation} onChange={(e) => setFilterRecommendation(e.target.value)}><option value="all">All recommendations</option>{["Strongly Recommended","Recommended","Acceptable","Acceptable w/ some Reservation","Not Recommended"].map((x) => <option key={x}>{x}</option>)}</select></label><label><span>Supplier</span><select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}><option value="all">All suppliers</option>{suppliers.map((x: string) => <option key={x}>{x}</option>)}</select></label><label><span>From date</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label><label><span>To date</span><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label></div></div>
    <div className="panel"><div className="panel-head"><div><div className="section-kicker">RECORDS</div><h2>All evaluations</h2><p>Click any row to review the full supplier evaluation.</p></div><Filter size={18} className="muted-icon" /></div><div className="table-wrap"><table className="evaluation-table"><thead><tr><th>Supplier / item</th><th>PRF</th><th>PO</th><th>Date</th><th>Purchasing</th><th>Requisitioner</th><th>AMD</th><th>Final</th><th>Recommendation</th><th /></tr></thead><tbody>{records.map((r: Evaluation) => <tr key={r.id} className="click-row" onClick={() => onView(r)}><td><div className="supplier-cell"><div className="avatar">{(r.supplier || "?").slice(0,1).toUpperCase()}</div><div><b>{r.supplier || "Unknown"}</b><small>{r.itemsDelivered || "No item description"}</small></div></div></td><td>{r.prfNo || "—"}</td><td>{r.poNumber || "—"}</td><td>{r.evaluationDate || "—"}</td><td>{r.purchasingAvg ? r.purchasingAvg.toFixed(2) : "—"}</td><td>{r.requisitionerAvg ? r.requisitionerAvg.toFixed(2) : "—"}</td><td>{r.amdAvg ? r.amdAvg.toFixed(2) : "—"}</td><td><span className={`rating-dot ${ratingTone(r.finalRating)}`}>{r.finalRating ? r.finalRating.toFixed(2) : "—"}</span></td><td><Pill value={r.recommendation} /></td><td><div className="row-actions" onClick={(e) => e.stopPropagation()}>{canEdit && <button className="icon-action" onClick={() => onEdit(r)} title="Edit"><Edit3 size={15} /></button>}{canDelete && <button className="icon-action danger" onClick={() => onDelete(r.id)} title="Delete"><Trash2 size={15} /></button>}</div></td></tr>)}{!records.length && <tr><td colSpan={10}><Empty text="No records match your filters" sub="Try clearing the search or changing the filters." /></td></tr>}</tbody></table></div></div></div>;
}

function EvaluationViewer({ value, onClose, onEdit, onDelete, canEdit, canDelete }: { value: Evaluation; onClose: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  return <div className="modal-backdrop"><div className="detail-modal"><div className="detail-top"><div><div className="eyebrow"><span className="eyebrow-dot" /> EVALUATION RECORD</div><h2>{value.supplier || "Supplier evaluation"}</h2><p>{value.poNumber || "No PO"} · PRF {value.prfNo || "—"} · {value.evaluationDate || "No date"}</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="detail-body"><div className="detail-grid"><Detail label="Supplier" value={value.supplier}/><Detail label="PRF No." value={value.prfNo}/><Detail label="PO Number" value={value.poNumber}/><Detail label="Evaluation Date" value={value.evaluationDate}/><Detail label="Address" value={value.address || "—"}/><Detail label="Item/s Delivered" value={value.itemsDelivered || "—"}/></div><div className="score-summary"><ScoreSummary title="Purchasing" value={value.purchasingAvg} /><ScoreSummary title="Requisitioner" value={value.requisitionerAvg} /><ScoreSummary title="AMD" value={value.amdAvg} /><ScoreSummary title="Final Rating" value={value.finalRating} final /></div><div className="criteria-detail"><CriterionBlock title="Purchasing" labels={criteria.purchasing} values={value.purchasing}/><CriterionBlock title="Requisitioner" labels={criteria.requisitioner} values={value.requisitioner}/><CriterionBlock title="AMD" labels={criteria.amd} values={value.amd}/></div><div className="remarks-box"><span>Remarks</span><p>{value.remarks || "No remarks recorded."}</p></div></div><div className="detail-footer"><Pill value={value.recommendation}/><div>{canDelete && <button className="btn danger-outline" onClick={onDelete}><Trash2 size={15}/> Delete</button>}{canEdit && <button className="btn secondary" onClick={onEdit}><Edit3 size={15}/> Edit evaluation</button>}</div></div></div></div>;
}

function Detail({ label, value }: { label: string; value?: string }) { return <div className="detail-item"><span>{label}</span><b>{value || "—"}</b></div>; }
function ScoreSummary({ title, value, final }: { title: string; value: number; final?: boolean }) { return <div className={`score-summary-card ${final ? "final" : ""}`}><span>{title}</span><strong>{value ? value.toFixed(2) : "—"}</strong>{value > 0 && <small>{recommendation(value)}</small>}</div>; }
function CriterionBlock({ title, labels, values }: { title: string; labels: string[]; values: Rating[] }) { return <div className="criterion-block"><b>{title}</b>{labels.map((label, i) => <div className="criterion-row" key={label}><span>{label}</span><strong>{values[i] ?? "—"}</strong></div>)}</div>; }

function EvaluationEditor({ value, onCancel, onSave, supplierDirectory }: { value: Evaluation; onCancel: () => void; onSave: (x: Evaluation) => void; supplierDirectory: string[] }) {
  const [draft, setDraft] = useState(value);
  const [poRecords, setPoRecords] = useState<PurchaseOrderRecord[]>([]);
  const [prfRecords, setPrfRecords] = useState<PrfRecord[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [liveFetchedAt, setLiveFetchedAt] = useState("");
  const [livePoCount, setLivePoCount] = useState(0);
  const [livePrfCount, setLivePrfCount] = useState(0);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupQuery, setLookupQuery] = useState(value.prfNo || value.poNumber || "");
  const [lookupNotice, setLookupNotice] = useState("");
  const [supplierLookupOpen, setSupplierLookupOpen] = useState(false);
  const lastAutoFilledKey = useRef("");

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    setLookupQuery(value.prfNo || value.poNumber || "");
    setLookupOpen(false);
    setLookupNotice("");
    lastAutoFilledKey.current = "";
  }, [value.id]);

  const loadLiveSheet = async () => {
    setLiveLoading(true);
    setLiveError("");
    try {
      const response = await fetch("/api/po-lookup", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || "Live Google Sheet lookup is unavailable.");
      }
      const nextPoRecords = Array.isArray(data.poRecords) ? data.poRecords : [];
      const nextPrfRecords = Array.isArray(data.prfRecords) ? data.prfRecords : [];
      setPoRecords(nextPoRecords);
      setPrfRecords(nextPrfRecords);
      setLivePoCount(nextPoRecords.reduce((total: number, group: PurchaseOrderRecord) => total + (group.matches?.length || 0), 0));
      setLivePrfCount(nextPrfRecords.length);
      setLiveFetchedAt(data.fetchedAt || new Date().toISOString());
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Unable to load live Google Sheet data.");
      setPoRecords([]);
      setPrfRecords([]);
      setLivePoCount(0);
      setLivePrfCount(0);
    } finally {
      setLiveLoading(false);
    }
  };

  useEffect(() => {
    const historicalRecord = String(value.id).startsWith("seed-") || String(value.id).startsWith("excel-") || value.source === "Imported workbook";
    if (!historicalRecord) void loadLiveSheet();
    // The historical-record guard intentionally keeps imported records untouched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.id]);

  const set = (key: keyof Evaluation, next: any) => setDraft((old) => ({ ...old, [key]: next }));
  const computed = compute(draft);

  const supplierSuggestions = useMemo(() => {
    const q = draft.supplier.trim().toLowerCase();
    const filtered = q ? supplierDirectory.filter((name) => name.toLowerCase().includes(q)) : supplierDirectory;
    return filtered.slice(0, 8);
  }, [draft.supplier, supplierDirectory]);

  const historicalRecord = String(value.id).startsWith("seed-") || String(value.id).startsWith("excel-") || value.source === "Imported workbook";
  const lookupEnabled = !historicalRecord;
  const normalizedQuery = normalizePO(lookupQuery);

  const poMatches = useMemo(() => {
    if (!lookupEnabled || normalizedQuery.length < 2) return [] as PurchaseOrderMatch[];
    const flat: PurchaseOrderMatch[] = [];
    for (const group of poRecords) {
      const groupKey = normalizePO(group.poNumber);
      if (groupKey.includes(normalizedQuery) || normalizedQuery.includes(groupKey)) {
        for (const match of group.matches || []) flat.push({ ...match, poNumber: group.poNumber });
      }
    }
    const seen = new Set<string>();
    return flat.filter((item) => {
      const key = [normalizePO(item.poNumber), item.prfNumber, item.itemsDelivered, item.supplier].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [lookupEnabled, normalizedQuery, poRecords]);

  const prfMatches = useMemo(() => {
    if (!lookupEnabled || normalizedQuery.length < 2) return [] as PrfRecord[];
    return prfRecords
      .filter((record) => normalizePO(record.prfNumber).includes(normalizedQuery))
      .slice(0, 8);
  }, [lookupEnabled, normalizedQuery, prfRecords]);

  const suggestions = useMemo(() => {
    const po = poMatches.slice(0, 8).map((match) => ({ kind: "po" as const, match }));
    if (prfMatches.length) return [{ kind: "prf" as const, record: prfMatches[0] }, ...po];
    return po;
  }, [poMatches, prfMatches]);

  useEffect(() => {
    if (!lookupEnabled || normalizedQuery.length < 2) return;

    const exactPo = poRecords
      .filter((group) => normalizePO(group.poNumber) === normalizedQuery)
      .flatMap((group) => group.matches || []);
    const distinctPo = exactPo.filter((match, index, arr) => {
      const key = [match.prfNumber, match.itemsDelivered, match.supplier].join("|");
      return arr.findIndex((x) => [x.prfNumber, x.itemsDelivered, x.supplier].join("|") === key) === index;
    });

    const exactPrf = prfRecords.find((record) => normalizePO(record.prfNumber) === normalizedQuery);
    const autoKey = `q:${normalizedQuery}|po:${distinctPo.length}|prf:${exactPrf?.prfNumber || ""}`;

    if (lastAutoFilledKey.current === autoKey) return;

    if (distinctPo.length === 1) {
      const match = distinctPo[0];
      lastAutoFilledKey.current = autoKey;
      setDraft((current) => ({
        ...current,
        poNumber: match.poNumber || current.poNumber,
        prfNo: match.prfNumber || current.prfNo,
        itemsDelivered: match.itemsDelivered || (exactPrf?.itemDescription ?? current.itemsDelivered),
        supplier: match.supplier || current.supplier,
      }));
      setLookupNotice(`Live PO match · ${match.supplier || "Supplier not listed"}`);
      setLookupOpen(false);
      return;
    }

    if (distinctPo.length > 1) {
      lastAutoFilledKey.current = autoKey;
      setLookupNotice(`${distinctPo.length} live PO records found. Choose the correct supplier.`);
      return;
    }

    if (exactPrf) {
      lastAutoFilledKey.current = autoKey;
      setDraft((current) => ({
        ...current,
        prfNo: exactPrf.prfNumber || current.prfNo,
        itemsDelivered: exactPrf.itemDescription || current.itemsDelivered,
      }));
      setLookupNotice(`Live PRF match · ${exactPrf.department || exactPrf.requisitioner || "PRF details found"}`);
      setLookupOpen(false);
    }
  }, [lookupEnabled, normalizedQuery, poRecords, prfRecords]);

  function choosePO(match: PurchaseOrderMatch) {
    lastAutoFilledKey.current = `manual:${normalizePO(match.poNumber)}:${match.prfNumber}`;
    setDraft((current) => ({
      ...current,
      poNumber: match.poNumber,
      prfNo: match.prfNumber || current.prfNo,
      itemsDelivered: match.itemsDelivered || current.itemsDelivered,
      supplier: match.supplier || current.supplier,
    }));
    setLookupQuery(match.poNumber);
    setLookupNotice(`Live PO selected · ${match.supplier || "Supplier not listed"}`);
    setLookupOpen(false);
  }

  function choosePrf(record: PrfRecord) {
    lastAutoFilledKey.current = `manual-prf:${normalizePO(record.prfNumber)}`;
    setDraft((current) => ({
      ...current,
      prfNo: record.prfNumber,
      itemsDelivered: record.itemDescription || current.itemsDelivered,
    }));
    setLookupQuery(record.prfNumber);
    setLookupNotice(`Live PRF selected · ${record.department || record.requisitioner || "PRF details found"}`);
    setLookupOpen(false);
  }

  function startLookup(value: string) {
    setLookupQuery(value);
    setLookupNotice("");
    lastAutoFilledKey.current = "";
    setLookupOpen(true);
  }

  return (
    <div className="modal-backdrop">
      <div className="editor-modal">
        <div className="editor-head">
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /> {draft.source === "AI scan" ? "AI SCAN REVIEW" : "NEW / EDIT EVALUATION"}</div>
            <h2>{draft.source === "AI scan" ? "Review extracted supplier form" : "Evaluation details"}</h2>
            <p>{draft.source === "AI scan" ? "AI prepared this record. Please verify names, dates, and handwritten ratings before saving." : "The website will automatically calculate all averages and use the latest live Purchasing sheet data for incoming records."}</p>
          </div>
          <button className="icon-button" onClick={onCancel}><X size={18}/></button>
        </div>

        <div className="editor-body">
          <div className="form-section">
            <div className="form-section-title"><span>01</span><div><b>Transaction details</b><small>Basic supplier and delivery information.</small></div></div>

            {lookupEnabled && (
              <div className={`live-sheet-status ${liveError ? "error" : ""}`}>
                <div className="live-sheet-status-main">
                  <span className="live-dot" />
                  <div>
                    <b>{liveLoading ? "Testing live Google Sheet…" : liveError ? "Live Google Sheet unavailable" : liveFetchedAt ? "Live Google Sheet connected" : "Live Google Sheet not tested yet"}</b>
                    <small>{liveError ? liveError : liveFetchedAt ? `Last checked ${new Date(liveFetchedAt).toLocaleTimeString()} · ${livePoCount.toLocaleString()} PO matches · ${livePrfCount.toLocaleString()} PRF records` : "Click Test connection to verify the website can read the current shared sheet."}</small>
                  </div>
                </div>
                <button type="button" className="live-refresh-btn" onClick={() => void loadLiveSheet()} disabled={liveLoading} title="Test and refresh live Google Sheet data">
                  <RefreshCw size={13} className={liveLoading ? "spin" : ""} /> {liveLoading ? "Testing…" : "Test connection"}
                </button>
              </div>
            )}

            <div className="form-grid">
              <div className="field supplier-picker-field"><span>Supplier</span><div className="autocomplete-wrap"><div className="po-input-wrap supplier-input-wrap"><Search size={14} className="po-search-icon"/><input value={draft.supplier} placeholder="Search stored suppliers" onFocus={() => setSupplierLookupOpen(true)} onChange={(e) => { set("supplier", e.target.value); setSupplierLookupOpen(true); }} onBlur={() => window.setTimeout(() => setSupplierLookupOpen(false), 180)}/></div>{supplierLookupOpen && supplierSuggestions.length > 0 && <div className="po-suggestions supplier-suggestions">{supplierSuggestions.map((name) => <button type="button" key={name} onMouseDown={(e) => e.preventDefault()} onClick={() => { set("supplier", name); setSupplierLookupOpen(false); }}><div className="po-suggestion-top"><b>{name}</b><span>STORED SUPPLIER</span></div><small>Select a supplier from your saved evaluation history</small></button>)}</div>}</div></div>
              <Field label="Evaluation date" type="date" value={draft.evaluationDate} onChange={(v) => set("evaluationDate", v)} />

              <div className="field po-lookup-field">
                <span>PRF No.</span>
                <div className="po-input-wrap">
                  <Search size={14} className="po-search-icon" />
                  <input
                    value={draft.prfNo}
                    placeholder="Scan or type PRF number"
                    onFocus={() => lookupEnabled && setLookupOpen(true)}
                    onChange={(e) => {
                      const next = e.target.value;
                      set("prfNo", next);
                      startLookup(next);
                    }}
                    onBlur={() => window.setTimeout(() => setLookupOpen(false), 180)}
                  />
                  {liveLoading && <span className="po-loading-dot" />}
                </div>
              </div>

              <div className="field po-lookup-field">
                <span>PO Number</span>
                <div className="po-input-wrap">
                  <Search size={14} className="po-search-icon" />
                  <input
                    value={draft.poNumber}
                    placeholder="Type or scan PO number"
                    onFocus={() => lookupEnabled && setLookupOpen(true)}
                    onChange={(e) => {
                      const next = e.target.value;
                      set("poNumber", next);
                      startLookup(next);
                    }}
                    onBlur={() => window.setTimeout(() => setLookupOpen(false), 180)}
                  />
                  {liveLoading && <span className="po-loading-dot" />}
                </div>

                {lookupEnabled && lookupOpen && suggestions.length > 0 && (
                  <div className="po-suggestions">
                    {suggestions.map((item, index) => {
                      if (item.kind === "prf") {
                        return (
                          <button type="button" key={`prf-${item.record.prfNumber}-${index}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choosePrf(item.record)}>
                            <div className="po-suggestion-top">
                              <b>PRF {item.record.prfNumber}</b>
                              <span>LIVE PRF</span>
                            </div>
                            <small>{item.record.department || item.record.requisitioner || "PRF details"}</small>
                            <p>{item.record.itemDescription || "No item description listed"}</p>
                          </button>
                        );
                      }
                      return (
                        <button
                          type="button"
                          key={`${normalizePO(item.match.poNumber)}-${item.match.prfNumber}-${item.match.supplier}-${item.match.itemsDelivered}-${index}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choosePO(item.match)}
                        >
                          <div className="po-suggestion-top">
                            <b>{item.match.poNumber}</b>
                            <span>PRF {item.match.prfNumber || "—"}</span>
                          </div>
                          <small>{item.match.supplier || "Supplier not listed"}</small>
                          <p>{item.match.itemsDelivered || "No items listed"}</p>
                        </button>
                      );
                    })}
                  </div>
                )}

                {lookupEnabled && lookupNotice && <small className="po-lookup-notice"><CheckCircle2 size={12}/>{lookupNotice}</small>}
                {!lookupEnabled && <small className="po-lookup-disabled">Historical record · live PO/PRF lookup is disabled to preserve the original data.</small>}
              </div>

              <Field full label="Address" value={draft.address} onChange={(v) => set("address", v)} />
              <TextArea full label="Item/s Delivered" value={draft.itemsDelivered} onChange={(v) => set("itemsDelivered", v)} placeholder="Items, materials, or services delivered" />
            </div>
          </div>

          <RatingSection title="Purchasing" subtitle="5 criteria" labels={criteria.purchasing} values={draft.purchasing} onChange={(i, v) => set("purchasing", draft.purchasing.map((x, j) => i === j ? v : x))}/>
          <RatingSection title="Requisitioner" subtitle="4 criteria" labels={criteria.requisitioner} values={draft.requisitioner} onChange={(i, v) => set("requisitioner", draft.requisitioner.map((x, j) => i === j ? v : x))}/>
          <RatingSection title="AMD" subtitle="4 criteria" labels={criteria.amd} values={draft.amd} onChange={(i, v) => set("amd", draft.amd.map((x, j) => i === j ? v : x))}/>

          <div className="form-section">
            <div className="form-section-title"><span>05</span><div><b>Automatic result</b><small>Calculated from the three evaluation groups.</small></div></div>
            <div className="result-grid">
              <ScoreSummary title="Purchasing avg." value={computed.purchasingAvg}/>
              <ScoreSummary title="Requisitioner avg." value={computed.requisitionerAvg}/>
              <ScoreSummary title="AMD avg." value={computed.amdAvg}/>
              <ScoreSummary title="Final rating" value={computed.finalRating} final/>
            </div>
            <div className="recommendation-banner">
              <div><Sparkles size={18}/><div><b>{computed.recommendation || "Not yet rated"}</b><span>Recommendation based on your existing rubric.</span></div></div>
              <strong>{computed.finalRating ? computed.finalRating.toFixed(2) : "—"}</strong>
            </div>
            <TextArea full label="Remarks / reasons for scores below 4" value={draft.remarks} onChange={(v) => set("remarks", v)} placeholder="Add remarks, reasons, or observations" />
          </div>
        </div>

        <div className="editor-footer">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(computed)}><CheckCircle2 size={17}/> Save evaluation</button>
        </div>
      </div>
    </div>
  );
}

function RatingSection({ title, subtitle, labels, values, onChange }: { title: string; subtitle: string; labels: string[]; values: Rating[]; onChange: (i: number, v: Rating) => void }) { return <div className="rating-section"><div className="rating-section-head"><div><b>{title}</b><span>{subtitle} · 1 = Poor · 5 = Excellent</span></div><div className="rating-preview">{average(values) ? average(values).toFixed(2) : "—"}</div></div><div className="rating-grid">{labels.map((label, i) => <label key={label}><span>{String.fromCharCode(65 + i)} · {label}</span><select value={values[i] ?? ""} onChange={(e) => onChange(i, e.target.value ? Number(e.target.value) : null)}><option value="">Select</option>{[1,2,3,4,5].map((n) => <option value={n} key={n}>{n} — {n === 1 ? "Poor" : n === 2 ? "Fair" : n === 3 ? "Good" : n === 4 ? "Very Good" : "Excellent"}</option>)}</select></label>)}</div></div>; }
function Field({ label, value, onChange, placeholder, type = "text", full = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; full?: boolean }) { return <label className={`field ${full ? "full" : ""}`}><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>; }
function TextArea({ label, value, onChange, placeholder, full = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; full?: boolean }) { return <label className={`field ${full ? "full" : ""}`}><span>{label}</span><textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>; }

function Suppliers({ records, suppliers, onViewSupplier }: { records: Evaluation[]; suppliers: string[]; onViewSupplier: (supplier: string) => void }) {
  const rows = suppliers.map((supplier) => { const rs = records.filter((r) => r.supplier === supplier); return { supplier, count: rs.length, avg: average(rs.map((r) => r.finalRating)) }; }).sort((a,b) => b.avg - a.avg);
  return <div><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> SUPPLIER DIRECTORY</div><h1>Suppliers</h1><p>Supplier history, evaluation volume, and current average ratings.</p></div><div className="heading-badge"><Users size={15}/><span>{suppliers.length.toLocaleString()} suppliers</span></div></div><div className="supplier-grid">{rows.map((r) => <button className="supplier-card" key={r.supplier} onClick={() => onViewSupplier(r.supplier)}><div className="supplier-card-top"><div className="large-avatar">{r.supplier.slice(0,1).toUpperCase()}</div><span className={`rating-dot ${ratingTone(r.avg)}`}>{r.avg ? r.avg.toFixed(2) : "—"}</span></div><b>{r.supplier}</b><small>{r.count} evaluation{r.count === 1 ? "" : "s"}</small><div className="supplier-meter"><i style={{ width: `${Math.max(4, Math.min(100, r.avg / 5 * 100))}%` }} /></div><span className="supplier-action">View history →</span></button>)}{!rows.length && <div className="panel"><Empty text="No suppliers yet" sub="Create or import an evaluation to build your supplier directory." /></div>}</div></div>;
}

function Reports({ records, monthly }: { records: Evaluation[]; monthly: any[] }) {
  const counts = ["Strongly Recommended", "Recommended", "Acceptable", "Acceptable w/ some Reservation", "Not Recommended"].map((name) => ({ name, count: records.filter((r) => r.recommendation === name).length }));
  const top = Array.from(new Set(records.map((r) => r.supplier).filter(Boolean))).map((supplier) => { const rs = records.filter((r) => r.supplier === supplier && r.finalRating); return { supplier, avg: average(rs.map((r) => r.finalRating)), count: rs.length }; }).filter((x) => x.count).sort((a,b) => b.avg - a.avg).slice(0, 10);
  const ayRows = useMemo(() => {
    const now = new Date();
    const currentStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 5 }, (_, index) => currentStartYear - index).map((startYear) => {
      const label = `AY ${startYear}\u2013${startYear + 1}`;
      const within = records.filter((record) => {
        const raw = record.evaluationDate || record.createdAt;
        if (!raw || record.finalRating <= 0) return false;
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return false;
        return date >= new Date(startYear, 6, 1) && date <= new Date(startYear + 1, 5, 30, 23, 59, 59);
      });
      const groupAverage = (values: number[]) => average(values.filter((value) => value > 0));
      return {
        label,
        count: within.length,
        final: groupAverage(within.map((r) => r.finalRating)),
        requisitioner: groupAverage(within.map((r) => r.requisitionerAvg)),
        purchasing: groupAverage(within.map((r) => r.purchasingAvg)),
        amd: groupAverage(within.map((r) => r.amdAvg)),
      };
    });
  }, [records]);

  return <div>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PERFORMANCE ANALYTICS</div><h1>Reports & Ratings</h1><p>Management-ready views built directly from your evaluation records.</p></div></div>
    <div className="report-grid">
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">RECOMMENDATIONS</div><h2>Recommendation distribution</h2><p>{records.length.toLocaleString()} total records</p></div></div><div className="report-bars">{counts.map((x) => <div className="report-bar" key={x.name}><div><span>{x.name}</span><b>{x.count}</b></div><div className="track"><i style={{ width: `${records.length ? (x.count / records.length) * 100 : 0}%` }} /></div></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">RANKING</div><h2>Top suppliers</h2><p>Highest final rating averages</p></div></div>{top.map((x, i) => <div className="rank-row" key={x.supplier}><span>{i + 1}</span><div><b>{x.supplier}</b><small>{x.count} evaluation{x.count === 1 ? "" : "s"}</small></div><strong>{x.avg.toFixed(2)}</strong></div>)}{!top.length && <Empty text="No rated suppliers" sub="Your supplier rankings will appear here."/>}</div>
    </div>
    <div className="content-grid">
      <div className="panel"><div className="panel-head"><div><div className="section-kicker">TREND</div><h2>Rating trend</h2><p>Recent monthly averages.</p></div></div><div className="trend-list">{monthly.map((m) => <div key={m.month}><span>{m.month}</span><div className="trend-track"><i style={{ width: `${(m.avg / 5) * 100}%` }} /></div><b>{m.avg.toFixed(2)}</b></div>)}{!monthly.length && <Empty text="No monthly ratings" sub="Rated evaluations are needed for this report."/>}</div></div>
      <div className="panel rubric"><div className="panel-head"><div><div className="section-kicker">RUBRIC</div><h2>Your recommendation rules</h2><p>Matches the rubric from your existing workbook.</p></div></div><Rule min="4.50" label="Strongly Recommended"/><Rule min="4.00" label="Recommended"/><Rule min="3.50" label="Acceptable"/><Rule min="3.00" label="Acceptable w/ some Reservation"/><Rule min="0.00" label="Not Recommended"/></div>
    </div>
    <div className="panel annual-summary-panel"><div className="panel-head"><div><div className="section-kicker">ACADEMIC YEAR SUMMARY</div><h2>Evaluation averages by academic year</h2><p>July 1 through June 30, matching the supplier-evaluation logic supplied for this system.</p></div><CalendarDays size={18} className="muted-icon"/></div><div className="table-wrap"><table><thead><tr><th>Academic Year</th><th>Evaluations</th><th>Final Avg.</th><th>Requisitioner Avg.</th><th>Purchasing Avg.</th><th>AMD Avg.</th></tr></thead><tbody>{ayRows.map((row) => <tr key={row.label}><td><b>{row.label}</b></td><td>{row.count}</td><td>{row.final ? row.final.toFixed(2) : "—"}</td><td>{row.requisitioner ? row.requisitioner.toFixed(2) : "—"}</td><td>{row.purchasing ? row.purchasing.toFixed(2) : "—"}</td><td>{row.amd ? row.amd.toFixed(2) : "—"}</td></tr>)}</tbody></table></div></div>
  </div>;
}
function Rule({ min, label }: { min: string; label: string }) { return <div className="rule"><span>{min}+</span><b>{label}</b></div>; }

function DataCenter({ records, onImport, onExport, onClear, onRefresh }: { records: Evaluation[]; onImport: () => void; onExport: () => void; onClear: () => void; onRefresh: () => void }) {
  return <div><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> DATA MANAGEMENT</div><h1>Data Center</h1><p>Excel is now optional. The website is your working database, with import and export when you need it.</p></div></div><div className="data-hero"><div className="data-icon"><Database size={24}/></div><div><b>{records.length.toLocaleString()} evaluations currently stored</b><p>Records are stored in Firebase Firestore, so your Vercel site can use the same supplier database from multiple devices.</p></div><span className="data-status"><span/> Ready</span></div><div className="data-cards"><DataCard icon={<Upload size={20}/>} title="Import existing Excel" text="Bring your current DATABASE sheet into the website without typing it again." action="Choose Excel" onClick={onImport}/><DataCard icon={<Download size={20}/>} title="Export to Excel" text="Download the website database as a clean Supplier Evaluations workbook." action="Export workbook" onClick={onExport}/><DataCard icon={<RefreshCw size={20}/>} title="Reload workspace" text="Reload the current browser session and refresh the dashboard data." action="Reload app" onClick={onRefresh}/></div><div className="panel warning-panel"><AlertCircle size={19}/><div><b>Important for Vercel deployment</b><p>Firebase is now the source of truth. The same records can be reviewed from your laptop, phone, and Vercel deployment.</p></div></div><div className="panel danger-panel"><div><b>Clear cloud database</b><p>This removes all stored evaluations from this browser.</p></div><button className="btn danger-outline" onClick={onClear}><Trash2 size={15}/> Clear all</button></div></div>;
}
function DataCard({ icon, title, text, action, onClick }: { icon: React.ReactNode; title: string; text: string; action: string; onClick: () => void }) { return <div className="data-card"><div className="data-card-icon">{icon}</div><b>{title}</b><p>{text}</p><button onClick={onClick}>{action} →</button></div>; }

function SettingsView({ settings, setSettings, onClear, theme, setTheme, user, accent, setAccent, profile, onOpenProfile }: { settings: any; setSettings: (x: any) => void; onClear: () => void; theme: "light" | "dark"; setTheme: (x: "light" | "dark") => void; user: any; accent: "emerald" | "indigo" | "blue" | "violet" | "amber"; setAccent: (x: any) => void; profile: UserProfile | null; onOpenProfile: () => void }) {
  return <div><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Settings & Preferences</h1><p>Customize your workspace, appearance, security and cloud storage.</p></div></div><div className="panel settings-panel">
    <div className="settings-section"><div><b>Workspace profile</b><p>These labels appear across the Purchasing workspace.</p></div><Field label="Workspace name" value={settings.name} onChange={(v) => setSettings({ ...settings, name: v })}/><Field label="Office / department" value={settings.office} onChange={(v) => setSettings({ ...settings, office: v })}/></div>
    <div className="settings-section"><div><b>Appearance</b><p>Choose the display style that is most comfortable for long purchasing-office sessions.</p></div><div className="theme-toggle-card"><div><b>{theme === "dark" ? "Dark mode enabled" : "Light mode enabled"}</b><span>Switch the entire dashboard theme instantly.</span></div><button className={`switch ${theme === "dark" ? "on" : ""}`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><i/></button></div><div className="theme-buttons"><button className={`theme-choice ${theme === "light" ? "selected" : ""}`} onClick={() => setTheme("light")}>☀ <span>Light</span></button><button className={`theme-choice ${theme === "dark" ? "selected" : ""}`} onClick={() => setTheme("dark")}>☾ <span>Dark</span></button></div></div>
    <div className="settings-section"><div><b>Brand color</b><p>Pick the accent used throughout the purchasing workspace.</p></div><div className="accent-palette">{[["emerald","Emerald"],["indigo","Indigo"],["blue","Blue"],["violet","Violet"],["amber","Amber"]].map(([value,label]) => <button key={value} className={`accent-choice ${accent === value ? "selected" : ""} accent-${value}`} onClick={() => setAccent(value)}><i />{label}</button>)}</div></div>
    <div className="settings-section"><div><b>Account</b><p>Your current Firebase Authentication account.</p></div><div className="storage-callout"><ShieldCheck size={18}/><div><b>Signed in securely</b><span>{user?.email || "Firebase user"}</span></div></div><button className="btn ghost" onClick={() => signOutFirebase()}>Sign out</button></div>
    {profile && <div className="settings-section"><div><b>Profile</b><p>Keep your staff or administrator profile current.</p></div><div className="profile-mini"><div className="profile-mini-avatar">{(profile.displayName || profile.email || "U").slice(0,1).toUpperCase()}</div><div><b>{profile.displayName}</b><span>{profile.jobTitle} · {profile.role}</span></div></div><button className="btn secondary" onClick={onOpenProfile}>Open profile</button></div>}
    <div className="settings-section"><div><b>Storage</b><p>Evaluations are stored in Firebase Firestore. Excel remains available for import, export, and backup.</p></div><div className="storage-callout"><Database size={18}/><div><b>Firebase Firestore</b><span>Cloud database · shared across devices</span></div></div></div>
    <div className="settings-section"><div><b>AI scanning</b><p>For Vercel, add <code>OPENAI_API_KEY</code> as a server-side environment variable. The browser never receives the secret key.</p></div><div className="security-note"><ShieldCheck size={18}/><span>Keep API keys only in Vercel/Firebase project configuration.</span></div></div>
    <div className="settings-section danger-section"><div><b>Danger zone</b><p>Delete every evaluation from your Firebase database.</p></div><button className="btn danger-outline" onClick={onClear}><Trash2 size={15}/> Clear cloud data</button></div>
  </div></div>;
}


function roleLabel(role: string) {
  return role === "admin" ? "Administrator" : role === "viewer" ? "Viewer" : "Purchasing Staff";
}

const permissionLabels: Record<string, string> = {
  view_dashboard: "Dashboard",
  scan_forms: "Scan & AI extract",
  create_evaluations: "Create evaluations",
  edit_evaluations: "Edit evaluations",
  delete_evaluations: "Delete evaluations",
  view_suppliers: "Suppliers",
  view_reports: "Reports",
  import_excel: "Import Excel",
  export_excel: "Export Excel",
  database_management: "Database management",
  user_management: "User management",
  activity_logs: "Activity logs",
  ai_support: "AI support",
  system_settings: "System settings",
};

function ProfileView({ profile, theme, accent, onAccent, onTheme, onSave }: { profile: UserProfile; theme: "light" | "dark"; accent: string; onAccent: (x: any) => void; onTheme: (x: "light" | "dark") => void; onSave: (x: UserProfile) => Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => setDraft(profile), [profile]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  async function save() {
    setBusy(true); setNotice("");
    try { await onSave(draft); setNotice("Profile saved successfully."); }
    catch (e: any) { setNotice(e?.message || "Could not save your profile."); }
    finally { setBusy(false); }
  }
  async function reset() {
    setDraft(profile); setNotice("");
  }
  async function sendReset() {
    setResetting(true); setNotice("");
    try { await resetPassword(profile.email); setNotice("Password reset link sent to your email."); }
    catch (e: any) { setNotice(e?.message || "Could not send the reset link."); }
    finally { setResetting(false); }
  }
  const initials = (draft.displayName || draft.email || "U").split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join("").toUpperCase();
  return <div className="profile-page routelike-profile">
    <div className="profile-breadcrumb-line"><div><div className="eyebrow"><span className="eyebrow-dot"/> ACCOUNT</div><h1>My profile</h1><p>Manage how your Purchasing workspace identifies you, your account access, and visual preferences.</p></div><span className={`role-badge role-${profile.role}`}><ShieldCheck size={13}/>{roleLabel(profile.role)}</span></div>
    {notice && <div className={`profile-notice ${notice.toLowerCase().includes("could not") ? "error" : "success"}`}>{notice}</div>}
    <div className="route-profile-grid">
      <div className="route-profile-main">
        <section className="panel route-profile-card">
          <div className="route-profile-top">
            <div className="route-avatar-wrap"><div className="route-avatar" title={draft.photoURL ? "Profile photo" : "Profile initials"}>{draft.photoURL ? <img src={draft.photoURL} alt="Profile" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span>{initials}</span>}</div></div>
            <div className="route-profile-summary"><span className={`role-badge role-${draft.role}`}>{roleLabel(draft.role)}</span><h2>{draft.displayName || "Purchasing User"}</h2><p>{draft.email}</p><div className="route-summary-meta"><span>{draft.jobTitle || "Purchasing Staff"}</span><span>{draft.department || "Purchasing Office"}</span></div></div>
          </div>
          <div className="route-profile-form">
            <div className="profile-section-label">PROFILE INFORMATION</div>
            <div className="form-grid">
              <Field label="Full name" value={draft.displayName} onChange={(v) => setDraft({ ...draft, displayName: v })} placeholder="Your full name" />
              <Field label="Job title" value={draft.jobTitle} onChange={(v) => setDraft({ ...draft, jobTitle: v })} placeholder="Purchasing Staff" />
              <Field label="Department" value={draft.department} onChange={(v) => setDraft({ ...draft, department: v })} placeholder="Purchasing Office" />
              <Field label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} placeholder="Optional" />
              <div className="field"><span>Profile photo URL</span><input value={draft.photoURL || ""} onChange={(e) => setDraft({ ...draft, photoURL: e.target.value })} placeholder="https://..." /><small className="field-helper">Use a direct image URL ending in .jpg, .png, .webp, or a public image link.</small></div>
              <TextArea label="Profile note" full value={draft.bio} onChange={(v) => setDraft({ ...draft, bio: v })} placeholder="Short professional note" />
            </div>
          </div>
        </section>

        <section className="panel route-account-card">
          <div className="panel-head"><div><div className="section-kicker">ACCOUNT AND SECURITY</div><h2>Sign-in and access details</h2><p>Firebase Authentication protects your email and password. Your access level is controlled by your administrator.</p></div><ShieldCheck size={18} className="muted-icon"/></div>
          <div className="route-security-grid">
            <div className="route-security-box"><small>REGISTERED EMAIL</small><b>{draft.email}</b></div>
            <div className="route-security-box"><small>SYSTEM ACCESS</small><b>{roleLabel(draft.role)} · {draft.active ? "Active account" : "Disabled account"}</b></div>
          </div>
          <div className="route-password-row"><div><b>Password protection</b><span>Purchasing Supplier Evaluation System never stores a readable password. Request a secure reset link when you need to create a new one.</span></div><button className="btn secondary" onClick={sendReset} disabled={resetting}>{resetting ? "Sending…" : "Send reset link"}</button></div>
        </section>
      </div>

      <div className="route-profile-side">
        <section className="panel route-side-card"><div className="profile-section-label">WORKSPACE APPEARANCE</div><p className="side-helper">Choose a comfortable layout and theme for your daily Purchasing work.</p><div className="theme-toggle-large"><button className={theme === "light" ? "selected" : ""} onClick={() => onTheme("light")}>☀ Light</button><button className={theme === "dark" ? "selected" : ""} onClick={() => onTheme("dark")}>☾ Dark</button></div><div className="accent-title">Accent color</div><div className="accent-palette route-accent-palette">{[["emerald","Emerald"],["indigo","Indigo"],["blue","Blue"],["violet","Violet"],["amber","Amber"]].map(([value,label]) => <button key={value} className={`accent-choice ${accent === value ? "selected" : ""} accent-${value}`} onClick={() => onAccent(value)}><i />{label}</button>)}</div><div className="route-theme-note">Use the moon/sun button in the top bar to switch between light and dark mode.</div></section>
        <section className="panel route-side-card"><div className="profile-section-label">SYSTEM ACCESS</div><p className="side-helper">Your current permissions are controlled by your role and administrator settings.</p><div className="permission-chip-grid route-permissions">{Array.from(new Set(draft.permissions)).map((permission) => <span key={`profile-permission-${permission}`}><Check size={11}/>{permissionLabels[permission] || permission}</span>)}</div></section>
      </div>
    </div>
    <div className="profile-bottom-bar"><div><b>{dirty ? "You have unsaved changes" : "Profile is up to date"}</b><span>Future profile changes can be reviewed from the activity log.</span></div><div className="profile-bottom-actions"><button className="btn ghost" onClick={reset} disabled={!dirty || busy}>Reset</button><button className="btn primary" onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save profile"}</button></div></div>
  </div>;
}

function AccessManagement({ users, currentUser, onSave }: { users: UserProfile[]; currentUser: any; onSave: (x: UserProfile) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, UserProfile>>({});
  useEffect(() => { setDrafts(Object.fromEntries(users.map((u) => [u.uid, u]))); }, [users]);
  function update(uid: string, patch: Partial<UserProfile>) { setDrafts((d) => ({ ...d, [uid]: { ...d[uid], ...patch } })); }
  function changeRole(uid: string, role: "admin" | "staff" | "viewer") {
    const current = drafts[uid];
    if (!current) return;
    const permissions = role === "admin" ? [...ALL_ADMIN_PERMISSIONS] : role === "viewer" ? [...DEFAULT_VIEWER_PERMISSIONS] : current.permissions?.length ? current.permissions : [...DEFAULT_STAFF_PERMISSIONS];
    update(uid, { role, permissions, jobTitle: role === "admin" ? "System Administrator" : role === "viewer" ? "Viewer" : current.jobTitle || "Purchasing Staff" });
  }
  async function save(uid: string) { if (drafts[uid]) await onSave(drafts[uid]); }
  return <div className="access-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> ADMINISTRATION</div><h1>Access & Permissions</h1><p>Give each Purchasing user the access they actually need without removing useful staff tools.</p></div><div className="heading-badge"><Users size={15}/><span>{users.length} accounts</span></div></div>
    <div className="panel access-intro"><div className="access-stat"><ShieldCheck size={18}/><div><b>Permission-based access</b><span>Import and Export can remain available to staff while sensitive controls stay with administrators.</span></div></div><div className="access-stat"><KeyRound size={18}/><div><b>Three roles</b><span>Administrator, Purchasing Staff, and Viewer work as templates you can customize per person.</span></div></div></div>
    <div className="access-list">{users.map((user) => { const draft = drafts[user.uid] || user; const self = user.uid === currentUser?.uid; return <div className="panel user-access-card" key={user.uid}><div className="user-access-head"><div className="user-access-avatar">{(draft.displayName || draft.email || "U").slice(0,1).toUpperCase()}</div><div className="user-access-main"><b>{draft.displayName || "Unnamed user"} {self && <span className="self-chip">You</span>}</b><small>{draft.email}</small><span>{draft.department} · {draft.jobTitle}</span></div><select className="role-select" value={draft.role} onChange={(e) => changeRole(user.uid, e.target.value as any)} disabled={self}>{self ? <option value="admin">{roleLabel(draft.role)}</option> : <><option value="admin">Administrator</option><option value="staff">Purchasing Staff</option><option value="viewer">Viewer</option></>}</select></div><div className="permission-grid">{PERMISSIONS.map((permission) => <label key={permission} className={draft.permissions.includes(permission) ? "checked" : ""}><input type="checkbox" checked={draft.role === "admin" || draft.permissions.includes(permission)} disabled={draft.role === "admin" || (self && permission !== "ai_support")} onChange={(e) => update(user.uid, { permissions: e.target.checked ? Array.from(new Set([...draft.permissions, permission])) as Permission[] : draft.permissions.filter((p) => p !== permission) })}/><span>{permissionLabels[permission]}</span></label>)}</div><div className="user-access-footer"><span className={draft.active ? "active-label" : "inactive-label"}>{draft.active ? "● Active account" : "● Disabled account"}</span><div><button className="btn ghost" onClick={() => update(user.uid, { active: !draft.active })} disabled={self}>{draft.active ? "Disable" : "Enable"}</button><button className="btn primary" onClick={() => save(user.uid)}>Save access</button></div></div></div>; })}{!users.length && <div className="panel"><Empty text="No user profiles yet" sub="Newly authenticated users will appear here after their first login."/></div>}</div>
  </div>;
}

function AISupportDrawer({ stats, records, prompt, setPrompt, response, busy, messages, onAsk, onClose, onClear }: { stats: any; records: Evaluation[]; prompt: string; setPrompt: (x: string) => void; response: string; busy: boolean; messages: { role: "user" | "assistant"; text: string }[]; onAsk: (x: string) => void; onClose: () => void; onClear: () => void }) {
  const quick = [
    "Give me a quick health check of supplier performance.",
    "Which suppliers should Purchasing review more closely?",
    "Draft a professional remark for a 4.2 rating.",
    "Explain my current dashboard numbers.",
  ];
  const top = [...records].filter((x) => x.finalRating > 0).sort((a,b) => b.finalRating - a.finalRating).slice(0, 5);
  const submit = () => onAsk(prompt);
  return <div className="ai-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="ai-drawer">
      <div className="ai-drawer-header"><div className="ai-drawer-brand"><div className="ai-drawer-icon"><Bot size={19}/></div><div><b>Ask Supplier AI</b><span>Purchasing assistant · data-aware</span></div></div><div className="ai-drawer-actions"><button className="icon-button" title="New chat" onClick={onClear}><RefreshCw size={16}/></button><button className="icon-button" title="Close" onClick={onClose}><X size={18}/></button></div></div>
      <div className="ai-drawer-context"><div><b>{stats.total.toLocaleString()}</b><span>evaluations</span></div><div><b>{stats.supplierCount.toLocaleString()}</b><span>suppliers</span></div><div><b>{stats.avg ? stats.avg.toFixed(2) : "—"}</b><span>avg rating</span></div><div><b>{stats.strong.toLocaleString()}</b><span>strong</span></div></div>
      <div className="ai-drawer-body">
        {messages.length === 0 ? <div className="ai-welcome"><div className="ai-welcome-icon"><Sparkles size={24}/></div><h3>What can I help you with?</h3><p>Ask about supplier performance, ratings, reports, evaluation remarks, or how to use the system.</p><div className="ai-quick-list">{quick.map((q) => <button key={q} onClick={() => { setPrompt(q); onAsk(q); }}>{q}<ChevronDown size={14}/></button>)}</div></div> : <div className="ai-message-list">{messages.map((m, i) => <div key={`ai-message-${i}-${m.role}-${m.text.slice(0, 12)}`} className={`ai-message ${m.role}`}><div className="ai-message-avatar">{m.role === "assistant" ? <Bot size={14}/> : <UserCircle2 size={14}/>}</div><div className="ai-message-bubble">{m.text.split("\n").map((line,j)=><p key={`ai-line-${j}`}>{line || "\u00a0"}</p>)}</div></div>)}{busy && <div className="ai-message assistant"><div className="ai-message-avatar"><Bot size={14}/></div><div className="ai-message-bubble ai-streaming"><span/><span/><span/> Thinking…</div></div>}</div>}
      </div>
      <div className="ai-drawer-footer">
        <div className="ai-drawer-composer"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit(); }} placeholder="Message Supplier AI…"/><button className="ai-send" onClick={submit} disabled={busy || !prompt.trim()}><Send size={16}/></button></div>
        <div className="ai-drawer-hint"><span>Ctrl/⌘ + Enter to send</span><span>AI suggestions are for support and review.</span></div>
        {top.length > 0 && <div className="ai-mini-insight"><span>Top current performer</span><b>{top[0].supplier}</b><strong>{top[0].finalRating.toFixed(2)}</strong></div>}
      </div>
    </aside>
  </div>;
}

function AISupport({ stats, records, prompt, setPrompt, response, busy, onAsk }: { stats: any; records: Evaluation[]; prompt: string; setPrompt: (x: string) => void; response: string; busy: boolean; onAsk: (x: string) => void }) {
  const quick = [
    "Give me a quick health check of supplier performance.",
    "Which recent suppliers should Purchasing review more closely?",
    "Draft a professional remark for an evaluation with a 4.2 rating.",
    "Explain what the current dashboard numbers mean.",
  ];
  const top = [...records].filter((x) => x.finalRating > 0).sort((a,b) => b.finalRating - a.finalRating).slice(0, 5);
  return <div className="ai-page">
    <div className="ai-hero"><div><div className="eyebrow"><span className="eyebrow-dot"/> AI WORKSPACE</div><h1>AI Support for Purchasing</h1><p>Use your supplier data as the starting point for summaries, remarks, review ideas, and workflow help.</p><div className="ai-hero-chips"><span><Bot size={14}/> Data-aware assistant</span><span><ShieldCheck size={14}/> Server-side API key</span><span><Sparkles size={14}/> GPT-5.6 Luna</span></div></div><div className="ai-orb"><Bot size={42}/></div></div>
    <div className="ai-grid"><section className="panel ai-chat-card"><div className="panel-head"><div><div className="section-kicker">ASK THE ASSISTANT</div><h2>What do you need help with?</h2><p>The AI receives a summary of the current supplier workspace, not your API key.</p></div><MessageCircle size={20} className="muted-icon"/></div><div className="quick-prompts">{quick.map((q) => <button key={q} onClick={() => { setPrompt(q); onAsk(q); }}>{q}</button>)}</div><div className="ai-composer"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask about ratings, supplier history, reports, remarks, or how to use the system…"/><button className="btn primary" onClick={() => onAsk(prompt)} disabled={busy || !prompt.trim()}><Sparkles size={16}/>{busy ? "Thinking…" : "Ask AI"}</button></div><div className="ai-answer">{busy ? <div className="ai-thinking"><span/><span/><span/> AI is analyzing the workspace…</div> : response ? <div className="ai-response">{response.split("\n").map((line, i) => <p key={i}>{line || "\u00a0"}</p>)}</div> : <div className="ai-empty"><Bot size={26}/><b>AI support is ready</b><span>Try a quick prompt or ask your own question.</span></div>}</div></section><aside className="ai-sidebar"><div className="panel"><div className="panel-head"><div><div className="section-kicker">LIVE CONTEXT</div><h2>Workspace at a glance</h2></div></div><div className="ai-metric-list"><div><span>Total evaluations</span><b>{stats.total.toLocaleString()}</b></div><div><span>Suppliers</span><b>{stats.supplierCount.toLocaleString()}</b></div><div><span>Average rating</span><b>{stats.avg ? stats.avg.toFixed(2) : "—"}</b></div><div><span>Strongly recommended</span><b>{stats.strong.toLocaleString()}</b></div></div></div><div className="panel"><div className="panel-head"><div><div className="section-kicker">TOP RATED</div><h2>Recent strong performers</h2></div></div>{top.map((r) => <div className="ai-top-row" key={r.id}><div className="avatar">{(r.supplier || "?").slice(0,1).toUpperCase()}</div><div><b>{r.supplier || "Unknown"}</b><small>{r.evaluationDate || "No date"}</small></div><strong>{r.finalRating.toFixed(2)}</strong></div>)}</div><div className="ai-disclaimer"><ShieldCheck size={16}/><span>AI suggestions are for support and review. Authorized Purchasing personnel make the final supplier decisions.</span></div></aside></div>
  </div>;
}

function AccessDenied({ title, text }: { title: string; text: string }) { return <div className="panel access-denied"><ShieldCheck size={30}/><h2>{title}</h2><p>{text}</p><span>Ask an administrator to grant the required permission.</span></div>; }

function AuthScreen({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { if (mode === "signin") await signInWithEmail(email, password); else await registerWithEmail(email, password); onSuccess(); }
    catch (err: any) { setError(err?.message?.replace("Firebase: ", "") || "Authentication failed."); }
    finally { setBusy(false); }
  }
  async function google() { try { setBusy(true); setError(""); await signInWithGoogle(); onSuccess(); } catch (err: any) { setError(err?.message?.replace("Firebase: ", "") || "Google sign-in failed."); } finally { setBusy(false); } }
  return <div className="auth-shell"><div className="auth-visual"><div className="auth-orbit one"/><div className="auth-orbit two"/><div className="auth-brand"><div className="brand-mark logo-brand-mark"><img src="/sisc-logo.png" alt="Southville International School and Colleges" /></div><div><b>Purchasing Supplier Evaluation System</b><span>Purchasing workspace</span></div></div><div className="auth-copy"><div className="eyebrow"><span className="eyebrow-dot"/> SECURE PURCHASING WORKSPACE</div><h1>Scan. Evaluate. Decide.</h1><p>Keep supplier evaluations, AI extraction, ratings, reports and Excel backups in one secure cloud workspace.</p><div className="auth-features"><span>✓ Firebase cloud database</span><span>✓ AI document scanning</span><span>✓ Multi-device access</span></div></div></div><div className="auth-card"><div className="auth-card-top"><div className="auth-mini-mark logo-auth-mark"><img src="/sisc-logo.png" alt="Southville International School and Colleges" /></div><div><div className="eyebrow">{mode === "signin" ? "WELCOME BACK" : "NEW ACCOUNT"}</div><h2>{mode === "signin" ? "Sign in to your workspace" : "Create your account"}</h2><p>{mode === "signin" ? "Access your supplier evaluation database." : "Create a secure Purchasing Office account."}</p></div></div><button className="google-btn" onClick={google} disabled={busy}><span className="google-g">G</span> Continue with Google</button><div className="auth-divider"><span>or continue with email</span></div><form onSubmit={submit}><label className="auth-field"><span>Email</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@school.edu" required/></label><label className="auth-field"><span>Password</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 6 characters" minLength={6} required/></label>{error && <div className="auth-error"><AlertCircle size={16}/><span>{error}</span></div>}<button className="btn primary auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button></form><button className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}>{mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}</button><small className="auth-note">Your account is handled by Firebase Authentication. Passwords are never stored in the supplier evaluation database.</small></div></div>;
}

function ScanModal({ busy, error, onClose, onFile }: { busy: boolean; error: string; onClose: () => void; onFile: (file: File) => void }) {
  const uploadRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  return <div className="modal-backdrop"><div className="scan-modal"><div className="scan-head"><div><div className="scan-badge"><Sparkles size={16}/></div><div className="eyebrow"><span className="eyebrow-dot"/> AI DOCUMENT SCANNER</div><h2>Scan your supplier evaluation</h2><p>Take a picture of the paper. The AI will extract the key fields and ratings into a reviewable record.</p></div><button className="icon-button" onClick={onClose} disabled={busy}><X size={18}/></button></div>{busy ? <div className="scanner-processing"><div className="scanner-ring"><Sparkles size={28}/></div><h3>Reading your form…</h3><p>Looking for supplier details, PRF, PO, criteria scores, date and remarks.</p><div className="scan-progress"><i/></div></div> : <><div className="scan-drop" onClick={() => uploadRef.current?.click()}><div className="scan-drop-icon"><Upload size={25}/></div><b>Upload a clear scanned image</b><span>JPG, PNG, WEBP · Entire page visible is best</span><input ref={uploadRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}/></div><div className="scan-options"><button onClick={() => cameraRef.current?.click()}><Camera size={19}/><div><b>Use camera</b><span>Take a photo now</span></div></button><input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}/><button onClick={() => uploadRef.current?.click()}><FileSpreadsheet size={19}/><div><b>Choose image</b><span>Select an existing scan</span></div></button></div>{error && <div className="error-box"><AlertCircle size={17}/><span>{error}</span></div>}<div className="scan-note"><Zap size={15}/><span><b>Always review AI results.</b> Handwritten ratings, names, and dates can be misread. The record is not saved automatically until you press Save.</span></div></>}</div></div>;
}

function ScoreSummaryCard({ title, value }: { title: string; value: number }) { return <ScoreSummary title={title} value={value}/>; }
function Empty({ text, sub }: { text: string; sub: string }) { return <div className="empty"><div className="empty-icon"><Database size={22}/></div><b>{text}</b><span>{sub}</span></div>; }
