import { createSign } from "node:crypto";
import { NextResponse } from "next/server";
import { appPool } from "../../../lib/server/neonAppAuth";

export const runtime = "nodejs";

type SA = { client_email: string; private_key: string; project_id: string };

function account(): SA {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing.");
  const parsed = JSON.parse(raw) as SA;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("Firebase service account is incomplete.");
  }
  return parsed;
}

async function accessToken(sa: SA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3500,
  });
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(sa.private_key).toString("base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: unsigned + "." + signature,
  });
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    cache: "no-store",
  });
  const data = await result.json();
  if (!result.ok || !data.access_token) throw new Error("Service account authentication failed.");
  return data.access_token as string;
}

function fromFirestore(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromFirestore);
  if ("mapValue" in value) {
    return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([key, val]) => [key, fromFirestore(val)]));
  }
  return null;
}

async function readDoc(sa: SA, token: string, collection: string, id: string): Promise<Record<string, any> | null> {
  const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(sa.project_id) +
    "/databases/(default)/documents/" + collection + "/" + encodeURIComponent(id);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not verify the saved evaluation.");
  const data = await response.json();
  return Object.fromEntries(Object.entries(data.fields || {}).map(([key, value]) => [key, fromFirestore(value)]));
}

/**
 * Public form sends ONLY its opaque link token. All evaluation fields are
 * retrieved from Firestore by the trusted server, never trusted from POST body.
 * The Apps Script performs an idempotent upsert keyed by the evaluation ID.
 */
export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (typeof token !== "string" || !/^[a-z0-9]{10,40}$/i.test(token)) {
      return NextResponse.json({ ok: false, message: "Invalid evaluation link." }, { status: 400 });
    }
    const url = process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL;
    const secret = process.env.PMS_WEBHOOK_SECRET || process.env.GOOGLE_APPS_SCRIPT_SECRET;
    if (!url || !secret) {
      return NextResponse.json({ ok: false, message: "School sheet integration is not configured." }, { status: 503 });
    }

    const useNeon = process.env.NEXT_PUBLIC_DATA_BACKEND === "neon";
    let link: Record<string,any> | null = null;
    let evaluation: Record<string,any> | null = null;
    if (useNeon) {
      // Client sends only opaque bearer token. Both records and integrity
      // checks are always read from PostgreSQL on the trusted server.
      const db = appPool();
      const [links, rows] = await Promise.all([
        db.query("SELECT payload FROM se_evaluation_links WHERE token=$1", [token]),
        db.query("SELECT payload FROM se_evaluations WHERE id=$1", ["public-"+token]),
      ]);
      link = links.rows[0]?.payload || null;
      evaluation = rows.rows[0]?.payload || null;
    } else {
      const sa = account();
      const auth = await accessToken(sa);
      [link, evaluation] = await Promise.all([
        readDoc(sa, auth, "evaluationLinks", token),
        readDoc(sa, auth, "evaluations", "public-" + token),
      ]);
    }
    if (!link || !evaluation || link.status !== "submitted" ||
        evaluation.publicToken !== token || evaluation.poNumber !== link.po?.poNumber ||
        evaluation.evaluatorRole !== (link.evaluatorRole || "requisitioner")) {
      return NextResponse.json({ ok: false, message: "Evaluation is not ready for synchronization." }, { status: 409 });
    }

    // Only allow a controlled subset of the validated Firestore record.
    const payload = {
      id: evaluation.id, poNumber: evaluation.poNumber, prfNo: evaluation.prfNo,
      supplier: evaluation.supplier, address: evaluation.address,
      itemsDelivered: evaluation.itemsDelivered, evaluatorRole: evaluation.evaluatorRole,
      evaluatorName: evaluation.evaluatorName, evaluatorEmail: evaluation.evaluatorEmail,
      submittedAt: evaluation.submittedAt, finalRating: evaluation.finalRating,
      remarks: evaluation.remarks, scores: evaluation.scores,
      ratingRemarks: evaluation.ratingRemarks, customerSatisfaction: evaluation.customerSatisfaction,
    };

    // Database-backed lease prevents repeated public calls from spamming the
    // school webhook. The official Apps Script also upserts by evaluation ID.
    if (useNeon) {
      const claim = await appPool().query(
        "INSERT INTO se_sheet_sync(evaluation_id,state,attempts,lock_expires_at) "+
        "VALUES($1,'processing',1,now()+interval '2 minutes') "+
        "ON CONFLICT(evaluation_id) DO UPDATE SET "+
        "state='processing',attempts=se_sheet_sync.attempts+1,"+
        "lock_expires_at=now()+interval '2 minutes',updated_at=now(),last_error='' "+
        "WHERE se_sheet_sync.state <> 'done' "+
        "AND (se_sheet_sync.lock_expires_at IS NULL OR se_sheet_sync.lock_expires_at < now()) "+
        "RETURNING evaluation_id",
        [payload.id],
      );
      if (claim.rowCount !== 1) {
        const existing = await appPool().query(
          "SELECT state,sheet_name FROM se_sheet_sync WHERE evaluation_id=$1",[payload.id]);
        if(existing.rows[0]?.state==="done") {
          return NextResponse.json({ok:true,evaluationId:payload.id,
            sheet:existing.rows[0].sheet_name||"WEB_EVALUATIONS",alreadySynced:true});
        }
        return NextResponse.json({ok:false,message:"Synchronization is already in progress. Retry later."},{status:429});
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "sync_evaluation", secret, evaluation: payload }),
    });
    } catch (error) {
      if (useNeon) await appPool().query(
        "UPDATE se_sheet_sync SET state='failed',lock_expires_at=NULL,last_error=$2,updated_at=now() WHERE evaluation_id=$1",
        [payload.id,error instanceof Error?error.message.slice(0,150):"Webhook connection failed"],
      );
      throw error;
    }
    const raw = await response.text();
    let result: any = {};
    try { result = JSON.parse(raw); } catch {}
    if (!response.ok || !result.ok) {
      if (useNeon) await appPool().query(
        "UPDATE se_sheet_sync SET state='failed',lock_expires_at=NULL,last_error=$2,updated_at=now() WHERE evaluation_id=$1",
        [payload.id,String(result.message || "Google Apps Script rejected the evaluation sync.").slice(0,150)],
      );
      throw new Error(String(result.message || "Google Apps Script rejected the evaluation sync."));
    }
    if (useNeon) await appPool().query(
      "UPDATE se_sheet_sync SET state='done',lock_expires_at=NULL,sheet_name=$2,last_error='',updated_at=now() WHERE evaluation_id=$1",
      [payload.id, String(result.sheet || "WEB_EVALUATIONS").slice(0,120)],
    );
    return NextResponse.json({ ok: true, evaluationId: payload.id, sheet: result.sheet || "WEB_EVALUATIONS" });
  } catch (error) {
    console.error("Evaluation sheet sync failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, message: "Could not sync to the official Google Sheet." }, { status: 503 });
  }
}
