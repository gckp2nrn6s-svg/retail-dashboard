// v2026-06-15
import { NextResponse } from "next/server";
import { query, STORE_NAMES } from "@/lib/db";
import { navQuery } from "@/lib/navdb";
import { fetchNavVelocity } from "@/lib/navVelocity";

function sn(code: string) { return STORE_NAMES[code] ?? code; }

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
  try {
    return await buildInsights();
  } catch (e) {
    // Insights are non-critical — never 500 the page over them. NAV/PG offline
    // just means no cards this cycle.
    console.error("[insights] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { insights: [], fx: 50, generatedAt: new Date().toISOString(), degraded: true },
      { status: 200 }
    );
  }
}

async function buildInsights() {
  const insights: Insight[] = [];

  // Pre-fetch NAV velocities (30d and 90d) in parallel with other queries
  const [vel30, vel90, fxRow, warehouseItems, hotMomentum, storeWeekly, onlineTransfer, onlineImport, topOpportunity] = await Promise.all([
    fetchNavVelocity(30),
    fetchNavVelocity(90),

    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    // All warehouse items (no all_sales join — we'll merge NAV velocity in JS)
    query<{ item_no: string; description: string; brand: string; category: string; size: string; in_stock: string; unit_price: string }>(`
      SELECT ws.item_no,
             COALESCE(ic.description, ws.description) AS description,
             ic.brand, ic.category, ic.size,
             ws.in_stock::numeric,
             ws.unit_price::numeric
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      WHERE ws.in_stock >= 0
    `),

    // Trending: last 7d vs prior 7d — from NAV
    navQuery<{ item_no: string; description: string; brand: string; last7: number; prev7: number; pct_change: number }>(`
      SELECT TOP 5
        [Item No_]      AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code]) AS brand,
        -SUM(CASE WHEN CAST([Date] AS DATE) >= CAST(DATEADD(day,-7,GETDATE()) AS DATE)  THEN [Quantity] ELSE 0 END) AS last7,
        -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END) AS prev7,
        CASE WHEN SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END) <> 0
          THEN ROUND((-SUM(CASE WHEN CAST([Date] AS DATE) >= CAST(DATEADD(day,-7,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END) + SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END)) * 100.0 / ABS(SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END)), 0)
          ELSE 0 END AS pct_change
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-14,GETDATE()) AS DATE)
        AND [Store No_] != 'ONLINE'
      GROUP BY [Item No_]
      HAVING -SUM(CASE WHEN CAST([Date] AS DATE) >= CAST(DATEADD(day,-7,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END) >= 3
        AND -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Quantity] ELSE 0 END) > 0
      ORDER BY pct_change DESC
    `),

    // Store week-over-week (retail only) — from NAV
    navQuery<{ store_code: string; this_week: number; last_week: number; pct_change: number }>(`
      SELECT
        [Store No_] AS store_code,
        -SUM(CASE WHEN CAST([Date] AS DATE) >= CAST(DATEADD(day,-7,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END) AS this_week,
        -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END) AS last_week,
        CASE WHEN SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END) <> 0
          THEN ROUND((-SUM(CASE WHEN CAST([Date] AS DATE) >= CAST(DATEADD(day,-7,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END) + SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END)) * 100.0 / ABS(SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END)), 0)
          ELSE 0 END AS pct_change
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-14,GETDATE()) AS DATE)
        AND [Store No_] IN ('ALMAZA','CCA','CF-HOS','CSTARS','P90','MOA','MOE','HIS','MC')
      GROUP BY [Store No_]
      HAVING -SUM(CASE WHEN CAST([Date] AS DATE) BETWEEN CAST(DATEADD(day,-14,GETDATE()) AS DATE) AND CAST(DATEADD(day,-8,GETDATE()) AS DATE) THEN [Net Amount]+[VAT Amount] ELSE 0 END) > 0
      ORDER BY pct_change DESC
    `),

    // Online items that ARE selling + warehouse HAS stock → transfer alert
    query<{ item_no: string; description: string; brand: string; in_stock: string; sold_30d: string; rev_30d: string; store: string }>(`
      SELECT ws.item_no, COALESCE(ic.description, ws.description) AS description,
             ws.brand, ws.in_stock::int,
             SUM(ss.quantity)::int AS sold_30d,
             SUM(ss.line_total)::int AS rev_30d,
             ss.store_code AS store
      FROM shopify_sales ss
      JOIN shopify_item_map sim ON sim.sku = ss.sku
      JOIN warehouse_stock ws ON ws.item_no = sim.item_no
      LEFT JOIN item_categorisation ic ON ic.item_no = sim.item_no
      WHERE ss.sale_date >= CURRENT_DATE - 30
        AND ss.fulfillment_status = 'fulfilled'
        AND ss.financial_status <> 'refunded'
        AND ss.quantity > 0
        AND ws.in_stock BETWEEN 1 AND 15
      GROUP BY ws.item_no, ic.description, ws.description, ws.brand, ws.in_stock, ss.store_code
      ORDER BY sold_30d DESC, ws.in_stock ASC
      LIMIT 10
    `),

    // Online items that ARE selling + warehouse ALSO has 0 → import needed
    query<{ item_no: string; description: string; brand: string; sold_30d: string; rev_30d: string; store: string }>(`
      SELECT ws.item_no, COALESCE(ic.description, ws.description) AS description,
             ws.brand,
             SUM(ss.quantity)::int AS sold_30d,
             SUM(ss.line_total)::int AS rev_30d,
             ss.store_code AS store
      FROM shopify_sales ss
      JOIN shopify_item_map sim ON sim.sku = ss.sku
      JOIN warehouse_stock ws ON ws.item_no = sim.item_no
      LEFT JOIN item_categorisation ic ON ic.item_no = sim.item_no
      WHERE ss.sale_date >= CURRENT_DATE - 30
        AND ss.fulfillment_status = 'fulfilled'
        AND ss.financial_status <> 'refunded'
        AND ss.quantity > 0
        AND ws.in_stock <= 0
      GROUP BY ws.item_no, ic.description, ws.description, ws.brand, ss.store_code
      ORDER BY sold_30d DESC
      LIMIT 10
    `),

    // Top revenue items last 30d from NAV, then join stock from Postgres in JS
    navQuery<{ item_no: string; description: string; brand: string; revenue_30d: number; units_30d: number }>(`
      SELECT TOP 10
        [Item No_]                      AS item_no,
        [Item No_] AS description,
        MAX([Item Category Code])       AS brand,
        -SUM([Net Amount]+[VAT Amount]) AS revenue_30d,
        -SUM([Quantity])                AS units_30d
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-30,GETDATE()) AS DATE)
        AND [Store No_] != 'ONLINE'
      GROUP BY [Item No_]
      ORDER BY revenue_30d DESC
    `),
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");

  // Compute stockouts from NAV velocity + warehouse stock in JS
  type StockoutItem = { item_no: string; description: string; brand: string; category: string; size: string; in_stock: number; units_30d: number; days_remaining: number; stock_value: number };
  const criticalStockout: StockoutItem[] = [];
  const soonStockout: StockoutItem[] = [];
  const deadStock: { item_no: string; description: string; brand: string; category: string; in_stock: number; dead_value: number }[] = [];

  for (const ws of warehouseItems) {
    const stock = parseFloat(ws.in_stock);
    const price = parseFloat(ws.unit_price);
    const v30 = vel30.get(ws.item_no);
    const v90 = vel90.get(ws.item_no);
    const units30 = v30?.units ?? 0;
    const units90 = v90?.units ?? 0;
    const dailyRate = units30 / 30;

    if (stock > 0 && units30 >= 1) {
      const daysRemaining = Math.round(stock / dailyRate);
      const entry: StockoutItem = {
        item_no: ws.item_no,
        description: ws.description,
        brand: ws.brand || "",
        category: ws.category || "",
        size: ws.size || "",
        in_stock: stock,
        units_30d: units30,
        days_remaining: daysRemaining,
        stock_value: Math.round(stock * price),
      };
      if (daysRemaining < 5)               criticalStockout.push(entry);
      else if (daysRemaining <= 14)         soonStockout.push(entry);
    }

    if (stock >= 20 && units90 === 0 && price > 0) {
      deadStock.push({ item_no: ws.item_no, description: ws.description, brand: ws.brand || "", category: ws.category || "", in_stock: stock, dead_value: Math.round(stock * price) });
    }
  }

  criticalStockout.sort((a, b) => a.days_remaining - b.days_remaining);
  soonStockout.sort((a, b) => a.days_remaining - b.days_remaining);
  deadStock.sort((a, b) => b.dead_value - a.dead_value);
  const criticalTop8 = criticalStockout.slice(0, 8);
  const soonTop20 = soonStockout.slice(0, 20);
  const deadTop6 = deadStock.slice(0, 6);

  // ── CRITICAL STOCKOUTS ──────────────────────────────────────────────────
  criticalTop8.forEach((item, i) => {
    const days = item.days_remaining;
    const stock = item.in_stock;
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
  if (criticalTop8.length > 1) {
    const totalAtRisk = criticalTop8.reduce((s, r) => s + r.stock_value, 0);
    insights.push({
      id: "critical-group",
      type: "critical",
      icon: "🚨",
      title: `${criticalTop8.length} items stock out in < 5 days`,
      body: `Immediate reorder needed. Combined remaining stock value: EGP ${Math.round(totalAtRisk).toLocaleString()}.`,
      action: "View all critical items",
      metric: `${criticalTop8.length} items`,
      metricSub: "< 5 days",
      link: "/dashboard/stock?tab=low",
    });
  }

  // ── SOON STOCKOUTS ──────────────────────────────────────────────────────
  if (soonTop20.length > 0) {
    const avgDays = Math.round(soonTop20.reduce((s, r) => s + r.days_remaining, 0) / soonTop20.length);
    insights.push({
      id: "warning-stockout",
      type: "warning",
      icon: "⚠️",
      title: `${soonTop20.length} items need reordering this week`,
      body: `These items will sell out in 5–14 days. Order now to avoid stockouts. Fastest depleting: ${soonTop20[0]?.description || soonTop20[0]?.item_no}.`,
      action: "Plan reorders",
      metric: `${soonTop20.length} SKUs`,
      metricSub: `avg ${avgDays}d left`,
      link: "/dashboard/stock?tab=low",
    });
  }

  // ── ONLINE: IMPORT NEEDED (selling online, zero in warehouse too) ────────
  if (onlineImport.length > 0) {
    const totalRev = onlineImport.reduce((s, r) => s + parseFloat(r.rev_30d || "0"), 0);
    const topItem = onlineImport[0];
    const storeLabel = topItem.store === "SHOPIFY-SAM" ? "SAM Online" : "AT Online";
    insights.push({
      id: "online-import",
      type: "critical",
      icon: "🛳️",
      title: `${onlineImport.length} online SKUs sold out everywhere — import needed`,
      body: `These items are selling on ${storeLabel} (EGP ${Math.round(totalRev).toLocaleString()} in 30d) but show ZERO stock in the main warehouse. Cannot transfer — needs import order. Top: ${topItem.description || topItem.item_no}.`,
      action: "Raise import order",
      metric: `${onlineImport.length} SKUs`,
      metricSub: `EGP ${Math.round(totalRev / 1000)}K/mo`,
      link: "/dashboard/stock?tab=low",
    });
  }

  // ── ONLINE: TRANSFER FROM WAREHOUSE (low stock on Shopify, warehouse has it) ──
  if (onlineTransfer.length > 0) {
    const totalStock = onlineTransfer.reduce((s, r) => s + parseFloat(r.in_stock || "0"), 0);
    const totalRev = onlineTransfer.reduce((s, r) => s + parseFloat(r.rev_30d || "0"), 0);
    const topItem = onlineTransfer[0];
    insights.push({
      id: "online-transfer",
      type: "warning",
      icon: "🔄",
      title: `${onlineTransfer.length} online SKUs need warehouse transfer`,
      body: `Main warehouse has stock for these items (≤15 units each) but online is running low. Transfer now to prevent losing EGP ${Math.round(totalRev).toLocaleString()} in monthly online sales. Start with: ${topItem.description || topItem.item_no} (${topItem.in_stock} units left).`,
      action: "Transfer to online store",
      metric: `${onlineTransfer.length} SKUs`,
      metricSub: `${totalStock} units available`,
      link: "/dashboard/stock?tab=low",
    });
  }

  // ── DEAD STOCK ──────────────────────────────────────────────────────────
  if (deadTop6.length > 0) {
    const totalDeadValue = deadTop6.reduce((s, r) => s + r.dead_value, 0);
    insights.push({
      id: "dead-stock",
      type: "warning",
      icon: "📦",
      title: `EGP ${Math.round(totalDeadValue / 1000)}K tied up in dead stock`,
      body: `${deadTop6.length} items (${deadTop6[0]?.description || deadTop6[0]?.item_no}${deadTop6.length > 1 ? ` + ${deadTop6.length - 1} more` : ""}) have had zero sales in 90 days. Consider promotion or markdown.`,
      action: "Review slow movers",
      metric: `EGP ${Math.round(totalDeadValue / 1000)}K`,
      metricSub: `${deadTop6.length} items`,
      link: "/dashboard/stock?tab=slow",
    });
  }

  // ── STORE PERFORMANCE ───────────────────────────────────────────────────
  const bestStore = storeWeekly[0];
  const worstStore = storeWeekly[storeWeekly.length - 1];

  if (bestStore && Number(bestStore.pct_change) > 15) {
    const pct = Number(bestStore.pct_change);
    const rev = Number(bestStore.this_week);
    const name = sn(bestStore.store_code);
    insights.push({
      id: `win-store-${bestStore.store_code}`,
      type: "win",
      icon: "🏆",
      title: `${name} is on fire this week`,
      body: `${name} revenue is up ${Math.round(pct)}% vs last week — EGP ${Math.round(rev).toLocaleString()} this week.`,
      action: "See store products",
      metric: `+${Math.round(pct)}%`,
      metricSub: "vs last week",
      link: `/dashboard/sales?store=${encodeURIComponent(bestStore.store_code)}`,
    });
  }

  if (worstStore && Number(worstStore.pct_change) < -20 && worstStore.store_code !== bestStore?.store_code) {
    const pct = Math.abs(Number(worstStore.pct_change));
    const rev = Number(worstStore.last_week);
    const missing = rev - Number(worstStore.this_week);
    const name = sn(worstStore.store_code);
    insights.push({
      id: `warn-store-${worstStore.store_code}`,
      type: "warning",
      icon: "📉",
      title: `${name} down ${Math.round(pct)}% this week`,
      body: `${name} is significantly underperforming vs last week. Missing EGP ${Math.round(missing).toLocaleString()} in expected revenue. Investigate.`,
      action: "Check store sales",
      metric: `-${Math.round(pct)}%`,
      metricSub: "vs last week",
      link: `/dashboard/sales?store=${encodeURIComponent(worstStore.store_code)}`,
    });
  }

  // ── TRENDING ITEMS ───────────────────────────────────────────────────────
  hotMomentum.forEach((item) => {
    const pct = Number(item.pct_change);
    insights.push({
      id: `trend-${item.item_no}`,
      type: "opportunity",
      icon: "🔥",
      title: `${item.description || item.item_no} trending up ${Math.round(pct)}%`,
      body: `${Number(item.last7).toFixed(0)} units sold this week vs ${Number(item.prev7).toFixed(0)} last week. Demand is accelerating — ensure stock is ready.`,
      action: "Check stock levels",
      metric: `+${Math.round(pct)}%`,
      metricSub: "this week",
      link: "/dashboard/stock?tab=fast",
    });
  });

  // ── TOP REVENUE OPPORTUNITIES ────────────────────────────────────────────
  const topRevItems = topOpportunity.filter((r) => Number(r.revenue_30d) > 0);
  if (topRevItems.length > 0) {
    const totalRev = topRevItems.reduce((s, r) => s + Number(r.revenue_30d), 0);
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
    (a, b) => Number(b.this_week) - Number(a.this_week)
  );
  if (allStoresSorted.length > 0) {
    const top = allStoresSorted[0];
    const totalRetailRev = allStoresSorted.reduce((s, r) => s + Number(r.this_week), 0);
    const topShare = totalRetailRev > 0
      ? Math.round((Number(top.this_week) / totalRetailRev) * 100)
      : 0;
    const name = sn(top.store_code);
    insights.push({
      id: "win-top-store",
      type: "win",
      icon: "⭐",
      title: `${name} leads retail — ${topShare}% of this week's revenue`,
      body: `${name} generated EGP ${Math.round(Number(top.this_week)).toLocaleString()} this week, leading all retail stores.`,
      action: "View top products",
      metric: `${topShare}% share`,
      metricSub: "of retail revenue",
      link: `/dashboard/sales?store=${encodeURIComponent(top.store_code)}`,
    });
  }

  // Sort: critical first, then warning, then opportunity, then win
  const ORDER = { critical: 0, warning: 1, opportunity: 2, win: 3 };
  insights.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  // Deduplicate (remove individual critical if group card exists)
  const hasCriticalGroup = insights.findIndex((x) => x.id === "critical-group") >= 0;
  const filtered = hasCriticalGroup ? insights.filter((x) => !x.id.startsWith("critical-") || x.id === "critical-group") : insights;

  return NextResponse.json({ insights: filtered, fx, generatedAt: new Date().toISOString() });
}
