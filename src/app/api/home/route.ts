// v2026-06-15
import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";

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
  if (["ONLINE","NOON","JUMIA"].includes(code)) return "Ecom";
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

  const [fxRow, storeRows, topProducts, catRows, storeWoW, descRows] = await Promise.all([

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

    query<{ item_no: string; description: string }>(
      "SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"
    ),

    navQuery<{ store: string; this7: number; prev7: number }>(`
      SELECT
        [Store No_] AS store,
        -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN @d7ago AND @today THEN [Net Amount] + [VAT Amount] ELSE 0 END) AS this7,
        -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN @d14ago AND @d8ago THEN [Net Amount] + [VAT Amount] ELSE 0 END) AS prev7
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) >= @d14ago
      GROUP BY [Store No_]
    `, { today, d7ago, d14ago, d8ago }),
  ]);

  const descMap = Object.fromEntries(descRows.map(r => [r.item_no, r.description]));

  const fx       = parseFloat(fxRow[0]?.egp_per_usd || "50");
  const totalRev = storeRows.reduce((s, r) => s + Number(r.egp), 0);

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

  const channelTotals = ["Retail","Ecom","B2B"].map(grp => {
    const filtered = stores.filter(s => s.group === grp);
    const egp      = filtered.reduce((s, r) => s + r.egp, 0);
    return {
      group:      grp,
      egp,
      usd:        Math.round(egp / fx),
      units:      filtered.reduce((s, r) => s + r.units, 0),
      pct:        totalRev > 0 ? Math.round(egp * 100 / totalRev) : 0,
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

  const products = topProducts.map(r => ({
    item_no:     r.item_no,
    description: descMap[r.item_no] || r.item_no,
    brand:       brandLabel(r.brand),
    category:    r.category || "",
    egp:         Math.round(Number(r.egp)),
    usd:         Math.round(Number(r.egp) / fx),
    units:       Math.round(Number(r.units)),
    pct:         totalRev > 0 ? Math.round(Number(r.egp) * 100 / totalRev) : 0,
  }));

  return NextResponse.json({
    stores,
    channelTotals,
    brands:     [],   // brand data not in NAV, kept for schema compat
    categories,
    products,
    totalRev:   Math.round(totalRev),
    fx,
    freshness:  [{ source: "nav", maxDate: today, lagDays: 0 }],
  });
}
