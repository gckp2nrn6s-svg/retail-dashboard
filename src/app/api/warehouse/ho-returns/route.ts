import { NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { safeSource, isDegraded } from "@/lib/resilience";

export const dynamic = "force-dynamic";

// Returns to HO — transfer lines whose destination is HO (store → HO). Receiving
// one adds the quantities back to HO on-hand (return_in), idempotent per document.
interface LineRow { doc: string; frm: string; item: string; qty: number; sd: string | null }
interface StockRow { item_no: string; in_stock: number; description: string | null; unit_price: number | null }
interface DocLine { item_no: string; description: string | null; qty: number; current: number; value: number }
interface Doc { doc: string; store: string; date: string | null; applied: boolean; lines: DocLine[]; totalQty: number; totalValue: number }

const Q = `
  SELECT DocumentNo AS doc, TransferFrom AS frm, ItemNo AS item, Quantity AS qty,
         CONVERT(varchar(10), CAST(ShipmentDate AS DATE), 23) AS sd
    FROM TransferLines
   WHERE TransferTo = 'HO' AND Quantity <> 0
   ORDER BY ShipmentDate DESC, DocumentNo`;

export async function GET() {
  try {
    const [tRes, stockRows, refs] = await Promise.all([
      safeSource<LineRow[]>("nav", () => navQuery<LineRow>(Q, {}), []),
      query<StockRow>("SELECT item_no, in_stock, description, unit_price FROM warehouse_stock"),
      query<{ source_ref: string }>("SELECT DISTINCT source_ref FROM wh_stock_ledger WHERE type='return_in'"),
    ]);

    const stock = new Map(stockRows.map(r => [String(r.item_no).trim(), { in_stock: Number(r.in_stock) || 0, desc: r.description, price: Number(r.unit_price) || 0 }]));
    const applied = new Set(refs.map(r => r.source_ref));

    const byDoc = new Map<string, Doc>();
    for (const r of tRes.value) {
      const item = String(r.item).trim();
      const qty = Math.round(Number(r.qty));
      if (!item || !qty) continue;
      const s = stock.get(item);
      const value = Math.round(qty * (s?.price ?? 0)); // returns have no invoice amount → value from warehouse unit price
      let d = byDoc.get(r.doc);
      if (!d) { d = { doc: r.doc, store: r.frm, date: r.sd ? String(r.sd).slice(0, 10) : null, applied: applied.has(r.doc), lines: [], totalQty: 0, totalValue: 0 }; byDoc.set(r.doc, d); }
      const ex = d.lines.find(x => x.item_no === item);
      if (ex) { ex.qty += qty; ex.value += value; }
      else d.lines.push({ item_no: item, description: s?.desc ?? null, qty, current: s?.in_stock ?? 0, value });
      d.totalQty += qty;
      d.totalValue += value;
    }

    const returns = [...byDoc.values()];
    const sources = { nav: tRes.status };
    return NextResponse.json({ returns, sources, degraded: isDegraded(sources) });
  } catch (e) {
    console.error("[warehouse/ho-returns]", e instanceof Error ? e.message : e);
    return NextResponse.json({ returns: [], sources: { nav: "offline" }, degraded: true, error: "Failed to load returns" }, { status: 200 });
  }
}
