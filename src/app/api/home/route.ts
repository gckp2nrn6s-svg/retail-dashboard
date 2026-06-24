// v2026-06-15
import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenueAndItems } from "@/lib/shopify";
import { safeSource, isDegraded } from "@/lib/resilience";
import { getB2BRevenue } from "@/lib/b2b-revenue";
import { navDateToISO, lagDaysFrom } from "@/lib/dates";
import type { ShopifyLineItemRow } from "@/lib/shopify";

export const dynamic = "force-dynamic"; // always reflect live sources, never cache

const STORE_NAMES: Record<string, string> = {
  ALMAZA:      "Almaza City Center",
  CCA:         "Alexandria",
  "CF-HOS":    "Cairo Festival City",
  CSTARS:      "City Stars",
  P90:         "Point 90",
  MOA:         "Mall of Arabia",
  MOE:         "Mall of Egypt",
  HIS:         "His Store",
  MC:          "Maadi City Centre",
  ONLINE:      "Own Website",
  NOON:        "Noon",
  JUMIA:       "Jumia",
  HO:          "HO / Wholesale",
  "GO SPORT1": "Go Sport",
  ATCFC:       "AT Cairo Festival",
  EVENT:       "Events",
};

function groupOf(code: string) {
  if (["ALMAZA","CCA","CF-HOS","CSTARS","P90","MOA","MOE","HIS","MC"].includes(code)) return "Retail";
  if (["NOON","JUMIA"].includes(code)) return "Ecom"; // ONLINE excluded — use Shopify for own website
  return "B2B";
}

interface StoreRow   { store: string; egp: number; units: number }
interface ProductRow { item_no: string; description: string; brand: string; category: string; egp: number; units: number }
interface CatRow     { category: string; egp: number; units: number }
interface WoWRow     { store: string; this7: number; prev7: number }
interface MaxDateRow { max_date: string }
interface FxRow      { egp_per_usd: string }
interface DescRow    { item_no: string; description: string }
interface SkuRow     { sku: string; item_no: string }

type NavBundle = {
  storeRows: StoreRow[];
  topProducts: ProductRow[];
  catRows: CatRow[];
  storeWoW: WoWRow[];
  navMaxDateRows: MaxDateRow[];
  b2b: { egp: number; units: number };
};
type PgBundle = { fxRow: FxRow[]; descRows: DescRow[]; skuMap: SkuRow[] };
type ShopBundle = { egp: number; units: number; items: ShopifyLineItemRow[] };

