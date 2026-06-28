import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getTransfersByDocs, consolidatePo, type TransferLineRaw } from "@/lib/warehouse-transfers";

export const dynamic = "force-dynamic";

// POST /api/warehouse/submit { docNos: string[], note? }
// Atomically: open a run; snapshot each picked doc (wh_transfers + its lines);
// snapshot the consolidated PO (wh_po_lines); and DECREMENT real HO stock
// (warehouse_stock) by the consolidated transfer qty per item. The docs then
// move to the "to be received" tracking state.
export async function POST(req: NextRequest) {
  let body: { docNos?: unknown; note?: string; poLines?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const docNos = Array.isArray(body.docNos) ? [...new Set(body.docNos.map(String).filter(Boolean))] : [];
  const note = (body.note || "").trim().slice(0, 500) || null;
  if (!docNos.length) return NextResponse.json({ error: "no docNos" }, { status: 400 });

  // Optional per-item PO override from the negative-HO chooser: only the chosen
  // po_qty is honored (transfer_qty + ho_qty always come from the server-side
  // consolidation; the stock decrement is unaffected — it's the physical transfer qty).
  const poChoice = new Map<string, number>();
  if (Array.isArray(body.poLines)) {
    for (const l of body.poLines as Array<{ item_no?: unknown; po_qty?: unknown }>) {
      if (l && l.item_no != null) poChoice.set(String(l.item_no), Math.max(0, Math.round(Number(l.po_qty) || 0)));
    }
  }

  // Pull raw lines + the consolidation OUTSIDE the txn (these are NAV/mock reads).
  let rawRows: TransferLineRaw[];
  let consolidation;
  try {
    const [{ rows }, c] = await Promise.all([getTransfersByDocs(docNos), consolidatePo(docNos)]);
    rawRows = rows;
    consolidation = c;
  } catch (e) {
    console.error("[warehouse/submit] read failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "could not read transfers" }, { status: 200 });
  }
  if (!rawRows.length) return NextResponse.json({ error: "no transfer lines found for those docs" }, { status: 200 });

  // Per-doc metadata: store + status (first line wins) and its item→qty lines.
  const docMeta = new Map<string, { store: string; status: string; items: Map<string, number> }>();
  for (const r of rawRows) {
    let m = docMeta.get(r.doc_no);
    if (!m) { m = { store: r.transfer_to, status: r.status, items: new Map() }; docMeta.set(r.doc_no, m); }
    m.items.set(r.item_no, (m.items.get(r.item_no) || 0) + r.qty);
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rows: [run] } = await client.query(
      `INSERT INTO wh_runs (created_by, note) VALUES ($1,$2) RETURNING id`, [null, note]);

    // Snapshot each picked doc + its lines.
    for (const [doc_no, m] of docMeta) {
      const { rows: [t] } = await client.query(
        `INSERT INTO wh_transfers (run_id, nav_doc_no, transfer_to, status_at_submit, stock_deducted_at)
         VALUES ($1,$2,$3,$4, now()) RETURNING id`,
        [run.id, doc_no, m.store, m.status]);
      for (const [item_no, qty] of m.items) {
        await client.query(
          `INSERT INTO wh_transfer_lines (transfer_id, item_no, qty) VALUES ($1,$2,$3)`,
          [t.id, item_no, qty]);
      }
    }

    // Snapshot the consolidated PO (po_qty honors the negative-HO choice when sent).
    for (const l of consolidation.lines) {
      const poQty = poChoice.has(l.item_no) ? poChoice.get(l.item_no)! : l.po_qty;
      await client.query(
        `INSERT INTO wh_po_lines (run_id, item_no, transfer_qty, ho_qty, po_qty) VALUES ($1,$2,$3,$4,$5)`,
        [run.id, l.item_no, l.transfer_qty, l.ho_qty, poQty]);
    }

    // Decrement real HO stock by the consolidated transfer qty per item.
    // Upsert so an item missing from warehouse_stock still records the outflow
    // (mirrors the receive route's upsert, inverted: out_qty +, in_stock −).
    let units = 0;
    for (const l of consolidation.lines) {
      units += l.transfer_qty;
      await client.query(`
        INSERT INTO warehouse_stock (item_no, quantity, out_qty, in_stock, description, snapshot_date, updated_at)
        VALUES ($1, 0, $2::numeric, -($2::numeric), $3, CURRENT_DATE, now())
        ON CONFLICT (item_no) DO UPDATE SET
          out_qty    = warehouse_stock.out_qty  + EXCLUDED.out_qty,
          in_stock   = warehouse_stock.in_stock - EXCLUDED.out_qty,
          updated_at = now()
      `, [l.item_no, l.transfer_qty, l.description ?? null]);
    }

    await client.query("COMMIT");
    return NextResponse.json({ runId: run.id, transfers: docMeta.size, units });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warehouse/submit]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "submit failed" }, { status: 200 });
  } finally {
    client.release();
  }
}
