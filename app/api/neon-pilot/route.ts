import { NextResponse } from "next/server";
import { getPreviewPool, requireActiveAdmin, previewErrorResponse } from "../../../lib/server/neonPreviewAccess";

// Audit-only endpoint; client receives summary counts, never raw records.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return previewErrorResponse(error);
  }
}
