import { getPool } from "@/lib/db";
import type { PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Stock movement ledger — the single, leak-proof source of truth for every
// change to warehouse on-hand. `warehouse_stock.in_stock` stays the fast read,
// but it ONLY ever moves through here, so it can always be reconciled against
// the ledger (baseline + Σ deltas == in_stock).
//
// The unique index on (type, source_ref, item_no) is what makes it bullet-proof:
// a given NAV document (invoice no / transfer no / credit-memo no) — or a manual
// batch — can be applied EXACTLY ONCE, ever. Re-running a sync can never
// double-deduct, and nothing posted gets silently dropped.
// ---------------------------------------------------------------------------

export type LedgerType =
  | "baseline"        // opening balance (stock-take clean slate)
  | "receipt"         // incoming purchase / cover received
  | "transfer_out"    // HO → store transfer (Submit)
  | "ho_invoice_out"  // HO posted sales invoice — deducts (can go negative)
  | "credit_memo_in"  // HO posted sales credit memo — adds back
  | "return_in"       // store → HO return transfer — adds back
  | "adjust"          // manual adjustment
  | "stocktake";      // stock-take re-baseline

export interface LedgerEntry {
  item_no: string;
  type: LedgerType;
  /** doc no / batch id — unique per (type, source_ref, item_no). */
  source_ref: string;
  /** signed: > 0 adds to stock, < 0 deducts. */
  qty_delta: number;
  batch_id?: string | null;
  note?: string | null;
  created_by?: string | null;
}

export interface ApplyResult {
  /** true if this entry was newly applied; false if the doc was already on the ledger (no change). */
  applied: boolean;
  before: number;
  after: number;
}

/**
 * Idempotent apply: records the movement AND moves `warehouse_stock`, but only
 * the FIRST time this (type, source_ref, item_no) is seen. If the row already
 * exists the insert is a no-op and we skip the stock update — so it can never
 * double-deduct. Returns { applied, before, after } (before==after when it was
 * already applied).
 *
 * Must run inside a transaction — pass the PoolClient (BEGIN/COMMIT in caller).
 */
export async function applyLedger(client: PoolClient, e: LedgerEntry): Promise<ApplyResult> {
  const ins = await client.query(
    `INSERT INTO wh_stock_ledger (item_no, type, source_ref, qty_delta, batch_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (type, source_ref, item_no) DO NOTHING
     RETURNING id`,
    [e.item_no, e.type, e.source_ref, e.qty_delta, e.batch_id ?? null, e.note ?? null, e.created_by ?? null]
  );
  if (ins.rowCount === 0) {
    // already applied — leak-proof: report current stock unchanged
    const { rows } = await client.query("SELECT in_stock FROM warehouse_stock WHERE item_no=$1", [e.item_no]);
    const cur = Number(rows[0]?.in_stock ?? 0);
    return { applied: false, before: cur, after: cur };
  }

  const d = e.qty_delta;
  const addQ = d > 0 ? d : 0;   // inflow bumps cumulative quantity
  const addO = d < 0 ? -d : 0;  // outflow bumps cumulative out
  const { rows } = await client.query(
    `INSERT INTO warehouse_stock (item_no, quantity, out_qty, in_stock, snapshot_date, updated_at)
     VALUES ($1,$2,$3,$4,CURRENT_DATE,now())
     ON CONFLICT (item_no) DO UPDATE SET
       quantity   = warehouse_stock.quantity + $2,
       out_qty    = warehouse_stock.out_qty  + $3,
       in_stock   = warehouse_stock.in_stock + $4,
       updated_at = now()
     RETURNING in_stock AS after`,
    [e.item_no, addQ, addO, d]
  );
  const after = Number(rows[0].after);
  return { applied: true, before: after - d, after };
}

/**
 * Record-only: log a movement whose `warehouse_stock` change is already being
 * done by an existing flow (receive / submit / adjust). Keeps the ledger
 * complete for the Log tab + reconciliation WITHOUT touching stock twice.
 * Idempotent on the ledger.
 */
export async function logLedger(client: PoolClient, e: LedgerEntry): Promise<void> {
  await client.query(
    `INSERT INTO wh_stock_ledger (item_no, type, source_ref, qty_delta, batch_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (type, source_ref, item_no) DO NOTHING`,
    [e.item_no, e.type, e.source_ref, e.qty_delta, e.batch_id ?? null, e.note ?? null, e.created_by ?? null]
  );
}

/** Has this exact document already been applied (any of its item lines)? */
export async function isApplied(type: LedgerType, source_ref: string): Promise<boolean> {
  const { rows } = await getPool().query(
    "SELECT 1 FROM wh_stock_ledger WHERE type=$1 AND source_ref=$2 LIMIT 1",
    [type, source_ref]
  );
  return rows.length > 0;
}

/** Reconcile: any item where Σ(ledger) ≠ warehouse_stock.in_stock is a leak. */
export async function reconcile(): Promise<{ item_no: string; ledger: number; in_stock: number }[]> {
  const { rows } = await getPool().query(
    `SELECT w.item_no,
            COALESCE(l.s, 0)::float AS ledger,
            w.in_stock::float       AS in_stock
       FROM warehouse_stock w
       LEFT JOIN (SELECT item_no, SUM(qty_delta) s FROM wh_stock_ledger GROUP BY item_no) l
         ON l.item_no = w.item_no
      WHERE COALESCE(l.s, 0) <> w.in_stock
      ORDER BY ABS(COALESCE(l.s,0) - w.in_stock) DESC`
  );
  return rows as { item_no: string; ledger: number; in_stock: number }[];
}
