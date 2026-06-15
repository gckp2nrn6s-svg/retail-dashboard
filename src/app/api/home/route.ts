// v2026-06-15
import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue, getShopifyLineItems } from "@/lib/shopify";

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

export async function GET(req: NextRequest) {
  const p    = new URL(req.url).searchParams;
  const from = p.get("from") || new Date().toISOString().slice(0, 8) + "01";
  const to   = p.get("to")   || new Date().toISOString().slice(0, 10);

  const today     = new Date().toISOString().slice(0, 10);
  const d7ago     = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const d14ago    = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const d8ago     = new Date(Date.now() - 8  * 86400000).toISOString().slice(0, 10);

  const [fxRow, storeRows, topProducts, catRows, storeWoW, descRows, shopify, shopifyItems, skuMap] = await Promise.all([

    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    navQuery<{ store: string; egp: number; units: number }>(`
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

    navQuery<{ item_no: string; description: string; brand: string; category: string; egp: number; units: number }>(`
      SELECT TOP 8
        [Item No_]           AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code]) AS brand,
        MAX([Product Group Code]) AS category,
        -SUM([Net Amount] + [VAT Amount]) AS egp,
        -SUM([Quantity])                  AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
      GROUP BY [Item No_]
      ORDER BY egp DESC
    `, { from, to }),

    navQuery<{ category: string; egp: number; units: number }>(`
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
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
      GROUP BY [Item Category Code]
      ORDER BY egp DESC
    `, { from, to }),

    navQuery<{ store: string; this7: number; prev7: number }>(`
      SELECT
        [Store No_] AS store,
        -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN @d7ago AND @today THEN [Net Amount] + [VAT Amount] ELSE 0 END) AS this7,
        -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN @d14ago AND @d8ago THEN [Net Amount] + [VAT Amount] ELSE 0 END) AS prev7
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) >= @d14ago
      GROUP BY [Store No_]
    `, { today, d7ago, d14ago, d8ago }),

    query<{ item_no: string; description: string }>(
      "SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"
    ),

    getShopifyRevenue(from, to),

    getShopifyLineItems(from, to),

    query<{ sku: string; item_no: string }>(
      "SELECT sku, item_no FROM shopify_item_map"
    ),
  ]);

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
    const t = Number(r.this7), p = Number(r.prev7);
    return [r.store, { this7: t, prev7: p, pct: p > 0 ? ((t - p) / p) * 100 : 0 }];
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
  const grandTotal   = totalRev + shopifyEgp;

  const channelTotals = ["Retail","Ecom","B2B"].map(grp => {
    const filtered = stores.filter(s => s.group === grp);
    const navEgp   = filtered.reduce((s, r) => s + r.egp, 0);
    // Shopify own-website orders are Ecom, not in NAV
    const egp      = grp === "Ecom" ? navEgp + shopifyEgp : navEgp;
    const units    = grp === "Ecom"
      ? filtered.reduce((s, r) => s + r.units, 0) + shopifyUnits
      : filtered.reduce((s, r) => s + r.units, 0);
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
    freshness:  [{ source: "nav", maxDate: today, lagDays: 0 }],
  });
}
