import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { resolveCodes } from "@/lib/warehouse";
import { canWh } from "@/lib/authz";

export const dynamic = "force-dynamic";

// POST { direction:'add'|'deduct', reason?, lines:[{item_no, qty}] }
// Manually corrects HO on-hand. 'add' bumps quantity+in_stock (like a receipt);
// 'deduct' bumps out_qty and drops in_stock (like a transfer-out). Records the
// before/after per item in wh_adjustment_lines for a full audit trail.
export async function POST(req: NextRequest) {
  if (!(await canWh("adjust"))) return NextResponse.json({ error: "You don't have permission to adjust stock." }, { status: 403 });
  let body: { direction?: string; reason?: string; lines?: { item_no?: string; qty?: number }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const direction = body.direction === "deduct" ? "deduct" : "add";
  const reason = (body.reason || "").trim().slice(0, 500) || null;

  const merged = new Map<string, number>();
  for (const l of body.lines ?? []) {
    const item = String(l.item_no || "").trim();
    const qty = Math.abs(Number(l.qty) || 0);
    if (item && qty > 0) merged.set(item, (merged.get(item) || 0) + qty);
  }
  if (!merged.size) return NextResponse.json({ error: "no valid lines" }, { status: 400 });

  const resolved = await resolveCodes([...merged.keys()]);
  const descByItem = new Map(resolved.map(r => [r.item_no, r.description]));
  const sign = direction === "add" ? 1 : -1;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [adj] } = await client.query(
      `INSERT INTO wh_adjustments (direction, reason) VALUES ($1,$2) RETURNING id`, [direction, reason]);

    const receipt: { item_no: string; before: number; after: number; delta: number }[] = [];
    for (const [item_no, qty] of merged) {
      const delta = sign * qty;
      // Upsert the stock change and capture before/after in one round-trip.
      const { rows: [r] } = await client.query(`
        INSERT INTO warehouse_stock (item_no, quantity, out_qty, in_stock, description, snapshot_date, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, now())
        ON CONFLICT (item_no) DO UPDATE SET
          quantity   = warehouse_stock.quantity + $2,
          out_qty    = warehouse_stock.out_qty  + $3,
          in_stock   = warehouse_stock.in_stock + $4,
          description = COALESCE(warehouse_stock.description, EXCLUDED.description),
          updated_at = now()
        RETURNING in_stock AS after_qty
      `, [
        item_no,
        direction === "add" ? qty : 0,      // quantity (cumulative in)
        direction === "deduct" ? qty : 0,   // out_qty (cumulative out)
        delta,                               // in_stock change
        descByItem.get(item_no) ?? null,
      ]);
      const after = Number(r.after_qty);
      const before = after - delta;
      receipt.push({ item_no, before, after, delta });
      await client.query(
        `INSERT INTO wh_adjustment_lines (adjustment_id, item_no, qty, before_qty, after_qty) VALUES ($1,$2,$3,$4,$5)`,
        [adj.id, item_no, qty, before, after]);
    }

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true, adjustmentId: adj.id, direction,
      lines: receipt.length,
      units: [...merged.values()].reduce((s, q) => s + q, 0),
      rows: receipt,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warehouse/adjust]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "adjust failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
