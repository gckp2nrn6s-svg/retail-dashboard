import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { reconcile } from "@/lib/stock-ledger";

export const dynamic = "force-dynamic";

// Unified stock-movement log — every change to HO on-hand, filterable, plus a live
// reconcile check (Σ ledger vs warehouse_stock) so any drift is visible at a glance.
interface Row { id: number; item_no: string; ts: string; type: string; source_ref: string; qty_delta: number; note: string | null; description: string | null }
interface ByType { type: string; n: number; sum: number }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const type = searchParams.get("type");
  const item = (searchParams.get("item") || "").trim();
  const limit = Math.min(2000, Math.max(1, Number(searchParams.get("limit")) || 500));

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (from) { params.push(from); where.push(`l.ts >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`l.ts < ($${params.length}::date + interval '1 day')`); }
  if (type && type !== "all") { params.push(type); where.push(`l.type = $${params.length}`); }
  if (item) { params.push(`%${item}%`); where.push(`(l.item_no ILIKE $${params.length} OR w.description ILIKE $${params.length})`); }

  try {
    const rows = await query<Row>(
      `SELECT l.id, l.item_no, l.ts, l.type, l.source_ref, l.qty_delta::float AS qty_delta, l.note, w.description
         FROM wh_stock_ledger l
         LEFT JOIN warehouse_stock w ON w.item_no = l.item_no
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY l.ts DESC, l.id DESC
         LIMIT ${limit}`,
      params
    );
    const byType = await query<ByType>(
      "SELECT type, COUNT(*)::int AS n, SUM(qty_delta)::float AS sum FROM wh_stock_ledger GROUP BY type ORDER BY type"
    );
    const recon = await reconcile();
    return NextResponse.json({ rows, count: rows.length, limit, byType, mismatches: recon.length, mismatchRows: recon.slice(0, 50) });
  } catch (e) {
    console.error("[warehouse/ledger]", e instanceof Error ? e.message : e);
    return NextResponse.json({ rows: [], count: 0, limit, byType: [], mismatches: 0, mismatchRows: [], error: "Failed to load ledger" }, { status: 200 });
  }
}
