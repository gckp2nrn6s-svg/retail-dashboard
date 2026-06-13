import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// Generic drill-down endpoint
// ?type=kpi|store|channel|category|brand|item|daily
// &from=YYYY-MM-DD&to=YYYY-MM-DD
// &store=CSTARS  (for type=store)
// &channel=Retail (for type=channel)
// &category=Luggage (for type=category)
// &brand=Samsonite (for type=brand)
// &item=10101 (for type=item)

const RETAIL  = ["ALMAZA","CCA","CF-HOS","CSTARS","P90"];
const ONLINE  = ["ONLINE","AMAZON BAN","AMAZON KAM","SHOPIFY-AMT","SHOPIFY-SAM"];
const B2B     = ["HO","NOON","AMAZON","JUMIA","DUTY FREE","FOUR SEASO","GO SPORT1","MOA","MOE","SPINNEYS","ATCFC","ATMADI","HIS","EVE"];

function channelFilter(ch: string) {
  if (ch === "Retail")  return `AND store_code = ANY(ARRAY[${RETAIL.map(s=>`'${s}'`).join(",")}])`;
  if (ch === "Online")  return `AND store_code = ANY(ARRAY[${ONLINE.map(s=>`'${s}'`).join(",")}])`;
  if (ch === "B2B")     return `AND store_code = ANY(ARRAY[${B2B.map(s=>`'${s}'`).join(",")}])`;
  return "";
}

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const type     = p.get("type") || "kpi";
  const from     = p.get("from") || "2026-01-01";
  const to       = p.get("to")   || new Date().toISOString().slice(0, 10);
  const store    = p.get("store") || "";
  const channel  = p.get("channel") || "";
  const category = p.get("category") || "";
  const brand    = p.get("brand") || "";
  const itemNo   = p.get("item") || "";

  const fxRow = await query<{ egp_per_usd: string }>(
    "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
  );
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "52");

  // ── Daily breakdown (KPI click) ──────────────────────────────────────
  if (type === "daily" || type === "kpi") {
    const storeF = store ? `AND store_code = '${store.replace(/'/g,"''")}'` : channel ? channelFilter(channel) : "";
    const rows = await query<{ date: string; revenue: string; units: string; stores: string }>(`
      SELECT sale_date::text AS date,
             SUM(revenue)::numeric AS revenue,
             SUM(units)::numeric AS units,
             COUNT(DISTINCT store_code)::int AS stores
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}' ${storeF}
      GROUP BY sale_date ORDER BY sale_date DESC
    `);
    const totalRev = rows.reduce((s,r) => s + parseFloat(r.revenue), 0);
    const totalUnits = rows.reduce((s,r) => s + parseFloat(r.units), 0);
    return NextResponse.json({
      columns: [
        { key: "date",    label: "Date",        type: "date" },
        { key: "revenue", label: "Revenue",      type: "currency" },
        { key: "units",   label: "Units Sold",   type: "units" },
        { key: "stores",  label: "Active Stores",type: "number" },
      ],
      rows,
      summary: [
        { label: "days",        value: String(rows.length) },
        { label: "total revenue", value: `EGP ${Math.round(totalRev).toLocaleString()}` },
        { label: "units",       value: totalUnits.toLocaleString() },
      ],
      fx,
    });
  }

  // ── Store breakdown ──────────────────────────────────────────────────
  if (type === "store") {
    const rows = await query<{ date: string; revenue: string; units: string }>(`
      SELECT sale_date::text AS date,
             SUM(revenue)::numeric AS revenue,
             SUM(units)::numeric AS units
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}'
        AND store_code = '${store.replace(/'/g,"''")}'
      GROUP BY sale_date ORDER BY sale_date DESC
    `);
    return NextResponse.json({
      columns: [
        { key: "date",    label: "Date",      type: "date" },
        { key: "revenue", label: "Revenue",   type: "currency" },
        { key: "units",   label: "Units",     type: "units" },
      ],
      rows,
      summary: [
        { label: "days", value: String(rows.length) },
        { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.revenue),0)).toLocaleString()}` },
      ],
      fx,
    });
  }

  // ── Channel breakdown ────────────────────────────────────────────────
  if (type === "channel") {
    const rows = await query<{ store_code: string; revenue: string; units: string; days: string }>(`
      SELECT store_code,
             SUM(revenue)::numeric AS revenue,
             SUM(units)::numeric AS units,
             COUNT(DISTINCT sale_date)::int AS days
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}'
        ${channelFilter(channel)}
      GROUP BY store_code ORDER BY revenue DESC
    `);
    return NextResponse.json({
      columns: [
        { key: "store_code", label: "Store/Channel", type: "text" },
        { key: "revenue",    label: "Revenue",       type: "currency" },
        { key: "units",      label: "Units",         type: "units" },
        { key: "days",       label: "Active Days",   type: "number" },
      ],
      rows,
      summary: [{ label: "stores", value: String(rows.length) }, { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.revenue),0)).toLocaleString()}` }],
      fx,
    });
  }

  // ── Category breakdown ───────────────────────────────────────────────
  if (type === "category") {
    const catFilter = category ? `AND ic.category = '${category.replace(/'/g,"''")}'` : "";
    const brandFilter = brand ? `AND ic.brand = '${brand.replace(/'/g,"''")}'` : "";
    const rows = await query<{ item_no: string; description: string; brand: string; size: string; colour_exact: string; revenue: string; units: string }>(`
      SELECT a.item_no,
             COALESCE(ic.description, a.item_no) AS description,
             COALESCE(ic.brand, 'Unknown') AS brand,
             COALESCE(ic.size, '') AS size,
             COALESCE(ic.colour_exact, '') AS colour_exact,
             SUM(a.revenue)::numeric AS revenue,
             SUM(a.units)::numeric AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
        ${catFilter} ${brandFilter}
      GROUP BY a.item_no, ic.description, ic.brand, ic.size, ic.colour_exact
      ORDER BY revenue DESC
      LIMIT 200
    `);
    return NextResponse.json({
      columns: [
        { key: "description",  label: "Product",   type: "text" },
        { key: "brand",        label: "Brand",     type: "text" },
        { key: "size",         label: "Size",      type: "text" },
        { key: "colour_exact", label: "Colour",    type: "text" },
        { key: "revenue",      label: "Revenue",   type: "currency" },
        { key: "units",        label: "Units",     type: "units" },
      ],
      rows,
      summary: [{ label: "SKUs", value: String(rows.length) }, { label: "revenue", value: `EGP ${Math.round(rows.reduce((s,r)=>s+parseFloat(r.revenue),0)).toLocaleString()}` }],
      fx,
    });
  }

  // ── Brand breakdown ──────────────────────────────────────────────────
  if (type === "brand") {
    const rows = await query<{ brand: string; revenue: string; units: string; skus: string }>(`
      SELECT COALESCE(ic.brand, 'Unknown') AS brand,
             SUM(a.revenue)::numeric AS revenue,
             SUM(a.units)::numeric AS units,
             COUNT(DISTINCT a.item_no)::int AS skus
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
      GROUP BY ic.brand ORDER BY revenue DESC
    `);
    return NextResponse.json({
      columns: [
        { key: "brand",   label: "Brand",   type: "text" },
        { key: "revenue", label: "Revenue", type: "currency" },
        { key: "units",   label: "Units",   type: "units" },
        { key: "skus",    label: "SKUs",    type: "number" },
      ],
      rows, summary: [], fx,
    });
  }

  // ── Item transaction history ─────────────────────────────────────────
  if (type === "item") {
    const rows = await query<{ date: string; store_code: string; revenue: string; units: string; source: string }>(`
      SELECT sale_date::text AS date, store_code,
             SUM(revenue)::numeric AS revenue,
             SUM(units)::numeric AS units,
             source
      FROM all_sales
      WHERE sale_date BETWEEN '${from}' AND '${to}'
        AND item_no = '${itemNo.replace(/'/g,"''")}'
      GROUP BY sale_date, store_code, source
      ORDER BY sale_date DESC
    `);
    return NextResponse.json({
      columns: [
        { key: "date",       label: "Date",     type: "date" },
        { key: "store_code", label: "Store",    type: "text" },
        { key: "revenue",    label: "Revenue",  type: "currency" },
        { key: "units",      label: "Units",    type: "units" },
        { key: "source",     label: "Source",   type: "text" },
      ],
      rows,
      summary: [{ label: "transactions", value: String(rows.length) }],
      fx,
    });
  }

  // ── Top items in period ──────────────────────────────────────────────
  if (type === "items") {
    const storeF = store ? `AND store_code = '${store.replace(/'/g,"''")}'` : channel ? channelFilter(channel) : "";
    const catF   = category ? `AND ic.category = '${category.replace(/'/g,"''")}'` : "";
    const rows = await query<{ item_no: string; description: string; brand: string; category: string; size: string; revenue: string; units: string }>(`
      SELECT a.item_no,
             COALESCE(ic.description, a.item_no) AS description,
             COALESCE(ic.brand, 'Unknown') AS brand,
             COALESCE(ic.category, 'Unknown') AS category,
             COALESCE(ic.size, '') AS size,
             SUM(a.revenue)::numeric AS revenue,
             SUM(a.units)::numeric AS units
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      WHERE a.sale_date BETWEEN '${from}' AND '${to}'
        ${storeF} ${catF}
      GROUP BY a.item_no, ic.description, ic.brand, ic.category, ic.size
      ORDER BY revenue DESC LIMIT 200
    `);
    return NextResponse.json({
      columns: [
        { key: "description", label: "Product",  type: "text" },
        { key: "brand",       label: "Brand",    type: "text" },
        { key: "category",    label: "Category", type: "text" },
        { key: "size",        label: "Size",     type: "text" },
        { key: "revenue",     label: "Revenue",  type: "currency" },
        { key: "units",       label: "Units",    type: "units" },
      ],
      rows,
      summary: [{ label: "SKUs", value: String(rows.length) }],
      fx,
    });
  }

  return NextResponse.json({ columns: [], rows: [], fx });
}
