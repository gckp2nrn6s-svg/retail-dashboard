import { navQuery } from "./navdb";
import { query } from "./db";

// HO sales/credit-memo rollup. SalesInvoiceLine has no [Posting Date] index, so a
// date-filtered scan is slow + intermittent (~0.8s warm, ~15s cold). We sync the
// last N days of item-lines into Postgres (wh_ho_docs) so the HO Sales tab reads
// it instantly + consistently; this refresh does the slow NAV scan in the background.

interface NavLine { doc: string; cust: string; pd: string; item: string; descr: string; qty: number; amount: number }

const Q = (tbl: string, days: number) => `
  SELECT [Document No_] AS doc, [Sell-to Customer No_] AS cust,
         CONVERT(varchar(10), CAST([Posting Date] AS DATE), 23) AS pd,
         [No_] AS item, [Description] AS descr, [Quantity] AS qty, [Amount Including VAT] AS amount
    FROM ${tbl}
   WHERE [Type] = 2 AND [Quantity] <> 0 AND [Posting Date] >= DATEADD(day, -${days}, GETDATE())`;

/** Scan NAV invoices + credit memos (last `days`d), aggregate per item, upsert the rollup. */
export async function refreshHoDocs(days = 120): Promise<void> {
  type Agg = { kind: string; doc: string; cust: string; pd: string | null; item: string; descr: string; qty: number; amount: number };
  const agg = new Map<string, Agg>();
  for (const [kind, tbl] of [["invoice", "SalesInvoiceLine"], ["creditmemo", "SalesCrMemoLine"]] as const) {
    const rows = await navQuery<NavLine>(Q(tbl, days), {});
    for (const r of rows) {
      const item = String(r.item).trim();
      if (!item) continue;
      const k = `${kind}|${r.doc}|${item}`;
      let a = agg.get(k);
      if (!a) { a = { kind, doc: r.doc, cust: r.cust, pd: r.pd ? String(r.pd).slice(0, 10) : null, item, descr: (r.descr || "").trim(), qty: 0, amount: 0 }; agg.set(k, a); }
      a.qty += Math.round(Number(r.qty) || 0);
      a.amount += Math.round(Number(r.amount) || 0);
    }
  }
  const entries = [...agg.values()];
  for (let c = 0; c < entries.length; c += 400) {
    const slice = entries.slice(c, c + 400);
    const tup: string[] = []; const vals: (string | number | null)[] = []; let i = 1;
    for (const a of slice) { tup.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},now())`); vals.push(a.kind, a.doc, a.cust, a.pd, a.item, a.descr, a.qty, a.amount); }
    await query(
      `INSERT INTO wh_ho_docs (kind,doc,cust,posting_date,item_no,descr,qty,amount,built_at) VALUES ${tup.join(",")}
       ON CONFLICT (kind,doc,item_no) DO UPDATE SET cust=EXCLUDED.cust, posting_date=EXCLUDED.posting_date, descr=EXCLUDED.descr, qty=EXCLUDED.qty, amount=EXCLUDED.amount, built_at=now()`,
      vals);
  }
}

let _lastHoRefresh = 0;
const HO_THROTTLE = 10 * 60 * 1000; // 10 min
/** Fire-and-forget: refresh the HO-docs rollup if >30min stale (non-blocking). */
export function maybeRefreshHoDocs(): void {
  if (Date.now() - _lastHoRefresh < HO_THROTTLE) return;
  _lastHoRefresh = Date.now();
  refreshHoDocs().catch(e => console.error("[ho-docs] refresh failed:", e instanceof Error ? e.message : e));
}
