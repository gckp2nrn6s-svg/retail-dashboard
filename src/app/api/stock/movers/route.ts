import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { navQuery } from "@/lib/navdb";
import { fetchNavVelocity } from "@/lib/navVelocity";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type     = searchParams.get("type")     || "fast";
  const range    = searchParams.get("range")    || "30d";
  const category = searchParams.get("category") || "";
  const brand    = searchParams.get("brand")    || "";

  let days = 30;
  if (range === "7d") days = 7;
  else if (range === "90d") days = 90;

  const fxRow = await query<{ egp_per_usd: string }>(
    "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
  );
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");

  // ── FAST MOVERS: top selling from NAV ────────────────────────────────────
  if (type === "fast") {
    const catFilter  = category ? `AND [Product Group Code] = '${category.replace(/'/g,"''")}'` : "";
    const brandFilter= brand    ? `AND [Item Category Code] = '${brand.replace(/'/g,"''")}'`    : "";

    const rows = await navQuery<{ item_no: string; description: string; brand: string; category: string; units_sold: number; revenue: number }>(`
      SELECT TOP 50
        [Item No_]                      AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code])       AS brand,
        MAX([Product Group Code])       AS category,
        -SUM([Quantity])                AS units_sold,
        -SUM([Net Amount]+[VAT Amount]) AS revenue
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-${days},GETDATE()) AS DATE)
        ${catFilter} ${brandFilter}
      GROUP BY [Item No_]
      ORDER BY units_sold DESC
    `);

    // Join with warehouse stock in JS
    const stockRows = await query<{ item_no: string; in_stock: string }>(`
      SELECT item_no, in_stock::numeric FROM warehouse_stock
    `);
    const stockMap = Object.fromEntries(stockRows.map(r => [r.item_no, parseFloat(r.in_stock)]));

    return NextResponse.json({
      items: rows.map(r => ({
        item_no:     r.item_no,
        description: r.description || r.item_no,
        brand:       r.brand === "AM-TOUR" ? "American Tourister" : r.brand || "",
        category:    r.category || "",
        units_sold:  Number(r.units_sold),
        revenue:     { egp: Math.round(Number(r.revenue)), usd: Math.round(Number(r.revenue) / fx) },
        in_stock:    stockMap[r.item_no] ?? 0,
        daysRemaining: Number(r.units_sold) > 0 && (stockMap[r.item_no] ?? 0) > 0
          ? Math.round((stockMap[r.item_no] ?? 0) / (Number(r.units_sold) / days))
          : null,
      })),
      fx, range,
    });
  }

  // ── LOW STOCK: warehouse items running low, with NAV velocity ─────────────
  if (type === "low") {
    const catFilter  = category ? `AND ic.category = '${category.replace(/'/g,"''")}'` : "";
    const brandFilter= brand    ? `AND ic.brand = '${brand.replace(/'/g,"''")}'`       : "";

    const [vel, wsRows] = await Promise.all([
      fetchNavVelocity(30),
      query<{ item_no: string; description: string; brand: string; category: string; colour_exact: string; size: string; line_name: string; in_stock: string; unit_price: string }>(`
        SELECT ws.item_no,
               COALESCE(ic.description, ws.description) AS description,
               ic.brand, ic.category, ic.colour_exact, ic.size, ic.line_name,
               ws.in_stock::numeric, ws.unit_price::numeric
        FROM warehouse_stock ws
        LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
        WHERE ws.in_stock > 0 AND ws.in_stock <= 10
          ${catFilter} ${brandFilter}
      `),
    ]);

    const items = wsRows
      .map(r => {
        const sold30 = vel.get(r.item_no)?.units ?? 0;
        const stock  = parseFloat(r.in_stock);
        return {
          ...r,
          in_stock:       stock,
          units_sold_30d: sold30,
          unit_price:     parseFloat(r.unit_price || "0"),
          daysRemaining:  sold30 > 0 ? Math.round(stock / (sold30 / 30)) : null,
        };
      })
      .filter(r => r.units_sold_30d > 0)
      .sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999))
      .slice(0, 50);

    return NextResponse.json({ items, fx, range });
  }

  // ── SLOW MOVERS: in stock, barely selling ────────────────────────────────
  const catFilter  = category ? `AND ic.category = '${category.replace(/'/g,"''")}'` : "";
  const brandFilter= brand    ? `AND ic.brand = '${brand.replace(/'/g,"''")}'`       : "";

  const [vel, wsRows] = await Promise.all([
    fetchNavVelocity(days),
    query<{ item_no: string; description: string; brand: string; category: string; colour_exact: string; size: string; in_stock: string; unit_price: string }>(`
      SELECT ws.item_no,
             COALESCE(ic.description, ws.description) AS description,
             ic.brand, ic.category, ic.colour_exact, ic.size,
             ws.in_stock::numeric, ws.unit_price::numeric
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 5
        ${catFilter} ${brandFilter}
    `),
  ]);

  const items = wsRows
    .map(r => ({
      ...r,
      in_stock:   parseFloat(r.in_stock),
      units_sold: vel.get(r.item_no)?.units ?? 0,
      unit_price: parseFloat(r.unit_price || "0"),
    }))
    .sort((a, b) => a.units_sold - b.units_sold)
    .slice(0, 50);

  return NextResponse.json({ items, fx, range });
}
