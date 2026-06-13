import { NextRequest, NextResponse } from "next/server";
import { query, SALES_FILTER } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "today";

  let fromExpr: string;
  let prevFromExpr: string;
  let prevToExpr: string;

  switch (range) {
    case "week":
      fromExpr = "date_trunc('week', CURRENT_DATE)";
      prevFromExpr = "date_trunc('week', CURRENT_DATE) - interval '7 days'";
      prevToExpr = "date_trunc('week', CURRENT_DATE) - interval '1 day'";
      break;
    case "month":
      fromExpr = "date_trunc('month', CURRENT_DATE)";
      prevFromExpr = "date_trunc('month', CURRENT_DATE) - interval '1 month'";
      prevToExpr = "date_trunc('month', CURRENT_DATE) - interval '1 day'";
      break;
    case "year":
      fromExpr = "date_trunc('year', CURRENT_DATE)";
      prevFromExpr = "date_trunc('year', CURRENT_DATE) - interval '1 year'";
      prevToExpr = "date_trunc('year', CURRENT_DATE) - interval '1 day'";
      break;
    default: // today
      fromExpr = "CURRENT_DATE";
      prevFromExpr = "CURRENT_DATE - interval '1 day'";
      prevToExpr = "CURRENT_DATE - interval '1 day'";
  }

  const [current, previous, fxRow, storeCount] = await Promise.all([
    query<{ revenue: string; units: string; orders: string }>(`
      SELECT
        COALESCE(SUM(sales_amount), 0)::numeric AS revenue,
        COALESCE(SUM(-invoiced_qty), 0)::numeric AS units,
        COUNT(DISTINCT item_no)::int AS orders
      FROM nav_sales
      WHERE ${SALES_FILTER} AND posting_date >= ${fromExpr}
    `),
    query<{ revenue: string; units: string }>(`
      SELECT
        COALESCE(SUM(sales_amount), 0)::numeric AS revenue,
        COALESCE(SUM(-invoiced_qty), 0)::numeric AS units
      FROM nav_sales
      WHERE ${SALES_FILTER} AND posting_date BETWEEN ${prevFromExpr} AND ${prevToExpr}
    `),
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),
    query<{ n: string }>(
      `SELECT COUNT(DISTINCT store_code) n FROM nav_sales WHERE ${SALES_FILTER} AND posting_date >= ${fromExpr}`
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
    range,
  });
}
