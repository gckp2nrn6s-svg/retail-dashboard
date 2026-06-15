import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";

const RETAIL = new Set(["ALMAZA","CCA","CF-HOS","CSTARS","P90","MOA","MOE","HIS","MC"]);
const ONLINE = new Set(["NOON","JUMIA"]); // ONLINE excluded — use Shopify for own website

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromParam  = searchParams.get("from");
  const toParam    = searchParams.get("to");
  const store      = searchParams.get("store") || "all";
  const group      = searchParams.get("group") || "all";

  const from = fromParam || new Date().toISOString().slice(0, 8) + "01";
  const to   = toParam   || new Date().toISOString().slice(0, 10);

  const spanDays = Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86400000
  );
  const groupBy = spanDays > 91 ? "week" : "day";

  // Build store filter
  let storeWhere = "";
  if (store !== "all") {
    storeWhere = `AND [Store No_] = '${store.replace(/'/g, "''")}'`;
  } else if (group === "retail") {
    storeWhere = `AND [Store No_] IN ('ALMAZA','CCA','CF-HOS','CSTARS','P90','MOA','MOE','HIS','MC')`;
  } else if (group === "online" || group === "ecom") {
    storeWhere = `AND [Store No_] IN ('NOON','JUMIA')`;
  } else if (group === "ho" || group === "b2b") {
    storeWhere = `AND [Store No_] IN ('ATCFC','EVENT','HO','GO SPORT1')`;
  }

  const truncExpr = groupBy === "week"
    ? "DATEADD(day, 1 - DATEPART(weekday, [Date]), CAST([Date] AS DATE))"
    : "CAST([Date] AS DATE)";

  const [rows, fxRows] = await Promise.all([
    navQuery<{ period: string; revenue: number; units: number }>(`
      SELECT
        ${truncExpr} AS period,
        -SUM([Net Amount] + [VAT Amount]) AS revenue,
        -SUM([Quantity])   AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
        ${storeWhere}
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr}
    `, { from, to }),

    query<{ week_start: string; egp_per_usd: string }>(
      "SELECT week_start::date AS week_start, egp_per_usd FROM fx_rates ORDER BY week_start"
    ),
  ]);

  const fxMap: Record<string, number> = {};
  for (const r of fxRows) fxMap[r.week_start] = parseFloat(r.egp_per_usd);

  function getFx(date: string): number {
    const d = new Date(date).getTime();
    let closest = 50, closestDiff = Infinity;
    for (const [ws, rate] of Object.entries(fxMap)) {
      const diff = Math.abs(new Date(ws).getTime() - d);
      if (diff < closestDiff) { closestDiff = diff; closest = rate; }
    }
    return closest;
  }

  const series = rows.map((r) => {
    const rev     = Number(r.revenue);
    const dateStr = r.period ? String(r.period).slice(0, 10) : "";
    const fx      = getFx(dateStr);
    return {
      date:  dateStr,
      egp:   Math.round(rev),
      usd:   Math.round(rev / fx),
      units: Math.round(Number(r.units)),
    };
  });

  return NextResponse.json({ series, store, group });
}
