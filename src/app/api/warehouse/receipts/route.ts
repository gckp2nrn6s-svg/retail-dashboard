import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET ?from&to&id  → receipt history (headers + totals), or one receipt's lines.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  try {
    if (id) {
      const lines = await query(`
        SELECT l.item_no, l.qty, COALESCE(w.description, ic.description) AS description
        FROM wh_receipt_lines l
        LEFT JOIN warehouse_stock w ON w.item_no = l.item_no
        LEFT JOIN item_categorisation ic ON ic.item_no = l.item_no
        WHERE l.receipt_id = $1 ORDER BY l.id`, [Number(id)]);
      return NextResponse.json({ lines });
    }
    const from = sp.get("from"), to = sp.get("to");
    const where: string[] = [], params: (string | number)[] = [];
    if (from) { params.push(from); where.push(`r.created_at >= $${params.length}::date`); }
    if (to)   { params.push(to);   where.push(`r.created_at < ($${params.length}::date + 1)`); }
    const rows = await query(`
      SELECT r.id, r.kind, r.reference, r.note, r.created_at,
             COUNT(l.id) AS lines, COALESCE(SUM(l.qty),0) AS units
      FROM wh_receipts r LEFT JOIN wh_receipt_lines l ON l.receipt_id = r.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY r.id ORDER BY r.created_at DESC LIMIT 300`, params);
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[warehouse/receipts]", e instanceof Error ? e.message : e);
    return NextResponse.json({ rows: [], lines: [], error: "receipts failed" }, { status: 200 });
  }
}
