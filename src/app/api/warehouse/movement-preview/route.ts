import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveCodes } from "@/lib/warehouse";

export const dynamic = "force-dynamic";

// POST { moves: [{ item_no, delta }] }  — delta > 0 adds, delta < 0 deducts.
// Read-only: returns each item's current HO on-hand and what it WOULD become,
// so the UI can show "was T → becomes T±N" before anything is committed.
export async function POST(req: NextRequest) {
  let body: { moves?: { item_no?: string; delta?: number }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // Merge duplicates, drop blanks / zero deltas.
  const merged = new Map<string, number>();
  for (const m of body.moves ?? []) {
    const item = String(m.item_no || "").trim();
    const delta = Number(m.delta) || 0;
    if (item && delta !== 0) merged.set(item, (merged.get(item) || 0) + delta);
  }
  if (!merged.size) return NextResponse.json({ rows: [], totals: { items: 0, delta: 0 } });

  const items = [...merged.keys()];
  try {
    const ph = items.map((_, i) => `$${i + 1}`).join(",");
    const stock = await query<{ item_no: string; in_stock: number; description: string | null }>(
      `SELECT item_no, in_stock, description FROM warehouse_stock WHERE item_no IN (${ph})`, items);
    const curBy = new Map(stock.map(s => [String(s.item_no), { current: Number(s.in_stock) || 0, description: s.description }]));

    // Backfill descriptions for items not yet in warehouse_stock.
    const missingDesc = items.filter(i => !curBy.get(i)?.description);
    let resolvedDesc = new Map<string, string | null>();
    if (missingDesc.length) {
      const res = await resolveCodes(missingDesc);
      resolvedDesc = new Map(res.map(r => [r.input, r.description]));
    }

    const rows = items.map(item_no => {
      const cur = curBy.get(item_no);
      const current = cur?.current ?? 0;
      const delta = merged.get(item_no) || 0;
      return {
        item_no,
        description: cur?.description ?? resolvedDesc.get(item_no) ?? null,
        current,
        delta,
        next: current + delta,
      };
    }).sort((a, b) => a.item_no.localeCompare(b.item_no));

    return NextResponse.json({
      rows,
      totals: { items: rows.length, delta: rows.reduce((s, r) => s + r.delta, 0) },
    });
  } catch (e) {
    console.error("[warehouse/movement-preview]", e instanceof Error ? e.message : e);
    return NextResponse.json({ rows: [], totals: { items: 0, delta: 0 }, error: "preview failed" }, { status: 200 });
  }
}
