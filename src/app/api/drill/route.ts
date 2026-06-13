import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const RETAIL = ["ALMAZA","CCA","CF-HOS","CSTARS","P90"];
const ONLINE = ["SHOPIFY-AMT","SHOPIFY-SAM","AMAZON BAN","AMAZON KAM"];
const B2B    = ["HO","NOON","AMAZON","JUMIA","DUTY FREE","FOUR SEASO","GO SPORT1","MOA","MOE","SPINNEYS","ATCFC","ATMADI","HIS","EVE"];

// Human names used in drill table cells
const STORE_NAMES: Record<string,string> = {
  "CSTARS":"City Stars","CF-HOS":"Festival of Hope","ALMAZA":"Almaza City Center",
  "P90":"Patio 90","CCA":"Cairo Festival City","ONLINE":"Online Store",
  "SHOPIFY-AMT":"AT Online","SHOPIFY-SAM":"Samsonite Online",
  "HO":"Head Office","NOON":"Noon","AMAZON":"Amazon Egypt","JUMIA":"Jumia",
  "DUTY FREE":"Duty Free","FOUR SEASO":"Four Seasons","GO SPORT1":"Go Sport",
  "MOA":"Mall of Arabia","MOE":"Mall of Egypt","SPINNEYS":"Spinneys",
  "AMAZON BAN":"Amazon Banha","AMAZON KAM":"Amazon Kamal",
};

function channelFilter(ch: string) {
  if (ch === "Retail") return `AND store_code = ANY(ARRAY[${RETAIL.map(s=>`'${s}'`).join(",")}])`;
  if (ch === "Online") return `AND store_code = ANY(ARRAY[${ONLINE.map(s=>`'${s}'`).join(",")}])`;
  if (ch === "B2B")    return `AND store_code = ANY(ARRAY[${B2B.map(s=>`'${s}'`).join(",")}])`;
  return "";
}

// Best description: NAV catalogue → Shopify product title → raw item_no
const ITEM_DESC_SQL = `
  COALESCE(
    ic.description,
    (SELECT product_title FROM shopify_sales WHERE sku = a.item_no LIMIT 1),
    a.item_no
  )`.trim();

