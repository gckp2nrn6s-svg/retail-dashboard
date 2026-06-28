import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface StockRow { item_no: string; description: string | null; in_stock: number; quantity: number; out_qty: number; unit_price: number | null; brand: string | null; item_group: string | null }

// GET ?q=<search>&zero=1 → HO warehouse on-hand (warehouse_stock).
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") || "").trim();
  const showZero = sp.get("zero") === "1";
  try {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q) { params.push(`%${q}%`); where.push(`(item_no ILIKE $${params.length} OR description ILIKE $${params.length})`); }
    if (!showZero) where.push(`in_stock <> 0`);
    const rows = await query<StockRow>(`
      SELECT item_no, description, in_stock, quantity, out_qty, unit_price, brand, item_group
      FROM warehouse_stock
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY in_stock DESC, item_no
      LIMIT 1000
    `, params);
    const totals = (await query<{ items: string; units: string }>(
      `SELECT COUNT(*) FILTER (WHERE in_stock <> 0) items, COALESCE(SUM(in_stock),0) units FROM warehouse_stock`
    ))[0];
    return NextResponse.json({ rows, totals: { items: Number(totals.items), units: Number(totals.units) } });
  } catch (e) {
    console.error("[warehouse/stock]", e instanceof Error ? e.message : e);
    return NextResponse.json({ rows: [], totals: { items: 0, units: 0 }, error: "stock failed" }, { status: 200 });
  }
}
