import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue } from "@/lib/shopify";
import { getB2BRevenue } from "@/lib/b2b-revenue";
import { safeSource, isDegraded } from "@/lib/resilience";

export const dynamic = "force-dynamic"; // always reflect live sources, never cache

function groupOf(code: string) {
  if (["ALMAZA","CCA","CF-HOS","CSTARS","P90","MOA","MOE","HIS","MC"].includes(code)) return "Retail";
  if (["NOON","JUMIA"].includes(code)) return "Ecom"; // ONLINE excluded — use Shopify for own website
  return "B2B";
}

interface StoreRow { store: string; revenue: number; units: number }
interface CatRow   { category: string; revenue: number; units: number }
interface FxRow    { egp_per_usd: string }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  const from = fromParam || new Date().toISOString().slice(0, 8) + "01";
  const to   = toParam   || new Date().toISOString().slice(0, 10);

  try {
    // Each source is isolated: a NAV outage no longer zeroes Shopify or FX.
    const [navResult, pgResult, shopResult] = await Promise.all([
      safeSource<[StoreRow[], CatRow[], { egp: number; units: number }]>("nav", () => Promise.all([
        navQuery<StoreRow>(`
          SELECT
            [Store No_]        AS store,
            -SUM([Net Amount] + [VAT Amount]) AS revenue,
            -SUM([Quantity])   AS units
          FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
            AND [Store No_] != 'ONLINE'
          GROUP BY [Store No_]
          ORDER BY revenue DESC
        `, { from, to }),
        navQuery<CatRow>(`
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
          WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] != 'ONLINE'
          GROUP BY [Item Category Code]
          ORDER BY revenue DESC
        `, { from, to }),
        getB2BRevenue(from, to), // HO invoices — the real B2B channel (not in POS)
      ]), [[], [], { egp: 0, units: 0 }]),

      safeSource<FxRow[]>("pg", () => query<FxRow>(
        // Time-aware: the rate in effect at the END of the viewed period.
        "SELECT egp_per_usd FROM fx_rates WHERE week_start <= $1 ORDER BY week_start DESC LIMIT 1", [to]
      ), []),

      safeSource("shopify", () => getShopifyRevenue(from, to), { egp: 0, units: 0 }),
    ]);

    const [storeRows, categoryRows, b2b] = navResult.value;
    const fxRow   = pgResult.value;
    const shopify = shopResult.value;
    const sources = { nav: navResult.status, shopify: shopResult.status, pg: pgResult.status };

    const fx          = parseFloat(fxRow[0]?.egp_per_usd || "50");
    const navTotal    = storeRows.reduce((s, r) => s + Number(r.revenue), 0);
    const shopifyEgp  = Math.round(shopify.egp);
    const shopifyUnits = Math.round(shopify.units);
    const b2bEgp      = Math.round(b2b?.egp ?? 0);
    const b2bUnits    = Math.round(b2b?.units ?? 0);
    // Headline = Retail + Ecom only. B2B shown as a channel card but kept out of the total.
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
      const navUnits  = filtered.reduce((s, r) => s + r.units, 0);
      const rev       = grp === "Ecom" ? navRev + shopifyEgp : grp === "B2B" ? navRev + b2bEgp : navRev;
      const units     = grp === "Ecom" ? navUnits + shopifyUnits : grp === "B2B" ? navUnits + b2bUnits : navUnits;
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
      sources,
      degraded: isDegraded(sources),
    });
  } catch (e) {
    // Last-resort safety net — never return a raw 500 that the client reads as 0.
    console.error("[sales/stores] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      stores: [], channelTotals: [], categories: [],
      total: { egp: 0, usd: 0 }, fx: 50,
      sources: { nav: "offline", shopify: "offline", pg: "offline" },
      degraded: true,
      error: "Failed to load sales data",
    }, { status: 200 });
  }
}
