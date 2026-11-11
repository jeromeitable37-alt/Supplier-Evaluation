import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

// Auth proxy is prepared before cutover. Public login must not switch until
// approved staff identities and Firestore records have been reconciled.
const baseUrl = process.env.NEON_AUTH_BASE_URL;
const secret = process.env.NEON_AUTH_COOKIE_SECRET;
if (!baseUrl || !secret || secret.length < 32) {
  throw new Error("Neon Auth is not fully configured for this deployment.");
}

export const neonAuth = createNeonAuth({
  baseUrl,
  cookies: { secret, sessionDataTtl: 300 },
});
