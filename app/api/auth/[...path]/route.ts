import { neonAuth } from "../../../../lib/auth/neon-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { GET, POST } = neonAuth.handler();
