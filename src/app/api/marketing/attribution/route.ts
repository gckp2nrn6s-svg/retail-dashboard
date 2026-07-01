import { NextRequest, NextResponse } from "next/server";
import { loadReconciliation } from "@/lib/marketing-pipeline";

// First-party revenue is live and reconciliation is per-request — never cache.
export const dynamic = "force-dynamic";

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Parse a gross-margin input: accepts 0.55, "55", or "55%" → 0.55. */
function parseMargin(raw: string | null): number | undefined {
  const v = raw ?? process.env.MARKETING_GROSS_MARGIN ?? "";
  if (!v) return undefined;
  const n = parseFloat(String(v).replace("%", ""));
  if (!isFinite(n) || n <= 0) return undefined;
  return n > 1 ? n / 100 : n;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to") ?? isoDay(new Date());
  const from = searchParams.get("from") ?? isoDay(new Date(Date.now() - 30 * DAY));
  const margin = parseMargin(searchParams.get("margin"));

  const r = await loadReconciliation(from, to, margin);
  return NextResponse.json({
    ok: r.ok,
    generatedBy: r.generatedBy,
    dateRange: r.dateRange,
    mer: r.mer,
    coverage: r.coverage,
    channels: r.channels,
    campaigns: r.campaigns,
    taggingIssues: r.taggingIssues,
    note: r.note,
  });
}
