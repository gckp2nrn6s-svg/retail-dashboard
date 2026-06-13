import { NextRequest, NextResponse } from "next/server";
import { query, STORE_GROUPS } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "30d";
  const store = searchParams.get("store") || "all";
  const group = searchParams.get("group") || "all"; // all | retail | online | ho(b2b)
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  let days = 30;
  if (range === "7d") days = 7;
  else if (range === "90d") days = 90;
  else if (range === "12m") days = 365;

  const retailArr = STORE_GROUPS.physical.map(s => `'${s}'`).join(",");
  const onlineArr = STORE_GROUPS.online.map(s => `'${s}'`).join(",");
  const b2bArr    = STORE_GROUPS.b2b.map(s => `'${s}'`).join(",");

  const storeFilter =
    store !== "all"
      ? `AND store_code = '${store.replace(/'/g, "''")}'`
      : group === "retail"
      ? `AND store_code = ANY(ARRAY[${retailArr}])`
      : group === "online"
      ? `AND store_code = ANY(ARRAY[${onlineArr}])`
      : group === "ho"
      ? `AND store_code = ANY(ARRAY[${b2bArr}])`
      : "";

  const groupBy = (fromParam && toParam)
    ? (Math.ceil((new Date(toParam).getTime() - new Date(fromParam).getTime()) / 86400000) > 91 ? "week" : "day")
    : (range === "12m" ? "week" : "day");

  const dateFilter = fromParam && toParam
    ? `sale_date BETWEEN '${fromParam}' AND '${toParam}'`
    : `sale_date >= CURRENT_DATE - interval '${days} days'`;

  const rows = await query<{ period: string; revenue: string; units: string }>(`
    SELECT
      date_trunc('${groupBy}', sale_date)::date AS period,
      SUM(revenue)::numeric AS revenue,
      SUM(units)::numeric   AS units
    FROM all_sales
    WHERE ${dateFilter}
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
