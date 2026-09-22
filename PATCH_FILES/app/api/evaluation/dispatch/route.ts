import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EvaluationRole = "purchaser" | "requisitioner" | "amd";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function normalizeName(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function roleLabel(role: EvaluationRole) {
  if (role === "purchaser") return "Purchasing / Buyer";
  if (role === "amd") return "AMD Personnel";
  return "Requisitioner";
}

function appUrl() {
  return text(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
}

async function findCollectionEmail(collectionName: string, wantedName: string) {
  const target = normalizeName(wantedName);
  if (!target) return "";
  try {
    const snap = await adminDb.collection(collectionName).get();
    const match = snap.docs.find((doc) => {
      const row = doc.data() as any;
      return normalizeName(row.name || row.fullName || row.displayName) === target;
    });
    if (!match) return "";
    const row = match.data() as any;
    const found = normalizeEmail(row.email || row.workEmail || row.emailAddress);
    return found.includes("@") ? found : "";
  } catch {
    return "";
  }
}

async function resolveRecipient(
  role: EvaluationRole,
  suppliedEmail: unknown,
  evaluatorName: string,
  poNumber: string,
) {
  const direct = normalizeEmail(suppliedEmail);
  if (direct.includes("@")) return direct;

  const collectionName = role === "purchaser" ? "buyers" : "employees";
  const found = await findCollectionEmail(collectionName, evaluatorName);
  if (found) return found;

  try {
    const snap = await adminDb.collection("purchaseOrders")
      .where("poNumber", "==", poNumber)
      .limit(1)
      .get();
    if (!snap.empty) {
      const order = snap.docs[0].data() as any;
      const fallback = role === "purchaser"
        ? order.buyerEmail || order.evaluatorEmail
        : role === "amd"
          ? order.amdEmail || order.receivedByEmail || order.evaluatorEmail
          : order.requisitionerEmail || order.evaluatorEmail;
      const email = normalizeEmail(fallback);
      if (email.includes("@")) return email;
    }
  } catch {}

  return "";
}

function evaluationHtml(link: string, evaluatorName: string, role: EvaluationRole, poNumber: string, vendorName: string, prfNo: string) {
  const clean = (value: string) => value.replace(/[<>]/g, "");
  const name = clean(evaluatorName) || roleLabel(role);
  const po = clean(poNumber);
  const vendor = clean(vendorName) || "Supplier";
  const prf = clean(prfNo);
  const roleText = roleLabel(role);
  const safeLink = link.replace(/"/g, "&quot;");

  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#12203a"><div style="max-width:680px;margin:30px auto;background:#fff;border:1px solid #e3e8f0;border-radius:16px;overflow:hidden"><div style="padding:26px 30px;background:linear-gradient(135deg,#0f5f52,#12856f);color:#fff"><div style="font-size:11px;letter-spacing:1px;font-weight:700;opacity:.85">PURCHASING MANAGEMENT SYSTEM</div><h1 style="margin:8px 0 0;font-size:25px">${roleText} Evaluation Request</h1></div><div style="padding:30px"><p>Hello <b>${name}</b>,</p><p style="font-size:14px;line-height:1.65">Please complete your supplier evaluation for the purchase below.</p><div style="background:#f7f9fc;border:1px solid #e8edf4;border-radius:12px;padding:18px;margin:20px 0"><div style="font-size:11px;color:#738095;text-transform:uppercase;font-weight:700">Evaluation</div><div style="margin-top:6px;font-size:16px;font-weight:800">${vendor}</div><div style="margin-top:4px;font-size:13px;color:#617087">PO ${po}${prf ? ` · PRF ${prf}` : ""} · ${roleText}</div></div><a href="${safeLink}" style="display:inline-block;background:#0f7b65;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:800">Open Supplier Evaluation</a><p style="font-size:12px;color:#7a8698;line-height:1.6;margin-top:22px">This evaluation link is unique to the intended evaluator. Purchasing / Buyer evaluations use 5 criteria including compliance; Requisitioner and AMD Personnel evaluations use 4 criteria.</p></div></div></body></html>`;
}

async function sendViaAppsScript(payload: { to: string; subject: string; html: string; text: string; attachments?: Array<{ url: string; name?: string }> }) {
  const endpoint = text(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL);
  const secret = text(process.env.GOOGLE_APPS_SCRIPT_SECRET);
  if (!endpoint || !secret) {
    return { sent: false, configured: false, message: "Google Apps Script email is not configured in Vercel." };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      secret,
      to: payload.to,
      subject: payload.subject,
      htmlBody: payload.html,
      textBody: payload.text,
      senderName: "Purchasing Management System",
      attachments: payload.attachments || [],
    }),
  });

  const raw = await response.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch {}
  if (!response.ok || !data?.ok) throw new Error(data?.message || `Google Apps Script returned ${response.status}.`);
  return { sent: true, configured: true, message: data.message || "Email sent through Google Apps Script." };
}