const ITEM_BRAND_SQL = `
  COALESCE(
    ic.brand,
    (SELECT shopify_store FROM shopify_sales WHERE sku = a.item_no LIMIT 1)
  )`.trim();

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const type     = p.get("type") || "daily";
  const from     = p.get("from") || "2026-01-01";
  const to       = p.get("to")   || new Date().toISOString().slice(0,10);
  const store    = p.get("store")    || "";
  const channel  = p.get("channel")  || "";
  const category = p.get("category") || "";
  const brand    = p.get("brand")    || "";
  const itemNo   = p.get("item")     || "";

  const fxRow = await query<{ egp_per_usd: string }>(
    "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
  );
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "52");

  // ── Daily revenue trend ──────────────────────────────────────────────────────
  if (type === "daily" || type === "kpi") {
    const storeF = store ? `AND store_code = '${store.replace(/'/g,"''")}'`
                 : channel ? channelFilter(channel) : "";
    const rows = await query<{ date: string; egp: string; units: string; stores: string }>(`
      SELECT sale_date::text AS date,
             SUM(revenue)::numeric AS egp,
             SUM(units)::numeric   AS units,
             COUNT(DISTINCT store_code)::int AS stores
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}' ${storeF}
      GROUP BY sale_date ORDER BY sale_date DESC
    `);
    const totalRev   = rows.reduce((s,r) => s + parseFloat(r.egp), 0);
    const totalUnits = rows.reduce((s,r) => s + parseFloat(r.units), 0);
    const avgDay     = rows.length > 0 ? Math.round(totalRev / rows.length) : 0;
    return NextResponse.json({
      columns: [
        { key: "date",   label: "Date",          type: "date" },
        { key: "egp",    label: "Revenue",        type: "currency" },
        { key: "units",  label: "Units Sold",     type: "units" },
        { key: "stores", label: "Active Stores",  type: "number" },
      ],
      rows,
      summary: [
        { label: "days",        value: String(rows.length) },
        { label: "total",       value: `EGP ${Math.round(totalRev).toLocaleString()}` },
        { label: "daily avg",   value: `EGP ${avgDay.toLocaleString()}` },
        { label: "units",       value: totalUnits.toLocaleString() },
      ],
      fx,
    });
  }

  // ── Store → top products sold in that store ──────────────────────────────────
  // (More actionable than a daily table: tells you WHAT is selling where)
  if (type === "store") {
    const safeStore = store.replace(/'/g,"''");
    const rows = await query<{ description: string; brand: string; category: string; size: string; colour: string; egp: string; units: string; pct: string }>(`
      WITH total AS (
        SELECT SUM(revenue) AS t FROM all_sales
        WHERE sale_date BETWEEN '${from}' AND '${to}' AND store_code = '${safeStore}'
      )
      SELECT
        ${ITEM_DESC_SQL.replace(/\ba\./g, "a.")} AS description,
        COALESCE(ic.brand, '') AS brand,
        COALESCE(ic.category, '') AS category,
        COALESCE(ic.size, '') AS size,
        COALESCE(ic.colour_exact, '') AS colour,
        SUM(a.revenue)::numeric AS egp,
        SUM(a.units)::numeric   AS units,
        ROUND(SUM(a.revenue) * 100.0 / NULLIF((SELECT t FROM total),0), 1)::numeric AS pct
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
        AND a.store_code = '${safeStore}'
      GROUP BY a.item_no, ic.description, ic.brand, ic.category, ic.size, ic.colour_exact
      ORDER BY egp DESC LIMIT 100
    `);
    const totalRev   = rows.reduce((s,r) => s + parseFloat(r.egp), 0);
    const totalUnits = rows.reduce((s,r) => s + parseFloat(r.units), 0);
    return NextResponse.json({
      columns: [
        { key: "description", label: "Product",   type: "text" },
        { key: "brand",       label: "Brand",     type: "text" },
        { key: "size",        label: "Size",      type: "text" },
        { key: "colour",      label: "Colour",    type: "text" },
        { key: "egp",         label: "Revenue",   type: "currency" },
        { key: "units",       label: "Units",     type: "units" },
        { key: "pct",         label: "% of store",type: "number" },
      ],
      rows,
      summary: [
        { label: "SKUs",    value: String(rows.length) },
        { label: "revenue", value: `EGP ${Math.round(totalRev).toLocaleString()}` },
        { label: "units",   value: totalUnits.toLocaleString() },
      ],
      fx,
    });
  }

  // ── Store daily trend (separate type for when you want the day-by-day) ────────
  if (type === "store-daily") {
    const safeStore = store.replace(/'/g,"''");
    const rows = await query<{ date: string; egp: string; units: string }>(`
      SELECT sale_date::text AS date,
             SUM(revenue)::numeric AS egp,
             SUM(units)::numeric   AS units
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}'
        AND store_code = '${safeStore}'
      GROUP BY sale_date ORDER BY sale_date DESC
    `);
    return NextResponse.json({
      columns: [
        { key: "date",  label: "Date",    type: "date" },
        { key: "egp",   label: "Revenue", type: "currency" },
        { key: "units", label: "Units",   type: "units" },
      ],
      rows,
      summary: [
        { label: "days",    value: String(rows.length) },
        { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.egp),0)).toLocaleString()}` },
      ],
      fx,
    });
  }

  // ── Channel → ranked stores ──────────────────────────────────────────────────
  if (type === "channel") {
    const rows = await query<{ store_code: string; egp: string; units: string; days: string; pct: string }>(`
      WITH total AS (
        SELECT SUM(revenue) AS t FROM all_sales
        WHERE sale_date BETWEEN '${from}' AND '${to}' ${channelFilter(channel)}
      )
      SELECT store_code,
             SUM(revenue)::numeric AS egp,
             SUM(units)::numeric   AS units,
             COUNT(DISTINCT sale_date)::int AS days,
             ROUND(SUM(revenue)*100.0/NULLIF((SELECT t FROM total),0),1)::numeric AS pct
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}' ${channelFilter(channel)}
      GROUP BY store_code ORDER BY egp DESC
    `);
    // Translate store codes to human names
    const namedRows = rows.map(r => ({
      ...r,
      store_display: STORE_NAMES[r.store_code] ?? r.store_code,
    }));
    return NextResponse.json({
      columns: [
        { key: "store_display", label: "Store",       type: "text" },
        { key: "egp",           label: "Revenue",     type: "currency" },
        { key: "units",         label: "Units",       type: "units" },
        { key: "days",          label: "Active Days", type: "number" },
        { key: "pct",           label: "% of channel",type: "number" },
      ],
      rows: namedRows,
      summary: [
        { label: "stores",  value: String(rows.length) },
        { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.egp),0)).toLocaleString()}` },
        { label: "units",   value: rows.reduce((s,r)=>s+parseFloat(r.units),0).toLocaleString() },
      ],
      fx,
    });
  }

  // ── Category → top products in that category ─────────────────────────────────
  if (type === "category") {
    const catF   = category ? `AND ic.category = '${category.replace(/'/g,"''")}'` : "";
    const brandF = brand    ? `AND ic.brand    = '${brand.replace(/'/g,"''")}'`    : "";
    const rows = await query<{ description: string; brand: string; size: string; colour: string; egp: string; units: string }>(`
      SELECT
        ${ITEM_DESC_SQL} AS description,
        COALESCE(ic.brand, '') AS brand,
        COALESCE(ic.size, '') AS size,
        COALESCE(ic.colour_exact, '') AS colour,
        SUM(a.revenue)::numeric AS egp,
        SUM(a.units)::numeric   AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}' ${catF} ${brandF}
      GROUP BY a.item_no, ic.description, ic.brand, ic.size, ic.colour_exact
      ORDER BY egp DESC LIMIT 200
    `);
    return NextResponse.json({
      columns: [
        { key: "description", label: "Product",  type: "text" },
        { key: "brand",       label: "Brand",    type: "text" },
        { key: "size",        label: "Size",     type: "text" },
        { key: "colour",      label: "Colour",   type: "text" },
        { key: "egp",         label: "Revenue",  type: "currency" },
        { key: "units",       label: "Units",    type: "units" },
      ],
      rows,
      summary: [
        { label: "SKUs",    value: String(rows.length) },
        { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.egp),0)).toLocaleString()}` },
        { label: "units",   value: rows.reduce((s,r)=>s+parseFloat(r.units),0).toLocaleString() },
      ],
      fx,
    });
  }

  // ── Brand breakdown ──────────────────────────────────────────────────────────
  if (type === "brand") {
    const rows = await query<{ brand: string; egp: string; units: string; skus: string }>(`
      SELECT COALESCE(ic.brand,'Unknown') AS brand,
             SUM(a.revenue)::numeric AS egp,
             SUM(a.units)::numeric   AS units,
             COUNT(DISTINCT a.item_no)::int AS skus
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
      GROUP BY ic.brand ORDER BY egp DESC
    `);
    return NextResponse.json({
      columns: [
        { key: "brand", label: "Brand",  type: "text" },
        { key: "egp",   label: "Revenue",type: "currency" },
        { key: "units", label: "Units",  type: "units" },
        { key: "skus",  label: "SKUs",   type: "number" },
      ],
      rows,
      summary: [{ label: "brands", value: String(rows.length) }],
      fx,
    });
  }

  // ── Item detail: which stores sold this item, day by day ─────────────────────
  if (type === "item") {
    const safeItem = itemNo.replace(/'/g,"''");
    // Get the best name for this item first
    const nameRow = await query<{ description: string; brand: string; category: string; size: string; colour: string }>(`
      SELECT
        COALESCE(ic.description, ss.product_title, '${safeItem}') AS description,
        COALESCE(ic.brand, '') AS brand,
        COALESCE(ic.category, '') AS category,
        COALESCE(ic.size, '') AS size,
        COALESCE(ic.colour_exact, '') AS colour
      FROM (SELECT '${safeItem}'::text AS item_no) x
      LEFT JOIN item_categorisation ic ON ic.item_no = x.item_no
      LEFT JOIN (SELECT DISTINCT sku, product_title FROM shopify_sales WHERE sku = '${safeItem}') ss ON true
      LIMIT 1
    `);
    const meta = nameRow[0] ?? { description: safeItem, brand: "", category: "", size: "", colour: "" };

    const rows = await query<{ date: string; store: string; egp: string; units: string; source: string }>(`
      SELECT sale_date::text AS date,
             store_code      AS store,
             SUM(revenue)::numeric AS egp,
             SUM(units)::numeric   AS units,
             source
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}'
        AND item_no = '${safeItem}'
      GROUP BY sale_date, store_code, source
      ORDER BY sale_date DESC
    `);

    const namedRows = rows.map(r => ({ ...r, store: STORE_NAMES[r.store] ?? r.store }));

    return NextResponse.json({
      columns: [
        { key: "date",   label: "Date",   type: "date" },
        { key: "store",  label: "Store",  type: "text" },
        { key: "egp",    label: "Revenue",type: "currency" },
        { key: "units",  label: "Units",  type: "units" },
        { key: "source", label: "Source", type: "text" },
      ],
      rows: namedRows,
      summary: [
        { label: "item",    value: meta.description },
        { label: "brand",   value: meta.brand },
        { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.egp),0)).toLocaleString()}` },
        { label: "units",   value: rows.reduce((s,r)=>s+parseFloat(r.units),0).toLocaleString() },
      ],
      fx,
    });
  }

  // ── Top items in period (Avg Ticket click, category drill, store products) ────
  if (type === "items") {
    const storeF   = store    ? `AND a.store_code  = '${store.replace(/'/g,"''")}'`    : channel ? channelFilter(channel) : "";
    const catF     = category ? `AND ic.category   = '${category.replace(/'/g,"''")}'` : "";
    const brandF   = brand    ? `AND ic.brand      = '${brand.replace(/'/g,"''")}'`    : "";

    const rows = await query<{ description: string; brand: string; category: string; size: string; egp: string; units: string }>(`
      SELECT
        ${ITEM_DESC_SQL} AS description,
        COALESCE(ic.brand,'') AS brand,
        COALESCE(ic.category,'') AS category,
        COALESCE(ic.size,'') AS size,
        SUM(a.revenue)::numeric AS egp,
        SUM(a.units)::numeric   AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}' ${storeF} ${catF} ${brandF}
      GROUP BY a.item_no, ic.description, ic.brand, ic.category, ic.size
      ORDER BY egp DESC LIMIT 200
    `);
    return NextResponse.json({
      columns: [
        { key: "description", label: "Product",  type: "text" },
        { key: "brand",       label: "Brand",    type: "text" },
        { key: "category",    label: "Category", type: "text" },
        { key: "size",        label: "Size",     type: "text" },
        { key: "egp",         label: "Revenue",  type: "currency" },
        { key: "units",       label: "Units",    type: "units" },
      ],
      rows,
      summary: [
        { label: "SKUs",    value: String(rows.length) },
        { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.egp),0)).toLocaleString()}` },
        { label: "units",   value: rows.reduce((s,r)=>s+parseFloat(r.units),0).toLocaleString() },
      ],
      fx,
    });
  }

  return NextResponse.json({ columns: [], rows: [], fx });
}
