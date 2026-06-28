import { NextRequest, NextResponse } from "next/server";
import { consolidatePo } from "@/lib/warehouse-transfers";

export const dynamic = "force-dynamic";

// POST /api/warehouse/po { docNos: string[] }
// Consolidate the picked docs' lines by item_no, subtract HO on-hand, and return
// the Purchase Order: po_qty = max(0, transfer_qty − ho_qty). copyText holds the
// `item_no\tqty` rows (po_qty > 0 only) to paste into the ERP. Read-only preview.
export async function POST(req: NextRequest) {
  let body: { docNos?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const docNos = Array.isArray(body.docNos) ? body.docNos.map(String).filter(Boolean) : [];
  if (!docNos.length) {
    return NextResponse.json({ lines: [], totals: { transfer_qty: 0, po_qty: 0, items: 0 }, copyText: "", sources: {}, error: "no docNos" }, { status: 200 });
  }

  try {
    const { lines, totals, copyText, source } = await consolidatePo(docNos);
    return NextResponse.json({ lines, totals, copyText, sources: { [source]: "ok" } });
  } catch (e) {
    console.error("[warehouse/po]", e instanceof Error ? e.message : e);
    return NextResponse.json({ lines: [], totals: { transfer_qty: 0, po_qty: 0, items: 0 }, copyText: "", sources: {}, error: "Failed to build PO" }, { status: 200 });
  }
}
