import { Pool } from "pg";

// Production-only connection for the dedicated SISC Supplier Evaluation database.
// Fail closed if the URL is missing, points at Preview, or uses another database.
let productionPool: Pool | undefined;

export function getProductionPool(): Pool {
  if (process.env.VERCEL_ENV !== "production" ||
      process.env.NEXT_PUBLIC_DATA_BACKEND !== "neon") {
    throw new Error("Production Neon connection is unavailable outside an approved cutover.");
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Production Neon DATABASE_URL is missing.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Production Neon DATABASE_URL is invalid.");
  }

  const allowedHosts = new Set([
    "ep-snowy-snow-b3hnvnsh.c-4.ap-southeast-1.aws.neon.tech",
    "ep-snowy-snow-b3hnvnsh-pooler.c-4.ap-southeast-1.aws.neon.tech",
  ]);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.pathname !== "/supplier_evaluation" ||
      !allowedHosts.has(parsed.hostname)) {
    throw new Error("Production Neon endpoint does not match the dedicated SISC database.");
  }
  parsed.searchParams.set("sslmode", "verify-full");
  if (!productionPool) {
    productionPool = new Pool({
      connectionString: parsed.toString(),
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    productionPool.on("error", (error) =>
      console.error("SISC Neon production pool error:", error.message));
  }
  return productionPool;
}
