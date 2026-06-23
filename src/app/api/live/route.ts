import { NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue } from "@/lib/shopify";
import { safeSource, isDegraded } from "@/lib/resilience";

export const dynamic = "force-dynamic";

const RETAIL = ["ALMAZA", "CCA", "CF-HOS", "CSTARS", "P90", "MOA", "MOE", "HIS", "MC"];
const STORE_NAMES: Record<string, string> = {
  ALMAZA: "Almaza City Center", CCA: "Alexandria", "CF-HOS": "Cairo Festival City",
  CSTARS: "City Stars", P90: "Point 90", MOA: "Mall of Arabia", MOE: "Mall of Egypt",
  HIS: "His Store", MC: "Maadi City Centre",
};

interface StoreRow { store: string; egp: number; units: number }
interface FxRow { egp_per_usd: string }

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const yest  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const retailIn = RETAIL.map(s => `'${s}'`).join(",");

  try {
    const [navResult, fxResult, shopTodayResult, shopYestResult] = await Promise.all([
      safeSource<[StoreRow[], { egp: number }[]]>("nav", () => Promise.all([
        navQuery<StoreRow>(`
          SELECT [Store No_] AS store, -SUM([Net Amount] + [VAT Amount]) AS egp, -SUM([Quantity]) AS units
          FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) = @today AND [Store No_] IN (${retailIn})
          GROUP BY [Store No_]
        `, { today }),
        navQuery<{ egp: number }>(`
          SELECT -SUM([Net Amount] + [VAT Amount]) AS egp FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) = @yest AND [Store No_] IN (${retailIn})
        `, { yest }),
      ]), [[], []]),
      safeSource<FxRow[]>("pg", () => query<FxRow>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"), []),
      safeSource("shopify", () => getShopifyRevenue(today, today), { egp: 0, units: 0 }),
      safeSource("shopify", () => getShopifyRevenue(yest, yest), { egp: 0, units: 0 }),
    ]);

    const [storeRows, yestRows] = navResult.value;
    const fx = parseFloat(fxResult.value[0]?.egp_per_usd || "50");
    const sources = { nav: navResult.status, shopify: shopTodayResult.status, pg: fxResult.status };

    const stores = storeRows
      .map(r => ({ code: r.store, name: STORE_NAMES[r.store] ?? r.store, group: "Retail", egp: Math.round(Number(r.egp)), units: Math.round(Number(r.units)) }))
      .filter(s => s.egp > 0 || s.units > 0);

    // Always include the Online (Ecom) bar — it's one of the six, and live.
    stores.push({ code: "ECOM", name: "Online (Ecom)", group: "Ecom", egp: Math.round(shopTodayResult.value.egp), units: Math.round(shopTodayResult.value.units) });
    stores.sort((a, b) => b.egp - a.egp);

    const totalEgp = stores.reduce((s, r) => s + r.egp, 0);
    const totalUnits = stores.reduce((s, r) => s + r.units, 0);
    const yesterdayTotal = Math.round(Number(yestRows[0]?.egp || 0)) + Math.round(shopYestResult.value.egp);

    return NextResponse.json({
      asOf: new Date().toISOString(),
      today,
      stores,
      total: { egp: totalEgp, usd: Math.round(totalEgp / fx), units: totalUnits },
      yesterdayTotal,
      fx,
      sources,
      degraded: isDegraded(sources),
    });
  } catch (e) {
    console.error("[live] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      asOf: new Date().toISOString(), today, stores: [], total: { egp: 0, usd: 0, units: 0 },
      yesterdayTotal: 0, fx: 50, sources: { nav: "offline", shopify: "offline", pg: "offline" }, degraded: true,
    }, { status: 200 });
  }
}
