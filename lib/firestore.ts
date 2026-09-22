import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db, storage } from "./firebase";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

export const EVALUATIONS = "evaluations";
export const PURCHASE_ORDERS = "purchaseOrders";
export const EVALUATION_LINKS = "evaluationLinks";
const SETTINGS = "workspace";
export const USERS = "users";

export type UserRole = "admin" | "staff" | "viewer";

export const PERMISSIONS = [
  "view_dashboard",
  "scan_forms",
  "create_evaluations",
  "edit_evaluations",
  "delete_evaluations",
  "view_suppliers",
  "view_reports",
  "import_excel",
  "export_excel",
  "database_management",
  "user_management",
  "activity_logs",
  "ai_support",
  "system_settings",
] as const;

export type Permission = typeof PERMISSIONS[number];

export const DEFAULT_STAFF_PERMISSIONS: Permission[] = [
  "view_dashboard",
  "scan_forms",
  "create_evaluations",
  "edit_evaluations",
  "view_suppliers",
  "view_reports",
  "import_excel",
  "export_excel",
  "ai_support",
];

export const DEFAULT_VIEWER_PERMISSIONS: Permission[] = [
  "view_dashboard",
  "view_suppliers",
  "view_reports",
  "ai_support",
];

export const ALL_ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  permissions: Permission[];
  department: string;
  jobTitle: string;
  phone: string;
  bio: string;
  photoURL?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => removeUndefined(item)) as T;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) cleaned[key] = removeUndefined(item);
    }
    return cleaned as T;
  }
  return value;
}

function requireDb() {
  if (!db) throw new Error("Firebase is not configured. Add your NEXT_PUBLIC_FIREBASE_* variables.");
  return db;
}

export async function signInToFirebase() {
  if (!auth?.currentUser) throw new Error("Please sign in first.");
  return auth.currentUser;
}

export function subscribeEvaluations(
  callback: (items: Record<string, unknown>[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const firestore = requireDb();
  const q = query(collection(firestore, EVALUATIONS));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Record<string, unknown>[]);
    },
    (error) => onError?.(error),
  );
}

export async function saveEvaluationCloud(item: Record<string, unknown>) {
  const firestore = requireDb();
  await signInToFirebase();
  await setDoc(doc(firestore, EVALUATIONS, String(item.id)), item, { merge: true });
}

export async function deleteEvaluationCloud(id: string) {
  const firestore = requireDb();
  await signInToFirebase();
  await deleteDoc(doc(firestore, EVALUATIONS, id));
}

export async function clearEvaluationsCloud(ids: string[]) {
  const firestore = requireDb();
  await signInToFirebase();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const batch = writeBatch(firestore);
    chunk.forEach((id) => batch.delete(doc(firestore, EVALUATIONS, id)));
    await batch.commit();
  }
}

export async function saveManyCloud(items: Record<string, unknown>[]) {
  const firestore = requireDb();
  await signInToFirebase();
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(firestore);
    items.slice(i, i + 400).forEach((item) => {
      batch.set(doc(firestore, EVALUATIONS, String(item.id)), item, { merge: true });
    });
    await batch.commit();
  }
}

export async function getWorkspaceSettings() {
  const firestore = requireDb();
  await signInToFirebase();
  const rows = await getDocs(collection(firestore, SETTINGS));
  const workspace = rows.docs.find((x) => x.id === "profile");
  return workspace?.data() ?? null;
}

export async function saveWorkspaceSettings(settings: Record<string, unknown>) {
  const firestore = requireDb();
  await signInToFirebase();
  await setDoc(doc(firestore, SETTINGS, "profile"), settings, { merge: true });
}

export async function clearWorkspaceSettings() {
  const firestore = requireDb();
  await signInToFirebase();
  await deleteDoc(doc(firestore, SETTINGS, "profile"));
}

export async function ensureSeedData() {
  const firestore = requireDb();
  await signInToFirebase();
  const metaRef = doc(firestore, "workspace", "seed");
  const meta = await getDoc(metaRef);
  if (meta.exists() && meta.data()?.version === 1) return false;

  const response = await fetch("/seed-records.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the historical Excel seed data.");
  const seed = (await response.json()) as Record<string, unknown>[];

  for (let i = 0; i < seed.length; i += 400) {
    const batch = writeBatch(firestore);
    seed.slice(i, i + 400).forEach((item, offset) => {
      const id = `seed-${i + offset + 1}`;
      const row = {
        ...item,
        id,
        source: item.source || "Imported workbook",
        createdAt: item.createdAt || `${String(item.evaluationDate || "2026-01-01")}T08:00:00.000Z`,
      };
      batch.set(doc(firestore, EVALUATIONS, id), row, { merge: true });
    });
    await batch.commit();
  }

  await setDoc(metaRef, { version: 1, seededCount: seed.length, seededAt: new Date().toISOString() }, { merge: true });
  return true;
}

