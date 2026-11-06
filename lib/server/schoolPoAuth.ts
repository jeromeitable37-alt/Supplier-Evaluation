import { createSign } from "node:crypto";

/** Server-only authentication for the school PO Drive pilot (admin-only). */
type SA = { project_id: string; client_email: string; private_key: string };
type FirebaseAccount = { localId: string; email?: string; disabled?: boolean };
export class PoDriveAuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function serviceAccount(): SA {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing.");
  const parsed = JSON.parse(raw) as SA;
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) throw new Error("Service account incomplete.");
  return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

async function firestoreToken(sa: SA): Promise<string> {
  const b64 = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const signed = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3300,
  });
  const signature = createSign("RSA-SHA256").update(signed).end()
    .sign(sa.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signed + "." + signature,
    }), cache: "no-store",
  });
  const result = await response.json() as { access_token?: string };
  if (!response.ok || !result.access_token) throw new Error("Could not authenticate Firestore service account.");
  return result.access_token;
}

/** Checks Firebase ID token AND trusted active admin role in Firestore. */
export async function requirePoDriveAdmin(request: Request): Promise<{ uid: string; email: string }> {
  const bearer = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!bearer || bearer.length < 100 || bearer.length > 10000) {
    throw new PoDriveAuthError("Sign in as an authorized Purchasing administrator.", 401);
  }
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("Firebase Auth API key is missing.");
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: bearer }), cache: "no-store" },
  );
  if (!response.ok) throw new PoDriveAuthError("Firebase session is expired or invalid.", 401);
  const result = await response.json() as { users?: FirebaseAccount[] };
  const user = result.users?.[0];
  if (!user?.localId || user.disabled) throw new PoDriveAuthError("This account is not active.", 403);
  const sa = serviceAccount();
  const token = await firestoreToken(sa);
  const url = "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(sa.project_id) + "/databases/(default)/documents/users/" +
    encodeURIComponent(user.localId);
  const saved = await fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  if (saved.status === 404) throw new PoDriveAuthError("Purchasing profile not found.", 403);
  if (!saved.ok) throw new Error("Could not verify Purchasing profile.");
  const doc = await saved.json() as { fields?: Record<string, any> };
  const profileEmail = String(doc.fields?.email?.stringValue || "").trim().toLowerCase();
  const authEmail = String(user.email || "").trim().toLowerCase();
  if (doc.fields?.active?.booleanValue !== true ||
      doc.fields?.role?.stringValue !== "admin" ||
      !authEmail || authEmail !== profileEmail) {
    throw new PoDriveAuthError("Only approved active Purchasing administrators can access PO Drive in this pilot.", 403);
  }
  return { uid: user.localId, email: authEmail };
}

export async function schoolPoWebhook(action: "upload_po" | "get_po_file", details: Record<string, unknown>) {
  const url = String(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL || "").trim();
  const secret = String(process.env.PMS_WEBHOOK_SECRET || process.env.GOOGLE_APPS_SCRIPT_SECRET || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec(?:\?.*)?$/.test(url) ||
      secret.length < 24) throw new Error("School Apps Script integration is not configured.");
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ action, secret, ...details }),
  });
  const body = await response.text();
  let result: any = null;
  try { result = JSON.parse(body); } catch {}
  if (!response.ok || !result?.ok) {
    throw new Error("School Drive webhook error: " + String(result?.message || response.status).slice(0, 180));
  }
  return result;
}
