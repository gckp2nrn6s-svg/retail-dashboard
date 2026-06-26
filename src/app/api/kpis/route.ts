import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue } from "@/lib/shopify";
import { todayCairo } from "@/lib/dates";
import { safeSource, isDegraded, type SourceStatus } from "@/lib/resilience";

export const dynamic = "force-dynamic"; // always reflect live sources, never cache

function safeDate(val: string | null, fallback: string): string {
  if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return fallback;
}

interface RevUnits { revenue: number; units: number }
interface Rev      { revenue: number }
interface DayRev   { day: string; revenue: number }
interface CountRow { n: number }
interface FxRow    { egp_per_usd: string }

type NavBundle = {
  current: RevUnits[]; previous: RevUnits[]; yest_row: Rev[];
  d7_row: Rev[]; d30_row: Rev[]; yoy_row: RevUnits[];
  storeCount: CountRow[]; sparkRows: DayRev[]; todayNavRow: Rev[];
  prevWeek: Rev[]; prevYear: Rev[];
};
type ShopRev = { egp: number; units: number };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const thisMonthStart = today.slice(0, 8) + "01";

  const from = safeDate(searchParams.get("from"), thisMonthStart);
  const to   = safeDate(searchParams.get("to"),   today);

  const fromDate = new Date(from);
  const toDate   = new Date(to);
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;

  const prevTo   = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(fromDate.getTime() - spanDays * 86400000).toISOString().slice(0, 10);

  const yest      = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const d7from    = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const d30from   = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const yoy_from  = new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), fromDate.getDate()).toISOString().slice(0, 10);
  const yoy_to    = new Date(toDate.getFullYear()   - 1, toDate.getMonth(),   toDate.getDate()).toISOString().slice(0, 10);
  const sparkStart = d30from;

  // Single-day views (Today / Yesterday) show THREE comparisons: vs the day before,
  // vs the same weekday last week, and vs the same date last year.
  const isSingleDay   = from === to;
  const prevWeekDate  = new Date(fromDate.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const prevYearDate  = `${fromDate.getUTCFullYear() - 1}-${String(fromDate.getUTCMonth() + 1).padStart(2, "0")}-${String(fromDate.getUTCDate()).padStart(2, "0")}`;

  try {
    const [navResult, pgResult, shopCurResult, shopPrevResult, shopTodayResult, shopPrevWeekResult, shopPrevYearResult] = await Promise.all([
      safeSource<NavBundle>("nav", async () => {
        const [current, previous, yest_row, d7_row, d30_row, yoy_row, storeCount, sparkRows, todayNavRow, prevWeek, prevYear] = await Promise.all([
          navQuery<RevUnits>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] != 'ONLINE'`, { from, to }),
          navQuery<RevUnits>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @prevFrom AND @prevTo AND [Store No_] != 'ONLINE'`, { prevFrom, prevTo }),
          navQuery<Rev>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) = @yest AND [Store No_] != 'ONLINE'`, { yest }),
          navQuery<Rev>(`SELECT -SUM([Net Amount]+[VAT Amount])/7.0 AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @d7from AND @today AND [Store No_] != 'ONLINE'`, { d7from, today }),
          navQuery<Rev>(`SELECT -SUM([Net Amount]+[VAT Amount])/30.0 AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @d30from AND @today AND [Store No_] != 'ONLINE'`, { d30from, today }),
          navQuery<RevUnits>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @yoy_from AND @yoy_to AND [Store No_] != 'ONLINE'`, { yoy_from, yoy_to }),
          navQuery<CountRow>(`SELECT COUNT(DISTINCT [Store No_]) AS n FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @from AND @to AND [Store No_] != 'ONLINE'`, { from, to }),
          navQuery<DayRev>(`SELECT CAST([Date] AS DATE) AS day, -SUM([Net Amount]+[VAT Amount]) AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) BETWEEN @sparkStart AND @today AND [Store No_] != 'ONLINE' GROUP BY CAST([Date] AS DATE) ORDER BY day`, { sparkStart, today }),
          navQuery<Rev>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) = @today AND [Store No_] != 'ONLINE'`, { today }),
          navQuery<Rev>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) = @prevWeekDate AND [Store No_] != 'ONLINE'`, { prevWeekDate }),
          navQuery<Rev>(`SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue FROM TransSalesEntry WHERE CAST([Date] AS DATE) = @prevYearDate AND [Store No_] != 'ONLINE'`, { prevYearDate }),
        ]);
        return { current, previous, yest_row, d7_row, d30_row, yoy_row, storeCount, sparkRows, todayNavRow, prevWeek, prevYear };
      }, { current: [], previous: [], yest_row: [], d7_row: [], d30_row: [], yoy_row: [], storeCount: [], sparkRows: [], todayNavRow: [], prevWeek: [], prevYear: [] }),

      safeSource<FxRow[]>("pg", () => query<FxRow>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"), []),

      safeSource<ShopRev>("shopify", () => getShopifyRevenue(from, to), { egp: 0, units: 0 }),
      safeSource<ShopRev>("shopify", () => getShopifyRevenue(prevFrom, prevTo), { egp: 0, units: 0 }),
      safeSource<ShopRev>("shopify", () => getShopifyRevenue(today, today), { egp: 0, units: 0 }),
      safeSource<ShopRev>("shopify", () => getShopifyRevenue(prevWeekDate, prevWeekDate), { egp: 0, units: 0 }),
      safeSource<ShopRev>("shopify", () => getShopifyRevenue(prevYearDate, prevYearDate), { egp: 0, units: 0 }),
    ]);

    const nav = navResult.value;
    const fxRow = pgResult.value;
    const shopifyCurrent = shopCurResult.value;
    const shopifyPrev    = shopPrevResult.value;
    const shopifyToday   = shopTodayResult.value;

    const shopStatus: SourceStatus = (shopCurResult.status === "ok" && shopPrevResult.status === "ok" && shopTodayResult.status === "ok") ? "ok" : "offline";
    const sources = { nav: navResult.status, shopify: shopStatus, pg: pgResult.status };

    const rev       = Number(nav.current[0]?.revenue  ?? 0) + shopifyCurrent.egp;
    const units     = Number(nav.current[0]?.units    ?? 0) + shopifyCurrent.units;
    const prevRev   = Number(nav.previous[0]?.revenue ?? 0) + shopifyPrev.egp;
    const prevUnits = Number(nav.previous[0]?.units   ?? 0) + shopifyPrev.units;
    const d30Rev    = Number(nav.d30_row[0]?.revenue  ?? 0); // daily avg
    const fx        = parseFloat(fxRow[0]?.egp_per_usd || "50");

    function pct(a: number, b: number) { return b > 0 ? ((a - b) / b) * 100 : 0; }

    // Three-way comparison shown on single-day views (Today / Yesterday).
    const prevWeekRev = Number(nav.prevWeek[0]?.revenue ?? 0) + shopPrevWeekResult.value.egp;
    const prevYearRev = Number(nav.prevYear[0]?.revenue ?? 0) + shopPrevYearResult.value.egp;
    const isTodaySel  = from === todayCairo();
    const mkCmp = (label: string, prev: number) => ({ label, change: prev > 0 ? pct(rev, prev) : null, prevEgp: Math.round(prev) });
    const dayComparisons = isSingleDay ? [
      mkCmp(isTodaySel ? "vs yesterday" : "vs prev day", prevRev),
      mkCmp("vs last week", prevWeekRev),
      mkCmp("vs last year", prevYearRev),
    ] : null;

    const dailyTarget = d30Rev * 1.1;
    const todayRev = Number(nav.todayNavRow[0]?.revenue ?? 0) + shopifyToday.egp;
    const paceToTarget = dailyTarget > 0 ? (todayRev / dailyTarget) * 100 : null;

    const sparkline = nav.sparkRows.map(r => Number(r.revenue));

    return NextResponse.json({
      revenue:      { egp: rev, usd: rev / fx },
      revChange:    prevRev > 0 ? pct(rev, prevRev) : null,
      dayComparisons,
      units,
      unitsChange:  prevUnits > 0 ? pct(units, prevUnits) : null,
      avgTicket:    { egp: units > 0 ? rev / units : 0, usd: units > 0 ? rev / units / fx : 0 },
      activeStores: Number(nav.storeCount[0]?.n ?? 0),
      fx,
      sparkline,
      todayRevenue: todayRev,
      pace: paceToTarget !== null ? { pct: paceToTarget, dailyTarget } : null,
      sources,
      degraded: isDegraded(sources),
      lastUpdated:  new Date().toISOString(),
    });
  } catch (e) {
    console.error("[kpis] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      revenue: { egp: 0, usd: 0 }, revChange: null, units: 0, unitsChange: null,
      avgTicket: { egp: 0, usd: 0 }, activeStores: 0, fx: 50, sparkline: [],
      todayRevenue: 0, pace: null,
      sources: { nav: "offline", shopify: "offline", pg: "offline" }, degraded: true,
      lastUpdated: new Date().toISOString(), error: "Failed to load KPIs",
    }, { status: 200 });
  }
}
