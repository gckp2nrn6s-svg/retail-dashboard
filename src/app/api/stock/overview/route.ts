import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const [summary, byCategory, byBrand, byColour, bySize, fxRow] = await Promise.all([
    query<{ total: string; in_stock: string; zero_stock: string; low_stock: string; total_units: string }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE in_stock > 0)::int AS in_stock,
        COUNT(*) FILTER (WHERE in_stock = 0)::int AS zero_stock,
        COUNT(*) FILTER (WHERE in_stock > 0 AND in_stock <= 5)::int AS low_stock,
        SUM(in_stock)::numeric AS total_units
      FROM warehouse_stock
    `),
    query<{ category: string; skus: string; units: string }>(`
      SELECT
        COALESCE(ic.category, 'Uncategorised') AS category,
        COUNT(*)::int AS skus,
        SUM(ws.in_stock)::numeric AS units
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 0
      GROUP BY 1 ORDER BY units DESC
    `),
    query<{ brand: string; skus: string; units: string }>(`
      SELECT
        COALESCE(ic.brand, 'Unknown') AS brand,
        COUNT(*)::int AS skus,
        SUM(ws.in_stock)::numeric AS units
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 0
      GROUP BY 1 ORDER BY units DESC
    `),
    query<{ colour_group: string; skus: string; units: string }>(`
      SELECT
        COALESCE(ic.colour_group, 'Unknown') AS colour_group,
        COUNT(*)::int AS skus,
        SUM(ws.in_stock)::numeric AS units
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 0 AND ic.colour_group IS NOT NULL
      GROUP BY 1 ORDER BY units DESC LIMIT 15
    `),
    query<{ size: string; skus: string; units: string }>(`
      SELECT
        ic.size,
        COUNT(*)::int AS skus,
        SUM(ws.in_stock)::numeric AS units
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 0 AND ic.size IS NOT NULL
      GROUP BY 1 ORDER BY units DESC
    `),
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),
    // velocity data for last 30 days
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");
  const s = summary[0];

  // Stock value estimate
  const valueRow = await query<{ value: string }>(`
    SELECT SUM(ws.in_stock * ws.unit_price)::numeric AS value
    FROM warehouse_stock ws WHERE ws.in_stock > 0 AND ws.unit_price > 0
  `);
  const stockValue = parseFloat(valueRow[0]?.value || "0");

  // 30-day velocity
  const velocityRow = await query<{ units_sold: string; revenue: string }>(`
    SELECT SUM(units)::numeric AS units_sold, SUM(revenue)::numeric AS revenue
    FROM all_sales WHERE sale_date >= CURRENT_DATE - 30
  `);

  return NextResponse.json({
    summary: {
      totalSkus: parseInt(s.total),
      inStock: parseInt(s.in_stock),
      zeroStock: parseInt(s.zero_stock),
      lowStock: parseInt(s.low_stock),
      totalUnits: parseFloat(s.total_units),
      stockValue: { egp: Math.round(stockValue), usd: Math.round(stockValue / fx) },
    },
    velocity30d: {
      units: parseFloat(velocityRow[0]?.units_sold || "0"),
      revenue: { egp: Math.round(parseFloat(velocityRow[0]?.revenue || "0")), usd: Math.round(parseFloat(velocityRow[0]?.revenue || "0") / fx) },
    },
    byCategory: byCategory.map((r) => ({ ...r, skus: parseInt(r.skus), units: parseFloat(r.units) })),
    byBrand: byBrand.map((r) => ({ ...r, skus: parseInt(r.skus), units: parseFloat(r.units) })),
    byColour: byColour.map((r) => ({ ...r, skus: parseInt(r.skus), units: parseFloat(r.units) })),
    bySize: bySize.map((r) => ({ ...r, skus: parseInt(r.skus), units: parseFloat(r.units) })),
    fx,
  });
}
