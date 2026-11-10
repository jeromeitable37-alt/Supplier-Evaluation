import { getPreviewPool } from "./neonPreviewAccess";
import type { Pool } from "pg";

type FirebaseRecord = {
  localId?: string;
  email?: string;
  disabled?: boolean;
};

export class AppAccessError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export type AppSession = {
  uid: string;
  email: string;
  role: "admin" | "staff" | "viewer";
  permissions: string[];
  active: boolean;
};

export function appPool(): Pool {
  // Hard pinned to SISC's isolated, nonproduction migration-preview endpoint.
  return getPreviewPool();
}

export async function appSession(request: Request): Promise<AppSession> {
  const token = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length < 100 || token.length > 10000) {
    throw new AppAccessError("Please sign in to your authorized Purchasing account.", 401);
  }
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new AppAccessError("Firebase login is not configured.", 503);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }), cache: "no-store", signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw new AppAccessError("Your session expired. Please sign in again.", 401);
  const result = await response.json() as { users?: FirebaseRecord[] };
  const identity = result.users?.[0];
  if (!identity?.localId || !identity.email || identity.disabled) throw new AppAccessError("Invalid account.", 403);
  const db = appPool();
  const found = await db.query(
    "SELECT uid,email,role,active,permissions FROM se_users WHERE uid=$1",
    [identity.localId],
  );
  const profile = found.rows[0];
  // No silent staff creation: only migrated, approved Purchasing profiles can
  // access production-like school records. Onboarding requires admin review.
  if (!profile || profile.active !== true ||
      String(profile.email || "").trim().toLowerCase() !== identity.email.trim().toLowerCase()) {
    throw new AppAccessError("Your Purchasing account is not yet approved for the Neon preview.", 403);
  }
  const role = profile.role;
  if (role !== "admin" && role !== "staff" && role !== "viewer") throw new AppAccessError("Invalid profile role.", 403);
  return {
    uid: identity.localId,
    email: identity.email,
    role,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    active: true,
  };
}

export function hasPermission(session: AppSession, permission: string): boolean {
  return session.role === "admin" || session.permissions.includes(permission);
}

export function requirePermission(session: AppSession, permission: string): void {
  if (!hasPermission(session, permission)) throw new AppAccessError("Your account does not have permission for this action.", 403);
}

export function requireAdmin(session: AppSession): void {
  if (session.role !== "admin") throw new AppAccessError("Administrator access required.", 403);
}

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("/");
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppAccessError("Invalid request data.", 400);
  return value as Record<string, unknown>;
}

export function s(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function numberOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const x = Number(value);
  return Number.isFinite(x) && x >= 0 && x <= 5 ? x : null;
}

export function jsonPayload(value: unknown): Record<string, unknown> {
  const body = object(value);
  const str = JSON.stringify(body);
  if (!str || str.length > 350000) throw new AppAccessError("Record exceeds the allowed size.", 413);
  return JSON.parse(str) as Record<string, unknown>;
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof AppAccessError ? error.status : 503;
  if (!(error instanceof AppAccessError)) {
    console.error("Neon app request failed:", error instanceof Error ? error.message : "unknown");
  }
  const message = error instanceof AppAccessError && status !== 503
    ? error.message
    : "Neon preview is temporarily unavailable.";
  return Response.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}
