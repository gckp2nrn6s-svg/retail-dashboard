import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  // Derive comparison period of equal length
  let fromExpr: string;
  let toExpr: string;
  let prevFromExpr: string;
  let prevToExpr: string;

  if (from && to) {
    fromExpr = `'${from}'::date`;
    toExpr   = `'${to}'::date`;
    prevFromExpr = `'${from}'::date - ('${to}'::date - '${from}'::date + 1)`;
    prevToExpr   = `'${from}'::date - interval '1 day'`;
  } else {
    // legacy: default to last 30 days
    fromExpr = "CURRENT_DATE - interval '29 days'";
    toExpr   = "CURRENT_DATE";
    prevFromExpr = "CURRENT_DATE - interval '59 days'";
    prevToExpr   = "CURRENT_DATE - interval '30 days'";
  }

  const [current, previous, fxRow, storeCount] = await Promise.all([
    query<{ revenue: string; units: string }>(`
      SELECT
        COALESCE(SUM(revenue), 0)::numeric AS revenue,
        COALESCE(SUM(units), 0)::numeric   AS units
      FROM all_sales
      WHERE sale_date BETWEEN ${fromExpr} AND ${toExpr}
    `),
    query<{ revenue: string; units: string }>(`
      SELECT
        COALESCE(SUM(revenue), 0)::numeric AS revenue,
        COALESCE(SUM(units), 0)::numeric   AS units
      FROM all_sales
      WHERE sale_date BETWEEN ${prevFromExpr} AND ${prevToExpr}
    `),
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),
    query<{ n: string }>(
      `SELECT COUNT(DISTINCT store_code) n FROM all_sales WHERE sale_date BETWEEN ${fromExpr} AND ${toExpr}`
    ),
  ]);

  const rev = parseFloat(current[0]?.revenue || "0");
  const units = parseFloat(current[0]?.units || "0");
  const prevRev = parseFloat(previous[0]?.revenue || "0");
  const prevUnits = parseFloat(previous[0]?.units || "0");
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");

  const revChange = prevRev > 0 ? ((rev - prevRev) / prevRev) * 100 : null;
  const unitsChange = prevUnits > 0 ? ((units - prevUnits) / prevUnits) * 100 : null;

  return NextResponse.json({
    revenue: { egp: rev, usd: rev / fx },
    units,
    avgTicket: { egp: units > 0 ? rev / units : 0, usd: units > 0 ? rev / units / fx : 0 },
    activeStores: parseInt(storeCount[0]?.n || "0"),
    revChange,
    unitsChange,
    fx,
  });
}
