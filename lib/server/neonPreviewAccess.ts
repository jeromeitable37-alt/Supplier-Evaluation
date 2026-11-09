import { Pool } from "pg";
import { NextResponse } from "next/server";

// An isolated, read-only database connection used only by preview APIs.
// NEVER use this module to perform writes or point it to a production branch.
let pool: Pool | undefined;

type FirebaseAccount = {
  localId?: string;
  email?: string;
  disabled?: boolean;
};

export class NeonPilotError extends Error {
  constructor(message: string, readonly status: 401 | 403 | 503) {
    super(message);
    this.name = "NeonPilotError";
  }
}

function fail(message: string, status: 401 | 403 | 503): never {
  throw new NeonPilotError(message, status);
}

export function getPreviewPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail("Preview database is not configured.", 503);
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return fail("Invalid preview database configuration.", 503);
  }
  // Exact Neon preview endpoint constraint deliberately rejects Production,
  // external hosts, arbitrary databases, and accidentally reused app URLs.
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.pathname !== "/supplier_evaluation" ||
      !/^ep-bitter-haze-b3p8g38w(?:-pooler)?\.c-4\.ap-southeast-1\.aws\.neon\.tech$/.test(parsed.hostname)) {
    return fail("This endpoint is restricted to the SISC migration-preview branch.", 503);
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    pool.on("error", (error) => console.error("Neon preview pool error:", error.message));
  }
  return pool;
}

export async function requireActiveAdmin(request: Request, db: Pool): Promise<void> {
  const token = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length < 100 || token.length > 10000) {
    fail("Sign in with your approved Purchasing account.", 401);
  }
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) fail("Firebase Authentication is not configured.", 503);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) fail("Your Firebase login has expired. Sign in again.", 401);
  const result = await response.json() as { users?: FirebaseAccount[] };
  const authUser = result.users?.[0];
  if (!authUser?.localId || !authUser.email || authUser.disabled) {
    fail("This Firebase account is not eligible.", 403);
  }

  // Verify permissions from the database, never from client-provided claims.
  const match = await db.query(
    "SELECT role, active, email FROM se_users WHERE uid = $1 LIMIT 1",
    [authUser.localId],
  );
  const saved = match.rows[0] as { role?: string; active?: boolean; email?: string } | undefined;
  if (saved?.role !== "admin" || saved.active !== true ||
      saved.email?.trim().toLowerCase() !== authUser.email.trim().toLowerCase()) {
    fail("Only an active Purchasing administrator can use the Neon preview.", 403);
  }
}

export function previewErrorResponse(error: unknown): NextResponse {
  const status = error instanceof NeonPilotError ? error.status : 503;
  if (status === 503) console.error("Neon preview unavailable:", error instanceof Error ? error.message : "unknown error");
  const message = error instanceof NeonPilotError && status !== 503
    ? error.message
    : "Neon preview check is unavailable. Verify the server-only preview database credential.";
  return NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}
