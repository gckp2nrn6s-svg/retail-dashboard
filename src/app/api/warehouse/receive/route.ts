import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { resolveCodes } from "@/lib/warehouse";
import { logLedger } from "@/lib/stock-ledger";
import { canWh } from "@/lib/authz";

export const dynamic = "force-dynamic";

// POST { kind:'factory'|'outside', reference?, note?, lines:[{item_no,qty}] }
// Records a receipt and ADDS the quantities to HO stock (quantity + in_stock).
export async function POST(req: NextRequest) {
  if (!(await canWh("receive"))) return NextResponse.json({ error: "You don't have permission to receive stock." }, { status: 403 });
  let body: { kind?: string; reference?: string; note?: string; lines?: { item_no?: string; qty?: number }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const kind = body.kind === "factory" ? "factory" : "outside";
  const reference = (body.reference || "").trim().slice(0, 200) || null;
  const note = (body.note || "").trim().slice(0, 500) || null;

  // merge duplicate item_nos, drop blanks / non-positive
  const merged = new Map<string, number>();
  for (const l of body.lines ?? []) {
    const item = String(l.item_no || "").trim();
    const qty = Number(l.qty) || 0;
    if (item && qty > 0) merged.set(item, (merged.get(item) || 0) + qty);
  }
  if (!merged.size) return NextResponse.json({ error: "no valid lines" }, { status: 400 });

  const resolved = await resolveCodes([...merged.keys()]);
  const descByItem = new Map(resolved.map(r => [r.item_no, r.description]));

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [receipt] } = await client.query(
      `INSERT INTO wh_receipts (kind, reference, note) VALUES ($1,$2,$3) RETURNING id`,
      [kind, reference, note],
    );
    for (const [item_no, qty] of merged) {
      await client.query(`INSERT INTO wh_receipt_lines (receipt_id, item_no, qty) VALUES ($1,$2,$3)`, [receipt.id, item_no, qty]);
      await client.query(`
        INSERT INTO warehouse_stock (item_no, quantity, out_qty, in_stock, description, snapshot_date, updated_at)
        VALUES ($1,$2,0,$2,$3,CURRENT_DATE,now())
        ON CONFLICT (item_no) DO UPDATE SET
          quantity   = warehouse_stock.quantity + EXCLUDED.quantity,
          in_stock   = warehouse_stock.in_stock + EXCLUDED.in_stock,
          description = COALESCE(warehouse_stock.description, EXCLUDED.description),
          updated_at = now()
      `, [item_no, qty, descByItem.get(item_no) ?? null]);
      // Record-only ledger entry (warehouse_stock already moved above).
      await logLedger(client, { item_no, type: "receipt", source_ref: `receipt-${receipt.id}`, qty_delta: qty, batch_id: `receipt-${receipt.id}`, note: `${kind} receipt ${receipt.id}` });
    }
    await client.query("COMMIT");
    const totalUnits = [...merged.values()].reduce((s, q) => s + q, 0);
    return NextResponse.json({ ok: true, receiptId: receipt.id, lines: merged.size, units: totalUnits });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warehouse/receive]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "receive failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
