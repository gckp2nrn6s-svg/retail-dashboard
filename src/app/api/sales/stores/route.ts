import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue } from "@/lib/shopify";

function groupOf(code: string) {
  if (["ALMAZA","CCA","CF-HOS","CSTARS","P90","MOA","MOE","HIS","MC"].includes(code)) return "Retail";
  if (["ONLINE","NOON","JUMIA"].includes(code)) return "Ecom";
  return "B2B";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  const from = fromParam || new Date().toISOString().slice(0, 8) + "01";
  const to   = toParam   || new Date().toISOString().slice(0, 10);

  const [storeRows, fxRow, categoryRows, shopify] = await Promise.all([
    navQuery<{ store: string; revenue: number; units: number }>(`
      SELECT
        [Store No_]        AS store,
        -SUM([Net Amount] + [VAT Amount]) AS revenue,
        -SUM([Quantity])   AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
      GROUP BY [Store No_]
      ORDER BY revenue DESC
    `, { from, to }),

    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    navQuery<{ category: string; revenue: number; units: number }>(`
      SELECT
        CASE
          WHEN [Item Category Code] = 'SAMSONITE' THEN 'Samsonite'
          WHEN [Item Category Code] = 'AM-TOUR'   THEN 'American Tourister'
          WHEN [Item Category Code] != ''          THEN [Item Category Code]
          ELSE 'Other'
        END AS category,
        -SUM([Net Amount] + [VAT Amount]) AS revenue,
        -SUM([Quantity])   AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
      GROUP BY [Item Category Code]
      ORDER BY revenue DESC
    `, { from, to }),

    getShopifyRevenue(from, to),
  ]);

  const fx          = parseFloat(fxRow[0]?.egp_per_usd || "50");
  const navTotal    = storeRows.reduce((s, r) => s + Number(r.revenue), 0);
  const shopifyEgp  = Math.round(shopify.egp);
  const shopifyUnits = Math.round(shopify.units);
  const grandTotal  = navTotal + shopifyEgp;

  const stores = storeRows.map((r) => {
    const rev = Number(r.revenue);
    return {
      code:    r.store,
      group:   groupOf(r.store),
      revenue: { egp: Math.round(rev), usd: Math.round(rev / fx) },
      units:   Math.round(Number(r.units)),
      pct:     grandTotal > 0 ? Math.round((rev / grandTotal) * 100) : 0,
    };
  });

  const channelTotals = ["Retail", "Ecom", "B2B"].map((grp) => {
    const filtered  = stores.filter((s) => s.group === grp);
    const navRev    = filtered.reduce((s, r) => s + r.revenue.egp, 0);
    const rev       = grp === "Ecom" ? navRev + shopifyEgp : navRev;
    const units     = grp === "Ecom"
      ? filtered.reduce((s, r) => s + r.units, 0) + shopifyUnits
      : filtered.reduce((s, r) => s + r.units, 0);
    return {
      group:   grp,
      revenue: { egp: rev, usd: Math.round(rev / fx) },
      units,
      pct:     grandTotal > 0 ? Math.round((rev / grandTotal) * 100) : 0,
    };
  });

  const totalCat = categoryRows.reduce((s, r) => s + Number(r.revenue), 0);
  const categories = categoryRows.map((r) => {
    const rev = Number(r.revenue);
    return {
      category: r.category,
      revenue:  { egp: Math.round(rev), usd: Math.round(rev / fx) },
      units:    Math.round(Number(r.units)),
      pct:      totalCat > 0 ? Math.round((rev / totalCat) * 100) : 0,
    };
  });

  return NextResponse.json({
    stores,
    channelTotals,
    categories,
    total: { egp: grandTotal, usd: Math.round(grandTotal / fx) },
    fx,
  });
}