export async function GET(req: NextRequest) {
  const p    = new URL(req.url).searchParams;
  const from = p.get("from") || new Date().toISOString().slice(0, 8) + "01";
  const to   = p.get("to")   || new Date().toISOString().slice(0, 10);

  const today     = new Date().toISOString().slice(0, 10);
  const d7ago     = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const d14ago    = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const d8ago     = new Date(Date.now() - 8  * 86400000).toISOString().slice(0, 10);

  try {
    // Three isolated source groups, run in parallel. NAV failing no longer
    // zeroes Shopify or Postgres — Shopify revenue always renders.
    const [navResult, pgResult, shopResult] = await Promise.all([
      safeSource<NavBundle>("nav", async () => {
        const [storeRows, topProducts, catRows, storeWoW, navMaxDateRows, b2b] = await Promise.all([
          navQuery<StoreRow>(`
            SELECT
              [Store No_]        AS store,
              -SUM([Net Amount] + [VAT Amount]) AS egp,
              -SUM([Quantity])   AS units
            FROM TransSalesEntry
            WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
              AND [Store No_] != 'ONLINE'
            GROUP BY [Store No_]
            ORDER BY egp DESC
          `, { from, to }),
          navQuery<ProductRow>(`
            SELECT TOP 8
              [Item No_]           AS item_no,
              [Item No_] AS description,
              MAX([Item Category Code]) AS brand,
              MAX([Product Group Code]) AS category,
              -SUM([Net Amount] + [VAT Amount]) AS egp,
              -SUM([Quantity])                  AS units
            FROM TransSalesEntry
            WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] != 'ONLINE'
            GROUP BY [Item No_]
            ORDER BY egp DESC
          `, { from, to }),
          navQuery<CatRow>(`
            SELECT
              CASE
                WHEN [Item Category Code] = 'SAMSONITE' THEN 'Samsonite'
                WHEN [Item Category Code] = 'AM-TOUR'   THEN 'American Tourister'
                WHEN [Item Category Code] != ''          THEN [Item Category Code]
                ELSE 'Other'
              END AS category,
              -SUM([Net Amount] + [VAT Amount]) AS egp,
              -SUM([Quantity])   AS units
            FROM TransSalesEntry
            WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] != 'ONLINE'
            GROUP BY [Item Category Code]
            ORDER BY egp DESC
          `, { from, to }),
          navQuery<WoWRow>(`
            SELECT
              [Store No_] AS store,
              -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN @d7ago AND @today THEN [Net Amount] + [VAT Amount] ELSE 0 END) AS this7,
              -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN @d14ago AND @d8ago THEN [Net Amount] + [VAT Amount] ELSE 0 END) AS prev7
            FROM TransSalesEntry
            WHERE CAST([Date] AS DATE) >= @d14ago AND [Store No_] != 'ONLINE'
            GROUP BY [Store No_]
          `, { today, d7ago, d14ago, d8ago }),
          navQuery<MaxDateRow>(
            "SELECT MAX(CAST([Date] AS DATE)) AS max_date FROM TransSalesEntry", {}
          ),
          getB2BRevenue(from, to), // HO invoices — the real B2B channel (not in POS)
        ]);
        return { storeRows, topProducts, catRows, storeWoW, navMaxDateRows, b2b };
      }, { storeRows: [], topProducts: [], catRows: [], storeWoW: [], navMaxDateRows: [], b2b: { egp: 0, units: 0 } }),

      safeSource<PgBundle>("pg", async () => {
        const [fxRow, descRows, skuMap] = await Promise.all([
          query<FxRow>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"),
          query<DescRow>("SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"),
          query<SkuRow>("SELECT sku, item_no FROM shopify_item_map"),
        ]);
        return { fxRow, descRows, skuMap };
      }, { fxRow: [], descRows: [], skuMap: [] }),

      safeSource<ShopBundle>("shopify", () => getShopifyRevenueAndItems(from, to),
        { egp: 0, units: 0, items: [] }),
    ]);

    const { storeRows, topProducts, catRows, storeWoW, navMaxDateRows, b2b } = navResult.value;
    const { fxRow, descRows, skuMap } = pgResult.value;
    const shopify = shopResult.value;
    const shopifyItems = shopify.items;
    const sources = { nav: navResult.status, shopify: shopResult.status, pg: pgResult.status };

    const descMap = Object.fromEntries(descRows.map(r => [r.item_no, r.description]));

    // Build Shopify item_no → { egp, units } from line items via shopify_item_map
    const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
    const shopifyByItem: Record<string, { egp: number; units: number }> = {};
    for (const li of shopifyItems) {
      const itemNo = skuToItemNo[li.sku];
      if (!itemNo) continue;
      if (!shopifyByItem[itemNo]) shopifyByItem[itemNo] = { egp: 0, units: 0 };
      shopifyByItem[itemNo].egp += li.egp;
      shopifyByItem[itemNo].units += li.quantity;
    }

    const fx       = parseFloat(fxRow[0]?.egp_per_usd || "50");
    const totalRev = storeRows.reduce((s, r) => s + Number(r.egp), 0); // NAV only, used for per-store pct

    const wowMap = Object.fromEntries(storeWoW.map(r => {
      const t = Number(r.this7), pv = Number(r.prev7);
      return [r.store, { this7: t, prev7: pv, pct: pv > 0 ? ((t - pv) / pv) * 100 : 0 }];
    }));

    const stores = storeRows.map(r => ({
      code:  r.store,
      name:  STORE_NAMES[r.store] ?? r.store,
      group: groupOf(r.store),
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      pct:   totalRev > 0 ? Math.round(Number(r.egp) * 100 / totalRev) : 0,
      wow:   wowMap[r.store]?.pct ?? null,
      this7: Math.round(wowMap[r.store]?.this7 ?? 0),
    }));

    const shopifyEgp   = Math.round(shopify.egp);
    const shopifyUnits = Math.round(shopify.units);
    const b2bEgp       = Math.round(b2b?.egp ?? 0);
    const b2bUnits     = Math.round(b2b?.units ?? 0);
    // Headline = Retail + Ecom only. B2B (wholesale) is shown as a channel card but
    // kept OUT of the total (like Marketplace) — its pct reads as a share of core.
    const grandTotal   = totalRev + shopifyEgp;

    const channelTotals = ["Retail","Ecom","B2B"].map(grp => {
      const filtered = stores.filter(s => s.group === grp);
      const navEgp   = filtered.reduce((s, r) => s + r.egp, 0);
      const navUnits = filtered.reduce((s, r) => s + r.units, 0);
      // Shopify own-website orders are Ecom (not in NAV); B2B is HO invoices (not in POS).
      const egp   = grp === "Ecom" ? navEgp + shopifyEgp : grp === "B2B" ? navEgp + b2bEgp : navEgp;
      const units = grp === "Ecom" ? navUnits + shopifyUnits : grp === "B2B" ? navUnits + b2bUnits : navUnits;
      return {
        group:      grp,
        egp,
        usd:        Math.round(egp / fx),
        units,
        pct:        grandTotal > 0 ? Math.round(egp * 100 / grandTotal) : 0,
        storeCount: filtered.length,
      };
    });

    const totalCat = catRows.reduce((s, r) => s + Number(r.egp), 0);
    const categories = catRows.map(r => ({
      category: r.category,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      pct:   totalCat > 0 ? Math.round(Number(r.egp) * 100 / totalCat) : 0,
    }));

    function brandLabel(code: string) {
      if (code === "SAMSONITE") return "Samsonite";
      if (code === "AM-TOUR")   return "American Tourister";
      return code || "";
    }

    // Merge Shopify line item sales into NAV top products
    const navItemSet = new Set(topProducts.map(r => r.item_no));
    const mergedProducts = topProducts.map(r => {
      const shopifyItem = shopifyByItem[r.item_no] ?? { egp: 0, units: 0 };
      const totalEgp = Math.round(Number(r.egp) + shopifyItem.egp);
      const totalUnits = Math.round(Number(r.units)) + shopifyItem.units;
      return {
        item_no:     r.item_no,
        description: descMap[r.item_no] || r.item_no,
        brand:       brandLabel(r.brand),
        category:    r.category || "",
        egp:         totalEgp,
        usd:         Math.round(totalEgp / fx),
        units:       totalUnits,
        pct:         grandTotal > 0 ? Math.round(totalEgp * 100 / grandTotal) : 0,
      };
    });

    // Add Shopify-only items (not in NAV top 8) that have meaningful sales
    for (const [itemNo, shopifyItem] of Object.entries(shopifyByItem)) {
      if (navItemSet.has(itemNo)) continue;
      const egp = Math.round(shopifyItem.egp);
      if (egp < 100) continue; // skip noise
      mergedProducts.push({
        item_no:     itemNo,
        description: descMap[itemNo] || itemNo,
        brand:       "",
        category:    "",
        egp,
        usd:         Math.round(egp / fx),
        units:       shopifyItem.units,
        pct:         grandTotal > 0 ? Math.round(egp * 100 / grandTotal) : 0,
      });
    }

    // Re-sort by egp descending and cap at top 8
    const products = mergedProducts.sort((a, b) => b.egp - a.egp).slice(0, 8);

    return NextResponse.json({
      stores,
      channelTotals,
      brands:     [],
      categories,
      products,
      totalRev:   Math.round(totalRev + shopifyEgp),
      fx,
      sources,
      degraded:   isDegraded(sources),
      freshness:  [{
        source:  "nav",
        maxDate: navDateToISO(navMaxDateRows[0]?.max_date) ?? "unknown",
        lagDays: lagDaysFrom(navDateToISO(navMaxDateRows[0]?.max_date)),
      }],
    });
  } catch (e) {
    console.error("[home] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      stores: [], channelTotals: [], brands: [], categories: [], products: [],
      totalRev: 0, fx: 50,
      sources: { nav: "offline", shopify: "offline", pg: "offline" },
      degraded: true,
      freshness: [{ source: "nav", maxDate: "unknown", lagDays: null }],
      error: "Failed to load home data",
    }, { status: 200 });
  }
}
