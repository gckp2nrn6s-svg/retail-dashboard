import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { maybeRefreshHoDocs } from "@/lib/ho-docs";
import { todayCairo } from "@/lib/dates";

export const dynamic = "force-dynamic";

// HO Sales — posted invoices (deduct stock) + credit memos (add stock), read from the
// wh_ho_docs Postgres rollup (instant + consistent; SalesInvoiceLine has no date index
// so scanning NAV live is slow/intermittent). The rollup is refreshed from NAV in the
// background. Each document is tagged applied/overridden + current on-hand per item;
// customer name comes from b2b_customers, value from the invoice amount.

interface LineRow { doc: string; cust: string; pd: string; item: string; descr: string; qty: number; amount: number }
interface DocRow { kind: string; doc: string; cust: string; posting_date: string; item_no: string; descr: string; qty: number; amount: number }
interface StockRow { item_no: string; in_stock: number }
interface RefRow { source_ref: string }

interface DocLine { item_no: string; description: string; qty: number; current: number; value: number }
interface Doc { doc: string; cust: string; custName: string; date: string; applied: boolean; overridden: boolean; lines: DocLine[]; totalQty: number; totalValue: number; anyNegative: boolean }

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

  maybeRefreshHoDocs(); // non-blocking: keep the rollup fresh from NAV

  try {
    const [docRows, stockRows, invRefs, cmRefs, ovRows, nameRows] = await Promise.all([
      query<DocRow>(
        `SELECT kind, doc, cust, posting_date::text AS posting_date, item_no, descr, qty::float AS qty, amount::float AS amount
           FROM wh_ho_docs WHERE posting_date BETWEEN $1 AND $2 ORDER BY posting_date DESC, doc`,
        [from, to]),
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

    const toLine = (r: DocRow): LineRow => ({ doc: r.doc, cust: r.cust, pd: r.posting_date, item: r.item_no, descr: r.descr, qty: r.qty, amount: r.amount });
    const invoices = group(docRows.filter(r => r.kind === "invoice").map(toLine), stock, invApplied, overridden, -1, nameMap);
    const creditMemos = group(docRows.filter(r => r.kind === "creditmemo").map(toLine), stock, cmApplied, overridden, +1, nameMap);

    return NextResponse.json({ from, to, invoices, creditMemos, sources: { nav: "ok" }, degraded: false });
  } catch (e) {
    console.error("[warehouse/ho-sales]", e instanceof Error ? e.message : e);
    return NextResponse.json({ from, to, invoices: [], creditMemos: [], sources: { nav: "offline" }, degraded: true, error: "Failed to load HO sales" }, { status: 200 });
  }
}
