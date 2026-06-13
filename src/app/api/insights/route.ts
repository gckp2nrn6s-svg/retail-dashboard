import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export interface Insight {
  id: string;
  type: "critical" | "warning" | "opportunity" | "win";
  icon: string;
  title: string;
  body: string;
  action: string;
  metric: string;
  metricSub?: string;
  link: string;
}

export async function GET() {
  const insights: Insight[] = [];

  const [
    fxRow,
    criticalStockout,
    soonStockout,
    deadStock,
    hotMomentum,
    storeWeekly,
    topOpportunity,
  ] = await Promise.all([
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    // Items stocking out in < 5 days with active sales
    query<{ item_no: string; description: string; brand: string; category: string; size: string; in_stock: string; units_30d: string; days_remaining: string; stock_value: string }>(`
      SELECT ws.item_no,
             COALESCE(ic.description, ws.description) AS description,
             ic.brand, ic.category, ic.size,
             ws.in_stock::numeric,
             r.units_30d,
             ROUND(ws.in_stock / (r.units_30d / 30.0))::int AS days_remaining,
             ROUND(ws.in_stock * ws.unit_price)::numeric AS stock_value
      FROM warehouse_stock ws
      JOIN (
        SELECT item_no, SUM(units) AS units_30d
        FROM all_sales WHERE sale_date >= CURRENT_DATE - 30
        GROUP BY item_no HAVING SUM(units) >= 1
      ) r ON ws.item_no = r.item_no
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 0
        AND ws.in_stock / (r.units_30d / 30.0) < 5
      ORDER BY days_remaining ASC, ws.in_stock DESC
      LIMIT 8
    `),

    // Items stocking out in 5-14 days
    query<{ item_no: string; description: string; brand: string; in_stock: string; days_remaining: string; units_30d: string }>(`
      SELECT ws.item_no,
             COALESCE(ic.description, ws.description) AS description,
             ic.brand,
             ws.in_stock::numeric,
             ROUND(ws.in_stock / (r.units_30d / 30.0))::int AS days_remaining,
             r.units_30d
      FROM warehouse_stock ws
      JOIN (
        SELECT item_no, SUM(units) AS units_30d
        FROM all_sales WHERE sale_date >= CURRENT_DATE - 30
        GROUP BY item_no HAVING SUM(units) >= 1
      ) r ON ws.item_no = r.item_no
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock > 0
        AND ws.in_stock / (r.units_30d / 30.0) BETWEEN 5 AND 14
      ORDER BY days_remaining ASC
      LIMIT 20
    `),

    // Dead stock: ≥ 20 units, zero sales in 90 days
    query<{ item_no: string; description: string; brand: string; category: string; in_stock: string; dead_value: string }>(`
      SELECT ws.item_no,
             COALESCE(ic.description, ws.description) AS description,
             ic.brand, ic.category,
             ws.in_stock::numeric,
             ROUND(ws.in_stock * ws.unit_price)::numeric AS dead_value
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      LEFT JOIN (
        SELECT item_no FROM all_sales
        WHERE sale_date >= CURRENT_DATE - 90
        GROUP BY item_no
      ) r ON ws.item_no = r.item_no
      WHERE ws.in_stock >= 20 AND r.item_no IS NULL AND ws.unit_price > 0
      ORDER BY dead_value DESC
      LIMIT 6
    `),

    // Trending: last 7d vs prior 7d, > 80% increase, minimum 3 units last 7d
    query<{ item_no: string; description: string; brand: string; last7: string; prev7: string; pct_change: string }>(`
      SELECT item_no,
             description,
             brand,
             last7, prev7,
             ROUND((last7 - prev7) * 100.0 / NULLIF(prev7, 0)) AS pct_change
      FROM (
        SELECT a.item_no,
               COALESCE(ic.description, a.item_no) AS description,
               ic.brand,
               SUM(CASE WHEN sale_date >= CURRENT_DATE - 7  THEN units ELSE 0 END)::numeric AS last7,
               SUM(CASE WHEN sale_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 THEN units ELSE 0 END)::numeric AS prev7
        FROM all_sales a
        LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
        WHERE a.sale_date >= CURRENT_DATE - 14
        GROUP BY a.item_no, ic.description, ic.brand
      ) t
      WHERE last7 >= 3 AND prev7 > 0 AND last7 / NULLIF(prev7, 0) > 1.8
      ORDER BY pct_change DESC
      LIMIT 5
    `),

    // Store week-over-week (retail only)
    query<{ store_code: string; this_week: string; last_week: string; pct_change: string }>(`
      SELECT store_code,
             this_week, last_week,
             ROUND((this_week - last_week) * 100.0 / NULLIF(last_week, 0)) AS pct_change
      FROM (
        SELECT store_code,
               SUM(CASE WHEN sale_date >= CURRENT_DATE - 7  THEN revenue ELSE 0 END)::numeric AS this_week,
               SUM(CASE WHEN sale_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8 THEN revenue ELSE 0 END)::numeric AS last_week
        FROM all_sales
        WHERE sale_date >= CURRENT_DATE - 14
          AND store_code = ANY(ARRAY['ALMAZA','CCA','CF-HOS','CSTARS','P90'])
        GROUP BY store_code
      ) t
      WHERE last_week > 0
      ORDER BY pct_change DESC
    `),

    // Top revenue items last 30d with their stock health
    query<{ item_no: string; description: string; brand: string; revenue_30d: string; units_30d: string; in_stock: string; days_remaining: string }>(`
      SELECT a.item_no,
             COALESCE(ic.description, a.item_no) AS description,
             ic.brand,
             SUM(a.revenue)::numeric AS revenue_30d,
             SUM(a.units)::numeric  AS units_30d,
             COALESCE(ws.in_stock, 0)::numeric AS in_stock,
             CASE WHEN SUM(a.units) > 0 AND ws.in_stock > 0
               THEN ROUND(ws.in_stock / (SUM(a.units) / 30.0))
               ELSE NULL END AS days_remaining
      FROM all_sales a
      LEFT JOIN item_categorisation ic ON a.item_no = ic.item_no
      LEFT JOIN warehouse_stock ws ON a.item_no = ws.item_no
      WHERE a.sale_date >= CURRENT_DATE - 30
      GROUP BY a.item_no, ic.description, ic.brand, ws.in_stock
      ORDER BY revenue_30d DESC
      LIMIT 10
    `),
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");

  // ── CRITICAL STOCKOUTS ──────────────────────────────────────────────────
  criticalStockout.forEach((item, i) => {
    const days = parseInt(item.days_remaining);
    const stock = parseInt(item.in_stock);
    insights.push({
      id: `critical-${item.item_no}`,
      type: "critical",
      icon: "🚨",
      title: days <= 1 ? "Stocking out TODAY" : `${days} days of stock left`,
      body: `${item.description || item.item_no}${item.brand ? ` (${item.brand})` : ""} — only ${stock} unit${stock !== 1 ? "s" : ""} remaining at current sales pace.`,
      action: "Order immediately",
      metric: `${stock} units`,
      metricSub: `${days}d left`,
      link: "/dashboard/stock?tab=low",
    });
    if (i === 0) return; // only first gets individual card, rest grouped
  });

  // If many critical, collapse into summary after first
  if (criticalStockout.length > 1) {
    const totalAtRisk = criticalStockout.reduce((s, r) => s + parseFloat(r.stock_value || "0"), 0);
    insights.push({
      id: "critical-group",
      type: "critical",
      icon: "🚨",
      title: `${criticalStockout.length} items stock out in < 5 days`,
      body: `Immediate reorder needed. Combined remaining stock value: EGP ${Math.round(totalAtRisk).toLocaleString()}.`,
      action: "View all critical items",
      metric: `${criticalStockout.length} items`,
      metricSub: "< 5 days",
      link: "/dashboard/stock?tab=low",
    });
  }

  // ── SOON STOCKOUTS ──────────────────────────────────────────────────────
  if (soonStockout.length > 0) {
    const avgDays = Math.round(
      soonStockout.reduce((s, r) => s + parseInt(r.days_remaining), 0) / soonStockout.length
    );
    insights.push({
      id: "warning-stockout",
      type: "warning",
      icon: "⚠️",
      title: `${soonStockout.length} items need reordering this week`,
      body: `These items will sell out in 5–14 days. Order now to avoid stockouts. Fastest depleting: ${soonStockout[0]?.description || soonStockout[0]?.item_no}.`,
      action: "Plan reorders",
      metric: `${soonStockout.length} SKUs`,
      metricSub: `avg ${avgDays}d left`,
      link: "/dashboard/stock?tab=low",
    });
  }

  // ── DEAD STOCK ──────────────────────────────────────────────────────────
  if (deadStock.length > 0) {
    const totalDeadValue = deadStock.reduce((s, r) => s + parseFloat(r.dead_value || "0"), 0);
    insights.push({
      id: "dead-stock",
      type: "warning",
      icon: "📦",
      title: `EGP ${Math.round(totalDeadValue / 1000)}K tied up in dead stock`,
      body: `${deadStock.length} items (${deadStock[0]?.description || deadStock[0]?.item_no}${deadStock.length > 1 ? ` + ${deadStock.length - 1} more` : ""}) have had zero sales in 90 days. Consider promotion or markdown.`,
      action: "Review slow movers",
      metric: `EGP ${Math.round(totalDeadValue / 1000)}K`,
      metricSub: `${deadStock.length} items`,
      link: "/dashboard/stock?tab=slow",
    });
  }

  // ── STORE PERFORMANCE ───────────────────────────────────────────────────
  const bestStore = storeWeekly[0];
  const worstStore = storeWeekly[storeWeekly.length - 1];

  if (bestStore && parseFloat(bestStore.pct_change) > 15) {
    const pct = parseFloat(bestStore.pct_change);
    const rev = parseFloat(bestStore.this_week);
    insights.push({
      id: `win-store-${bestStore.store_code}`,
      type: "win",
      icon: "🏆",
      title: `${bestStore.store_code} is on fire this week`,
      body: `${bestStore.store_code} revenue is up ${Math.round(pct)}% vs last week — EGP ${Math.round(rev).toLocaleString()} this week.`,
      action: "See full breakdown",
      metric: `+${Math.round(pct)}%`,
      metricSub: "vs last week",
      link: "/dashboard/sales",
    });
  }

  if (worstStore && parseFloat(worstStore.pct_change) < -20 && worstStore.store_code !== bestStore?.store_code) {
    const pct = Math.abs(parseFloat(worstStore.pct_change));
    const rev = parseFloat(worstStore.last_week);
    const missing = rev - parseFloat(worstStore.this_week);
    insights.push({
      id: `warn-store-${worstStore.store_code}`,
      type: "warning",
      icon: "📉",
      title: `${worstStore.store_code} down ${Math.round(pct)}% this week`,
      body: `${worstStore.store_code} is significantly underperforming vs last week. Missing EGP ${Math.round(missing).toLocaleString()} in expected revenue. Investigate.`,
      action: "Check store sales",
      metric: `-${Math.round(pct)}%`,
      metricSub: "vs last week",
      link: "/dashboard/sales",
    });
  }

  // ── TRENDING ITEMS ───────────────────────────────────────────────────────
  hotMomentum.forEach((item) => {
    const pct = parseFloat(item.pct_change);
    insights.push({
      id: `trend-${item.item_no}`,
      type: "opportunity",
      icon: "🔥",
      title: `${item.description || item.item_no} trending up ${Math.round(pct)}%`,
      body: `${parseFloat(item.last7).toFixed(0)} units sold this week vs ${parseFloat(item.prev7).toFixed(0)} last week. Demand is accelerating — ensure stock is ready.`,
      action: "Check stock levels",
      metric: `+${Math.round(pct)}%`,
      metricSub: "this week",
      link: "/dashboard/stock?tab=fast",
    });
  });

  // ── TOP REVENUE OPPORTUNITIES ────────────────────────────────────────────
  const topRevItems = topOpportunity.filter(
    (r) => parseFloat(r.days_remaining || "999") < 14 && parseFloat(r.in_stock) > 0
  );
  if (topRevItems.length > 0) {
    const totalRev = topRevItems.reduce((s, r) => s + parseFloat(r.revenue_30d), 0);
    insights.push({
      id: "opportunity-top-rev",
      type: "opportunity",
      icon: "💰",
      title: `Top ${topRevItems.length} revenue drivers running low on stock`,
      body: `Your best-selling items (EGP ${Math.round(totalRev).toLocaleString()} revenue in 30 days) are approaching stockout. Reorder to protect this revenue.`,
      action: "Prioritise reorder",
      metric: `EGP ${Math.round(totalRev / 1000)}K`,
      metricSub: "at risk",
      link: "/dashboard/stock?tab=fast",
    });
  }

  // ── STORE ALL-STARS (wins) ────────────────────────────────────────────────
  const allStoresSorted = [...storeWeekly].sort(
    (a, b) => parseFloat(b.this_week) - parseFloat(a.this_week)
  );
  if (allStoresSorted.length > 0) {
    const top = allStoresSorted[0];
    const totalRetailRev = allStoresSorted.reduce((s, r) => s + parseFloat(r.this_week), 0);
    const topShare = totalRetailRev > 0
      ? Math.round((parseFloat(top.this_week) / totalRetailRev) * 100)
      : 0;
    insights.push({
      id: "win-top-store",
      type: "win",
      icon: "⭐",
      title: `${top.store_code} leads retail — ${topShare}% of this week's revenue`,
      body: `${top.store_code} generated EGP ${Math.round(parseFloat(top.this_week)).toLocaleString()} this week, leading all 5 retail stores.`,
      action: "View store breakdown",
      metric: `${topShare}% share`,
      metricSub: "of retail revenue",
      link: "/dashboard/sales",
    });
  }

  // Sort: critical first, then warning, then opportunity, then win
  const ORDER = { critical: 0, warning: 1, opportunity: 2, win: 3 };
  insights.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  // Deduplicate (remove individual critical if group card exists)
  const seenCritical = insights.findIndex((x) => x.id === "critical-group") >= 0;
  const filtered = seenCritical ? insights.filter((x) => !x.id.startsWith("critical-") || x.id === "critical-group") : insights;

  return NextResponse.json({ insights: filtered, fx, generatedAt: new Date().toISOString() });
}
