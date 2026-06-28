import { NextRequest, NextResponse } from "next/server";
import { resolveCodes } from "@/lib/warehouse";

export const dynamic = "force-dynamic";

// POST { codes: string[] } → resolve item numbers / messy SKUs → item_no + description.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const codes: string[] = Array.isArray(body.codes) ? body.codes.map(String).slice(0, 2000) : [];
    return NextResponse.json({ resolved: await resolveCodes(codes) });
  } catch (e) {
    console.error("[warehouse/resolve]", e instanceof Error ? e.message : e);
    return NextResponse.json({ resolved: [], error: "resolve failed" }, { status: 200 });
  }
}
