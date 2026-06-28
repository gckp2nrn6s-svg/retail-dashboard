import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { liveStateByDoc, type DocState } from "@/lib/warehouse-transfers";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  doc_no: string;
  store: string;
  status_at_submit: string | null;
  paper_checked_at: string | null;
}

// Human-readable status for the row. Prefers the custom NAV "Retail Status"
// (Sent / Received …) when synced; otherwise derives from the posting progress.
function displayStatus(st: DocState | undefined): string {
  if (!st || !st.present) return "Received";          // gone from NAV's open table ⇒ fully received
  if (st.retail_status) return st.retail_status;       // "Sent" / "Received" (custom field)
  if (st.qty_received > 0) return "Receiving";
  if (st.qty_shipped > 0) return "Shipped";
  return st.status === "1" ? "Released" : st.status === "0" ? "Open" : (st.status || "Open");
}

// GET /api/warehouse/to-be-received?from=&to=
// Submitted transfers with their CURRENT NAV posting state re-read live per doc,
// plus the manual paper-check state. The "to be received" tick fires once the
// transfer has been SHIPPED in NAV — QtyShipped > 0, or the order has left NAV's
// open-transfer table entirely (which only happens once it's fully received).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  try {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (from) { params.push(from); where.push(`t.created_at >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`t.created_at < ($${params.length}::date + 1)`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query<Row>(`
      SELECT t.id, t.nav_doc_no AS doc_no, t.transfer_to AS store,
             t.status_at_submit, t.paper_checked_at
        FROM wh_transfers t
        ${clause}
       ORDER BY t.created_at DESC, t.id DESC`, params);

    const docNos = [...new Set(rows.map(r => r.doc_no).filter(Boolean))];
    let liveMap = new Map<string, DocState>();
    let liveOk = false;
    try {
      ({ map: liveMap } = await liveStateByDoc(docNos));
      liveOk = true;
    } catch (e) {
      console.error("[warehouse/to-be-received] live state read failed:", e instanceof Error ? e.message : e);
    }

    const out = rows.map(r => {
      const st = liveMap.get(r.doc_no);
      // Shipped ⇒ "to be received". Treat absence as received ONLY when the live
      // read succeeded (a failed read must not falsely tick everything green).
      const gone = liveOk && !st;
      const nav_received = (st ? st.qty_shipped > 0 : false) || gone;
      const paper_checked = r.paper_checked_at != null;
      return {
        id: r.id,
        doc_no: r.doc_no,
        store: r.store,
        status_at_submit: r.status_at_submit,
        current_status: liveOk ? displayStatus(st) : (r.status_at_submit ?? "—"),
        stock_deducted: true,            // submit always deducts, by construction
        nav_received,
        paper_checked,
        done: nav_received && paper_checked,
      };
    });

    return NextResponse.json(out);
  } catch (e) {
    console.error("[warehouse/to-be-received]", e instanceof Error ? e.message : e);
    return NextResponse.json([], { status: 200 });
  }
}
