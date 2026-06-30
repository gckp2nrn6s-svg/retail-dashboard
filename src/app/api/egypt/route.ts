import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { navQuery } from "@/lib/navdb";
import { getCombinedVelocity } from "@/lib/navVelocity";

function safeDate(val: string | null, fallback: string): string {
  if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return fallback;
}

const LINE_CODES: Record<string, string> = {
  SKYTRAC: "HZ9",
  "SKY PARK": "HC0",
  BRICKLANE: "GE3",
  PRESTON: "AG9",
  "TWIST WAVES": "QC6",
};

const STORE_NAMES: Record<string, string> = {
  "CF-HOS": "Cairo Festival City",
  CSTARS: "City Stars",
  CCA: "Alexandria",
  ALMAZA: "Almaza",
  P90: "Point 90",
  "SHOPIFY-AMT": "AT Online",
  HO: "B2B / Wholesale",
  MOE: "Ministry of Education",
  NOON: "Noon",
  JUMIA: "Jumia",
};

const MIE_CASE = `
  CASE
    WHEN description ILIKE '%HZ9%' THEN 'SKYTRAC'
    WHEN description ILIKE '%HC0%' THEN 'SKY PARK'
    WHEN description ILIKE '%GE3%' THEN 'BRICKLANE'
    WHEN description ILIKE '%AG9%' AND description NOT ILIKE '%BLOCKED%' THEN 'PRESTON'
    WHEN description ILIKE '%QC6%' THEN 'TWIST WAVES'
  END
`;

// Same 5 made-in-Egypt lines, but matched on the factory sheet's sku/description
// (e.g. sku 'AG9-09-003' → PRESTON). Used to fold factory-direct sales into MIE.
const FD_LINE_CASE = `
  CASE
    WHEN f.sku ILIKE 'HZ9%' OR f.description ILIKE '%HZ9%' THEN 'SKYTRAC'
    WHEN f.sku ILIKE 'HC0%' OR f.description ILIKE '%HC0%' THEN 'SKY PARK'
    WHEN f.sku ILIKE 'GE3%' OR f.description ILIKE '%GE3%' THEN 'BRICKLANE'
    WHEN (f.sku ILIKE 'AG9%' OR f.description ILIKE '%AG9%') AND f.description NOT ILIKE '%BLOCKED%' THEN 'PRESTON'
    WHEN f.sku ILIKE 'QC6%' OR f.description ILIKE '%QC6%' THEN 'TWIST WAVES'
  END
`;
// Factory-direct sales reshaped to the (line, store_code, sale_date, units, revenue)
// shape so it can UNION with the all_sales-based MIE rows. store_code = 'FD:<client>'.
const FD_UNIFIED = `
  SELECT fd.line, fd.store_code, fd.sale_date, fd.units, fd.revenue FROM (
    SELECT ${FD_LINE_CASE} AS line, 'FD:'||UPPER(TRIM(f.client)) AS store_code,
           f.sale_date, f.qty AS units, f.total_sales AS revenue
    FROM factory_direct_sales f
  ) fd WHERE fd.line IS NOT NULL`;
// Shared source: all_sales MIE rows + factory-direct MIE rows, one shape.
const UNIFIED_CTE = `
  WITH mie AS (SELECT item_no, ${MIE_CASE} AS line FROM warehouse_stock WHERE description NOT ILIKE '%BLOCKED%'),
  unified AS (
    SELECT m.line, a.store_code, a.sale_date, a.units, a.revenue
    FROM all_sales a JOIN mie m ON a.item_no = m.item_no WHERE m.line IS NOT NULL
    UNION ALL
    ${FD_UNIFIED}
  )`;