function defaultProfile(user: any): UserProfile {
  const displayName = String(user?.displayName || user?.email?.split("@")[0] || "Purchasing User").trim();
  const email = String(user?.email || "").trim();
  const now = new Date().toISOString();
  return {
    uid: String(user?.uid || ""),
    email,
    displayName,
    role: "staff",
    permissions: [...DEFAULT_STAFF_PERMISSIONS],
    department: "Purchasing Office",
    jobTitle: "Purchasing Staff",
    phone: "",
    bio: "",
    photoURL: String(user?.photoURL || ""),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizePermissions(value: unknown, fallback: Permission[] = DEFAULT_STAFF_PERMISSIONS): Permission[] {
  if (!Array.isArray(value)) return [...fallback];
  const allowed = new Set<string>(PERMISSIONS);
  return Array.from(new Set(value.filter((p): p is string => typeof p === "string" && allowed.has(p)))) as Permission[];
}

function normalizeProfile(user: any, data?: Partial<UserProfile>): UserProfile {
  const base = defaultProfile(user);
  const merged = { ...base, ...(data || {}) } as UserProfile;
  const role = merged.role === "admin" || merged.role === "viewer" || merged.role === "staff" ? merged.role : "staff";
  const fallback = role === "admin" ? ALL_ADMIN_PERMISSIONS : role === "viewer" ? DEFAULT_VIEWER_PERMISSIONS : DEFAULT_STAFF_PERMISSIONS;
  return {
    ...merged,
    uid: String(user?.uid || merged.uid || ""),
    email: String(user?.email || merged.email || "").trim(),
    displayName: String(merged.displayName || user?.displayName || user?.email?.split("@")[0] || "Purchasing User").trim(),
    role,
    permissions: sanitizePermissions(merged.permissions, fallback),
    department: String(merged.department || "Purchasing Office"),
    jobTitle: String(merged.jobTitle || (role === "admin" ? "System Administrator" : role === "viewer" ? "Viewer" : "Purchasing Staff")),
    phone: String(merged.phone || ""),
    bio: String(merged.bio || ""),
    photoURL: String(merged.photoURL || user?.photoURL || ""),
    active: merged.active !== false,
    createdAt: String(merged.createdAt || base.createdAt),
    updatedAt: String(merged.updatedAt || new Date().toISOString()),
  };
}

export async function getUserProfile(uid?: string) {
  const firestore = requireDb();
  const user = await signInToFirebase();
  const id = uid || user.uid;
  if (!id) throw new Error("Please sign in first.");
  const snap = await getDoc(doc(firestore, USERS, id));
  return snap.exists() ? normalizeProfile(user, snap.data() as Partial<UserProfile>) : null;
}

export async function ensureUserProfile(): Promise<UserProfile> {
  const firestore = requireDb();
  const user = await signInToFirebase();
  const ref = doc(firestore, USERS, user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const fresh = defaultProfile(user);
    await setDoc(ref, fresh, { merge: false });
    return fresh;
  }

  const current = snap.data() as Partial<UserProfile>;
  const merged = normalizeProfile(user, current);
  const needsRepair =
    !current.email || !current.displayName || !current.department || !current.jobTitle ||
    !current.updatedAt || !Array.isArray(current.permissions) || !current.role;

  if (needsRepair) {
    await setDoc(ref, merged, { merge: true });
  }

  return merged;
}

export async function saveUserProfile(profile: Partial<UserProfile> & { uid: string }) {
  const firestore = requireDb();
  const current = await signInToFirebase();
  if (profile.uid !== current.uid) throw new Error("You can only update your own profile from this screen.");

  // Do not allow a user's own profile form to change their role, permissions, status, or email.
  const existing = await getDoc(doc(firestore, USERS, current.uid));
  const currentProfile = normalizeProfile(current, existing.exists() ? existing.data() as Partial<UserProfile> : undefined);

  await setDoc(doc(firestore, USERS, current.uid), {
    uid: current.uid,
    email: currentProfile.email,
    displayName: String(profile.displayName ?? currentProfile.displayName),
    department: String(profile.department ?? currentProfile.department),
    jobTitle: String(profile.jobTitle ?? currentProfile.jobTitle),
    phone: String(profile.phone ?? currentProfile.phone),
    bio: String(profile.bio ?? currentProfile.bio),
    photoURL: String(profile.photoURL ?? currentProfile.photoURL ?? ""),
    role: currentProfile.role,
    permissions: currentProfile.permissions,
    active: currentProfile.active,
    createdAt: currentProfile.createdAt,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export function subscribeUserProfiles(callback: (items: UserProfile[]) => void, onError?: (error: Error) => void): Unsubscribe {
  const firestore = requireDb();
  return onSnapshot(
    query(collection(firestore, USERS)),
    (snapshot) => {
      const unique = new Map<string, UserProfile>();
      snapshot.docs.forEach((item) => {
        const raw = item.data() as Partial<UserProfile>;
        const uid = String(raw.uid || item.id);
        if (!uid) return;
        const normalized: UserProfile = {
          uid,
          email: String(raw.email || ""),
          displayName: String(raw.displayName || "Purchasing User"),
          role: raw.role === "admin" || raw.role === "viewer" || raw.role === "staff" ? raw.role : "staff",
          permissions: sanitizePermissions(raw.permissions, raw.role === "admin" ? ALL_ADMIN_PERMISSIONS : raw.role === "viewer" ? DEFAULT_VIEWER_PERMISSIONS : DEFAULT_STAFF_PERMISSIONS),
          department: String(raw.department || "Purchasing Office"),
          jobTitle: String(raw.jobTitle || "Purchasing Staff"),
          phone: String(raw.phone || ""),
          bio: String(raw.bio || ""),
          photoURL: String(raw.photoURL || ""),
          active: raw.active !== false,
          createdAt: String(raw.createdAt || ""),
          updatedAt: String(raw.updatedAt || ""),
        };
        unique.set(uid, normalized);
      });
      callback(Array.from(unique.values()));
    },
    (error) => onError?.(error),
  );
}

export async function updateManagedUser(profile: UserProfile) {
  const firestore = requireDb();
  const current = await signInToFirebase();
  if (!current.uid) throw new Error("Please sign in first.");
  if (profile.uid === current.uid) throw new Error("Your own role and account status should be managed separately.");

  const role: UserRole = profile.role === "admin" || profile.role === "viewer" || profile.role === "staff" ? profile.role : "staff";
  const permissions = role === "admin" ? [...ALL_ADMIN_PERMISSIONS] : sanitizePermissions(profile.permissions, role === "viewer" ? DEFAULT_VIEWER_PERMISSIONS : DEFAULT_STAFF_PERMISSIONS);
  await setDoc(doc(firestore, USERS, profile.uid), {
    ...profile,
    role,
    permissions,
    active: profile.active !== false,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}


export type PurchaseOrderLine = {
  line: number;
  description: string;
  unit: string;
  qty: number | string;
  unitPrice: number | string;
  itemDiscountPct: number | string;
  lineTotal: number | string;
};

export type PurchaseOrderDocument = {
  url: string;
  publicId?: string;
  resourceType?: string;
  format?: string;
  name: string;
  mimeType?: string;
  size?: number;
  pages?: number;
};

export type PurchaseOrder = {
  id: string;
  poNumber: string;
  prfNumber: string;
  requisitioner: string;
  requisitionerEmail?: string;
  department: string;
  purpose: string;
  vendorName: string;
  vendorAttention: string;
  vendorPhone: string;
  vendorEmail: string;
  vendorAddress: string;
  vendorCity: string;
  deliveryAddress: string;
  orderDate: string;
  expectedDate: string;
  paymentTerms: string;
  notes: string;
  subtotal: number;
  discountPct: number;
  discountAmt: number;
  total: number;
  buyerName: string;
  buyerEmail: string;
  approverName: string;
  status: string;
  actualDeliveryDate: string;
  receivedBy: string;
  deliveryLeadTimeDays?: number;
  pricingSource?: "spreadsheet" | "uploaded-po" | "manual" | "mixed";
  createdAt: string;
  source: string;
  items: PurchaseOrderLine[];
  documentUrl?: string;
  documentPath?: string;
  documentName?: string;
  documentMimeType?: string;
  documentSize?: number;
  documentUploadedAt?: string;
  documentUploadedBy?: string;
  documentSource?: string;
  documentProvider?: "cloudinary" | "firebase";
  documentPages?: PurchaseOrderDocument[];
};

export type EvaluationRole = "requisitioner" | "amd_personnel" | "purchaser";

export type EvaluationContactRole = EvaluationRole;

export type EvaluationContact = {
  id: string;
  name: string;
  email: string;
  roles: EvaluationContactRole[];
  department?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

export const EVALUATION_CONTACTS = "evaluationContacts";

function contactDocId(name: string) {
  const normalized = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "contact";
  return `${slug}-${Math.abs(hash).toString(36)}`;
}

export type PublicEvaluationLink = {
  token: string;
  status: "pending" | "submitted";
  po: PurchaseOrder;
  workspaceName: string;
  requisitionerName: string;
  requisitionerEmail: string;
  evaluatorRole?: EvaluationRole;
  evaluatorName?: string;
  evaluatorEmail?: string;
  amdName?: string;
  amdEmail?: string;
  buyerName?: string;
  buyerEmail?: string;
  createdAt: string;
  submittedAt?: string;
};

export function subscribePurchaseOrders(callback: (items: PurchaseOrder[]) => void, onError?: (error: Error) => void): Unsubscribe {
  const firestore = requireDb();
  return onSnapshot(
    query(collection(firestore, PURCHASE_ORDERS)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as PurchaseOrder[]),
    (error) => onError?.(error),
  );
}

export async function savePurchaseOrderCloud(item: PurchaseOrder) {
  const firestore = requireDb();
  await signInToFirebase();
  const safePurchaseOrder = removeUndefined(item);
  await setDoc(doc(firestore, PURCHASE_ORDERS, String(item.id)), safePurchaseOrder, { merge: true });
}

export async function getPurchaseOrderCloud(id: string): Promise<PurchaseOrder | null> {
  const firestore = requireDb();
  await signInToFirebase();
  const snap = await getDoc(doc(firestore, PURCHASE_ORDERS, String(id)));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as PurchaseOrder) : null;
}

export async function uploadPurchaseOrderDocumentCloud(input: {
  po: PurchaseOrder;
  file: File;
  uploadedBy?: string;
}) {
  const firestore = requireDb();
  if (!storage) throw new Error("Firebase Storage is not configured. Check NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.");
  await signInToFirebase();
  if (!input.file) throw new Error("Please choose a PO document first.");
  if (input.file.size > 12 * 1024 * 1024) throw new Error("PO document is too large. Maximum size is 12 MB.");
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "official-po";
  const folder = String(input.po.poNumber || input.po.id || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `purchase-orders/${folder}/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, input.file, { contentType: input.file.type || undefined });
  const url = await getDownloadURL(fileRef);
  const metadata = {
    documentUrl: url,
    documentPath: path,
    documentName: input.file.name,
    documentMimeType: input.file.type || "application/octet-stream",
    documentSize: input.file.size,
    documentUploadedAt: new Date().toISOString(),
    documentUploadedBy: input.uploadedBy || auth?.currentUser?.email || "",
    documentSource: "uploaded-official-po",
  };
  await setDoc(doc(firestore, PURCHASE_ORDERS, String(input.po.id)), removeUndefined(metadata), { merge: true });
  return metadata;
}

export function subscribePurchaseOrderEvaluations(callback: (items: Record<string, unknown>[]) => void, onError?: (error: Error) => void): Unsubscribe {
  const firestore = requireDb();
  return onSnapshot(
    query(collection(firestore, EVALUATIONS)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Record<string, unknown>[]),
    (error) => onError?.(error),
  );
}

export function subscribeEvaluationLinks(callback: (items: PublicEvaluationLink[]) => void, onError?: (error: Error) => void): Unsubscribe {
  const firestore = requireDb();
  return onSnapshot(
    query(collection(firestore, EVALUATION_LINKS)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ token: item.id, ...item.data() })) as PublicEvaluationLink[]),
    (error) => onError?.(error),
  );
}

export async function updateEvaluationLinkPOCloud(token: string, po: PurchaseOrder) {
  const firestore = requireDb();
  await signInToFirebase();
  await setDoc(doc(firestore, EVALUATION_LINKS, token), removeUndefined({ po }), { merge: true });
}

export async function createEvaluationLinkCloud(input: {
  po: PurchaseOrder;
  requisitionerEmail?: string;
  requisitionerName?: string;
  evaluatorRole?: EvaluationRole;
  evaluatorName?: string;
  evaluatorEmail?: string;
  amdName?: string;
  amdEmail?: string;
  createdBy?: string;
  workspaceName?: string;
}) {
  const firestore = requireDb();
  await signInToFirebase();
  const token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, "").slice(0, 32);
  const workspaceName = input.workspaceName || "Southville International School and Colleges";
  const role: EvaluationRole = input.evaluatorRole === "amd_personnel" ? "amd_personnel" : input.evaluatorRole === "purchaser" ? "purchaser" : "requisitioner";
  const evaluatorName = input.evaluatorName || (role === "amd_personnel" ? input.po.receivedBy : role === "purchaser" ? input.po.buyerName : (input.requisitionerName || input.po.requisitioner)) || (role === "amd_personnel" ? "AMD Personnel" : role === "purchaser" ? "Purchasing / Buyer" : "Requisitioner");
  const evaluatorEmail = input.evaluatorEmail || (role === "amd_personnel" ? input.amdEmail : role === "purchaser" ? input.po.buyerEmail : input.requisitionerEmail) || "";
  const link: PublicEvaluationLink = {
    token,
    status: "pending",
    po: input.po,
    workspaceName,
    requisitionerName: input.requisitionerName || input.po.requisitioner || "Requisitioner",
    requisitionerEmail: input.requisitionerEmail || input.po.requisitionerEmail || "",
    evaluatorRole: role,
    evaluatorName,
    evaluatorEmail,
    amdName: input.amdName || (role === "amd_personnel" ? evaluatorName : input.po.receivedBy || ""),
    amdEmail: input.amdEmail || (role === "amd_personnel" ? evaluatorEmail : ""),
    buyerName: input.po.buyerName || (role === "purchaser" ? evaluatorName : ""),
    buyerEmail: input.po.buyerEmail || (role === "purchaser" ? evaluatorEmail : ""),
    createdAt: new Date().toISOString(),
  };
  const payload = removeUndefined({
    ...link,
    createdBy: input.createdBy || "",
    evaluationId: `public-${token}`,
  });
  await setDoc(doc(firestore, EVALUATION_LINKS, token), payload);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { token, url: `${origin}/evaluate/${token}`, record: link };
}

export async function getPublicEvaluationLink(token: string): Promise<PublicEvaluationLink | null> {
  const firestore = requireDb();
  const snap = await getDoc(doc(firestore, EVALUATION_LINKS, token));
  if (!snap.exists()) return null;
  const data = snap.data() as PublicEvaluationLink;
  return { ...data, token };
}

export function subscribeEvaluationContacts(callback: (items: EvaluationContact[]) => void, onError?: (error: Error) => void): Unsubscribe {
  const firestore = requireDb();
  return onSnapshot(
    query(collection(firestore, EVALUATION_CONTACTS)),
    (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as EvaluationContact);
      items.sort((a, b) => a.name.localeCompare(b.name));
      callback(items);
    },
    (error) => onError?.(error),
  );
}

export async function upsertEvaluationContactCloud(input: {
  name: string;
  email: string;
  roles: EvaluationContactRole[];
  department?: string;
  notes?: string;
  createdBy?: string;
  replaceRoles?: boolean;
}) {
  const firestore = requireDb();
  await signInToFirebase();
  const cleanName = String(input.name || "").trim();
  const cleanEmail = String(input.email || "").trim().toLowerCase();
  const validRoles = Array.from(new Set((input.roles || []).filter((role): role is EvaluationContactRole =>
    role === "purchaser" || role === "requisitioner" || role === "amd_personnel"
  )));
  if (!cleanName) throw new Error("Contact name is required.");
  if (!cleanEmail.includes("@")) throw new Error("A valid email address is required.");
  if (!validRoles.length) throw new Error("Select at least one evaluator role.");

  const id = contactDocId(cleanName);
  const ref = doc(firestore, EVALUATION_CONTACTS, id);
  const existing = await getDoc(ref);
  const current = existing.exists() ? existing.data() as Partial<EvaluationContact> : {};
  const roles = input.replaceRoles ? validRoles : Array.from(new Set([...(current.roles || []), ...validRoles]));
  const now = new Date().toISOString();
  const payload: EvaluationContact = {
    id,
    name: cleanName,
    email: cleanEmail,
    roles,
    department: input.department || current.department || "",
    notes: input.notes ?? current.notes ?? "",
    createdAt: String(current.createdAt || now),
    updatedAt: now,
    createdBy: input.createdBy || String(current.createdBy || ""),
  };
  await setDoc(ref, removeUndefined(payload), { merge: true });
  return payload;
}

export async function deleteEvaluationContactCloud(id: string) {
  const firestore = requireDb();
  await signInToFirebase();
  await deleteDoc(doc(firestore, EVALUATION_CONTACTS, String(id)));
}

export async function createPublicRequisitionerEvaluation(input: {
  token: string;
  link: PublicEvaluationLink;
  scores: Record<string, number>;
  comments: string;
  overall: number;
}) {
  const firestore = requireDb();
  const role: EvaluationRole =
    input.link.evaluatorRole === "purchaser"
      ? "purchaser"
      : input.link.evaluatorRole === "amd_personnel"
        ? "amd_personnel"
        : "requisitioner";
  const evaluationId = `public-${input.token}`;
  const submittedAt = new Date().toISOString();
  const fourScores = [
    input.scores.accurate_delivery || null,
    input.scores.competitive_price || null,
    input.scores.timeliness || null,
    input.scores.after_sales || null,
  ];
  const purchasingScores = [
    input.scores.accurate_delivery || null,
    input.scores.competitive_price || null,
    input.scores.timeliness || null,
    input.scores.after_sales || null,
    input.scores.compliance || null,
  ];
  const row: Record<string, unknown> = {
    id: evaluationId,
    prfNo: input.link.po.prfNumber || "",
    poNumber: input.link.po.poNumber || "",
    itemsDelivered: input.link.po.items.map((item) => `${item.qty || ""} ${item.unit || ""} ${item.description || ""}`.trim()).filter(Boolean).join("; "),
    evaluationDate: submittedAt.slice(0, 10),
    supplier: input.link.po.vendorName || "",
    address: input.link.po.deliveryAddress || "",
    remarks: input.comments || "",
    purchasing: role === "purchaser" ? purchasingScores : [null, null, null, null, null],
    requisitioner: role === "requisitioner" ? fourScores : [null, null, null, null],
    amd: role === "amd_personnel" ? fourScores : [null, null, null, null],
    purchasingAvg: role === "purchaser" ? input.overall : 0,
    requisitionerAvg: role === "requisitioner" ? input.overall : 0,
    amdAvg: role === "amd_personnel" ? input.overall : 0,
    finalRating: input.overall,
    recommendation: input.overall >= 4.5 ? "Strongly Recommended" : input.overall >= 4 ? "Recommended" : input.overall >= 3.5 ? "Acceptable" : input.overall >= 3 ? "Acceptable w/ some Reservation" : "Not Recommended",
    createdAt: submittedAt,
    source: role === "purchaser" ? "Purchasing web evaluation" : role === "amd_personnel" ? "AMD Personnel web evaluation" : "Requisitioner web evaluation",
    publicToken: input.token,
    evaluatorRole: role,
    evaluatorName: input.link.evaluatorName || (role === "purchaser" ? input.link.po.buyerName : role === "amd_personnel" ? input.link.po.receivedBy : input.link.po.requisitioner) || "",
    evaluatorEmail: input.link.evaluatorEmail || (role === "purchaser" ? input.link.po.buyerEmail : role === "amd_personnel" ? input.link.amdEmail : input.link.requisitionerEmail) || "",
    submittedAt,
    evaluationLinkId: input.token,
  };
  const calculateLeadTimeDays = (orderDate?: string, actualDeliveryDate?: string) => {
    if (!orderDate || !actualDeliveryDate) return null;
    const start = new Date(orderDate);
    const end = new Date(actualDeliveryDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  };
  const deliveryLeadTimeDays = input.link.po.deliveryLeadTimeDays ?? calculateLeadTimeDays(input.link.po.orderDate, input.link.po.actualDeliveryDate);

  row.orderDate = input.link.po.orderDate || "";
  row.expectedDeliveryDate = input.link.po.expectedDate || "";
  row.actualDeliveryDate = input.link.po.actualDeliveryDate || "";
  row.deliveryLeadTimeDays = deliveryLeadTimeDays;

  const safeRow = removeUndefined(row);
  await setDoc(doc(firestore, EVALUATIONS, evaluationId), safeRow, { merge: false });
  await setDoc(doc(firestore, EVALUATION_LINKS, input.token), removeUndefined({ status: "submitted", submittedAt, evaluationId }), { merge: true });
  return { ok: true, evaluationId, submittedAt };
}
