import { NextRequest, NextResponse } from "next/server";
import { query, SALES_FILTER } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "30d";

  let days = 30;
  if (range === "7d") days = 7;
  else if (range === "90d") days = 90;
  else if (range === "12m") days = 365;

  const [storeRows, fxRow, categoryRows] = await Promise.all([
    query<{ store_code: string; revenue: string; units: string }>(`
      SELECT
        store_code,
        SUM(sales_amount)::numeric AS revenue,
        SUM(-invoiced_qty)::numeric AS units
      FROM nav_sales
      WHERE ${SALES_FILTER} AND posting_date >= CURRENT_DATE - interval '${days} days'
      GROUP BY store_code
      ORDER BY revenue DESC
    `),
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),
    query<{ category: string; revenue: string; units: string }>(`
      SELECT
        COALESCE(ic.category, 'Other') AS category,
        SUM(n.sales_amount)::numeric AS revenue,
        SUM(-n.invoiced_qty)::numeric AS units
      FROM nav_sales n
      LEFT JOIN item_categorisation ic ON n.item_no = ic.item_no
      WHERE ${SALES_FILTER} AND n.posting_date >= CURRENT_DATE - interval '${days} days'
      GROUP BY 1
      ORDER BY revenue DESC
    `),
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");
  const totalRev = storeRows.reduce((s, r) => s + parseFloat(r.revenue), 0);

  const RETAIL = new Set(["ALMAZA","ATCFC","ATMADI","CCA","CF-HOS","CSTARS","DUTY FREE","FOUR SEASO","GO SPORT1","MOA","MOE","P90","SPINNEYS"]);
  const ONLINE = new Set(["AMAZON","AMAZON BAN","AMAZON KAM","JUMIA","NOON","ONLINE"]);

  function groupLabel(code: string) {
    if (RETAIL.has(code)) return "Retail";
    if (ONLINE.has(code)) return "Online";
    return "HO";
  }

  const stores = storeRows.map((r) => {
    const rev = parseFloat(r.revenue);
    return {
      code: r.store_code,
      group: groupLabel(r.store_code),
      revenue: { egp: Math.round(rev), usd: Math.round(rev / fx) },
      units: parseFloat(r.units),
      pct: totalRev > 0 ? Math.round((rev / totalRev) * 100) : 0,
    };
  });

  const channelTotals = ["Retail", "Online", "HO"].map((grp) => {
    const filtered = stores.filter((s) => s.group === grp);
    const rev = filtered.reduce((s, r) => s + r.revenue.egp, 0);
    const units = filtered.reduce((s, r) => s + r.units, 0);
    return {
      group: grp,
      revenue: { egp: Math.round(rev), usd: Math.round(rev / fx) },
      units,
      pct: totalRev > 0 ? Math.round((rev / totalRev) * 100) : 0,
    };
  });

  const categories = categoryRows.map((r) => {
    const rev = parseFloat(r.revenue);
    const totalCat = categoryRows.reduce((s, c) => s + parseFloat(c.revenue), 0);
    return {
      category: r.category,
      revenue: { egp: Math.round(rev), usd: Math.round(rev / fx) },
      units: parseFloat(r.units),
      pct: totalCat > 0 ? Math.round((rev / totalCat) * 100) : 0,
    };
  });

  return NextResponse.json({ stores, channelTotals, categories, total: { egp: Math.round(totalRev), usd: Math.round(totalRev / fx) }, fx, range });
}
