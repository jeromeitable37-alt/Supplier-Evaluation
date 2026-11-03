import { createSign } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel invokes this endpoint daily at 00:00 UTC = 08:00 Asia/Manila.
// In Vercel Hobby, invocation can occur anywhere within that hour.
type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};
type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};
type FirestoreDocument = {
  name: string;
  updateTime: string;
  fields?: Record<string, FirestoreValue>;
};
type EvaluationLink = Record<string, any>;

function decode(value: FirestoreValue | undefined): any {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  if (value.mapValue) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]),
  );
  return null;
}

function fieldsToObject(fields: Record<string, FirestoreValue> | undefined): EvaluationLink {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

function encodeField(value: string | number): FirestoreValue {
  return typeof value === "number"
    ? { integerValue: String(Math.trunc(value)) }
    : { stringValue: value };
}

function getCredentials(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON in Vercel.");
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain project_id, client_email and private_key.");
  }
  return {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

async function googleAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const payload = b64({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3500,
  });
  const unsigned = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + "." + signer.sign(account.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error("Google service account auth failed: " + (data.error_description || response.status));
  }
  return data.access_token;
}

function baseURL(projectId: string) {
  return "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) + "/databases/(default)/documents";
}

async function firestoreRequest(url: string, accessToken: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
}

async function listEvaluationLinks(projectId: string, accessToken: string): Promise<FirestoreDocument[]> {
  const result: FirestoreDocument[] = [];
  let pageToken = "";
  do {
    const url = new URL(baseURL(projectId) + "/evaluationLinks");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await firestoreRequest(url.toString(), accessToken);
    if (!response.ok) throw new Error("Cannot read evaluationLinks in Firestore (HTTP " + response.status + ").");
    const page = await response.json() as { documents?: FirestoreDocument[]; nextPageToken?: string };
    result.push(...(page.documents || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return result;
}

async function submittedEvaluationExists(
  projectId: string, accessToken: string, token: string,
): Promise<boolean> {
  const response = await firestoreRequest(
    baseURL(projectId) + "/evaluations/public-" + encodeURIComponent(token),
    accessToken,
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("Cannot verify submitted evaluation (HTTP " + response.status + ").");
  return true;
}

async function patchDocument(
  doc: FirestoreDocument,
  accessToken: string,
  changes: Record<string, string | number>,
  preconditionUpdateTime?: string,
) {
  const url = new URL("https://firestore.googleapis.com/v1/" + doc.name);
  for (const key of Object.keys(changes)) url.searchParams.append("updateMask.fieldPaths", key);
  if (preconditionUpdateTime) url.searchParams.set("currentDocument.updateTime", preconditionUpdateTime);
  const fields = Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [key, encodeField(value)]),
  );
  const response = await firestoreRequest(url.toString(), accessToken, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("Firestore update failed (HTTP " + response.status + "): " + text.slice(0, 250));
  }
  return response.json() as Promise<FirestoreDocument>;
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const escapes: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return escapes[char];
  });
}
function manilaDay(date: Date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function dateInManilaDay(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : manilaDay(date);
}
function roleName(role: string) {
  if (role === "purchaser") return "Purchasing / Buyer";
  if (role === "amd_personnel") return "AMD Personnel";
  return "Requisitioner";
}

async function sendViaAppsScript(input: {
  to: string; subject: string; text: string; html: string;
  attachments: { url: string; name: string; mimeType?: string }[];
}) {
  const url = process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL;
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
  if (!url || !secret) throw new Error("Google Apps Script email variables are missing.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      secret,
      to: input.to,
      subject: input.subject,
      textBody: input.text,
      htmlBody: input.html,
      senderName: "Southville Supplier Evaluation",
      attachments: input.attachments,
    }),
    cache: "no-store",
  });
  const raw = await response.text();
  let data: { ok?: boolean; message?: string } = {};
  try { data = JSON.parse(raw); } catch { /* Not valid Apps Script JSON */ }
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Email provider failed (HTTP " + response.status + ").");
  }
}

