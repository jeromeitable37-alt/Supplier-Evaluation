import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import {
  getPreviewPool, requireActiveAdmin, previewErrorResponse,
  NeonPilotError,
} from "../../../lib/server/neonPreviewAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Requires admin auth, explicit action, and the branch-pinned Preview pool.
// Every test write happens inside ONE database transaction that is ALWAYS
// rolled back, including on success. There are no email/Sheet/network calls.

type CheckResult = { name: string; passed: boolean };
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error("QA assertion failed: " + message);
};

function sameNumber(value: unknown, expected: number): boolean {
  return Number(value) === expected;
}

async function countId(client: PoolClient, table: "se_evaluations" | "se_purchase_orders" | "se_evaluation_links", column: "id" | "token", id: string): Promise<number> {
  // SQL identifiers are exclusively from fixed server-side allowlists.
  const found = await client.query(
    "SELECT count(*)::integer AS total FROM " + table + " WHERE " + column + "=$1",
    [id],
  );
  return Number(found.rows[0]?.total || 0);
}

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let stage = "authentication";
  let rollbackNeeded = false;
  const checks: CheckResult[] = [];

  const check = (name: string, condition: unknown) => {
    stage = name;
    assert(condition, name);
    checks.push({ name, passed: true });
  };

  try {
    const db = getPreviewPool();
    await requireActiveAdmin(request, db);
    if (process.env.NEXT_PUBLIC_DATA_BACKEND !== "neon") {
      return NextResponse.json(
        { ok: false, message: "Rollback QA is available only in the isolated Neon Preview." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    const raw = await request.text();
    if (raw.length > 100) {
      return NextResponse.json({ ok: false, message: "Invalid QA confirmation." }, { status: 400 });
    }
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { body = null; }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        (body as Record<string, unknown>).confirm !== "RUN_ROLLBACK_QA") {
      return NextResponse.json({ ok: false, message: "Explicit QA confirmation required." }, { status: 400 });
    }

    const suffix = randomBytes(12).toString("hex");
    const evaluationId = "qa-rollback-eval-" + suffix;
    const purchaseOrderId = "qa-rollback-po-" + suffix;
    const token = randomBytes(20).toString("hex");
    const publicId = "public-" + token;
    const previewSupplier = "QA-SIMULATION-ONLY";
    const previewPo = "QA-ROLLBACK-ONLY";
    const startCounts = await db.query(`
      SELECT
        (SELECT count(*)::integer FROM firestore_snapshots) AS snapshots,
        (SELECT count(*)::integer FROM se_evaluations) AS evaluations,
        (SELECT count(*)::integer FROM se_purchase_orders) AS purchase_orders,
        (SELECT count(*)::integer FROM se_evaluation_links) AS links
    `);
    const baseline = startCounts.rows[0] as {
      snapshots: number; evaluations: number; purchase_orders: number; links: number;
    };

    // A single connection ensures PostgreSQL transaction isolation for all QA writes.
    client = await db.connect();
    await client.query("BEGIN");
    rollbackNeeded = true;
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");

    stage = "evaluation insert";
    const initialEval = {
      id: evaluationId, poNumber: previewPo, supplier: previewSupplier,
      evaluationDate: "2026-11-10", finalRating: 4,
      remarks: "Temporary rollback QA only",
    };
    const createdEval = await client.query(
      "INSERT INTO se_evaluations (id,po_number,supplier_name,evaluation_date,final_rating,payload) " +
      "VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id",
      [evaluationId, previewPo, previewSupplier, initialEval.evaluationDate, 4, JSON.stringify(initialEval)],
    );
    check("Create a temporary evaluation", createdEval.rowCount === 1);
    check("Read a temporary evaluation", await countId(client, "se_evaluations", "id", evaluationId) === 1);

    stage = "evaluation update";
    await client.query(
      "UPDATE se_evaluations SET final_rating=$2,payload=jsonb_set(payload,'{finalRating}',to_jsonb($2::numeric)) WHERE id=$1",
      [evaluationId, 3.5],
    );
    const updatedEval = await client.query(
      "SELECT final_rating, payload->>'finalRating' AS payload_rating FROM se_evaluations WHERE id=$1",
      [evaluationId],
    );
    check("Update and read back the rating", sameNumber(updatedEval.rows[0]?.final_rating, 3.5) &&
      sameNumber(updatedEval.rows[0]?.payload_rating, 3.5));

    const duplicateEval = await client.query(
      "INSERT INTO se_evaluations (id,po_number,supplier_name,evaluation_date,final_rating,payload) " +
      "VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [evaluationId, previewPo, previewSupplier, initialEval.evaluationDate, 4, JSON.stringify(initialEval)],
    );
    check("Evaluation ID duplicate is rejected", duplicateEval.rowCount === 0);
    await client.query("DELETE FROM se_evaluations WHERE id=$1", [evaluationId]);
    check("Delete temporary evaluation", await countId(client, "se_evaluations", "id", evaluationId) === 0);

    const poPayload = {
      id: purchaseOrderId, poNumber: previewPo, prfNumber: "QA-PRF-ONLY",
      vendorName: previewSupplier, status: "Draft", total: 100,
      source: "transaction-rollback-qa",
    };
    const poInserted = await client.query(
      "INSERT INTO se_purchase_orders (id,po_number,prf_number,vendor_name,po_status,payload) " +
      "VALUES ($1,$2,$3,$4,'Draft',$5::jsonb) RETURNING id",
      [purchaseOrderId, previewPo, poPayload.prfNumber, previewSupplier, JSON.stringify(poPayload)],
    );
    check("Create a temporary purchase order", poInserted.rowCount === 1);
    await client.query(
      "UPDATE se_purchase_orders SET po_status='Received',payload=jsonb_set(payload,'{status}', to_jsonb('Received'::text)) WHERE id=$1",
      [purchaseOrderId],
    );
    const revisedPo = await client.query(
      "SELECT po_status,payload->>'status' AS value FROM se_purchase_orders WHERE id=$1",
      [purchaseOrderId],
    );
    check("Update and read back PO status", revisedPo.rows[0]?.po_status === "Received" &&
      revisedPo.rows[0]?.value === "Received");

    const publicLink = {
      token, status: "pending", evaluatorRole: "requisitioner",
      po: poPayload, createdAt: "2026-11-10T00:00:00.000Z",
      source: "transaction-rollback-qa",
    };
    const insertedLink = await client.query(
      "INSERT INTO se_evaluation_links (token,link_status,evaluator_role,po_number,payload) " +
      "VALUES ($1,'pending','requisitioner',$2,$3::jsonb) RETURNING token",
      [token, previewPo, JSON.stringify(publicLink)],
    );
    check("Create a temporary evaluation link", insertedLink.rowCount === 1);
    const claimedLink = await client.query(
      "UPDATE se_evaluation_links SET link_status='submitted'," +
      "payload=jsonb_set(payload,'{status}', to_jsonb('submitted'::text)) " +
      "WHERE token=$1 AND link_status='pending' RETURNING token",
      [token],
    );
    check("Change a pending link to submitted", claimedLink.rowCount === 1);
    const secondClaim = await client.query(
      "UPDATE se_evaluation_links SET link_status='submitted' " +
      "WHERE token=$1 AND link_status='pending' RETURNING token",
      [token],
    );
    check("Prevent second submission claim", secondClaim.rowCount === 0);

    const publicPayload = {
      id: publicId, poNumber: previewPo, supplier: previewSupplier,
      evaluationDate: "2026-11-10", finalRating: 4.25, publicToken: token,
      source: "transaction-rollback-qa",
    };
    const firstPublic = await client.query(
      "INSERT INTO se_evaluations (id,po_number,supplier_name,evaluator_role,evaluation_date,final_rating,payload) " +
      "VALUES($1,$2,$3,'requisitioner',$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [publicId,previewPo,previewSupplier,publicPayload.evaluationDate,4.25,JSON.stringify(publicPayload)],
    );
    const repeatedPublic = await client.query(
      "INSERT INTO se_evaluations (id,po_number,supplier_name,evaluator_role,evaluation_date,final_rating,payload) " +
      "VALUES($1,$2,$3,'requisitioner',$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [publicId,previewPo,previewSupplier,publicPayload.evaluationDate,4.25,JSON.stringify(publicPayload)],
    );
    check("Prevent duplicate public evaluation ID", firstPublic.rowCount === 1 && repeatedPublic.rowCount === 0);

    const transientCounts = await client.query(
      "SELECT (SELECT count(*)::integer FROM se_evaluations) AS evaluations," +
      "(SELECT count(*)::integer FROM se_purchase_orders) AS purchase_orders," +
      "(SELECT count(*)::integer FROM se_evaluation_links) AS links",
    );
    check("Changes visible only inside QA transaction",
      Number(transientCounts.rows[0]?.evaluations) === Number(baseline.evaluations) + 1 &&
      Number(transientCounts.rows[0]?.purchase_orders) === Number(baseline.purchase_orders) + 1 &&
      Number(transientCounts.rows[0]?.links) === Number(baseline.links) + 1);

    // ROLLBACK is intentional on success; there is no COMMIT anywhere.
    stage = "transaction rollback";
    await client.query("ROLLBACK");
    rollbackNeeded = false;
    client.release();
    client = undefined;

    const persisted = await db.query(
      "SELECT " +
        "(SELECT count(*)::integer FROM se_evaluations WHERE id=ANY($1::text[])) AS evaluations," +
        "(SELECT count(*)::integer FROM se_purchase_orders WHERE id=$2) AS purchase_orders," +
        "(SELECT count(*)::integer FROM se_evaluation_links WHERE token=$3) AS links," +
        "(SELECT count(*)::integer FROM firestore_snapshots) AS snapshots",
      [[evaluationId,publicId], purchaseOrderId, token],
    );
    check("Rollback erased all temporary QA records",
      persisted.rows[0]?.evaluations === 0 &&
      persisted.rows[0]?.purchase_orders === 0 &&
      persisted.rows[0]?.links === 0);
    check("Original migration snapshots unchanged",
      Number(persisted.rows[0]?.snapshots) === Number(baseline.snapshots));

    return NextResponse.json({
      ok: true, branch: "migration-preview",
      committed: false, rolledBack: true, externalEffects: false,
      passed: checks.length, failed: 0, checks,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (client && rollbackNeeded) {
      try { await client.query("ROLLBACK"); } catch { /* Pool reset rolls back uncommitted work */ }
    }
    if (error instanceof NeonPilotError) return previewErrorResponse(error);
    console.error("Neon transaction-rollback QA failure:", stage,
      error instanceof Error && "code" in error ? String((error as {code?:string}).code ?? "unknown") : "assertion");
    return NextResponse.json({
      ok: false, message: "A temporary QA check did not complete. No changes were committed.",
      stage, committed: false, passed: checks.length, checks,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    if (client) client.release();
  }
}
