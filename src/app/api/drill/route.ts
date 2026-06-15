import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenueSplit, getShopifyLineItems } from "@/lib/shopify";

const RETAIL_STORES = ["ALMAZA","CCA","CF-HOS","CSTARS","P90","MOA","MOE","HIS","MC"];
const ECOM_STORES   = ["NOON","JUMIA"]; // ONLINE excluded — Shopify is the source for own website
// B2B = everything else (HO, GO SPORT1, ATCFC, EVENT, ...)

const STORE_NAMES: Record<string,string> = {
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
function sn(code: string) { return STORE_NAMES[code] ?? code; }

function groupOf(code: string) {
  if (RETAIL_STORES.includes(code)) return "Retail";
  if (ECOM_STORES.includes(code))   return "Ecom";
  return "B2B";
}

function inList(codes: string[]) {
  return codes.map(c => `'${c}'`).join(",");
}

function channelInClause(ch: string): string {
  if (ch === "Retail") return `AND [Store No_] IN (${inList(RETAIL_STORES)})`;
  if (ch === "Ecom")   return `AND [Store No_] IN (${inList(ECOM_STORES)})`;
  if (ch === "B2B")    return `AND [Store No_] NOT IN (${inList([...RETAIL_STORES,...ECOM_STORES,"ONLINE"])})`;
  return "";
}

function brandLabel(code: string) {
  if (code === "SAMSONITE") return "Samsonite";
  if (code === "AM-TOUR")   return "American Tourister";
  return code || "Other";
}

function dUrl(params: Record<string,string>, from: string, to: string) {
  return "/api/drill?" + new URLSearchParams({...params, from, to}).toString();
}

function safeDate(val: string | null, fallback: string): string {
  if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return fallback;
}
function safeStr(val: string | null): string {
  if (!val) return "";
  return val.replace(/[';]/g, "").slice(0, 100);
}
const ALLOWED_TYPES = new Set([
  "daily","kpi","store","store-daily","channel","category","brand",
  "item","item-store","items","daily-detail",
  "store-category","store-subcat",
]);

export async function GET(req: NextRequest) {
  const p       = new URL(req.url).searchParams;
  const typeRaw = p.get("type") || "daily";
  const type    = ALLOWED_TYPES.has(typeRaw) ? typeRaw : "daily";
  const today   = new Date().toISOString().slice(0,10);
  const from    = safeDate(p.get("from"), "2026-01-01");
  const to      = safeDate(p.get("to"),   today);
  const store   = safeStr(p.get("store"));
  const channel = safeStr(p.get("channel"));
  const category= safeStr(p.get("category"));
  const brand   = safeStr(p.get("brand"));
  const itemNo  = safeStr(p.get("item"));
  const datePm  = safeDate(p.get("date"), today);

  const [fxRow, descRows] = await Promise.all([
    query<{egp_per_usd:string}>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"),
    query<{item_no:string;description:string}>("SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"),
  ]);
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "52");
  const descMap = Object.fromEntries(descRows.map(r => [r.item_no, r.description]));

  // ── Daily trend ──────────────────────────────────────────────────────────────
  if (type === "daily" || type === "kpi") {
    const storeF = store   ? `AND [Store No_] = '${store}'`
                 : channel ? channelInClause(channel) : "";
    const rows = await navQuery<{date:string;egp:number;units:number;stores:number}>(`
      SELECT
        CONVERT(varchar(10), CAST([Date] AS DATE), 23) AS date,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])                AS units,
        COUNT(DISTINCT [Store No_])     AS stores
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to ${storeF}
      GROUP BY CAST([Date] AS DATE)
      ORDER BY CAST([Date] AS DATE) DESC
    `, { from, to });

    const totalRev = rows.reduce((s,r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => ({
      ...r,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      _drill_url:   dUrl({type:"daily-detail", date:r.date, ...(store?{store}:{})}, r.date, r.date),
      _drill_title: `${r.date} · All Items`,
    }));
    return NextResponse.json({
      columns:[
        {key:"date",  label:"Date",         type:"date"},
        {key:"egp",   label:"Revenue",      type:"currency"},
        {key:"units", label:"Units Sold",   type:"units"},
        {key:"stores",label:"Active Stores",type:"number"},
      ],
      rows: drillRows,
      summary:[
        {label:"days",     value:String(rows.length)},
        {label:"total",    value:`EGP ${Math.round(totalRev).toLocaleString()}`},
        {label:"daily avg",value:`EGP ${rows.length>0 ? Math.round(totalRev/rows.length).toLocaleString() : 0}`},
      ],
      fx,
    });
  }

  // ── Daily detail: all items sold on one day ──────────────────────────────────
  if (type === "daily-detail") {
    const d = datePm || from;
    const storeF = store ? `AND [Store No_] = '${store}'` : "";
    const rows = await navQuery<{item_no:string;description:string;brand:string;category:string;store:string;egp:number;units:number}>(`
      SELECT TOP 150
        [Item No_]                     AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code])      AS brand,
        MAX([Product Group Code])      AS category,
        [Store No_]                    AS store,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])               AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) = @d ${storeF}
      GROUP BY [Item No_], [Store No_]
      ORDER BY egp DESC
    `, { d });

    const drillRows = rows.map(r => ({
      ...r,
      description:  descMap[r.item_no] || r.item_no,
      egp:         Math.round(Number(r.egp)),
      usd:         Math.round(Number(r.egp) / fx),
      units:       Math.round(Number(r.units)),
      store:       sn(r.store),
      brand:       brandLabel(r.brand),
      _drill_url:   dUrl({type:"item", item:r.item_no}, from, to),
      _drill_title: descMap[r.item_no] || r.item_no,
    }));
    const totalRev = drillRows.reduce((s,r) => s + r.egp, 0);
    return NextResponse.json({
      columns:[
        {key:"description",label:"Product",  type:"text"},
        {key:"brand",      label:"Brand",    type:"text"},
        {key:"store",      label:"Store",    type:"text"},
        {key:"egp",        label:"Revenue",  type:"currency"},
        {key:"units",      label:"Units",    type:"units"},
      ],
      rows: drillRows,
      summary:[
        {label:"date",   value:d},
        {label:"SKUs",   value:String(rows.length)},
        {label:"revenue",value:`EGP ${totalRev.toLocaleString()}`},
        {label:"units",  value:drillRows.reduce((s,r)=>s+r.units,0).toLocaleString()},
      ],
      fx,
    });
  }

  // ── Channel=all → all stores ranked ─────────────────────────────────────────
  if (type === "channel" && (!channel || channel === "all")) {
    const rows = await navQuery<{store_code:string;egp:number;units:number;days:number}>(`
      SELECT
        [Store No_]                     AS store_code,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])                AS units,
        COUNT(DISTINCT CAST([Date] AS DATE)) AS days
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
      GROUP BY [Store No_]
      ORDER BY egp DESC
    `, { from, to });

    const total = rows.reduce((s,r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => ({
      store_code:    r.store_code,
      store_display: sn(r.store_code),
      group:         groupOf(r.store_code),
      egp:           Math.round(Number(r.egp)),
      usd:           Math.round(Number(r.egp) / fx),
      units:         Math.round(Number(r.units)),
      days:          Number(r.days),
      pct:           total > 0 ? Math.round(Number(r.egp)*100/total) : 0,
      _drill_url:    dUrl({type:"store-category", store:r.store_code}, from, to),
      _drill_title:  `${sn(r.store_code)} · Categories`,
    }));
    return NextResponse.json({
      columns:[
        {key:"store_display",label:"Store",        type:"text"},
        {key:"group",        label:"Channel",      type:"text"},
        {key:"egp",          label:"Revenue",      type:"currency"},
        {key:"units",        label:"Units",        type:"units"},
        {key:"pct",          label:"% of total",   type:"number"},
        {key:"days",         label:"Active Days",  type:"number"},
      ],
      rows: drillRows,
      summary:[
        {label:"stores", value:String(rows.length)},
        {label:"revenue",value:`EGP ${Math.round(total).toLocaleString()}`},
      ],
      fx,
    });
  }

  // ── Channel → stores breakdown ───────────────────────────────────────────────
  if (type === "channel") {
    const cf = channelInClause(channel);
    const [rows, shopifySplit] = await Promise.all([
      navQuery<{store_code:string;egp:number;units:number;days:number}>(`
        SELECT
          [Store No_]                     AS store_code,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT CAST([Date] AS DATE)) AS days
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) BETWEEN @from AND @to ${cf}
        GROUP BY [Store No_]
        ORDER BY egp DESC
      `, { from, to }),
      channel === "Ecom"
        ? getShopifyRevenueSplit(from, to)
        : Promise.resolve({ samsonite: { egp: 0, units: 0 }, americanTourister: { egp: 0, units: 0 } }),
    ]);

    const shopifyEgp   = Math.round(shopifySplit.samsonite.egp + shopifySplit.americanTourister.egp);
    const shopifyUnits = Math.round(shopifySplit.samsonite.units + shopifySplit.americanTourister.units);
    const navTotal = rows.reduce((s,r) => s + Number(r.egp), 0);
    const total = navTotal + shopifyEgp;

    const drillRows: object[] = rows.map(r => ({
      store_display: sn(r.store_code),
      egp:           Math.round(Number(r.egp)),
      usd:           Math.round(Number(r.egp) / fx),
      units:         Math.round(Number(r.units)),
      days:          Number(r.days),
      pct:           total > 0 ? Math.round(Number(r.egp)*100/total) : 0,
      _drill_url:    dUrl({type:"store-category", store:r.store_code}, from, to),
      _drill_title:  `${sn(r.store_code)} · Categories`,
    }));

    // Add Shopify stores as separate rows for Ecom channel
    if (channel === "Ecom") {
      const shopifyBrands = [
        { key: "SHOPIFY-SAM", label: "Samsonite Website", ...shopifySplit.samsonite },
        { key: "SHOPIFY-AMT", label: "American Tourister Website", ...shopifySplit.americanTourister },
      ];
      for (const b of shopifyBrands) {
        const egp = Math.round(b.egp);
        if (egp === 0) continue;
        drillRows.push({
          store_display: b.label,
          egp,
          usd:           Math.round(egp / fx),
          units:         Math.round(b.units),
          days:          null,
          pct:           total > 0 ? Math.round(egp * 100 / total) : 0,
          _drill_url:    dUrl({ type: "store-category", store: b.key }, from, to),
          _drill_title:  `${b.label} · Categories`,
        });
      }
    }

    return NextResponse.json({
      columns:[
        {key:"store_display",label:"Store",        type:"text"},
        {key:"egp",          label:"Revenue",      type:"currency"},
        {key:"units",        label:"Units",        type:"units"},
        {key:"days",         label:"Active Days",  type:"number"},
        {key:"pct",          label:"% of channel", type:"number"},
      ],
      rows: drillRows,
      summary:[
        {label:"stores", value:String(rows.length + (channel === "Ecom" && shopifyEgp > 0 ? 1 : 0))},
        {label:"revenue",value:`EGP ${Math.round(total).toLocaleString()}`},
      ],
      fx,
    });
  }

  // ── Store → top products ─────────────────────────────────────────────────────
  if (type === "store") {
    const rows = await navQuery<{item_no:string;description:string;brand:string;category:string;egp:number;units:number}>(`
      SELECT TOP 100
        [Item No_]                     AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code])      AS brand,
        MAX([Product Group Code])      AS category,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])               AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
        AND [Store No_] = @store
      GROUP BY [Item No_]
      ORDER BY egp DESC
    `, { from, to, store });

    const totalRev = rows.reduce((s,r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => ({
      ...r,
      description:  descMap[r.item_no] || r.item_no,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      brand: brandLabel(r.brand),
      pct:   totalRev > 0 ? Number((Number(r.egp)*100/totalRev).toFixed(1)) : 0,
      _drill_url:   dUrl({type:"item", item:r.item_no}, from, to),
      _drill_title: descMap[r.item_no] || r.item_no,
    }));
    return NextResponse.json({
      columns:[
        {key:"description",label:"Product",    type:"text"},
        {key:"brand",      label:"Brand",      type:"text"},
        {key:"category",   label:"Category",   type:"text"},
        {key:"egp",        label:"Revenue",    type:"currency"},
        {key:"units",      label:"Units",      type:"units"},
        {key:"pct",        label:"% of store", type:"number"},
      ],
      rows: drillRows,
      summary:[
        {label:"SKUs",   value:String(rows.length)},
        {label:"revenue",value:`EGP ${Math.round(totalRev).toLocaleString()}`},
        {label:"units",  value:drillRows.reduce((s,r)=>s+r.units,0).toLocaleString()},
      ],
      fx,
    });
  }

  // ── Store daily breakdown ────────────────────────────────────────────────────
  if (type === "store-daily") {
    const rows = await navQuery<{date:string;egp:number;units:number}>(`
      SELECT
        CONVERT(varchar(10), CAST([Date] AS DATE), 23) AS date,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])               AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
        AND [Store No_] = @store
      GROUP BY CAST([Date] AS DATE)
      ORDER BY CAST([Date] AS DATE) DESC
    `, { from, to, store });

    const drillRows = rows.map(r => ({
      ...r,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      _drill_url:   dUrl({type:"daily-detail", date:r.date, store}, r.date, r.date),
      _drill_title: `${sn(store)} · ${r.date}`,
    }));
    return NextResponse.json({
      columns:[
        {key:"date", label:"Date",    type:"date"},
        {key:"egp",  label:"Revenue", type:"currency"},
        {key:"units",label:"Units",   type:"units"},
      ],
      rows: drillRows,
      summary:[
        {label:"days",   value:String(rows.length)},
        {label:"revenue",value:`EGP ${Math.round(drillRows.reduce((s,r)=>s+r.egp,0)).toLocaleString()}`},
      ],
      fx,
    });
  }

  // ── Category → products ──────────────────────────────────────────────────────
  if (type === "category") {
    const catF   = category ? `AND [Product Group Code] = '${category}'` : "";
    const brandF = brand    ? `AND [Item Category Code] = '${brand}'`    : "";
    const rows = await navQuery<{item_no:string;description:string;brand:string;category:string;egp:number;units:number}>(`
      SELECT TOP 200
        [Item No_]                     AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code])      AS brand,
        MAX([Product Group Code])      AS category,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])               AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to ${catF} ${brandF}
      GROUP BY [Item No_]
      ORDER BY egp DESC
    `, { from, to });

    const drillRows = rows.map(r => ({
      ...r,
      description:  descMap[r.item_no] || r.item_no,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      brand: brandLabel(r.brand),
      _drill_url:   dUrl({type:"item", item:r.item_no}, from, to),
      _drill_title: descMap[r.item_no] || r.item_no,
    }));
    return NextResponse.json({
      columns:[
        {key:"description",label:"Product",  type:"text"},
        {key:"brand",      label:"Brand",    type:"text"},
        {key:"egp",        label:"Revenue",  type:"currency"},
        {key:"units",      label:"Units",    type:"units"},
      ],
      rows: drillRows,
      summary:[{label:"SKUs",value:String(rows.length)}],
      fx,
    });
  }

  // ── Brand → products ─────────────────────────────────────────────────────────
  if (type === "brand") {
    const rows = await navQuery<{brand:string;egp:number;units:number;skus:number}>(`
      SELECT
        MAX([Item Category Code])       AS brand,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])                AS units,
        COUNT(DISTINCT [Item No_])      AS skus
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
      GROUP BY [Item Category Code]
      ORDER BY egp DESC
    `, { from, to });

    const drillRows = rows.map(r => ({
      brand:        brandLabel(r.brand),
      brand_code:   r.brand,
      egp:          Math.round(Number(r.egp)),
      usd:          Math.round(Number(r.egp) / fx),
      units:        Math.round(Number(r.units)),
      skus:         Number(r.skus),
      _drill_url:   dUrl({type:"items", brand:r.brand}, from, to),
      _drill_title: `${brandLabel(r.brand)} · Products`,
    }));
    return NextResponse.json({
      columns:[
        {key:"brand",label:"Brand",   type:"text"},
        {key:"egp",  label:"Revenue", type:"currency"},
        {key:"units",label:"Units",   type:"units"},
        {key:"skus", label:"SKUs",    type:"number"},
      ],
      rows: drillRows,
      summary:[{label:"brands",value:String(rows.length)}],
      fx,
    });
  }

  // ── Item → which stores sold it ──────────────────────────────────────────────
  if (type === "item") {
    const [metaRows, storeRows] = await Promise.all([
      navQuery<{description:string;brand:string;category:string}>(`
        SELECT TOP 1
          [Item No_] AS description,
          MAX([Item Category Code]) AS brand,
          MAX([Product Group Code]) AS category
        FROM TransSalesEntry WHERE [Item No_] = @itemNo
      `, { itemNo }),

      navQuery<{store_code:string;egp:number;units:number;days:number}>(`
        SELECT
          [Store No_]                     AS store_code,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT CAST([Date] AS DATE)) AS days
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Item No_] = @itemNo
        GROUP BY [Store No_]
        ORDER BY egp DESC
      `, { from, to, itemNo }),
    ]);

    const meta = metaRows[0] ?? {description:itemNo, brand:"", category:""};
    const totalRev = storeRows.reduce((s,r) => s + Number(r.egp), 0);

    const drillRows = storeRows.map(r => ({
      store_display: sn(r.store_code),
      egp:           Math.round(Number(r.egp)),
      usd:           Math.round(Number(r.egp) / fx),
      units:         Math.round(Number(r.units)),
      days:          Number(r.days),
      _drill_url:    dUrl({type:"item-store", item:itemNo, store:r.store_code}, from, to),
      _drill_title:  `${sn(r.store_code)} · ${meta.description || itemNo} · Daily`,
    }));
    return NextResponse.json({
      columns:[
        {key:"store_display",label:"Store",       type:"text"},
        {key:"egp",          label:"Revenue",     type:"currency"},
        {key:"units",        label:"Units",       type:"units"},
        {key:"days",         label:"Active Days", type:"number"},
      ],
      rows: drillRows,
      summary:[
        {label:"product", value:meta.description || itemNo},
        {label:"brand",   value:brandLabel(meta.brand) || "—"},
        {label:"category",value:meta.category || "—"},
        {label:"revenue", value:`EGP ${Math.round(totalRev).toLocaleString()}`},
        {label:"units",   value:drillRows.reduce((s,r)=>s+r.units,0).toLocaleString()},
        {label:"stores",  value:String(storeRows.length)},
      ],
      fx,
    });
  }

  // ── Item-Store: daily history of one item at one store ───────────────────────
  if (type === "item-store") {
    const rows = await navQuery<{date:string;egp:number;units:number}>(`
      SELECT
        CONVERT(varchar(10), CAST([Date] AS DATE), 23) AS date,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])               AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
        AND [Item No_] = @itemNo AND [Store No_] = @store
      GROUP BY CAST([Date] AS DATE)
      ORDER BY CAST([Date] AS DATE) DESC
    `, { from, to, itemNo, store });

    const drillRows = rows.map(r => ({
      ...r,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
    }));
    const totalUnits = drillRows.reduce((s,r) => s + r.units, 0);
    const totalRev   = drillRows.reduce((s,r) => s + r.egp,   0);
    return NextResponse.json({
      columns:[
        {key:"date",  label:"Date",    type:"date"},
        {key:"egp",   label:"Revenue", type:"currency"},
        {key:"units", label:"Units",   type:"units"},
      ],
      rows: drillRows,
      summary:[
        {label:"store",   value:sn(store)},
        {label:"days",    value:String(rows.length)},
        {label:"revenue", value:`EGP ${totalRev.toLocaleString()}`},
        {label:"units",   value:totalUnits.toLocaleString()},
        {label:"avg/day", value:rows.length>0 ? (totalUnits/rows.length).toFixed(1)+" u/day" : "—"},
      ],
      fx,
    });
  }

  // ── Items: top products with optional filters ────────────────────────────────
  if (type === "items") {
    // SHOPIFY virtual store: show only Shopify line items (no NAV query for SHOPIFY store)
    if (store === "SHOPIFY") {
      const [shopifyItems, skuMap] = await Promise.all([
        getShopifyLineItems(from, to),
        query<{ sku: string; item_no: string }>("SELECT sku, item_no FROM shopify_item_map"),
      ]);
      const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
      const byItemNo: Record<string, { egp: number; units: number }> = {};
      for (const li of shopifyItems) {
        const itemNo = skuToItemNo[li.sku];
        if (!itemNo) continue;
        if (brand && /* filter by category code */ true) { /* applied below */ }
        if (!byItemNo[itemNo]) byItemNo[itemNo] = { egp: 0, units: 0 };
        byItemNo[itemNo].egp += li.egp;
        byItemNo[itemNo].units += li.quantity;
      }
      // Fetch category/subcat for each item_no to apply brand/category filters
      const itemNos = Object.keys(byItemNo);
      const itemMeta: Record<string, { category_code: string; subcat: string }> = {};
      if (itemNos.length > 0) {
        const inClause = itemNos.map(n => `'${n}'`).join(",");
        const metaRows = await navQuery<{ item_no: string; category_code: string; subcat: string }>(`
          SELECT [Item No_] AS item_no,
            MAX([Item Category Code]) AS category_code,
            MAX([Product Group Code]) AS subcat
          FROM TransSalesEntry WHERE [Item No_] IN (${inClause})
          GROUP BY [Item No_]
        `, {});
        for (const r of metaRows) itemMeta[r.item_no] = r;
      }
      const total = Object.values(byItemNo).reduce((s, v) => s + v.egp, 0);
      const drillRows = Object.entries(byItemNo)
        .filter(([itemNo]) => {
          const meta = itemMeta[itemNo];
          if (brand && meta?.category_code !== brand) return false;
          if (category && meta?.subcat !== category) return false;
          return true;
        })
        .map(([itemNo, v]) => {
          const egp = Math.round(v.egp);
          return {
            item_no:     itemNo,
            description: descMap[itemNo] || itemNo,
            egp,
            usd:         Math.round(egp / fx),
            units:       v.units,
            brand:       brandLabel(itemMeta[itemNo]?.category_code || ""),
            category:    itemMeta[itemNo]?.subcat || "",
            _drill_url:  dUrl({ type: "item", item: itemNo }, from, to),
            _drill_title: descMap[itemNo] || itemNo,
          };
        })
        .sort((a, b) => b.egp - a.egp);
      return NextResponse.json({
        columns: [
          { key: "description", label: "Product",  type: "text" },
          { key: "brand",       label: "Brand",    type: "text" },
          { key: "category",    label: "Category", type: "text" },
          { key: "egp",         label: "Revenue",  type: "currency" },
          { key: "units",       label: "Units",    type: "units" },
        ],
        rows: drillRows,
        summary: [
          { label: "source",  value: "Own Website (Shopify)" },
          { label: "SKUs",    value: String(drillRows.length) },
          { label: "revenue", value: `EGP ${Math.round(drillRows.reduce((s,r)=>s+r.egp,0)).toLocaleString()}` },
        ],
        fx,
      });
    }

    const storeF = store    ? `AND [Store No_] = '${store}'`           : channel ? channelInClause(channel) : "";
    const catF   = category ? `AND [Product Group Code] = '${category}'` : "";
    const brandF = brand    ? `AND [Item Category Code] = '${brand}'`    : "";

    // Include Shopify line items when viewing all channels or Ecom (no store-specific filter)
    const includeShopify = !store && (!channel || channel === "Ecom" || channel === "all");

    const [rows, shopifyItems, skuMap] = await Promise.all([
      navQuery<{item_no:string;description:string;brand:string;category:string;egp:number;units:number}>(`
        SELECT TOP 200
          [Item No_]                     AS item_no,
          [Item No_] AS description,
          MAX([Item Category Code])      AS brand,
          MAX([Product Group Code])      AS category,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])               AS units
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) BETWEEN @from AND @to ${storeF} ${catF} ${brandF}
        GROUP BY [Item No_]
        ORDER BY egp DESC
      `, { from, to }),
      includeShopify ? getShopifyLineItems(from, to) : Promise.resolve([]),
      includeShopify ? query<{sku:string;item_no:string}>("SELECT sku, item_no FROM shopify_item_map") : Promise.resolve([]),
    ]);

    // Aggregate Shopify line items by NAV item_no
    const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
    const shopifyByItem: Record<string, { egp: number; units: number }> = {};
    for (const li of shopifyItems) {
      const itemNo = skuToItemNo[li.sku];
      if (!itemNo) continue;
      if (!shopifyByItem[itemNo]) shopifyByItem[itemNo] = { egp: 0, units: 0 };
      shopifyByItem[itemNo].egp += li.egp;
      shopifyByItem[itemNo].units += li.quantity;
    }

    const navItemSet = new Set(rows.map(r => r.item_no));
    const navTotal = rows.reduce((s, r) => s + Number(r.egp), 0);
    const shopifyTotal = Object.values(shopifyByItem).reduce((s, v) => s + v.egp, 0);
    const grandTotal = navTotal + shopifyTotal;

    const drillRows = rows.map(r => {
      const shopifyItem = shopifyByItem[r.item_no] ?? { egp: 0, units: 0 };
      const egp = Math.round(Number(r.egp) + shopifyItem.egp);
      const units = Math.round(Number(r.units)) + shopifyItem.units;
      return {
        item_no: r.item_no,
        description:  descMap[r.item_no] || r.item_no,
        egp,
        usd:   Math.round(egp / fx),
        units,
        brand: brandLabel(r.brand),
        category: r.category || "",
        _drill_url:   dUrl({type:"item", item:r.item_no}, from, to),
        _drill_title: descMap[r.item_no] || r.item_no,
      };
    });

    // Add Shopify-only items not in NAV top 200
    for (const [itemNo, shopifyItem] of Object.entries(shopifyByItem)) {
      if (navItemSet.has(itemNo)) continue;
      const egp = Math.round(shopifyItem.egp);
      if (egp < 100) continue;
      drillRows.push({
        item_no: itemNo,
        description: descMap[itemNo] || itemNo,
        egp,
        usd: Math.round(egp / fx),
        units: shopifyItem.units,
        brand: "",
        category: "",
        _drill_url:   dUrl({type:"item", item:itemNo}, from, to),
        _drill_title: descMap[itemNo] || itemNo,
      });
    }

    drillRows.sort((a, b) => b.egp - a.egp);

    return NextResponse.json({
      columns:[
        {key:"description",label:"Product",  type:"text"},
        {key:"brand",      label:"Brand",    type:"text"},
        {key:"category",   label:"Category", type:"text"},
        {key:"egp",        label:"Revenue",  type:"currency"},
        {key:"units",      label:"Units",    type:"units"},
      ],
      rows: drillRows,
      summary:[
        {label:"SKUs",   value:String(drillRows.length)},
        {label:"revenue",value:`EGP ${Math.round(grandTotal).toLocaleString()}`},
        {label:"units",  value:drillRows.reduce((s,r)=>s+r.units,0).toLocaleString()},
      ],
      fx,
    });
  }

  // ── Store / Source → categories ──────────────────────────────────────────────
  if (type === "store-category") {
    let catRows: { category_code: string; category: string; egp: number; units: number; skus: number }[];

    const isShopify = store === "SHOPIFY" || store === "SHOPIFY-SAM" || store === "SHOPIFY-AMT";
    const shopifyBrand = store === "SHOPIFY-SAM" ? "samsonite" as const
                       : store === "SHOPIFY-AMT" ? "american-tourister" as const
                       : undefined;
    const storeLabel = store === "SHOPIFY-SAM" ? "Samsonite Website"
                     : store === "SHOPIFY-AMT" ? "American Tourister Website"
                     : store === "SHOPIFY"     ? "Own Website (Shopify)"
                     : sn(store);

    if (isShopify) {
      // Shopify: map line items → item_no → NAV category codes
      const [shopifyItems, skuMap] = await Promise.all([
        getShopifyLineItems(from, to, shopifyBrand),
        query<{ sku: string; item_no: string }>("SELECT sku, item_no FROM shopify_item_map"),
      ]);
      const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
      const byItemNo: Record<string, { egp: number; units: number }> = {};
      for (const li of shopifyItems) {
        const itemNo = skuToItemNo[li.sku];
        if (!itemNo) continue;
        if (!byItemNo[itemNo]) byItemNo[itemNo] = { egp: 0, units: 0 };
        byItemNo[itemNo].egp += li.egp;
        byItemNo[itemNo].units += li.quantity;
      }
      const itemNos = Object.keys(byItemNo);
      if (itemNos.length === 0) {
        catRows = [];
      } else {
        const inClause = itemNos.map(n => `'${n}'`).join(",");
        const itemCats = await navQuery<{ item_no: string; category_code: string }>(`
          SELECT [Item No_] AS item_no, MAX([Item Category Code]) AS category_code
          FROM TransSalesEntry WHERE [Item No_] IN (${inClause})
          GROUP BY [Item No_]
        `, {});
        const itemCatMap = Object.fromEntries(itemCats.map(r => [r.item_no, r.category_code]));
        const byCat: Record<string, { egp: number; units: number; skus: Set<string> }> = {};
        for (const [itemNo, vals] of Object.entries(byItemNo)) {
          const cc = itemCatMap[itemNo] || "";
          if (!byCat[cc]) byCat[cc] = { egp: 0, units: 0, skus: new Set() };
          byCat[cc].egp += vals.egp;
          byCat[cc].units += vals.units;
          byCat[cc].skus.add(itemNo);
        }
        catRows = Object.entries(byCat).map(([cc, v]) => ({
          category_code: cc,
          category: cc === "SAMSONITE" ? "Samsonite" : cc === "AM-TOUR" ? "American Tourister" : cc || "Other",
          egp: v.egp,
          units: v.units,
          skus: v.skus.size,
        })).sort((a, b) => b.egp - a.egp);
      }
    } else {
      catRows = await navQuery<{ category_code: string; category: string; egp: number; units: number; skus: number }>(`
        SELECT
          [Item Category Code] AS category_code,
          CASE
            WHEN [Item Category Code] = 'SAMSONITE' THEN 'Samsonite'
            WHEN [Item Category Code] = 'AM-TOUR'   THEN 'American Tourister'
            WHEN [Item Category Code] != ''          THEN [Item Category Code]
            ELSE 'Other'
          END AS category,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT [Item No_])      AS skus
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
          AND [Store No_] = @store
        GROUP BY [Item Category Code]
        ORDER BY egp DESC
      `, { from, to, store });
    }

    const total = catRows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = catRows.map(r => ({
      category:      r.category,
      category_code: r.category_code,
      egp:           Math.round(Number(r.egp)),
      usd:           Math.round(Number(r.egp) / fx),
      units:         Math.round(Number(r.units)),
      skus:          Number(r.skus),
      pct:           total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
      _drill_url:    dUrl({ type: "store-subcat", store, brand: r.category_code }, from, to),
      _drill_title:  `${storeLabel} · ${r.category} · Sub-categories`,
    }));
    return NextResponse.json({
      columns: [
        { key: "category", label: "Category",    type: "text" },
        { key: "egp",      label: "Revenue",     type: "currency" },
        { key: "units",    label: "Units",       type: "units" },
        { key: "skus",     label: "SKUs",        type: "number" },
        { key: "pct",      label: "% of source", type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "source",     value: storeLabel },
        { label: "revenue",    value: `EGP ${Math.round(total).toLocaleString()}` },
        { label: "categories", value: String(catRows.length) },
      ],
      fx,
    });
  }

  // ── Store + Category → sub-categories ────────────────────────────────────────
  if (type === "store-subcat") {
    const brandF = brand ? `AND [Item Category Code] = '${brand}'` : "";

    let subcatRows: { subcat: string; egp: number; units: number; skus: number }[];

    const isShopifySubcat = store === "SHOPIFY" || store === "SHOPIFY-SAM" || store === "SHOPIFY-AMT";
    const shopifyBrandSubcat = store === "SHOPIFY-SAM" ? "samsonite" as const
                             : store === "SHOPIFY-AMT" ? "american-tourister" as const
                             : undefined;
    const storeLabelSubcat = store === "SHOPIFY-SAM" ? "Samsonite Website"
                           : store === "SHOPIFY-AMT" ? "American Tourister Website"
                           : store === "SHOPIFY"     ? "Own Website (Shopify)"
                           : sn(store);

    if (isShopifySubcat) {
      const [shopifyItems, skuMap] = await Promise.all([
        getShopifyLineItems(from, to, shopifyBrandSubcat),
        query<{ sku: string; item_no: string }>("SELECT sku, item_no FROM shopify_item_map"),
      ]);
      const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
      const byItemNo: Record<string, { egp: number; units: number }> = {};
      for (const li of shopifyItems) {
        const itemNo = skuToItemNo[li.sku];
        if (!itemNo) continue;
        if (!byItemNo[itemNo]) byItemNo[itemNo] = { egp: 0, units: 0 };
        byItemNo[itemNo].egp += li.egp;
        byItemNo[itemNo].units += li.quantity;
      }
      const itemNos = Object.keys(byItemNo);
      if (itemNos.length === 0) {
        subcatRows = [];
      } else {
        const inClause = itemNos.map(n => `'${n}'`).join(",");
        const brandClause = brand ? `AND MAX([Item Category Code]) = '${brand}'` : "";
        const itemMeta = await navQuery<{ item_no: string; category_code: string; subcat: string }>(`
          SELECT [Item No_] AS item_no,
            MAX([Item Category Code]) AS category_code,
            MAX([Product Group Code]) AS subcat
          FROM TransSalesEntry WHERE [Item No_] IN (${inClause})
          GROUP BY [Item No_]
          HAVING 1=1 ${brandClause}
        `, {});
        const itemMetaMap = Object.fromEntries(itemMeta.map(r => [r.item_no, r]));
        const bySubcat: Record<string, { egp: number; units: number; skus: Set<string> }> = {};
        for (const [itemNo, vals] of Object.entries(byItemNo)) {
          const meta = itemMetaMap[itemNo];
          if (!meta) continue;
          const sc = meta.subcat || "Other";
          if (!bySubcat[sc]) bySubcat[sc] = { egp: 0, units: 0, skus: new Set() };
          bySubcat[sc].egp += vals.egp;
          bySubcat[sc].units += vals.units;
          bySubcat[sc].skus.add(itemNo);
        }
        subcatRows = Object.entries(bySubcat).map(([sc, v]) => ({
          subcat: sc,
          egp: v.egp,
          units: v.units,
          skus: v.skus.size,
        })).sort((a, b) => b.egp - a.egp);
      }
    } else {
      subcatRows = await navQuery<{ subcat: string; egp: number; units: number; skus: number }>(`
        SELECT
          CASE WHEN [Product Group Code] != '' THEN [Product Group Code] ELSE 'Other' END AS subcat,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT [Item No_])      AS skus
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
          AND [Store No_] = @store ${brandF}
        GROUP BY [Product Group Code]
        ORDER BY egp DESC
      `, { from, to, store });
    }

    const total = subcatRows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = subcatRows.map(r => ({
      subcat:    r.subcat,
      egp:       Math.round(Number(r.egp)),
      usd:       Math.round(Number(r.egp) / fx),
      units:     Math.round(Number(r.units)),
      skus:      Number(r.skus),
      pct:       total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
      _drill_url:   dUrl({ type: "items", store, brand, category: r.subcat }, from, to),
      _drill_title: `${storeLabelSubcat} · ${brandLabel(brand)} · ${r.subcat} · Items`,
    }));
    return NextResponse.json({
      columns: [
        { key: "subcat", label: "Sub-category",   type: "text" },
        { key: "egp",    label: "Revenue",        type: "currency" },
        { key: "units",  label: "Units",          type: "units" },
        { key: "skus",   label: "SKUs",           type: "number" },
        { key: "pct",    label: "% of category",  type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "source",   value: storeLabelSubcat },
        { label: "category", value: brandLabel(brand) },
        { label: "revenue",  value: `EGP ${Math.round(total).toLocaleString()}` },
      ],
      fx,
    });
  }

  return NextResponse.json({columns:[], rows:[], fx});
}
