import { NextRequest, NextResponse } from "next/server";
import { query, STORE_NAMES } from "@/lib/db";

const RETAIL = ["ALMAZA","CCA","CF-HOS","CSTARS","P90"];
const ONLINE = ["SHOPIFY-AMT","SHOPIFY-SAM","AMAZON BAN","AMAZON KAM"];

// Parse Shopify SKU line code (first 3 chars) and infer category from product_title
const SHOPIFY_CAT_SQL = `
  CASE
    WHEN LOWER(pt.product_title) LIKE '%spinner%'   OR LOWER(pt.product_title) LIKE '%trolley%'
      OR LOWER(pt.product_title) LIKE '%suitcase%'  OR LOWER(pt.product_title) LIKE '%carry%on%'
      OR LOWER(pt.product_title) LIKE '%hardcase%'  THEN 'Luggage'
    WHEN LOWER(pt.product_title) LIKE '%backpack%'  OR LOWER(pt.product_title) LIKE '%laptop%'
      THEN 'Backpacks'
    WHEN LOWER(pt.product_title) LIKE '%handbag%'   OR LOWER(pt.product_title) LIKE '%tote%'
      OR LOWER(pt.product_title) LIKE '%bag%'        THEN 'Bags'
    WHEN LOWER(pt.product_title) LIKE '%wallet%'    OR LOWER(pt.product_title) LIKE '%belt%'
      OR LOWER(pt.product_title) LIKE '%accessori%' THEN 'Accessories'
    WHEN LOWER(pt.product_title) LIKE '%travel%'    OR LOWER(pt.product_title) LIKE '%pillow%'
      OR LOWER(pt.product_title) LIKE '%lock%'       THEN 'Travel Accessories'
    WHEN pt.product_title IS NOT NULL THEN 'Online Other'
    ELSE CONCAT('Line ', UPPER(LEFT(a.item_no, 3)))
  END
`.trim();

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const from = p.get("from") || new Date().toISOString().slice(0,8) + "01"; // MTD default
  const to   = p.get("to")   || new Date().toISOString().slice(0,10);

  const [fxRow, storeRows, topProducts, brandRows, catRows, storeWoW] = await Promise.all([

    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    // All stores: revenue + units in period
    query<{ store_code: string; egp: string; units: string }>(`
      SELECT store_code,
             SUM(revenue)::numeric AS egp,
             SUM(units)::numeric   AS units
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}'
      GROUP BY store_code ORDER BY egp DESC
    `),

    // Top 8 products by revenue
    query<{ item_no: string; description: string; brand: string; category: string; egp: string; units: string }>(`
      SELECT a.item_no,
             COALESCE(ic.description,
               (SELECT product_title FROM shopify_sales WHERE sku = a.item_no LIMIT 1),
               a.item_no) AS description,
             COALESCE(ic.brand,'') AS brand,
             COALESCE(ic.category,
               CASE WHEN a.source='shopify' THEN 'Online' ELSE 'Other' END
             ) AS category,
             SUM(a.revenue)::numeric AS egp,
             SUM(a.units)::numeric   AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
      GROUP BY a.item_no, ic.description, ic.brand, ic.category, a.source
      ORDER BY egp DESC LIMIT 8
    `),

    // Brand split
    query<{ brand: string; egp: string; units: string }>(`
      SELECT COALESCE(ic.brand, 'Other') AS brand,
             SUM(a.revenue)::numeric AS egp,
             SUM(a.units)::numeric   AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
        AND ic.brand IS NOT NULL
      GROUP BY ic.brand ORDER BY egp DESC LIMIT 6
    `),

    // Category breakdown with Shopify keyword mapping
    query<{ category: string; egp: string; units: string }>(`
      SELECT
        CASE
          WHEN ic.category IS NOT NULL THEN ic.category
          WHEN a.source = 'shopify' THEN ${SHOPIFY_CAT_SQL}
          ELSE 'Uncategorised'
        END AS category,
        SUM(a.revenue)::numeric AS egp,
        SUM(a.units)::numeric   AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      LEFT JOIN LATERAL (
        SELECT product_title FROM shopify_sales WHERE sku = a.item_no LIMIT 1
      ) pt ON true
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
      GROUP BY 1 ORDER BY egp DESC
    `),

    // Store WoW (last 7 days vs prior 7 days) — retail + online
    query<{ store_code: string; this7: string; prev7: string; pct: string }>(`
      SELECT store_code,
             SUM(CASE WHEN sale_date >= CURRENT_DATE - 7  THEN revenue ELSE 0 END)::numeric AS this7,
             SUM(CASE WHEN sale_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 THEN revenue ELSE 0 END)::numeric AS prev7,
             ROUND(
               (SUM(CASE WHEN sale_date >= CURRENT_DATE - 7  THEN revenue ELSE 0 END) -
                SUM(CASE WHEN sale_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 THEN revenue ELSE 0 END)) * 100.0 /
               NULLIF(SUM(CASE WHEN sale_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 THEN revenue ELSE 0 END), 0)
             )::numeric AS pct
      FROM all_sales
      WHERE sale_date >= CURRENT_DATE - 14
      GROUP BY store_code ORDER BY this7 DESC
    `),
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "52");
  const totalRev = storeRows.reduce((s, r) => s + parseFloat(r.egp), 0);

  function groupOf(code: string) {
    if (RETAIL.includes(code)) return "Retail";
    if (ONLINE.includes(code)) return "Online";
    return "B2B";
  }

  const wowMap = Object.fromEntries(storeWoW.map(r => [r.store_code, { this7: parseFloat(r.this7), prev7: parseFloat(r.prev7), pct: parseFloat(r.pct) || 0 }]));

  const stores = storeRows.map(r => ({
    code:   r.store_code,
    name:   STORE_NAMES[r.store_code] ?? r.store_code,
    group:  groupOf(r.store_code),
    egp:    Math.round(parseFloat(r.egp)),
    usd:    Math.round(parseFloat(r.egp) / fx),
    units:  Math.round(parseFloat(r.units)),
    pct:    totalRev > 0 ? Math.round(parseFloat(r.egp) * 100 / totalRev) : 0,
    wow:    wowMap[r.store_code]?.pct ?? null,
    this7:  Math.round(wowMap[r.store_code]?.this7 ?? 0),
  }));

  const channelTotals = ["Retail","Online","B2B"].map(grp => {
    const filtered = stores.filter(s => s.group === grp);
    const egp = filtered.reduce((s,r) => s + r.egp, 0);
    return {
      group: grp,
      egp, usd: Math.round(egp / fx),
      units: filtered.reduce((s,r) => s + r.units, 0),
      pct:   totalRev > 0 ? Math.round(egp * 100 / totalRev) : 0,
      storeCount: filtered.length,
    };
  });

  const totalBrand = brandRows.reduce((s,r) => s + parseFloat(r.egp), 0);
  const brands = brandRows.map(r => ({
    brand: r.brand,
    egp:   Math.round(parseFloat(r.egp)),
    usd:   Math.round(parseFloat(r.egp) / fx),
    units: Math.round(parseFloat(r.units)),
    pct:   totalBrand > 0 ? Math.round(parseFloat(r.egp) * 100 / totalBrand) : 0,
  }));

  const totalCat = catRows.reduce((s,r) => s + parseFloat(r.egp), 0);
  const categories = catRows.map(r => ({
    category: r.category,
    egp:   Math.round(parseFloat(r.egp)),
    usd:   Math.round(parseFloat(r.egp) / fx),
    units: Math.round(parseFloat(r.units)),
    pct:   totalCat > 0 ? Math.round(parseFloat(r.egp) * 100 / totalCat) : 0,
  }));

  const products = topProducts.map(r => ({
    item_no:     r.item_no,
    description: r.description,
    brand:       r.brand,
    category:    r.category,
    egp:         Math.round(parseFloat(r.egp)),
    usd:         Math.round(parseFloat(r.egp) / fx),
    units:       Math.round(parseFloat(r.units)),
    pct:         totalRev > 0 ? Math.round(parseFloat(r.egp) * 100 / totalRev) : 0,
  }));

  return NextResponse.json({
    stores,
    channelTotals,
    brands,
    categories,
    products,
    totalRev: Math.round(totalRev),
    fx,
  });
}
