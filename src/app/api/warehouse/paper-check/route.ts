import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/warehouse/paper-check { transferId }
// Tick the manual paper-check on a submitted transfer (sets paper_checked_at).
export async function POST(req: NextRequest) {
  let body: { transferId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const id = Number(body.transferId);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "bad transferId" }, { status: 400 });

  try {
    const rows = await query<{ id: number }>(
      `UPDATE wh_transfers SET paper_checked_at = now() WHERE id = $1 RETURNING id`, [id]);
    if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 200 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[warehouse/paper-check]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "paper-check failed" }, { status: 200 });
  }
}
