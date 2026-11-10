import { NextResponse } from "next/server";
import { getPreviewPool, previewErrorResponse, requireActiveAdmin } from "../../../lib/server/neonPreviewAccess";

// Administrator-only, read-only preview of migrated PO data. No attachment
// download URLs, private email addresses, or complete JSON payloads are returned.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  try {
    const pool = getPreviewPool();
    await requireActiveAdmin(request, pool);
    const url = new URL(request.url);
    const rawPage = Number(url.searchParams.get("page") || "1");
    const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 100 ? rawPage : 1;
    const search = String(url.searchParams.get("search") || "").trim().slice(0, 90);

    const filter = `
      WHERE ($1::text = ''
        OR strpos(lower(p.po_number), lower($1)) > 0
        OR strpos(lower(p.prf_number), lower($1)) > 0
        OR strpos(lower(p.vendor_name), lower($1)) > 0
        OR strpos(lower(p.id), lower($1)) > 0
      )
    `;
    const [records, count] = await Promise.all([
      pool.query(`
        SELECT p.id, p.po_number, p.prf_number, p.vendor_name,
               p.po_status AS status,
               COALESCE(p.payload->>'expectedDate', '') AS expected_date,
               COALESCE(p.payload->>'orderDate', '') AS order_date,
               COALESCE(p.payload->>'total', '') AS total_amount
        FROM se_purchase_orders p
        ${filter}
        ORDER BY NULLIF(p.payload->>'orderDate', '') DESC NULLS LAST, p.id ASC
        LIMIT $2 OFFSET $3
      `, [search, PAGE_SIZE, (page - 1) * PAGE_SIZE]),
      pool.query(`SELECT count(*)::integer AS total FROM se_purchase_orders p ${filter}`, [search]),
    ]);

    return NextResponse.json({
      ok: true,
      readOnly: true,
      branch: "migration-preview",
      page,
      pageSize: PAGE_SIZE,
      total: Number(count.rows[0]?.total || 0),
      items: records.rows,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return previewErrorResponse(error);
  }
}
