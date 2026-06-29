import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { navQuery } from "@/lib/navdb";
import { applyLedger, type LedgerType } from "@/lib/stock-ledger";
import { canWh, sessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// POST { doc, kind:'invoice'|'creditmemo', mode?:'apply'|'override'|'unoverride', reason? }
// apply      → invoice: ho_invoice_out (deduct, may go negative); creditmemo: credit_memo_in (add back)
// override   → mark the doc "already reconciled" WITHOUT moving stock (some invoices were
//              covered elsewhere; force-deducting them would re-create the negatives)
// unoverride → clear that mark
// Idempotent per document: the ledger's unique key makes a re-apply a no-op.
interface NavLine { item: string; descr: string; qty: number }

export async function POST(req: NextRequest) {
  if (!(await canWh("ho"))) return NextResponse.json({ error: "You don't have permission to process HO sales." }, { status: 403 });

  let body: { doc?: string; kind?: string; mode?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const doc = String(body.doc || "").trim();
  const kind = body.kind === "creditmemo" ? "creditmemo" : "invoice";
  const mode = body.mode === "override" ? "override" : body.mode === "unoverride" ? "unoverride" : "apply";
  if (!doc) return NextResponse.json({ error: "missing document" }, { status: 400 });

  // Override path — record/clear "already reconciled" without touching stock.
  if (mode === "override") {
    const u = await sessionUser();
    await query(
      `INSERT INTO wh_ho_overrides (doc, kind, reason, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (doc) DO UPDATE SET kind=EXCLUDED.kind, reason=EXCLUDED.reason, created_by=EXCLUDED.created_by, ts=now()`,
      [doc, kind, (body.reason || "").trim().slice(0, 300) || null, u?.id ?? null]
    );
    return NextResponse.json({ ok: true, doc, kind, mode });
  }
  if (mode === "unoverride") {
    await query("DELETE FROM wh_ho_overrides WHERE doc=$1", [doc]);
    return NextResponse.json({ ok: true, doc, kind, mode });
  }

  const tbl = kind === "creditmemo" ? "SalesCrMemoLine" : "SalesInvoiceLine";
  const type: LedgerType = kind === "creditmemo" ? "credit_memo_in" : "ho_invoice_out";
  const sign = kind === "creditmemo" ? 1 : -1;

  // NAV is the source of truth for the quantities; round fractional units.
  const navLines = await navQuery<NavLine>(
    `SELECT [No_] AS item, MAX([Description]) AS descr, SUM([Quantity]) AS qty
       FROM ${tbl} WHERE [Type] = 2 AND [Document No_] = @doc GROUP BY [No_]`,
    { doc }
  );
  const lines = navLines
    .map(l => ({ item_no: String(l.item).trim(), description: (l.descr || "").trim(), qty: Math.round(Number(l.qty)) }))
    .filter(l => l.item_no && l.qty);
  if (!lines.length) return NextResponse.json({ error: "no item lines on this document" }, { status: 400 });

  const u = await sessionUser();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const rows: { item_no: string; description: string; qty: number; delta: number; before: number; after: number; applied: boolean }[] = [];
    let newly = 0;
    for (const l of lines) {
      const delta = sign * l.qty;
      const res = await applyLedger(client, {
        item_no: l.item_no, type, source_ref: doc, qty_delta: delta,
        note: `${kind} ${doc}`, created_by: u?.id ?? null,
      });
      if (res.applied) newly++;
      rows.push({ item_no: l.item_no, description: l.description, qty: l.qty, delta, before: res.before, after: res.after, applied: res.applied });
    }
    await client.query("COMMIT");
    return NextResponse.json({
      ok: true, doc, kind,
      alreadyApplied: newly === 0,
      units: lines.reduce((s, l) => s + l.qty, 0),
      rows,
      // reconciled-PO copy (invoices): item⇥qty to re-purchase in the ERP and clear the negatives
      poLines: lines.map(l => `${l.item_no}\t${l.qty}`),
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warehouse/ho-apply]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "apply failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