async function getExistingEvaluation(poNumber: string, recipient: string, role: EvaluationRole) {
  const snap = await adminDb.collection("evaluations").where("poNumber", "==", poNumber).get();
  const wanted = normalizeEmail(recipient);
  return snap.docs.find((doc) => {
    const row = doc.data() as any;
    return normalizeEmail(row.evaluatorEmail) === wanted && text(row.evaluatorRole).toLowerCase() === role;
  }) || null;
}

async function dispatch(body: any) {
  const poNumber = text(body.poNumber);
  if (!poNumber) throw new Error("PO number is required.");

  const role: EvaluationRole = body.evaluatorRole === "purchaser" || body.evaluatorRole === "amd" ? body.evaluatorRole : "requisitioner";

  const orderSnap = await adminDb.collection("purchaseOrders").where("poNumber", "==", poNumber).limit(1).get();
  const order = orderSnap.empty ? {} : orderSnap.docs[0].data() as any;

  let evaluatorName = text(body.evaluatorName);
  let suppliedEmail = text(body.email || body.evaluatorEmail);

  if (role === "purchaser") {
    evaluatorName = evaluatorName || text(order.buyerName) || text(order.preparedBy);
    suppliedEmail = suppliedEmail || text(order.buyerEmail);
  } else if (role === "amd") {
    const receivedBy = text(body.evaluatorName || order.receivedBy);
    if (receivedBy.includes("@") && !suppliedEmail.includes("@")) {
      suppliedEmail = receivedBy;
      evaluatorName = text(body.evaluatorName) && !text(body.evaluatorName).includes("@") ? text(body.evaluatorName) : "AMD Personnel";
    } else {
      evaluatorName = receivedBy || "AMD Personnel";
      suppliedEmail = suppliedEmail || text(order.amdEmail || order.receivedByEmail);
    }
  } else {
    evaluatorName = evaluatorName || text(order.requisitioner);
    suppliedEmail = suppliedEmail || text(order.requisitionerEmail);
  }

  const recipient = await resolveRecipient(role, suppliedEmail, evaluatorName, poNumber);
  if (!recipient) throw new Error(`No email was found for ${roleLabel(role)} "${evaluatorName || "the assigned evaluator"}". Enter a manual email address or update the Buyers/Employees record.`);

  const existing = await getExistingEvaluation(poNumber, recipient, role);
  const ref = existing ? existing.ref : adminDb.collection("evaluations").doc();
  const current = existing ? existing.data() as any : {};
  const token = text(current.token) || crypto.randomBytes(24).toString("hex");
  const now = new Date().toISOString();

  const evaluation = {
    id: ref.id,
    token,
    poNumber,
    prfNo: text(body.prfNo || order.prfNo),
    vendorName: text(body.vendorName || order.vendorName),
    supplier: text(body.vendorName || order.vendorName),
    evaluatorEmail: recipient,
    evaluatorName,
    evaluatorRole: role,
    deliveryDate: text(body.actualDeliveryDate || order.actualDeliveryDate || order.deliveryDate),
    expectedDeliveryDate: text(body.expectedDeliveryDate || order.expectedDate || order.deliveryDate),
    actualDeliveryDate: text(body.actualDeliveryDate || order.actualDeliveryDate),
    totalAmount: Number(body.totalAmount ?? order.total ?? 0),
    itemsDelivered: text(body.itemsDelivered),
    status: ["submitted", "completed", "evaluated"].includes(text(current.status).toLowerCase()) ? current.status : "pending",
    createdAt: current.createdAt || now,
    updatedAt: now,
    autoEmail: true,
    needsExport: false,
  };

  await ref.set(evaluation, { merge: true });

  const origin = appUrl();
  if (!origin) throw new Error("NEXT_PUBLIC_APP_URL is not configured in Vercel.");
  const link = `${origin}/evaluate/${encodeURIComponent(token)}`;
  const subject = `${roleLabel(role)} Supplier Evaluation – ${poNumber}${evaluation.vendorName ? ` · ${evaluation.vendorName}` : ""}`;
  const html = evaluationHtml(link, evaluatorName, role, poNumber, text(evaluation.vendorName), text(evaluation.prfNo));
  const mail = await sendViaAppsScript({
    to: recipient,
    subject,
    html,
    text: `Please complete your ${roleLabel(role)} supplier evaluation for PO ${poNumber}.\n\nOpen evaluation: ${link}`,
  });

  if (mail.sent) {
    await ref.set({ status: "sent", sentAt: now, lastEmailSentAt: now, emailProvider: "google-apps-script", needsExport: true, updatedAt: now }, { merge: true });
  }

  return { ok: true, sent: mail.sent, configured: mail.configured, evaluationId: ref.id, link, recipient, evaluatorName, role, message: mail.message };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.evaluationId) {
      const snap = await adminDb.collection("evaluations").doc(text(body.evaluationId)).get();
      if (!snap.exists) return NextResponse.json({ ok: false, message: "Evaluation record was not found." }, { status: 404 });
      const row = snap.data() as any;
      return NextResponse.json(await dispatch({ ...row, ...body, evaluationId: undefined }));
    }
    return NextResponse.json(await dispatch(body));
  } catch (error: any) {
    return NextResponse.json({ ok: false, sent: false, message: error?.message || "Unable to dispatch supplier evaluation." }, { status: 500 });
  }
}
