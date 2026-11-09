import { NextResponse } from "next/server";
import { Pool } from "pg";

// A deliberately read-only bridge for inspecting the migrated Neon PREVIEW data.
// Firebase Auth remains the identity provider; PostgreSQL credentials never reach the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FirebaseAccount = {
  localId?: string;
  email?: string;
  disabled?: boolean;
};
type PilotError = Error & { status?: number };

let previewPool: Pool | undefined;

function fail(message: string, status: number): never {
  const error = new Error(message) as PilotError;
  error.status = status;
  throw error;
}

function getPreviewPool(): Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) return fail("Preview database is not configured.", 503);
  let url: URL;
  try { url = new URL(raw); } catch { return fail("Invalid preview database configuration.", 503); }
  // Fail closed: never let this pilot accidentally inspect the Production branch,
  // other projects, or the unrelated Asylum database.
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.pathname !== "/supplier_evaluation" ||
      !/^ep-bitter-haze-b3p8g38w(?:-pooler)?\.c-4\.ap-southeast-1\.aws\.neon\.tech$/.test(url.hostname)) {
    return fail("This endpoint is restricted to the SISC migration-preview branch.", 503);
  }
  if (!previewPool) {
    previewPool = new Pool({
      connectionString: raw,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    previewPool.on("error", (error) => console.error("Preview PostgreSQL pool error:", error.message));
  }
  return previewPool;
}

async function requireActiveAdmin(request: Request, pool: Pool): Promise<void> {
  const bearer = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!bearer || bearer.length < 100 || bearer.length > 10000) {
    fail("Sign in with your approved Purchasing account.", 401);
  }
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) fail("Firebase Authentication is not configured.", 503);

  // Firebase Identity Toolkit validates the ID token using the original school
  // Firebase project's configured API key (as in the existing PO Drive pilot).
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(key!),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: bearer }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) fail("Your Firebase login has expired. Sign in again.", 401);
  const result = await response.json() as { users?: FirebaseAccount[] };
  const account = result.users?.[0];
  if (!account?.localId || !account.email || account.disabled) {
    fail("The signed-in Firebase account is not eligible.", 403);
  }

  // Never trust a browser-provided role or user ID. The migrated DB decides.
  const match = await pool.query(
    "SELECT role, active, email FROM se_users WHERE uid = $1 LIMIT 1",
    [account.localId],
  );
  const user = match.rows[0] as { role?: string; active?: boolean; email?: string } | undefined;
  if (!user || user.active !== true || user.role !== "admin" ||
      user.email?.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
    fail("Only an active Purchasing administrator can view the migration pilot.", 403);
  }
}

export async function GET(request: Request) {
  try {
    const pool = getPreviewPool();
    await requireActiveAdmin(request, pool);
    // All user/supplier data stays server-side. Return counts and audit status only.
    const [counts, audit] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT count(*)::integer FROM firestore_snapshots) AS snapshots,
          (SELECT count(*)::integer FROM firestore_extra_snapshots) AS extra_snapshots,
          (SELECT count(*)::integer FROM se_evaluations) AS evaluations,
          (SELECT count(*)::integer FROM se_purchase_orders) AS purchase_orders,
          (SELECT count(*)::integer FROM se_users) AS users,
          (SELECT count(*)::integer FROM se_evaluation_links) AS evaluation_links,
          (SELECT count(*)::integer FROM se_evaluation_contacts) AS evaluation_contacts,
          (SELECT count(*)::integer FROM se_workspace) AS workspace
      `),
      pool.query(`
        SELECT id::integer, state, expected_counts, imported_counts,
               completed_at::text AS completed_at
        FROM migration_runs
        ORDER BY id DESC LIMIT 1
      `),
    ]);
    const current = counts.rows[0];
    const verified = audit.rows[0] || null;
    const sourceTotal = Number(verified?.imported_counts?.sourceDocuments ?? 0);
    const copiedTotal = Number(verified?.imported_counts?.retainedSnapshots ?? 0);
    const isVerified = verified?.state === "verified" &&
      sourceTotal > 0 && sourceTotal === copiedTotal &&
      copiedTotal === Number(current?.snapshots || 0);
    return NextResponse.json(
      {
        ok: true,
        branch: "migration-preview",
        readOnly: true,
        audit: verified ? {
          id: verified.id,
          state: verified.state,
          sourceDocuments: sourceTotal,
          copiedDocuments: copiedTotal,
          completedAt: verified.completed_at,
          countsMatch: isVerified,
        } : null,
        counts: current,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const typed = error as PilotError;
    const status = typed.status && [401, 403, 503].includes(typed.status) ? typed.status : 503;
    if (status === 503) console.error("Neon pilot unavailable:", typed.message);
    return NextResponse.json(
      { ok: false, message: status === 503 ? "Neon preview check is unavailable. Verify the server-only preview database credential." : typed.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