async function sendPendingLinkEmail(
  link: EvaluationLink, token: string, origin: string, isReminder: boolean,
) {
  const recipient = String(link.evaluatorEmail || "").trim().toLowerCase();
  if (!isEmail(recipient)) throw new Error("No valid evaluator email address.");
  const po = link.po || {};
  const poNumber = String(po.poNumber || "").trim();
  if (!poNumber) throw new Error("Missing Purchase Order number.");
  const rawDocuments = Array.isArray(po.documentPages) && po.documentPages.length
    ? po.documentPages
    : [{ url: po.documentUrl, name: po.documentName || poNumber + ".pdf", mimeType: po.documentMimeType }];
  const attachments: { url: string; name: string; mimeType?: string }[] = rawDocuments
    .filter((item: any) => {
      try { return new URL(String(item?.url || "")).protocol === "https:"; }
      catch { return false; }
    })
    .map((item: any) => ({
      url: String(item.url),
      name: String(item.name || poNumber + ".pdf").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-160),
      mimeType: item.mimeType ? String(item.mimeType) : undefined,
    }));
  if (!attachments.length) throw new Error("No stored official PO document.");
  const role = roleName(String(link.evaluatorRole || "requisitioner"));
  const name = String(link.evaluatorName || "Evaluator");
  const evalUrl = origin.replace(/\/$/, "") + "/evaluate/" + encodeURIComponent(token);
  const title = (isReminder ? "Reminder: " : "") + role + " Supplier Evaluation";
  const subject = (isReminder ? "Reminder | " : "") + "Supplier Evaluation Request | PO " + poNumber.replace(/[\r\n]/g, " ") + " | " + role;
  const greeting = isReminder
    ? "This is a friendly reminder to complete your pending supplier evaluation."
    : "Please review the official Purchase Order and complete your supplier evaluation.";
  const text = "Hello " + name + ",\n\n" + greeting +
    "\n\nPurchase Order: " + poNumber + "\nSupplier: " + String(po.vendorName || "—") +
    "\n\nOpen and complete evaluation: " + evalUrl +
    "\n\nThe official Purchase Order is attached. This email stops after your evaluation is submitted.";
  const html = '<!doctype html><html><body style="background:#f5f4f9;padding:24px;font-family:Arial,sans-serif;color:#20202b">' +
    '<div style="max-width:640px;margin:auto;background:white;border:1px solid #e5e5eb;border-radius:14px;overflow:hidden">' +
    '<div style="background:#4f247c;color:white;padding:24px;font-size:20px;font-weight:700">' + escapeHtml(title) + '</div>' +
    '<div style="padding:26px"><p>Hello <strong>' + escapeHtml(name) + '</strong>,</p><p>' + escapeHtml(greeting) + '</p>' +
    '<p><strong>PO Number:</strong> ' + escapeHtml(poNumber) + '<br><strong>Supplier:</strong> ' + escapeHtml(po.vendorName || "—") + '</p>' +
    '<p style="margin:26px 0"><a style="padding:12px 20px;background:#287849;border-radius:8px;color:white;text-decoration:none;font-weight:700" href="' +
    escapeHtml(evalUrl) + '">Open PO &amp; Complete Evaluation</a></p>' +
    '<p style="color:#697284;font-size:12px">The official PO is attached. Reminders stop after you submit the form. This evaluation link is unique to the recipient.</p>' +
    '</div></div></body></html>';
  await sendViaAppsScript({ to: recipient, subject, html, text, attachments });
  return recipient;
}

