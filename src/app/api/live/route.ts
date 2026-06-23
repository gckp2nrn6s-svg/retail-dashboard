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

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: Request) {
  const today = iso(new Date());
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") || today;
  const to   = sp.get("to")   || today;

  // Previous equal-length period, immediately before [from] — generalises the
  // "vs yesterday" comparison to any range (single day today → yesterday).
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD   = new Date(`${to}T00:00:00Z`);
  const rangeDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
  const prevTo   = new Date(fromD.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (rangeDays - 1) * 86400000);
  const prevFromS = iso(prevFrom), prevToS = iso(prevTo);

  const retailIn = RETAIL.map(s => `'${s}'`).join(",");

  try {
    const [navResult, fxResult, shopResult, shopPrevResult] = await Promise.all([
      safeSource<[StoreRow[], { egp: number }[]]>("nav", () => Promise.all([
        navQuery<StoreRow>(`
          SELECT [Store No_] AS store, -SUM([Net Amount] + [VAT Amount]) AS egp, -SUM([Quantity]) AS units
          FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] IN (${retailIn})
          GROUP BY [Store No_]
        `, { from, to }),
        navQuery<{ egp: number }>(`
          SELECT -SUM([Net Amount] + [VAT Amount]) AS egp FROM TransSalesEntry
          WHERE CAST([Date] AS DATE) BETWEEN @prevFrom AND @prevTo AND [Store No_] IN (${retailIn})
        `, { prevFrom: prevFromS, prevTo: prevToS }),
      ]), [[], []]),
      safeSource<FxRow[]>("pg", () => query<FxRow>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"), []),
      safeSource("shopify", () => getShopifyRevenue(from, to), { egp: 0, units: 0 }),
      safeSource("shopify", () => getShopifyRevenue(prevFromS, prevToS), { egp: 0, units: 0 }),
    ]);

    const [storeRows, prevRows] = navResult.value;
    const fx = parseFloat(fxResult.value[0]?.egp_per_usd || "50");
    const sources = { nav: navResult.status, shopify: shopResult.status, pg: fxResult.status };

    const stores = storeRows
      .map(r => ({ code: r.store, name: STORE_NAMES[r.store] ?? r.store, group: "Retail", egp: Math.round(Number(r.egp)), units: Math.round(Number(r.units)) }))
      .filter(s => s.egp > 0 || s.units > 0);

    // Always include the Online (Ecom) bar — it's one of the six, and live.
    stores.push({ code: "ECOM", name: "Online (Ecom)", group: "Ecom", egp: Math.round(shopResult.value.egp), units: Math.round(shopResult.value.units) });
    stores.sort((a, b) => b.egp - a.egp);

    const totalEgp = stores.reduce((s, r) => s + r.egp, 0);
    const totalUnits = stores.reduce((s, r) => s + r.units, 0);
    const prevTotal = Math.round(Number(prevRows[0]?.egp || 0)) + Math.round(shopPrevResult.value.egp);

    return NextResponse.json({
      asOf: new Date().toISOString(),
      today, from, to, rangeDays,
      stores,
      total: { egp: totalEgp, usd: Math.round(totalEgp / fx), units: totalUnits },
      prevTotal, prevFrom: prevFromS, prevTo: prevToS,
      fx,
      sources,
      degraded: isDegraded(sources),
    });
  } catch (e) {
    console.error("[live] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      asOf: new Date().toISOString(), today, from, to, rangeDays: 1, stores: [], total: { egp: 0, usd: 0, units: 0 },
      prevTotal: 0, prevFrom: prevFromS, prevTo: prevToS, fx: 50, sources: { nav: "offline", shopify: "offline", pg: "offline" }, degraded: true,
    }, { status: 200 });
  }
}
