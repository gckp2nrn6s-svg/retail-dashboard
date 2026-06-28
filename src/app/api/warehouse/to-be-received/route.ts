import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { liveStatusByDoc } from "@/lib/warehouse-transfers";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// The exact NAV status string that means "received" is STILL TBD. Detect it
// here in ONE place so it's trivial to adjust when we learn the real wording —
// just edit this regex (e.g. /received/i, or list the exact strings).
// ─────────────────────────────────────────────────────────────────────────────
export function isReceivedStatus(status: string | null | undefined): boolean {
  return /receiv/i.test(status || "");
}

interface Row {
  id: number;
  doc_no: string;
  store: string;
  status_at_submit: string | null;
  paper_checked_at: string | null;
}

// GET /api/warehouse/to-be-received?from=&to=
// Submitted transfers with their CURRENT NAV status re-read live per doc, plus
// the manual paper-check state. `done` = NAV says received AND paper ticked.
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
    let liveMap = new Map<string, string>();
    try {
      ({ map: liveMap } = await liveStatusByDoc(docNos));
    } catch (e) {
      console.error("[warehouse/to-be-received] live status read failed:", e instanceof Error ? e.message : e);
    }

    const out = rows.map(r => {
      const current_status = liveMap.get(r.doc_no) ?? r.status_at_submit ?? null;
      const nav_received = isReceivedStatus(current_status);
      const paper_checked = r.paper_checked_at != null;
      return {
        id: r.id,
        doc_no: r.doc_no,
        store: r.store,
        status_at_submit: r.status_at_submit,
        current_status,
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