// Live per-period MIE sales (POS + B2B invoices + Shopify rollup + factory) so the
// CURRENT period stays correct even when the all_sales snapshot pipeline lags. All-time
// + monthly remain on all_sales (historical, lag-tolerant). POS+Shopify ≈ 96% of EG;
// B2B (~4%) is lumped under 'HO' and factory is per-line (no item_no).
type Bucket = Map<string, { units: number; revenue: number }>;
interface LiveAgg { byLine: Bucket; byLineStore: Bucket; byItem: Bucket }

async function livePeriodMie(from: string, to: string, lineOf: Map<string, string>): Promise<LiveAgg> {
  const byLine: Bucket = new Map(), byLineStore: Bucket = new Map(), byItem: Bucket = new Map();
  const bump = (m: Bucket, k: string, u: number, r: number) => { const e = m.get(k) || { units: 0, revenue: 0 }; e.units += u; e.revenue += r; m.set(k, e); };
  const addItem = (item: string, store: string, u: number, r: number) => {
    const line = lineOf.get(item); if (!line) return;
    bump(byItem, item, u, r); bump(byLine, line, u, r); bump(byLineStore, `${line}|${store}`, u, r);
  };
  const [pos, b2b, shop, fac] = await Promise.all([
    navQuery<{ item: string; store: string; rev: number; units: number }>(
      `SELECT [Item No_] AS item, [Store No_] AS store, -SUM([Net Amount]+[VAT Amount]) AS rev, -SUM([Quantity]) AS units
         FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] <> 'ONLINE'
         GROUP BY [Item No_], [Store No_]`, { from, to }).catch(() => []),
    navQuery<{ item: string; rev: number; units: number }>(
      `SELECT [No_] AS item, SUM([Amount Including VAT]) AS rev, SUM([Quantity]) AS units
         FROM SalesInvoiceLine WHERE [Type]=2 AND CAST([Posting Date] AS DATE) BETWEEN @from AND @to GROUP BY [No_]`,
      { from, to }).catch(() => []),
    query<{ item_no: string; units: string; revenue: string }>(
      `SELECT m.item_no, SUM(s.units)::numeric AS units, SUM(s.revenue)::numeric AS revenue
         FROM shopify_item_daily s JOIN shopify_item_map m ON m.sku = s.sku
        WHERE s.sale_date BETWEEN $1 AND $2 GROUP BY m.item_no`, [from, to]).catch(() => []),
    query<{ line: string; store: string; units: string; revenue: string }>(
      `SELECT line, store, SUM(units)::numeric AS units, SUM(revenue)::numeric AS revenue FROM (
         SELECT ${FD_LINE_CASE} AS line, 'FD:'||UPPER(TRIM(f.client)) AS store, f.qty AS units, f.total_sales AS revenue
         FROM factory_direct_sales f WHERE f.sale_date BETWEEN $1 AND $2) t
       WHERE line IS NOT NULL GROUP BY line, store`, [from, to]).catch(() => []),
  ]);
  for (const r of pos)  addItem(String(r.item).trim(), String(r.store || "").trim() || "HO", Number(r.units) || 0, Math.round(Number(r.rev) || 0));
  for (const r of b2b)  addItem(String(r.item).trim(), "HO", Number(r.units) || 0, Math.round(Number(r.rev) || 0));
  for (const r of shop) addItem(String(r.item_no).trim(), "SHOPIFY-AMT", Number(r.units) || 0, Math.round(Number(r.revenue) || 0));
  for (const r of fac) { const line = String(r.line).trim(), store = String(r.store).trim(); bump(byLine, line, Number(r.units) || 0, Math.round(Number(r.revenue) || 0)); bump(byLineStore, `${line}|${store}`, Number(r.units) || 0, Math.round(Number(r.revenue) || 0)); }
  return { byLine, byLineStore, byItem };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().slice(0, 10);
  const from = safeDate(searchParams.get("from"), defaultFrom);
  const to   = safeDate(searchParams.get("to"),   defaultTo);

  // Previous equal-length period — for per-line growth (momentum).
  const fromD = new Date(from), toD = new Date(to);
  const prevTo = new Date(fromD.getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(fromD.getTime() - 86400000 - (toD.getTime() - fromD.getTime())).toISOString().slice(0, 10);

  const [summary, monthly, byStore, skus, fxRows] = await Promise.all([
    query<{ line: string; revenue_all: string; revenue_period: string; revenue_prev: string; units_all: string; units_period: string; units_prev: string; }>(`
      ${UNIFIED_CTE}
      SELECT line,
        ROUND(SUM(revenue))::text AS revenue_all,
        ROUND(SUM(CASE WHEN sale_date BETWEEN '${from}' AND '${to}' THEN revenue ELSE 0 END))::text AS revenue_period,
        ROUND(SUM(CASE WHEN sale_date BETWEEN '${prevFrom}' AND '${prevTo}' THEN revenue ELSE 0 END))::text AS revenue_prev,
        SUM(units)::text AS units_all,
        SUM(CASE WHEN sale_date BETWEEN '${from}' AND '${to}' THEN units ELSE 0 END)::text AS units_period,
        SUM(CASE WHEN sale_date BETWEEN '${prevFrom}' AND '${prevTo}' THEN units ELSE 0 END)::text AS units_prev
      FROM unified GROUP BY line ORDER BY revenue_period DESC
    `),

    query<{ line: string; month: string; units: string; revenue: string; }>(`
      ${UNIFIED_CTE}
      SELECT line, TO_CHAR(DATE_TRUNC('month', sale_date), 'YYYY-MM') AS month,
        SUM(units)::text AS units, ROUND(SUM(revenue))::text AS revenue
      FROM unified
      WHERE sale_date >= '2024-01-01'
      GROUP BY line, DATE_TRUNC('month', sale_date)
      ORDER BY line, month
    `),

    query<{ line: string; store_code: string; units_period: string; revenue_period: string; units_all: string; revenue_all: string; }>(`
      ${UNIFIED_CTE}
      SELECT line, store_code,
        SUM(CASE WHEN sale_date BETWEEN '${from}' AND '${to}' THEN units ELSE 0 END)::text AS units_period,
        ROUND(SUM(CASE WHEN sale_date BETWEEN '${from}' AND '${to}' THEN revenue ELSE 0 END))::text AS revenue_period,
        SUM(units)::text AS units_all,
        ROUND(SUM(revenue))::text AS revenue_all
      FROM unified GROUP BY line, store_code ORDER BY line, revenue_period DESC
    `),

    query<{
      item_no: string; description: string; line: string;
      in_stock: string; unit_price: string;
      units_period: string; revenue_period: string; units_all: string; revenue_all: string;
    }>(`
      WITH mie AS (
        SELECT ws.item_no, ws.description, ws.in_stock, ws.unit_price,
          ${MIE_CASE} AS line
        FROM warehouse_stock ws WHERE ws.description NOT ILIKE '%BLOCKED%'
      )
      SELECT m.item_no, m.description, m.line,
        m.in_stock::text, m.unit_price::text,
        COALESCE(SUM(CASE WHEN a.sale_date BETWEEN '${from}' AND '${to}' THEN a.units ELSE 0 END), 0)::text AS units_period,
        ROUND(COALESCE(SUM(CASE WHEN a.sale_date BETWEEN '${from}' AND '${to}' THEN a.revenue ELSE 0 END), 0))::text AS revenue_period,
        COALESCE(SUM(a.units), 0)::text AS units_all,
        ROUND(COALESCE(SUM(a.revenue), 0))::text AS revenue_all
      FROM mie m
      LEFT JOIN all_sales a ON m.item_no = a.item_no
      WHERE m.line IS NOT NULL
      GROUP BY m.item_no, m.description, m.line, m.in_stock, m.unit_price
      ORDER BY m.line, revenue_period DESC
    `),

    // Time-aware FX: the rate in effect at the END of the viewed period.
    query<{ egp_per_usd: string }>("SELECT egp_per_usd FROM fx_rates WHERE week_start <= $1 ORDER BY week_start DESC LIMIT 1", [to]),
  ]);
  const fx = parseFloat(fxRows[0]?.egp_per_usd || "50");

  // Live period/prev override (resilient to all_sales snapshot lag) + snapshot freshness.
  const mieRows = await query<{ item_no: string; line: string }>(`SELECT item_no, ${MIE_CASE} AS line FROM warehouse_stock WHERE description NOT ILIKE '%BLOCKED%'`);
  const lineOf = new Map<string, string>();
  for (const r of mieRows) if (r.line) lineOf.set(String(r.item_no).trim(), r.line);
  const [livePeriod, livePrev, freshRow] = await Promise.all([
    livePeriodMie(from, to, lineOf),
    livePeriodMie(prevFrom, prevTo, lineOf),
    query<{ d: string }>("SELECT MAX(sale_date)::text AS d FROM all_sales"),
  ]);
  const dataThrough = freshRow[0]?.d ?? null;

  // Days cover uses the last 30 days of COMBINED sell-through (NAV POS + Shopify own-
  // website + factory-direct), so an Egyptian-made line selling online or via factory
  // isn't mis-flagged for reorder — same velocity the Stock module's alerts use.
  const vel30 = await getCombinedVelocity(30);
  const sales30Map: Record<string, number> = {};
  for (const [item, v] of vel30) sales30Map[item] = v.units;

  const skusParsed = skus.map((s) => {
    const stock = parseInt(s.in_stock);
    const sold30 = sales30Map[s.item_no] || 0;
    const daysCover = sold30 > 0 ? Math.round(stock / (sold30 / 30)) : null;
    return {
      ...s,
      in_stock: stock,
      unit_price: parseInt(s.unit_price),
      units_period: livePeriod.byItem.get(s.item_no)?.units ?? 0,        // period: LIVE
      units_all: parseFloat(s.units_all),                               // all-time: snapshot
      revenue_period: livePeriod.byItem.get(s.item_no)?.revenue ?? 0,
      revenue_all: parseFloat(s.revenue_all),
      units_30d: sold30,
      daysCover,
      reorderNow: daysCover !== null && daysCover < 30,
      stockout: stock === 0 && sold30 > 0,
    };
  });

  const byStoreParsed = byStore.map((s) => {
    const isFd = s.store_code?.startsWith("FD:");
    const fdName = isFd ? s.store_code.slice(3).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "";
    return {
      ...s,
      storeName: isFd ? fdName : (STORE_NAMES[s.store_code] || s.store_code),
      factory: isFd,
      units_period: livePeriod.byLineStore.get(`${s.line}|${s.store_code}`)?.units ?? 0,        // period: LIVE
      revenue_period: livePeriod.byLineStore.get(`${s.line}|${s.store_code}`)?.revenue ?? 0,
      units_all: parseFloat(s.units_all),                                                       // all-time: snapshot
      revenue_all: parseFloat(s.revenue_all),
    };
  });

  const summaryParsed = summary.map((s) => ({
    ...s,
    code: LINE_CODES[s.line] || "",
    revenue_all: parseFloat(s.revenue_all),                          // all-time: snapshot
    revenue_period: livePeriod.byLine.get(s.line)?.revenue ?? 0,     // period: LIVE
    revenue_prev: livePrev.byLine.get(s.line)?.revenue ?? 0,         // prev:   LIVE
    units_all: parseFloat(s.units_all),
    units_period: livePeriod.byLine.get(s.line)?.units ?? 0,
    units_prev: livePrev.byLine.get(s.line)?.units ?? 0,
  }));

  return NextResponse.json({ summary: summaryParsed, monthly, byStore: byStoreParsed, skus: skusParsed, fx, dataThrough, from, to });
}
