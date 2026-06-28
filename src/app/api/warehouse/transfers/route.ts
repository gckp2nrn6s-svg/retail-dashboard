import { NextRequest, NextResponse } from "next/server";
import { getOpenTransfers } from "@/lib/warehouse-transfers";

export const dynamic = "force-dynamic";

// GET /api/warehouse/transfers?store=&status=&from=&to=
// Open HO → store transfers grouped by doc (already-submitted docs excluded),
// ready to be picked for a PO consolidation.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filters = {
    store:  searchParams.get("store"),
    status: searchParams.get("status"),
    from:   searchParams.get("from"),
    to:     searchParams.get("to"),
  };

  try {
    const { transfers, source } = await getOpenTransfers(filters);
    return NextResponse.json({ transfers, sources: { [source]: "ok" } });
  } catch (e) {
    console.error("[warehouse/transfers]", e instanceof Error ? e.message : e);
    return NextResponse.json({ transfers: [], sources: {}, error: "Failed to load transfers" }, { status: 200 });
  }
}
