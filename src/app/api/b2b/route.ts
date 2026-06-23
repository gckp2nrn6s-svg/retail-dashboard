import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { safeSource, isDegraded } from "@/lib/resilience";
import { todayCairo, cairoStartOfMonth } from "@/lib/dates";

export const dynamic = "force-dynamic";

interface CustRow { cust: string; egp: number; units: number; txns: number }
interface DayRow  { date: string; egp: number; units: number }
interface FxRow   { egp_per_usd: string }
interface NameRow { code: string; name: string }

// HO/B2B sales = SalesInvoiceLine (invoices) net of SalesCrMemoLine (credit memos).
// Revenue is VAT-inclusive ([Amount Including VAT]) to match the rest of the dashboard.
// Customer = [Sell-to Customer No_] (C-XXXX); names come from Postgres b2b_customers.
const CUST_TOTALS = `
  SELECT cust, SUM(egp) AS egp, SUM(units) AS units, COUNT(DISTINCT doc) AS txns FROM (
    SELECT [Sell-to Customer No_] AS cust, [Amount Including VAT] AS egp, [Quantity] AS units, [Document No_] AS doc
      FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] <> ''
    UNION ALL
    SELECT [Sell-to Customer No_], -[Amount Including VAT], -[Quantity], [Document No_]
      FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] <> ''
  ) t GROUP BY cust HAVING SUM(egp) <> 0 ORDER BY egp DESC`;

const CUST_SERIES = `
  SELECT date, SUM(egp) AS egp, SUM(units) AS units FROM (
    SELECT CONVERT(varchar(10), CAST([Posting Date] AS DATE), 23) AS date, [Amount Including VAT] AS egp, [Quantity] AS units
      FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] <> ''
    UNION ALL
    SELECT CONVERT(varchar(10), CAST([Posting Date] AS DATE), 23), -[Amount Including VAT], -[Quantity]
      FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] <> ''
  ) t GROUP BY date ORDER BY date`;

// Strip trailing account-number noise from CEO-list names (e.g. "CARREFOUR 200/185/128"
// → "CARREFOUR"). Keep the raw name if stripping would empty it.
function cleanName(raw?: string): string {
  if (!raw) return "";
  const c = raw.replace(/[\s\d/_.\-]+$/u, "").trim();
  return c || raw;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || cairoStartOfMonth();
  const to   = searchParams.get("to")   || todayCairo();

  try {
    const [navResult, fxResult, nameResult] = await Promise.all([
      safeSource<[CustRow[], DayRow[]]>("nav", () => Promise.all([
        navQuery<CustRow>(CUST_TOTALS, { from, to }),
        navQuery<DayRow>(CUST_SERIES, { from, to }),
      ]), [[], []]),
      safeSource<FxRow[]>("pg", () => query<FxRow>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"), []),
      safeSource<NameRow[]>("pg", () => query<NameRow>("SELECT code, name FROM b2b_customers"), []),
    ]);

    const [custRows, dayRows] = navResult.value;
    const fx = parseFloat(fxResult.value[0]?.egp_per_usd || "50");
    const nameMap = Object.fromEntries(nameResult.value.map(r => [r.code, r.name]));
    const sources = { nav: navResult.status, pg: fxResult.status };

    const total = custRows.reduce((s, r) => s + Number(r.egp), 0);
    const totalUnits = custRows.reduce((s, r) => s + Number(r.units), 0);

    const customers = custRows.map(r => {
      const egp = Math.round(Number(r.egp));
      const mapped = nameMap[r.cust];
      return {
        code:    r.cust,
        name:    mapped ? (cleanName(mapped) || mapped) : r.cust, // fall back to the code — never drop the number
        named:   !!mapped,
        egp,
        usd:     Math.round(egp / fx),
        units:   Math.round(Number(r.units)),
        txns:    Number(r.txns),
        pct:     total > 0 ? Math.round((Number(r.egp) / total) * 100) : 0,
      };
    });

    const series = dayRows.map(r => ({ date: String(r.date).slice(0, 10), egp: Math.round(Number(r.egp)), units: Math.round(Number(r.units)) }));
    const through = series.length ? series[series.length - 1].date : null;

    return NextResponse.json({
      customers,
      total: { egp: Math.round(total), usd: Math.round(total / fx), units: Math.round(totalUnits) },
      series, through, fx, sources, degraded: isDegraded(sources),
    });
  } catch (e) {
    console.error("[b2b] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      customers: [], total: { egp: 0, usd: 0, units: 0 }, series: [], through: null, fx: 50,
      sources: { nav: "offline", pg: "offline" }, degraded: true, error: "Failed to load B2B data",
    }, { status: 200 });
  }
}
