import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { safeSource, isDegraded } from "@/lib/resilience";
import { B2B_CUST_FILTER } from "@/lib/b2b-revenue";
import { getFactoryDirectByClient, getFactoryDirectSeries, maybeRefreshFactoryDirect, lastFactorySync, clientKey, type FdClient } from "@/lib/factory-direct";
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
      FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
    UNION ALL
    SELECT [Sell-to Customer No_], -[Amount Including VAT], -[Quantity], [Document No_]
      FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
  ) t GROUP BY cust HAVING SUM(egp) <> 0 ORDER BY egp DESC`;

const CUST_SERIES = `
  SELECT date, SUM(egp) AS egp, SUM(units) AS units FROM (
    SELECT CONVERT(varchar(10), CAST([Posting Date] AS DATE), 23) AS date, [Amount Including VAT] AS egp, [Quantity] AS units
      FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
    UNION ALL
    SELECT CONVERT(varchar(10), CAST([Posting Date] AS DATE), 23), -[Amount Including VAT], -[Quantity]
      FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
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

  maybeRefreshFactoryDirect(); // non-blocking: re-pull the live sheet if >12h stale

  try {
    const [navResult, fxResult, nameResult, fdResult] = await Promise.all([
      safeSource<[CustRow[], DayRow[]]>("nav", () => Promise.all([
        navQuery<CustRow>(CUST_TOTALS, { from, to }),
        navQuery<DayRow>(CUST_SERIES, { from, to }),
      ]), [[], []]),
      safeSource<FxRow[]>("pg", () => query<FxRow>("SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"), []),
      safeSource<NameRow[]>("pg", () => query<NameRow>("SELECT code, name FROM b2b_customers"), []),
      safeSource<[FdClient[], { date: string; egp: number; units: number }[], Awaited<ReturnType<typeof lastFactorySync>>]>("pg", () => Promise.all([
        getFactoryDirectByClient(from, to),
        getFactoryDirectSeries(from, to),
        lastFactorySync(),
      ]), [[], [], null]),
    ]);

    const [custRows, dayRows] = navResult.value;
    const [fdClients, fdSeries, fdSync] = fdResult.value;
    const fx = parseFloat(fxResult.value[0]?.egp_per_usd || "50");
    const nameMap = Object.fromEntries(nameResult.value.map(r => [r.code, r.name]));
    const sources = { nav: navResult.status, pg: fxResult.status };

    const customers = custRows.map(r => {
      const egp = Math.round(Number(r.egp));
      const mapped = nameMap[r.cust];
      return {
        code:    r.cust,
        name:    mapped ? (cleanName(mapped) || mapped) : r.cust, // fall back to the code — never drop the number
        named:   !!mapped,
        egp,
        usd:     0,
        units:   Math.round(Number(r.units)),
        txns:    Number(r.txns),
        pct:     0,
        factory: false,   // true once factory-direct sales are folded in
        client_key: "",   // set when factory-direct is involved (drills into the sheet)
      };
    });

    // Fold in factory-direct sales (live sheet): merge into a matching B2B customer
    // by normalized name, else add the client as its own card. These are additive —
    // sales that don't flow through NAV.
    const byKey = new Map<string, (typeof customers)[number]>();
    for (const c of customers) { const k = clientKey(cleanName(c.name) || c.name); if (!byKey.has(k)) byKey.set(k, c); }
    for (const f of fdClients) {
      const ex = byKey.get(f.client_key);
      if (ex) { ex.egp += f.egp; ex.units += f.units; ex.txns += f.txns; ex.factory = true; ex.client_key = f.client_key; }
      else {
        const nc = { code: `FD:${f.client_key}`, name: f.client, named: true, egp: f.egp, usd: 0, units: f.units, txns: f.txns, pct: 0, factory: true, client_key: f.client_key };
        customers.push(nc); byKey.set(f.client_key, nc);
      }
    }
    customers.sort((a, b) => b.egp - a.egp);

    // Total from the rounded rows so the cards always sum exactly to the header.
    const total = customers.reduce((s, c) => s + c.egp, 0);
    const totalUnits = customers.reduce((s, c) => s + c.units, 0);
    for (const c of customers) { c.usd = Math.round(c.egp / fx); c.pct = total > 0 ? Math.round((c.egp / total) * 100) : 0; }

    // Merge daily series (NAV + factory) by date.
    const seriesMap = new Map<string, { egp: number; units: number }>();
    for (const r of dayRows) { const d = String(r.date).slice(0, 10); const e = seriesMap.get(d) || { egp: 0, units: 0 }; e.egp += Math.round(Number(r.egp)); e.units += Math.round(Number(r.units)); seriesMap.set(d, e); }
    for (const r of fdSeries) { const e = seriesMap.get(r.date) || { egp: 0, units: 0 }; e.egp += r.egp; e.units += r.units; seriesMap.set(r.date, e); }
    const series = [...seriesMap.entries()].map(([date, v]) => ({ date, egp: v.egp, units: v.units })).sort((a, b) => a.date.localeCompare(b.date));
    const through = series.length ? series[series.length - 1].date : null;

    return NextResponse.json({
      customers,
      total: { egp: Math.round(total), usd: Math.round(total / fx), units: Math.round(totalUnits) },
      series, through, fx, sources, degraded: isDegraded(sources),
      factory: { egp: fdClients.reduce((s, f) => s + f.egp, 0), clients: fdClients.length, syncedAt: fdSync?.synced_at ?? null },
    });
  } catch (e) {
    console.error("[b2b] fatal:", e instanceof Error ? e.message : e);
    return NextResponse.json({
      customers: [], total: { egp: 0, usd: 0, units: 0 }, series: [], through: null, fx: 50,
      sources: { nav: "offline", pg: "offline" }, degraded: true, error: "Failed to load B2B data",
    }, { status: 200 });
  }
}
