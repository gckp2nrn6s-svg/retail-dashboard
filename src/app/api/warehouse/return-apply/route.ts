import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { navQuery } from "@/lib/navdb";
import { applyLedger } from "@/lib/stock-ledger";
import { canWh, sessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// POST { doc } — receive a store→HO return: add its quantities back to HO on-hand
// (return_in), idempotent per document.
interface NavLine { item: string; qty: number }

export async function POST(req: NextRequest) {
  if (!(await canWh("receive"))) return NextResponse.json({ error: "You don't have permission to receive stock." }, { status: 403 });

  let body: { doc?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const doc = String(body.doc || "").trim();
  if (!doc) return NextResponse.json({ error: "missing document" }, { status: 400 });

  const navLines = await navQuery<NavLine>(
    `SELECT ItemNo AS item, SUM(Quantity) AS qty FROM TransferLines WHERE TransferTo='HO' AND DocumentNo=@doc GROUP BY ItemNo`,
    { doc }
  );
  const lines = navLines
    .map(l => ({ item_no: String(l.item).trim(), qty: Math.round(Number(l.qty)) }))
    .filter(l => l.item_no && l.qty);
  if (!lines.length) return NextResponse.json({ error: "no item lines on this return" }, { status: 400 });

  const u = await sessionUser();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const rows: { item_no: string; qty: number; before: number; after: number; applied: boolean }[] = [];
    let newly = 0;
    for (const l of lines) {
      const res = await applyLedger(client, { item_no: l.item_no, type: "return_in", source_ref: doc, qty_delta: l.qty, note: `return ${doc}`, created_by: u?.id ?? null });
      if (res.applied) newly++;
      rows.push({ item_no: l.item_no, qty: l.qty, before: res.before, after: res.after, applied: res.applied });
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc, alreadyApplied: newly === 0, units: lines.reduce((s, l) => s + l.qty, 0), rows });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warehouse/return-apply]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "receive failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
