import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { safeSource, isDegraded } from "@/lib/resilience";
import { MARKETPLACE_WHERE, marketplaceName } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";

interface StaffRow { staff: string; egp: number; units: number; txns: number }
interface DayRow   { date: string; egp: number; units: number }
interface FxRow    { egp_per_usd: string }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || new Date().toISOString().slice(0, 8) + "01";
  const to   = searchParams.get("to")   || new Date().toISOString().slice(0, 10);

  try {
    const [navResult, pgResult] = await Promise.all([
      safeSource<[StaffRow[], DayRow[]]>("nav", () => Promise.all([
        navQuery<StaffRow>(`
          SELECT [Staff ID] AS staff,
                 -SUM([Net Amount] + [VAT Amount]) AS egp,
                 -SUM([Quantity])                  AS units,
                 COUNT(DISTINCT [Transaction No_]) AS txns
          FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) BETWEEN @from AND @to ${MARKETPLACE_WHERE}
          GROUP BY [Staff ID]
        `, { from, to }),
        navQuery<DayRow>(`
          SELECT CONVERT(varchar(10), CAST([Date] AS DATE), 23) AS date,
                 -SUM([Net Amount] + [VAT Amount]) AS egp,
                 -SUM([Quantity])                  AS units
          FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) BETWEEN @from AND @to ${MARKETPLACE_WHERE}
          GROUP BY CAST([Date] AS DATE)
          ORDER BY CAST([Date] AS DATE)
        `, { from, to }),
      ]), [[], []]),

      safeSource<FxRow[]>("pg", () => query<FxRow>(
        "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
      ), []),
    ]);

    const [staffRows, dayRows] = navResult.value;
    const fx = parseFloat(pgResult.value[0]?.egp_per_usd || "50");
    const sources = { nav: navResult.status, pg: pgResult.status };

    const marketplaces = staffRows
      .map(r => {
        const egp = Math.round(Number(r.egp));
        return {
          code:  r.staff,
          name:  marketplaceName(r.staff),
          egp,
          usd:   Math.round(egp / fx),
          units: Math.round(Number(r.units)),
          txns:  Number(r.txns),
          pct:   0,
        };
      })
      .sort((a, b) => b.egp - a.egp);
    // Total from the rounded rows so the cards always sum exactly to the header.
    const total = marketplaces.reduce((s, m) => s + m.egp, 0);
    const totalUnits = marketplaces.reduce((s, m) => s + m.units, 0);
    for (const m of marketplaces) m.pct = total > 0 ? Math.round((m.egp / total) * 100) : 0;

    const series = dayRows.map(r => ({
      date:  String(r.date).slice(0, 10),
      egp:   Math.round(Number(r.egp)),
      units: Math.round(Number(r.units)),
    }));

    return NextResponse.json({
      marketplaces,
      total: { egp: Math.round(total), usd: Math.round(total / fx), units: Math.round(totalUnits) },
      series,
      fx,
      sources,
      degraded: isDegraded(sources),
    });
  } catch (e) {
    console.error("[marketplace] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      marketplaces: [], total: { egp: 0, usd: 0, units: 0 }, series: [], fx: 50,
      sources: { nav: "offline", pg: "offline" }, degraded: true, error: "Failed to load marketplace data",
    }, { status: 200 });
  }
}