export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // Fail closed until the production email sender and server credentials are configured.
  if (!process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL || !process.env.GOOGLE_APPS_SCRIPT_SECRET) {
    return NextResponse.json({ ok: false, error: "Google Apps Script email variables are missing." }, { status: 503 });
  }

  try {
    const account = getCredentials();
    const accessToken = await googleAccessToken(account);
    const allDocs = await listEvaluationLinks(account.project_id, accessToken);
    const records = allDocs.map((doc) => ({ doc, link: fieldsToObject(doc.fields) }));
    const roleKey = (link: EvaluationLink) =>
      String(link.po?.poNumber || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") +
      "::" + String(link.evaluatorRole || "requisitioner");
    const completedRoles = new Set(
      records.filter(({ link }) => link.status === "submitted").map(({ link }) => roleKey(link)),
    );
    const day = manilaDay(new Date());
    // A duplicate pending link must not trigger another email if the same role was emailed today.
    const emailedTodayRoles = new Set(records
      .filter(({ link }) => link.lastReminderAttemptDay === day ||
        dateInManilaDay(link.lastEmailSentAt || link.emailSentAt) === day)
      .map(({ link }) => roleKey(link)));
    const pending = records
      .filter(({ link }) =>
        link.status === "pending" &&
        !completedRoles.has(roleKey(link)) &&
        !emailedTodayRoles.has(roleKey(link)) &&
        link.remindersEnabled !== false &&
        link.lastReminderAttemptDay !== day &&
        dateInManilaDay(link.lastEmailSentAt || link.emailSentAt) !== day &&
        isEmail(link.evaluatorEmail) &&
        Boolean(link.po?.poNumber) &&
        Boolean(link.po?.documentUrl || link.po?.documentPages?.length),
      )
      .sort((a, b) => String(a.link.lastEmailSentAt || a.link.createdAt || "").localeCompare(
        String(b.link.lastEmailSentAt || b.link.createdAt || ""),
      ));

    // One email per PO and evaluator role, even if older records contain duplicate pending links.
    const seenRoles = new Set<string>();
    const uniquePending = pending.filter(({ link }) => {
      const key = roleKey(link);
      if (seenRoles.has(key)) return false;
      seenRoles.add(key);
      return true;
    });
    const rawLimit = Number(process.env.MAX_DAILY_EVALUATION_EMAILS || 100);
    const maxDaily = Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, Math.trunc(rawLimit))) : 100;
    const queue = uniquePending.slice(0, maxDaily);
    const stats = { checked: allDocs.length, pending: uniquePending.length, attempted: 0, sent: 0, skipped: 0, failed: 0 };
    const failures: string[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        const link = item.link;
        const token = item.doc.name.split("/").pop() || "";
        if (!token) { stats.skipped++; continue; }
        let claimed: FirestoreDocument | null = null;
        try {
          if (await submittedEvaluationExists(account.project_id, accessToken, token)) {
            stats.skipped++;
            continue;
          }
          // Atomic, updateTime-guarded claim prevents duplicate emails from overlapping cron runs.
          claimed = await patchDocument(item.doc, accessToken, { lastReminderAttemptDay: day }, item.doc.updateTime);
          stats.attempted++;
          const isReminder = Boolean(link.emailSentAt);
          const recipient = await sendPendingLinkEmail(link, token, new URL(request.url).origin, isReminder);
          const now = new Date().toISOString();
          const changes: Record<string, string | number> = {
            lastEmailSentAt: now,
            lastEmailRecipient: recipient,
            lastReminderAt: now,
            emailSendStatus: "sent",
            reminderCount: Number(link.reminderCount || 0) + (isReminder ? 1 : 0),
            lastReminderError: "",
          };
          if (!isReminder) changes.emailSentAt = now;
          await patchDocument(claimed, accessToken, changes);
          stats.sent++;
        } catch (error) {
          stats.failed++;
          const message = error instanceof Error ? error.message : String(error);
          // Do not expose recipient emails or evaluation access tokens in public logs.
          failures.push("PO " + String(link.po?.poNumber || "unknown") + ": " + message.slice(0, 180));
          try {
            // Only the worker that claimed this link can write its failure detail.
            if (!claimed) continue;
            const recent = await firestoreRequest("https://firestore.googleapis.com/v1/" + item.doc.name, accessToken);
            if (recent.ok) {
              const latest = await recent.json() as FirestoreDocument;
              if (fieldsToObject(latest.fields).lastReminderAttemptDay === day) {
                await patchDocument(latest, accessToken, { lastReminderError: message.slice(0, 250) }, latest.updateTime);
              }
            }
          } catch { /* Preserve the original send error */ }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(queue.length, 4) }, () => worker()));
    return NextResponse.json({ ok: true, runDay: day, ...stats, deferred: uniquePending.length - queue.length, errors: failures.slice(0, 12) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Daily email job failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
