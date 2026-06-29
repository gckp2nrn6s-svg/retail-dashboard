import { NextRequest, NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { safeSource, isDegraded } from "@/lib/resilience";
import { todayCairo } from "@/lib/dates";

export const dynamic = "force-dynamic";

// HO Sales — posted sales invoices (deduct stock) + posted credit memos (add stock).
// Each document is tagged with whether it has already been applied to the ledger
// (so it can't be deducted twice) and the current on-hand for each of its items.

interface LineRow { doc: string; cust: string; pd: string; item: string; descr: string; qty: number; amount: number }
interface StockRow { item_no: string; in_stock: number }
interface RefRow { source_ref: string }

interface DocLine { item_no: string; description: string; qty: number; current: number; value: number }
interface Doc { doc: string; cust: string; custName: string; date: string; applied: boolean; overridden: boolean; lines: DocLine[]; totalQty: number; totalValue: number; anyNegative: boolean }

// item lines only ([Type]=2); fractional NAV quantities are rounded to whole units.
// [Amount Including VAT] = the line's VAT-inclusive value. The customer NAME isn't on the
// line table (nor any NAV replica table) so it's resolved from b2b_customers (code→name).
const LINES = (tbl: string) => `
  SELECT [Document No_] AS doc, [Sell-to Customer No_] AS cust,
         CONVERT(varchar(10), CAST([Posting Date] AS DATE), 23) AS pd,
         [No_] AS item, [Description] AS descr, [Quantity] AS qty, [Amount Including VAT] AS amount
    FROM ${tbl}
   WHERE [Type] = 2 AND [Quantity] <> 0
     AND CAST([Posting Date] AS DATE) BETWEEN @from AND @to
   ORDER BY [Posting Date] DESC, [Document No_]`;

// Strip trailing account-number noise from CEO-list names ("JUMIA 413/731" → "JUMIA").
const cleanName = (raw?: string) => { if (!raw) return ""; const c = raw.replace(/[\s\d/_.\-]+$/u, "").trim(); return c || raw; };

function group(rows: LineRow[], stock: Map<string, number>, applied: Set<string>, overridden: Set<string>, sign: number, nameMap: Map<string, string>): Doc[] {
  const byDoc = new Map<string, Doc>();
  for (const r of rows) {
    const item = String(r.item).trim();
    const qty = Math.round(Number(r.qty));
    if (!item || !qty) continue;
    const value = Math.round(Number(r.amount) || 0);
    let d = byDoc.get(r.doc);
    if (!d) {
      const nm = nameMap.get(r.cust);
      d = { doc: r.doc, cust: r.cust, custName: nm ? (cleanName(nm) || nm) : r.cust, date: String(r.pd).slice(0, 10), applied: applied.has(r.doc), overridden: overridden.has(r.doc), lines: [], totalQty: 0, totalValue: 0, anyNegative: false };
      byDoc.set(r.doc, d);
    }
    const ex = d.lines.find(x => x.item_no === item);
    if (ex) { ex.qty += qty; ex.value += value; }
    else d.lines.push({ item_no: item, description: (r.descr || "").trim(), qty, current: stock.get(item) ?? 0, value });
    d.totalQty += qty;
    d.totalValue += value;
  }
  const out = [...byDoc.values()];
  for (const d of out) d.anyNegative = d.lines.some(l => l.current + sign * l.qty < 0);
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to") || todayCairo();
  const from = searchParams.get("from") || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

  try {
    const [invRes, cmRes, stockRows, invRefs, cmRefs, ovRows, nameRows] = await Promise.all([
      safeSource<LineRow[]>("nav", () => navQuery<LineRow>(LINES("SalesInvoiceLine"), { from, to }), []),
      safeSource<LineRow[]>("nav", () => navQuery<LineRow>(LINES("SalesCrMemoLine"), { from, to }), []),
      query<StockRow>("SELECT item_no, in_stock FROM warehouse_stock"),
      query<RefRow>("SELECT DISTINCT source_ref FROM wh_stock_ledger WHERE type='ho_invoice_out'"),
      query<RefRow>("SELECT DISTINCT source_ref FROM wh_stock_ledger WHERE type='credit_memo_in'"),
      query<{ doc: string }>("SELECT doc FROM wh_ho_overrides"),
      query<{ code: string; name: string }>("SELECT code, name FROM b2b_customers").catch(() => []),
    ]);

    const stock = new Map(stockRows.map(r => [String(r.item_no).trim(), Number(r.in_stock) || 0]));
    const invApplied = new Set(invRefs.map(r => r.source_ref));
    const cmApplied = new Set(cmRefs.map(r => r.source_ref));
    const overridden = new Set(ovRows.map(r => r.doc));
    const nameMap = new Map(nameRows.map(r => [r.code, r.name]));

    const invoices = group(invRes.value, stock, invApplied, overridden, -1, nameMap);
    const creditMemos = group(cmRes.value, stock, cmApplied, overridden, +1, nameMap);
    const sources = { nav: invRes.status };

    return NextResponse.json({ from, to, invoices, creditMemos, sources, degraded: isDegraded(sources) });
  } catch (e) {
    console.error("[warehouse/ho-sales]", e instanceof Error ? e.message : e);
    return NextResponse.json({ from, to, invoices: [], creditMemos: [], sources: { nav: "offline" }, degraded: true, error: "Failed to load HO sales" }, { status: 200 });
  }
}
