import { NextResponse } from "next/server";
import { getPreviewPool, previewErrorResponse, requireActiveAdmin } from "../../../lib/server/neonPreviewAccess";

// Aggregate-only link status report. Never expose bearer tokens or linked
// evaluator personal information in this verification endpoint.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const pool = getPreviewPool();
    await requireActiveAdmin(request, pool);
    const result = await pool.query(`
      SELECT COALESCE(NULLIF(link_status, ''), 'unspecified') AS status,
             COALESCE(NULLIF(evaluator_role, ''), 'unspecified') AS evaluator_role,
             count(*)::integer AS total
      FROM se_evaluation_links
      GROUP BY 1, 2
      ORDER BY status, evaluator_role
    `);
    return NextResponse.json({
      ok: true,
      readOnly: true,
      branch: "migration-preview",
      total: result.rows.reduce((total: number, item: { total: number }) => total + item.total, 0),
      groups: result.rows,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return previewErrorResponse(error);
  }
}
