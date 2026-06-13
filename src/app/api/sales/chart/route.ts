import { NextRequest, NextResponse } from "next/server";
import { query, SALES_FILTER } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "30d";
  const store = searchParams.get("store") || "all";
  const group = searchParams.get("group") || "all"; // all | retail | online | ho

  let days = 30;
  if (range === "7d") days = 7;
  else if (range === "90d") days = 90;
  else if (range === "12m") days = 365;

  const storeFilter =
    store !== "all"
      ? `AND store_code = '${store.replace(/'/g, "''")}'`
      : group === "retail"
      ? `AND store_code = ANY(ARRAY['ALMAZA','ATCFC','ATMADI','CCA','CF-HOS','CSTARS','DUTY FREE','FOUR SEASO','GO SPORT1','MOA','MOE','P90','SPINNEYS'])`
      : group === "online"
      ? `AND store_code = ANY(ARRAY['AMAZON','AMAZON BAN','AMAZON KAM','JUMIA','NOON','ONLINE'])`
      : group === "ho"
      ? `AND store_code = 'HO'`
      : "";

  const groupBy = range === "12m" ? "week" : "day";

  const rows = await query<{ period: string; revenue: string; units: string }>(`
    SELECT
      date_trunc('${groupBy}', posting_date)::date AS period,
      SUM(sales_amount)::numeric AS revenue,
      SUM(-invoiced_qty)::numeric AS units
    FROM nav_sales
    WHERE ${SALES_FILTER}
      AND posting_date >= CURRENT_DATE - interval '${days} days'
      ${storeFilter}
    GROUP BY 1
    ORDER BY 1
  `);

  const fxRows = await query<{ week_start: string; egp_per_usd: string }>(
    `SELECT week_start::date as week_start, egp_per_usd FROM fx_rates ORDER BY week_start`
  );
  const fxMap: Record<string, number> = {};
  for (const r of fxRows) fxMap[r.week_start] = parseFloat(r.egp_per_usd);

  function getFx(date: string): number {
    const d = new Date(date);
    let closest = 50;
    let closestDiff = Infinity;
    for (const [ws, rate] of Object.entries(fxMap)) {
      const diff = Math.abs(new Date(ws).getTime() - d.getTime());
      if (diff < closestDiff) { closestDiff = diff; closest = rate; }
    }
    return closest;
  }

  const series = rows.map((r) => {
    const rev = parseFloat(r.revenue);
    const fx = getFx(r.period);
    return {
      date: r.period,
      egp: Math.round(rev),
      usd: Math.round(rev / fx),
      units: parseFloat(r.units),
    };
  });

  return NextResponse.json({ series, range, store, group });
}
