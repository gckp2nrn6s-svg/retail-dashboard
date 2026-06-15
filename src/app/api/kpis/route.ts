import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";

function safeDate(val: string | null, fallback: string): string {
  if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return fallback;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const thisMonthStart = today.slice(0, 8) + "01";

  const from = safeDate(searchParams.get("from"), thisMonthStart);
  const to   = safeDate(searchParams.get("to"),   today);

  const fromDate = new Date(from);
  const toDate   = new Date(to);
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;

  // Comparison periods
  const prevTo   = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(fromDate.getTime() - spanDays * 86400000).toISOString().slice(0, 10);

  // Yesterday (same-time-of-day proxy: same calendar day last period)
  const yest      = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const d7from    = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const d30from   = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const yoy_from  = new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), fromDate.getDate()).toISOString().slice(0, 10);
  const yoy_to    = new Date(toDate.getFullYear()   - 1, toDate.getMonth(),   toDate.getDate()).toISOString().slice(0, 10);

  // Sparkline: daily revenue for last 30 days
  const sparkStart = d30from;

  const [current, previous, yest_row, d7_row, d30_row, yoy_row, fxRow, storeCount, sparkRows] = await Promise.all([
    navQuery<{ revenue: number; units: number }>(`
      SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
    `, { from, to }),

    navQuery<{ revenue: number; units: number }>(`
      SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @prevFrom AND @prevTo
    `, { prevFrom, prevTo }),

    navQuery<{ revenue: number }>(`
      SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) = @yest
    `, { yest }),

    navQuery<{ revenue: number }>(`
      SELECT -SUM([Net Amount]+[VAT Amount])/7.0 AS revenue
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @d7from AND @today
    `, { d7from, today }),

    navQuery<{ revenue: number }>(`
      SELECT -SUM([Net Amount]+[VAT Amount])/30.0 AS revenue
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @d30from AND @today
    `, { d30from, today }),

    navQuery<{ revenue: number; units: number }>(`
      SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @yoy_from AND @yoy_to
    `, { yoy_from, yoy_to }),

    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    navQuery<{ n: number }>(`
      SELECT COUNT(DISTINCT [Store No_]) AS n FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
    `, { from, to }),

    navQuery<{ day: string; revenue: number }>(`
      SELECT CAST([Date] AS DATE) AS day, -SUM([Net Amount]+[VAT Amount]) AS revenue
      FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @sparkStart AND @today
      GROUP BY CAST([Date] AS DATE) ORDER BY day
    `, { sparkStart, today }),
  ]);

  const rev       = Number(current[0]?.revenue  ?? 0);
  const units     = Number(current[0]?.units    ?? 0);
  const prevRev   = Number(previous[0]?.revenue ?? 0);
  const prevUnits = Number(previous[0]?.units   ?? 0);
  const yestRev   = Number(yest_row[0]?.revenue ?? 0);
  const d7Rev     = Number(d7_row[0]?.revenue   ?? 0); // daily avg
  const d30Rev    = Number(d30_row[0]?.revenue  ?? 0); // daily avg
  const yoyRev    = Number(yoy_row[0]?.revenue  ?? 0);
  const fx        = parseFloat(fxRow[0]?.egp_per_usd || "50");

  function pct(a: number, b: number) { return b > 0 ? ((a - b) / b) * 100 : 0; }

  // Pace: daily run-rate vs estimated daily target (30d avg * 1.1 as proxy)
  const dailyTarget = d30Rev * 1.1;
  const todayRev    = Number((await navQuery<{ revenue: number }>(`
    SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue FROM TransSalesEntry
    WHERE CAST([Date] AS DATE) = @today
  `, { today }))[0]?.revenue ?? 0);
  const paceToTarget = dailyTarget > 0 ? (todayRev / dailyTarget) * 100 : null;

  const sparkline = sparkRows.map(r => Number(r.revenue));

  return NextResponse.json({
    revenue:      { egp: rev, usd: rev / fx },
    revChange:    prevRev > 0 ? pct(rev, prevRev) : null,
    units,
    unitsChange:  prevUnits > 0 ? pct(units, prevUnits) : null,
    avgTicket:    { egp: units > 0 ? rev / units : 0, usd: units > 0 ? rev / units / fx : 0 },
    activeStores: Number(storeCount[0]?.n ?? 0),
    fx,
    sparkline,
    todayRevenue: todayRev,
    pace: paceToTarget !== null ? { pct: paceToTarget, dailyTarget } : null,
    lastUpdated:  new Date().toISOString(),
  });
}
