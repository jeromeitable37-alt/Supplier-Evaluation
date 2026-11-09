import { NextResponse } from "next/server";
import { getPreviewPool, previewErrorResponse, requireActiveAdmin } from "../../../lib/server/neonPreviewAccess";

// Preview migration validation, not the production application data API.
// Read-only and admin-only; records are returned in small paginated summaries.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_PAGE = 100;

export async function GET(request: Request) {
  try {
    const pool = getPreviewPool();
    await requireActiveAdmin(request, pool);

    const url = new URL(request.url);
    const pageRaw = Number(url.searchParams.get("page") || "1");
    const page = Number.isSafeInteger(pageRaw) && pageRaw >= 1 && pageRaw <= MAX_PAGE ? pageRaw : 1;
    const search = String(url.searchParams.get("search") || "").trim().slice(0, 90);
    // STRPOS performs literal substring matching: user input is never a SQL pattern.
    const filter = `
      WHERE ($1::text = ''
        OR strpos(lower(COALESCE(NULLIF(e.payload->>'supplier', ''), e.supplier_name)), lower($1)) > 0
        OR strpos(lower(e.po_number), lower($1)) > 0
        OR strpos(lower(e.id), lower($1)) > 0
        OR strpos(lower(COALESCE(e.payload->>'prfNo', '')), lower($1)) > 0
      )
    `;

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT e.id,
           COALESCE(NULLIF(e.payload->>'supplier', ''), e.supplier_name) AS supplier,
           COALESCE(NULLIF(e.payload->>'evaluationDate', ''), e.evaluation_date) AS evaluation_date,
           e.po_number,
           COALESCE(e.payload->>'prfNo', '') AS prf_number,
           e.final_rating::float8 AS final_rating,
           COALESCE(e.payload->>'recommendation', '') AS recommendation,
           COALESCE(e.payload->>'source', '') AS source
         FROM se_evaluations e
         ${filter}
         ORDER BY NULLIF(COALESCE(NULLIF(e.payload->>'evaluationDate', ''), e.evaluation_date), '') DESC NULLS LAST,
                  e.id ASC
         LIMIT $2 OFFSET $3`,
        [search, PAGE_SIZE, (page - 1) * PAGE_SIZE],
      ),
      pool.query(`SELECT count(*)::integer AS total FROM se_evaluations e ${filter}`, [search]),
    ]);

    return NextResponse.json({
      ok: true,
      branch: "migration-preview",
      readOnly: true,
      page,
      pageSize: PAGE_SIZE,
      total: Number(count.rows[0]?.total || 0),
      items: rows.rows,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return previewErrorResponse(error);
  }
}
