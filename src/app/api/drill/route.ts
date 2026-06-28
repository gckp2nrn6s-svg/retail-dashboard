import { NextRequest, NextResponse } from "next/server";
import { navQuery as navQueryRaw } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenueSplit, getShopifyLineItems, getShopifyDailyRevenue } from "@/lib/shopify";
import { B2B_CUST_FILTER } from "@/lib/b2b-revenue";
import { todayCairo } from "@/lib/dates";

// Fault isolation for the whole drill route: NAV going offline (the laptop tunnel
// dropping) must NEVER hard-fail a drill — it should degrade to whatever non-NAV
// data exists (e.g. the Ecom drill still shows the Shopify websites). Shadowing the
// import means every navQuery call below is automatically safe: on NAV error it
// returns [] (logged) instead of throwing and 500-ing the whole sheet.
async function navQuery<T = Record<string, unknown>>(
  q: string,
  params?: Record<string, string | number | Date>,
): Promise<T[]> {
  try {
    return await navQueryRaw<T>(q, params);
  } catch (e) {
    console.error(`[drill] NAV query failed, degrading to non-NAV data: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

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

// Parse luggage size from a description string (e.g. "MAGNUM ECO 81/30 GRAPHITE" → "81CM")
function parseSize(desc: string): string {
  const m = desc.match(/(?<![A-Z\d])(5[5-9]|6[0-9]|7[0-9]|8[0-5])(?:\/\d{2})?(?![A-Z\d])/i);
  return m ? m[1] + "CM" : "Other";
}

// Parse color from description (text after the size, before the product code)
function parseColor(desc: string): string {
  const sizeMatch = desc.match(/(?<![A-Z\d])(5[5-9]|6[0-9]|7[0-9]|8[0-5])(?:\/\d{2})?(?![A-Z\d])/i);
  if (!sizeMatch) return "";
  const afterSize = desc.slice((sizeMatch.index ?? 0) + sizeMatch[0].length).trim();
  const colorMatch = afterSize.match(/^([A-Z][A-Z\s]+?)(?:\s+[A-Z]{1,3}[\d-]|$)/i);
  return colorMatch ? colorMatch[1].trim() : "";
}
const ALLOWED_TYPES = new Set([
  "daily","kpi","store","store-daily","channel","category","brand",
  "item","item-store","items","daily-detail",
  "store-category","store-subcat","marketplace-items","store-brand","b2b-customer-items",
  "factory-client-items",
]);

export async function GET(req: NextRequest) {
  try {
    return await handleDrill(req);
  } catch (e) {
    // Final safety net — a drill must never return a hard 500 (which the sheet
    // shows as "Failed to load data"). Degrade to a soft empty state instead.
    console.error(`[drill] fatal: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json(
      { columns: [], rows: [], summary: [{ label: "status", value: "Data temporarily unavailable" }], fx: 52, degraded: true },
      { status: 200 },
    );
  }
}

async function handleDrill(req: NextRequest) {
  const p       = new URL(req.url).searchParams;
  const typeRaw = p.get("type") || "daily";
  const type    = ALLOWED_TYPES.has(typeRaw) ? typeRaw : "daily";
  const today   = todayCairo();
  const from    = safeDate(p.get("from"), "2026-01-01");
  const to      = safeDate(p.get("to"),   today);
  const store   = safeStr(p.get("store"));
  const channel = safeStr(p.get("channel"));
  const category= safeStr(p.get("category"));
  const brand   = safeStr(p.get("brand"));
  const size    = safeStr(p.get("size"));
  const itemNo  = safeStr(p.get("item"));
  const staff   = safeStr(p.get("staff"));
  const customer= safeStr(p.get("customer"));
  const client  = safeStr(p.get("client")); // factory-direct client_key
  const datePm  = safeDate(p.get("date"), today);

  // FX + product descriptions live in Postgres. They're enrichment, not the
  // drill's core data (which is NAV) — so a Postgres blip must NOT sink the whole
  // drill. Degrade gracefully: fx→52 fallback, descriptions→item numbers.
  let fxRow: { egp_per_usd: string }[] = [];
  let descRows: { item_no: string; description: string }[] = [];
  try {
    [fxRow, descRows] = await Promise.all([
      query<{egp_per_usd:string}>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"),
      query<{item_no:string;description:string}>("SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"),
    ]);
  } catch (e) {
    console.error(`[drill] Postgres lookup (fx/desc) failed, degrading to NAV-only: ${e instanceof Error ? e.message : e}`);
  }
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "52");
  const descMap = Object.fromEntries(descRows.map(r => [r.item_no, r.description]));

  // ── Marketplace → products (NAV ONLINE store, one marketplace by [Staff ID]) ──
  if (type === "marketplace-items" && staff) {
    const rows = await navQuery<{item_no:string;egp:number;units:number}>(`
      SELECT [Item No_] AS item_no,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])                AS units
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to
        AND [Store No_] = 'ONLINE' AND [Staff ID] = @staff
      GROUP BY [Item No_]
      ORDER BY egp DESC
    `, { from, to, staff });
    const total = rows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => {
      const desc = descMap[r.item_no] || r.item_no;
      const sz = parseSize(desc);
      return {
        item_no:     r.item_no,
        description: desc,
        size:        sz !== "Other" ? sz : "",
        color:       parseColor(desc),
        egp:         Math.round(Number(r.egp)),
        usd:         Math.round(Number(r.egp) / fx),
        units:       Math.round(Number(r.units)),
        pct:         total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
        _drill_url:   dUrl({ type: "item", item: r.item_no }, from, to),
        _drill_title: desc,
      };
    });
    return NextResponse.json({
      columns: [
        { key: "description", label: "Product",          type: "text" },
        { key: "size",        label: "Size",             type: "text" },
        { key: "color",       label: "Colour",           type: "text" },
        { key: "egp",         label: "Revenue",          type: "currency" },
        { key: "units",       label: "Units",            type: "units" },
        { key: "pct",         label: "% of marketplace", type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "products", value: String(drillRows.length) },
        { label: "revenue",  value: `EGP ${Math.round(total).toLocaleString()}` },
        { label: "units",    value: drillRows.reduce((s, r) => s + r.units, 0).toLocaleString() },
      ],
      fx,
    });
  }

  // ── Store → brand split (Samsonite vs American Tourister) ────────────────────
  if (type === "store-brand" && store) {
    const rows = await navQuery<{code:string;egp:number;units:number;skus:number}>(`
      SELECT [Item Category Code] AS code,
        -SUM([Net Amount]+[VAT Amount]) AS egp,
        -SUM([Quantity])                AS units,
        COUNT(DISTINCT [Item No_])      AS skus
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] = @store
      GROUP BY [Item Category Code]
      ORDER BY egp DESC
    `, { from, to, store });
    const total = rows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => ({
      brand: brandLabel(r.code),
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      skus:  Number(r.skus),
      pct:   total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
      _drill_url:   dUrl({ type: "items", store, brand: r.code }, from, to),
      _drill_title: `${sn(store)} · ${brandLabel(r.code)} · Items`,
    }));
    return NextResponse.json({
      columns: [
        { key: "brand", label: "Brand",       type: "text" },
        { key: "egp",   label: "Revenue",     type: "currency" },
        { key: "units", label: "Units",       type: "units" },
        { key: "skus",  label: "SKUs",        type: "number" },
        { key: "pct",   label: "% of store",  type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "store",   value: sn(store) },
        { label: "revenue", value: `EGP ${Math.round(total).toLocaleString()}` },
      ],
      fx,
    });
  }

  // ── B2B customer → their products (HO invoices net of credit memos) ──────────
  if (type === "b2b-customer-items" && customer) {
    const rows = await navQuery<{item_no:string;description:string;egp:number;units:number}>(`
      SELECT item_no, MAX(description) AS description, SUM(egp) AS egp, SUM(units) AS units FROM (
        SELECT [No_] AS item_no, [Description] AS description, [Amount Including VAT] AS egp, [Quantity] AS units
          FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] = @customer
        UNION ALL
        SELECT [No_], [Description], -[Amount Including VAT], -[Quantity]
          FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] = @customer
      ) t GROUP BY item_no HAVING SUM(egp) <> 0 ORDER BY egp DESC
    `, { from, to, customer });
    const total = rows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => ({
      product: descMap[r.item_no] || (r.description && String(r.description).trim()) || r.item_no,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      pct:   total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
    }));
    return NextResponse.json({
      columns: [
        { key: "product", label: "Product",        type: "text" },
        { key: "egp",     label: "Revenue",        type: "currency" },
        { key: "units",   label: "Units",          type: "units" },
        { key: "pct",     label: "% of customer",  type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "products", value: String(drillRows.length) },
        { label: "revenue",  value: `EGP ${Math.round(total).toLocaleString()}` },
      ],
      fx,
    });
  }

  // ── Factory-direct client → products (from the live sheet, in Postgres) ───────
  if (type === "factory-client-items" && client) {
    const rows = await query<{ product: string; egp: string; units: string }>(`
      SELECT COALESCE(NULLIF(TRIM(description),''), NULLIF(TRIM(sku),''), NULLIF(TRIM(model),''), 'item') AS product,
             SUM(total_sales) AS egp, SUM(qty) AS units
        FROM factory_direct_sales
       WHERE client_key = $1 AND sale_date BETWEEN $2 AND $3
       GROUP BY 1 HAVING SUM(total_sales) <> 0 ORDER BY egp DESC`, [client, from, to]);
    const total = rows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = rows.map(r => ({
      product: r.product,
      egp:   Math.round(Number(r.egp)),
      usd:   Math.round(Number(r.egp) / fx),
      units: Math.round(Number(r.units)),
      pct:   total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
    }));
    return NextResponse.json({
      columns: [
        { key: "product", label: "Product",      type: "text" },
        { key: "egp",     label: "Revenue",      type: "currency" },
        { key: "units",   label: "Units",        type: "units" },
        { key: "pct",     label: "% of client",  type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "products", value: String(drillRows.length) },
        { label: "revenue",  value: `EGP ${Math.round(total).toLocaleString()}` },
      ],
      fx,
    });
  }

  // ── Daily trend ──────────────────────────────────────────────────────────────
  if (type === "daily" || type === "kpi") {
    const storeF = store   ? `AND [Store No_] = '${store}'`
                 : channel ? channelInClause(channel) : "";
    // Ecom / all-channel daily must include Shopify, else "today" is blank (NAV lags a day).
    const includeShopify = !store && (!channel || channel === "all" || channel === "Ecom");
    const [rows, shopDaily] = await Promise.all([
      navQuery<{date:string;egp:number;units:number;stores:number}>(`
        SELECT
          CONVERT(varchar(10), CAST([Date] AS DATE), 23) AS date,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT [Store No_])     AS stores
        FROM TransSalesEntry
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to ${storeF}
        GROUP BY CAST([Date] AS DATE)
        ORDER BY CAST([Date] AS DATE) DESC
      `, { from, to }),
      includeShopify ? getShopifyDailyRevenue(from, to) : Promise.resolve({} as Record<string, { egp:number; units:number }>),
    ]);

    // Merge NAV + Shopify by date so today's web orders show even with NAV behind.
    const byDate: Record<string, { egp:number; units:number; stores:number }> = {};
    for (const r of rows) byDate[r.date] = { egp:Number(r.egp), units:Number(r.units), stores:Number(r.stores) };
    for (const [d, v] of Object.entries(shopDaily)) {
      if (!byDate[d]) byDate[d] = { egp:0, units:0, stores:0 };
      byDate[d].egp += v.egp; byDate[d].units += v.units; byDate[d].stores += 1; // website
    }
    const merged = Object.entries(byDate)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a,b) => a.date < b.date ? 1 : -1);

    const totalRev = merged.reduce((s,r) => s + r.egp, 0);
    const drillRows = merged.map(r => ({
      date:  r.date,
      egp:   Math.round(r.egp),
      usd:   Math.round(r.egp / fx),
      units: Math.round(r.units),
      stores: r.stores,
      _drill_url:   dUrl({type:"daily-detail", date:r.date, ...(store?{store}:{}), ...(channel?{channel}:{})}, r.date, r.date),
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
        {label:"days",     value:String(merged.length)},
        {label:"total",    value:`EGP ${Math.round(totalRev).toLocaleString()}`},
        {label:"daily avg",value:`EGP ${merged.length>0 ? Math.round(totalRev/merged.length).toLocaleString() : 0}`},
      ],
      fx,
    });
  }

  // ── Daily detail: all items sold on one day ──────────────────────────────────
  if (type === "daily-detail") {
    const d = datePm || from;
    const storeF = store ? `AND [Store No_] = '${store}'` : "";
    const includeShopify = !store && (!channel || channel === "all" || channel === "Ecom");
    const [rows, shopItems, skuMap] = await Promise.all([
      navQuery<{item_no:string;description:string;brand:string;category:string;store:string;egp:number;units:number}>(`
        SELECT TOP 150
          [Item No_]                     AS item_no,
          [Item No_] AS description,
          MAX([Item Category Code])      AS brand,
          MAX([Product Group Code])      AS category,
          [Store No_]                    AS store,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])               AS units
        FROM TransSalesEntry
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) = @d ${storeF}
        GROUP BY [Item No_], [Store No_]
        ORDER BY egp DESC
      `, { d }),
      includeShopify ? getShopifyLineItems(d, d) : Promise.resolve([]),
      includeShopify ? query<{sku:string;item_no:string}>("SELECT sku, item_no FROM shopify_item_map") : Promise.resolve([]),
    ]);

    const drillRows = rows.map(r => ({
      item_no:     r.item_no,
      description: descMap[r.item_no] || r.item_no,
      egp:         Math.round(Number(r.egp)),
      usd:         Math.round(Number(r.egp) / fx),
      units:       Math.round(Number(r.units)),
      store:       sn(r.store),
      brand:       brandLabel(r.brand),
      _drill_url:   dUrl({type:"item", item:r.item_no}, from, to),
      _drill_title: descMap[r.item_no] || r.item_no,
    }));

    // Merge Shopify website line items sold that day (own website store row)
    if (shopItems.length > 0) {
      const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
      const shopByItem: Record<string, { egp:number; units:number }> = {};
      for (const li of shopItems) {
        const itemNo = skuToItemNo[li.sku] || li.sku;
        if (!shopByItem[itemNo]) shopByItem[itemNo] = { egp:0, units:0 };
        shopByItem[itemNo].egp += li.egp; shopByItem[itemNo].units += li.quantity;
      }
      for (const [itemNo, v] of Object.entries(shopByItem)) {
        drillRows.push({
          item_no:     itemNo,
          description: descMap[itemNo] || itemNo,
          egp:         Math.round(v.egp),
          usd:         Math.round(v.egp / fx),
          units:       Math.round(v.units),
          store:       "Own Website",
          brand:       "",
          _drill_url:   dUrl({type:"item", item:itemNo}, from, to),
          _drill_title: descMap[itemNo] || itemNo,
        });
      }
      drillRows.sort((a,b) => b.egp - a.egp);
    }
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
        {label:"SKUs",   value:String(drillRows.length)},
        {label:"revenue",value:`EGP ${totalRev.toLocaleString()}`},
        {label:"units",  value:drillRows.reduce((s,r)=>s+r.units,0).toLocaleString()},
      ],
      fx,
    });
  }

  // ── Channel=all → all stores ranked ─────────────────────────────────────────
  if (type === "channel" && (!channel || channel === "all")) {
    const [rows, shopifySplit] = await Promise.all([
      navQuery<{store_code:string;egp:number;units:number;days:number}>(`
        SELECT
          [Store No_]                     AS store_code,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT CAST([Date] AS DATE)) AS days
        FROM TransSalesEntry
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
        GROUP BY [Store No_]
        ORDER BY egp DESC
      `, { from, to }),
      getShopifyRevenueSplit(from, to),
    ]);

    // Shopify websites are real Ecom stores but absent from NAV — add them.
    const shopStores = [
      { store_code:"SHOPIFY-SAM", label:"Samsonite Website", ...shopifySplit.samsonite },
      { store_code:"SHOPIFY-AMT", label:"American Tourister Website", ...shopifySplit.americanTourister },
    ].filter(s => Math.round(s.egp) > 0);

    const navTotal = rows.reduce((s,r) => s + Number(r.egp), 0);
    const shopTotal = shopStores.reduce((s,r) => s + r.egp, 0);
    const total = navTotal + shopTotal;

    const drillRows = [
      ...rows.map(r => ({
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
      })),
      ...shopStores.map(s => ({
        store_code:    s.store_code,
        store_display: s.label,
        group:         "Ecom",
        egp:           Math.round(s.egp),
        usd:           Math.round(s.egp / fx),
        units:         Math.round(s.units),
        days:          null as number | null,
        pct:           total > 0 ? Math.round(s.egp*100/total) : 0,
        _drill_url:    dUrl({type:"store-category", store:s.store_code}, from, to),
        _drill_title:  `${s.label} · Categories`,
      })),
    ].sort((a,b) => b.egp - a.egp);

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
        {label:"stores", value:String(drillRows.length)},
        {label:"revenue",value:`EGP ${Math.round(total).toLocaleString()}`},
      ],
      fx,
    });
  }

  // ── Channel → stores breakdown ───────────────────────────────────────────────
  // B2B channel drills into CUSTOMERS (HO invoices), not POS stores (which are empty).
  if (type === "channel" && channel === "B2B") {
    const custRows = await navQuery<{cust:string;egp:number;units:number;txns:number}>(`
      SELECT cust, SUM(egp) AS egp, SUM(units) AS units, COUNT(DISTINCT doc) AS txns FROM (
        SELECT [Sell-to Customer No_] AS cust, [Amount Including VAT] AS egp, [Quantity] AS units, [Document No_] AS doc
          FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
        UNION ALL
        SELECT [Sell-to Customer No_], -[Amount Including VAT], -[Quantity], [Document No_]
          FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
      ) t GROUP BY cust HAVING SUM(egp) <> 0 ORDER BY egp DESC
    `, { from, to });
    let nameRows: { code: string; name: string }[] = [];
    try { nameRows = await query<{ code: string; name: string }>("SELECT code, name FROM b2b_customers"); } catch { /* names are enrichment — degrade to codes */ }
    const nameMap = Object.fromEntries(nameRows.map(r => [r.code, r.name]));
    const cleanName = (raw?: string) => { if (!raw) return ""; const c = raw.replace(/[\s\d/_.\-]+$/u, "").trim(); return c || raw; };
    const total = custRows.reduce((s, r) => s + Number(r.egp), 0);
    const drillRows = custRows.map(r => {
      const nm = nameMap[r.cust];
      const display = nm ? (cleanName(nm) || nm) : r.cust;
      return {
        customer: display,
        code:     r.cust,
        egp:      Math.round(Number(r.egp)),
        usd:      Math.round(Number(r.egp) / fx),
        units:    Math.round(Number(r.units)),
        pct:      total > 0 ? Math.round(Number(r.egp) * 100 / total) : 0,
        _drill_url:   dUrl({ type: "b2b-customer-items", customer: r.cust }, from, to),
        _drill_title: `${display} · Products`,
      };
    });
    return NextResponse.json({
      columns: [
        { key: "customer", label: "Customer",  type: "text" },
        { key: "code",     label: "Code",      type: "text" },
        { key: "egp",      label: "Revenue",   type: "currency" },
        { key: "units",    label: "Units",     type: "units" },
        { key: "pct",      label: "% of B2B",  type: "number" },
      ],
      rows: drillRows,
      summary: [
        { label: "customers", value: String(drillRows.length) },
        { label: "revenue",   value: `EGP ${Math.round(total).toLocaleString()}` },
      ],
      fx,
    });
  }

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
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to ${cf}
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
      WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
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
      WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
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

  // ── Category → products (cross-channel, incl. own website) ───────────────────
  if (type === "category") {
    const catF   = category ? `AND [Product Group Code] = '${category}'` : "";
    const brandF = brand    ? `AND [Item Category Code] = '${brand}'`    : "";
    const [rows, shopItems, skuMap] = await Promise.all([
      navQuery<{item_no:string;description:string;brand:string;category:string;egp:number;units:number}>(`
        SELECT TOP 200
          [Item No_]                     AS item_no,
          [Item No_] AS description,
          MAX([Item Category Code])      AS brand,
          MAX([Product Group Code])      AS category,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])               AS units
        FROM TransSalesEntry
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to ${catF} ${brandF}
        GROUP BY [Item No_]
        ORDER BY egp DESC
      `, { from, to }),
      getShopifyLineItems(from, to),
      query<{sku:string;item_no:string}>("SELECT sku, item_no FROM shopify_item_map"),
    ]);

    // Aggregate Shopify line items by NAV item_no
    const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
    const shopByItem: Record<string, { egp:number; units:number }> = {};
    for (const li of shopItems) {
      const itemNo = skuToItemNo[li.sku];
      if (!itemNo) continue;
      if (!shopByItem[itemNo]) shopByItem[itemNo] = { egp:0, units:0 };
      shopByItem[itemNo].egp += li.egp; shopByItem[itemNo].units += li.quantity;
    }
    // Keep only Shopify items that belong to this category/brand (via NAV metadata)
    const shopItemNos = Object.keys(shopByItem);
    let validShop = new Set<string>();
    if (shopItemNos.length > 0 && (category || brand)) {
      const inClause = shopItemNos.map(n => `'${n.replace(/'/g,"''")}'`).join(",");
      const pgRows = await navQuery<{item_no:string}>(`
        SELECT [Item No_] AS item_no FROM TransSalesEntry
        WHERE [Item No_] IN (${inClause}) ${catF} ${brandF}
        GROUP BY [Item No_]
      `, {});
      validShop = new Set(pgRows.map(r => r.item_no));
    } else {
      validShop = new Set(shopItemNos); // no filter → all map
    }

    const navItemSet = new Set(rows.map(r => r.item_no));
    const merged = rows.map(r => {
      const s = shopByItem[r.item_no];
      const egp = Number(r.egp) + (s ? s.egp : 0);
      const units = Number(r.units) + (s ? s.units : 0);
      return {
        item_no: r.item_no,
        description: descMap[r.item_no] || r.item_no,
        egp: Math.round(egp), usd: Math.round(egp / fx), units: Math.round(units),
        brand: brandLabel(r.brand),
        _drill_url:   dUrl({type:"item", item:r.item_no}, from, to),
        _drill_title: descMap[r.item_no] || r.item_no,
      };
    });
    // Shopify-only items in this category (not in NAV results)
    for (const itemNo of shopItemNos) {
      if (navItemSet.has(itemNo) || !validShop.has(itemNo)) continue;
      const s = shopByItem[itemNo];
      if (Math.round(s.egp) < 100) continue;
      merged.push({
        item_no: itemNo,
        description: descMap[itemNo] || itemNo,
        egp: Math.round(s.egp), usd: Math.round(s.egp / fx), units: Math.round(s.units),
        brand: "",
        _drill_url:   dUrl({type:"item", item:itemNo}, from, to),
        _drill_title: descMap[itemNo] || itemNo,
      });
    }
    const drillRows = merged.sort((a,b) => b.egp - a.egp);
    return NextResponse.json({
      columns:[
        {key:"description",label:"Product",  type:"text"},
        {key:"brand",      label:"Brand",    type:"text"},
        {key:"egp",        label:"Revenue",  type:"currency"},
        {key:"units",      label:"Units",    type:"units"},
      ],
      rows: drillRows,
      summary:[{label:"SKUs",value:String(drillRows.length)}],
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
      WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
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

  // ── Item → which stores sold it (incl. own website) ──────────────────────────
  if (type === "item") {
    const [metaRows, storeRows, shopItems, skuRows] = await Promise.all([
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
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to AND [Item No_] = @itemNo
        GROUP BY [Store No_]
        ORDER BY egp DESC
      `, { from, to, itemNo }),

      getShopifyLineItems(from, to),
      query<{sku:string}>("SELECT sku FROM shopify_item_map WHERE item_no = $1", [itemNo]),
    ]);

    const meta = metaRows[0] ?? {description:itemNo, brand:"", category:""};

    const drillRows = storeRows.map(r => ({
      store_display: sn(r.store_code),
      egp:           Math.round(Number(r.egp)),
      usd:           Math.round(Number(r.egp) / fx),
      units:         Math.round(Number(r.units)),
      days:          Number(r.days) as number | null,
      _drill_url:    dUrl({type:"item-store", item:itemNo, store:r.store_code}, from, to) as string | undefined,
      _drill_title:  `${sn(r.store_code)} · ${meta.description || itemNo} · Daily`,
    }));

    // Own-website (Shopify) sales of this item — NAV doesn't carry these.
    const itemSkus = new Set(skuRows.map(r => r.sku));
    let shopEgp = 0, shopUnits = 0;
    for (const li of shopItems) if (itemSkus.has(li.sku)) { shopEgp += li.egp; shopUnits += li.quantity; }
    if (Math.round(shopEgp) > 0) {
      drillRows.push({
        store_display: "Own Website",
        egp:           Math.round(shopEgp),
        usd:           Math.round(shopEgp / fx),
        units:         Math.round(shopUnits),
        days:          null,
        _drill_url:    undefined, // item-store daily is NAV-only
        _drill_title:  "",
      });
      drillRows.sort((a,b) => b.egp - a.egp);
    }

    const totalRev = drillRows.reduce((s,r) => s + r.egp, 0);
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
        {label:"stores",  value:String(drillRows.length)},
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
      WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
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
    // SHOPIFY virtual stores: show only Shopify line items (no NAV query).
    // Handles the combined store and each brand-specific website.
    if (store === "SHOPIFY" || store === "SHOPIFY-SAM" || store === "SHOPIFY-AMT") {
      const shopBrand = store === "SHOPIFY-SAM" ? "samsonite" as const
                      : store === "SHOPIFY-AMT" ? "american-tourister" as const
                      : undefined;
      const shopLabel = store === "SHOPIFY-SAM" ? "Samsonite Website"
                      : store === "SHOPIFY-AMT" ? "American Tourister Website"
                      : "Own Website (Shopify)";
      const [shopifyItems, skuMap] = await Promise.all([
        getShopifyLineItems(from, to, shopBrand),
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
          const egp  = Math.round(v.egp);
          const desc = descMap[itemNo] || itemNo;
          return {
            item_no:     itemNo,
            description: desc,
            size:        parseSize(desc) !== "Other" ? parseSize(desc) : "",
            color:       parseColor(desc),
            egp,
            usd:         Math.round(egp / fx),
            units:       v.units,
            brand:       brandLabel(itemMeta[itemNo]?.category_code || ""),
            category:    itemMeta[itemNo]?.subcat || "",
            _drill_url:  dUrl({ type: "item", item: itemNo }, from, to),
            _drill_title: desc,
          };
        })
        .sort((a, b) => b.egp - a.egp);
      return NextResponse.json({
        columns: [
          { key: "description", label: "Product",  type: "text" },
          { key: "size",        label: "Size",     type: "text" },
          { key: "color",       label: "Colour",   type: "text" },
          { key: "brand",       label: "Brand",    type: "text" },
          { key: "egp",         label: "Revenue",  type: "currency" },
          { key: "units",       label: "Units",    type: "units" },
        ],
        rows: drillRows,
        summary: [
          { label: "source",  value: shopLabel },
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
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to ${storeF} ${catF} ${brandF}
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

    const buildRow = (item_no: string, egpVal: number, unitsVal: number, brandCode: string, catCode: string) => {
      const desc = descMap[item_no] || item_no;
      const itemSize  = parseSize(desc);
      const itemColor = parseColor(desc);
      return {
        item_no,
        description: desc,
        size:        itemSize !== "Other" ? itemSize : "",
        color:       itemColor,
        egp:         Math.round(egpVal),
        usd:         Math.round(egpVal / fx),
        units:       Math.round(unitsVal),
        brand:       brandLabel(brandCode),
        category:    catCode || "",
        _drill_url:   dUrl({type:"item", item:item_no}, from, to),
        _drill_title: desc,
      };
    };

    let drillRows = rows.map(r => {
      const shopifyItem = shopifyByItem[r.item_no] ?? { egp: 0, units: 0 };
      return buildRow(r.item_no, Number(r.egp) + shopifyItem.egp, Number(r.units) + shopifyItem.units, r.brand, r.category);
    });

    // Add Shopify-only items not in NAV top 200
    for (const [itemNo, shopifyItem] of Object.entries(shopifyByItem)) {
      if (navItemSet.has(itemNo)) continue;
      if (shopifyItem.egp < 100) continue;
      drillRows.push(buildRow(itemNo, shopifyItem.egp, shopifyItem.units, "", ""));
    }

    drillRows.sort((a, b) => b.egp - a.egp);

    // Filter by size if specified (from store-subcat drill)
    if (size) drillRows = drillRows.filter(r => r.size === size);

    return NextResponse.json({
      columns:[
        {key:"description",label:"Product",  type:"text"},
        {key:"size",       label:"Size",     type:"text"},
        {key:"color",      label:"Colour",   type:"text"},
        {key:"brand",      label:"Brand",    type:"text"},
        {key:"egp",        label:"Revenue",  type:"currency"},
        {key:"units",      label:"Units",    type:"units"},
      ],
      rows: drillRows,
      summary:[
        {label:"SKUs",   value:String(drillRows.length)},
        {label:"revenue",value:`EGP ${Math.round(drillRows.reduce((s,r)=>s+r.egp,0)).toLocaleString()}`},
        {label:"units",  value:drillRows.reduce((s,r)=>s+r.units,0).toLocaleString()},
      ],
      fx,
    });
  }

  // ── Store / Source → product categories ──────────────────────────────────────
  if (type === "store-category") {
    const isShopify = store === "SHOPIFY" || store === "SHOPIFY-SAM" || store === "SHOPIFY-AMT";
    const shopifyBrandCat = store === "SHOPIFY-SAM" ? "samsonite" as const
                          : store === "SHOPIFY-AMT" ? "american-tourister" as const
                          : undefined;
    const storeLabelCat = store === "SHOPIFY-SAM" ? "Samsonite Website"
                        : store === "SHOPIFY-AMT" ? "American Tourister Website"
                        : store === "SHOPIFY"     ? "Own Website (Shopify)"
                        : sn(store);

    // Aggregate egp/units/skus by [Product Group Code]
    const pgMap: Record<string, { egp: number; units: number; skus: Set<string> }> = {};

    if (isShopify) {
      const [shopifyItems, skuMap] = await Promise.all([
        getShopifyLineItems(from, to, shopifyBrandCat),
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
      if (itemNos.length > 0) {
        const inClause = itemNos.map(n => `'${n}'`).join(",");
        const pgRows = await navQuery<{ item_no: string; pg: string }>(`
          SELECT [Item No_] AS item_no, MAX([Product Group Code]) AS pg
          FROM TransSalesEntry WHERE [Item No_] IN (${inClause})
          GROUP BY [Item No_]
        `, {});
        const itemPgMap = Object.fromEntries(pgRows.map(r => [r.item_no, r.pg || "Other"]));
        for (const [itemNo, vals] of Object.entries(byItemNo)) {
          const pg = itemPgMap[itemNo] || "Other";
          if (!pgMap[pg]) pgMap[pg] = { egp: 0, units: 0, skus: new Set() };
          pgMap[pg].egp += vals.egp;
          pgMap[pg].units += vals.units;
          pgMap[pg].skus.add(itemNo);
        }
      }
    } else {
      const rows = await navQuery<{ pg: string; egp: number; units: number; skus: number }>(`
        SELECT
          CASE WHEN LEN([Product Group Code]) > 0 THEN [Product Group Code] ELSE 'Other' END AS pg,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units,
          COUNT(DISTINCT [Item No_])      AS skus
        FROM TransSalesEntry
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
          AND [Store No_] = @store
        GROUP BY [Product Group Code]
        ORDER BY egp DESC
      `, { from, to, store });
      for (const r of rows) {
        pgMap[r.pg] = { egp: Number(r.egp), units: Number(r.units), skus: new Set(Array(Number(r.skus)).fill("")) };
      }
    }

    const catRows = Object.entries(pgMap)
      .map(([pg, v]) => ({ pg, egp: v.egp, units: v.units, skus: v.skus.size }))
      .sort((a, b) => b.egp - a.egp);

    const total = catRows.reduce((s, r) => s + r.egp, 0);
    const drillRows = catRows.map(r => ({
      category: r.pg,
      egp:      Math.round(r.egp),
      usd:      Math.round(r.egp / fx),
      units:    Math.round(r.units),
      skus:     r.skus,
      pct:      total > 0 ? Math.round(r.egp * 100 / total) : 0,
      _drill_url:   dUrl({ type: "store-subcat", store, category: r.pg }, from, to),
      _drill_title: `${storeLabelCat} · ${r.pg} · Products`,
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
        { label: "source",     value: storeLabelCat },
        { label: "revenue",    value: `EGP ${Math.round(total).toLocaleString()}` },
        { label: "categories", value: String(catRows.length) },
      ],
      fx,
    });
  }

  // ── Store + Category → sizes (parsed from descriptions) ──────────────────────
  if (type === "store-subcat") {
    const isShopifySub = store === "SHOPIFY" || store === "SHOPIFY-SAM" || store === "SHOPIFY-AMT";
    const shopifyBrandSub = store === "SHOPIFY-SAM" ? "samsonite" as const
                          : store === "SHOPIFY-AMT" ? "american-tourister" as const
                          : undefined;
    const storeLabelSub = store === "SHOPIFY-SAM" ? "Samsonite Website"
                        : store === "SHOPIFY-AMT" ? "American Tourister Website"
                        : store === "SHOPIFY"     ? "Own Website (Shopify)"
                        : sn(store);
    const catFilter = category ? `AND [Product Group Code] = '${category}'` : "";

    // Step 1: get revenue/units by item_no
    let byItemNo: Record<string, { egp: number; units: number }> = {};

    if (isShopifySub) {
      const [shopifyItems, skuMap] = await Promise.all([
        getShopifyLineItems(from, to, shopifyBrandSub),
        query<{ sku: string; item_no: string }>("SELECT sku, item_no FROM shopify_item_map"),
      ]);
      const skuToItemNo = Object.fromEntries(skuMap.map(r => [r.sku, r.item_no]));
      const allItemNos: Record<string, { egp: number; units: number }> = {};
      for (const li of shopifyItems) {
        const itemNo = skuToItemNo[li.sku];
        if (!itemNo) continue;
        if (!allItemNos[itemNo]) allItemNos[itemNo] = { egp: 0, units: 0 };
        allItemNos[itemNo].egp += li.egp;
        allItemNos[itemNo].units += li.quantity;
      }
      if (Object.keys(allItemNos).length > 0 && category) {
        const inClause = Object.keys(allItemNos).map(n => `'${n}'`).join(",");
        const pgRows = await navQuery<{ item_no: string }>(`
          SELECT [Item No_] AS item_no FROM TransSalesEntry
          WHERE [Item No_] IN (${inClause}) AND [Product Group Code] = '${category}'
          GROUP BY [Item No_]
        `, {});
        const valid = new Set(pgRows.map(r => r.item_no));
        for (const [itemNo, vals] of Object.entries(allItemNos)) {
          if (valid.has(itemNo)) byItemNo[itemNo] = vals;
        }
      } else {
        byItemNo = allItemNos;
      }
    } else {
      const rows = await navQuery<{ item_no: string; egp: number; units: number }>(`
        SELECT [Item No_] AS item_no,
          -SUM([Net Amount]+[VAT Amount]) AS egp,
          -SUM([Quantity])                AS units
        FROM TransSalesEntry
        WHERE [Store No_] != 'ONLINE' AND CAST([Date] AS DATE) BETWEEN @from AND @to
          AND [Store No_] = @store ${catFilter}
        GROUP BY [Item No_]
      `, { from, to, store });
      for (const r of rows) byItemNo[r.item_no] = { egp: Number(r.egp), units: Number(r.units) };
    }

    // Step 2: get descriptions from PostgreSQL and parse sizes
    const descRows = await query<{ item_no: string; description: string }>(
      "SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"
    );
    const dMap = Object.fromEntries(descRows.map(r => [r.item_no, r.description]));

    // One row per product, with size + colour parsed from the description.
    // Users need to see the actual products that sold — not just size buckets.
    const total = Object.values(byItemNo).reduce((s, v) => s + v.egp, 0);
    const itemRows = Object.entries(byItemNo)
      .map(([itemNo, v]) => {
        const desc = dMap[itemNo] || itemNo;
        const sz   = parseSize(desc);
        return {
          item_no:     itemNo,
          description: desc,
          size:        sz !== "Other" ? sz : "",
          color:       parseColor(desc),
          egp:         Math.round(v.egp),
          usd:         Math.round(v.egp / fx),
          units:       Math.round(v.units),
          pct:         total > 0 ? Math.round(v.egp * 100 / total) : 0,
          _drill_url:   dUrl({ type: "item", item: itemNo }, from, to),
          _drill_title: desc,
        };
      })
      .sort((a, b) => b.egp - a.egp);

    return NextResponse.json({
      columns: [
        { key: "description", label: "Product",       type: "text" },
        { key: "size",        label: "Size",          type: "text" },
        { key: "color",       label: "Colour",        type: "text" },
        { key: "egp",         label: "Revenue",       type: "currency" },
        { key: "units",       label: "Units",         type: "units" },
        { key: "pct",         label: "% of category", type: "number" },
      ],
      rows: itemRows,
      summary: [
        { label: "source",   value: storeLabelSub },
        { label: "category", value: category },
        { label: "products", value: String(itemRows.length) },
        { label: "revenue",  value: `EGP ${Math.round(total).toLocaleString()}` },
      ],
      fx,
    });
  }

  return NextResponse.json({columns:[], rows:[], fx});
}
