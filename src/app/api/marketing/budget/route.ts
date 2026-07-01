import { NextRequest, NextResponse } from "next/server";
import { loadReconciliation } from "@/lib/marketing-pipeline";
import { bucketize, allocate, type CampaignForBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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

  // Need real Meta campaigns to allocate. Degrade gracefully otherwise.
  if (r.generatedBy !== "first-party" || r.campaigns.length === 0) {
    return NextResponse.json({
      ok: true,
      available: false,
      dateRange: r.dateRange,
      mer: r.mer,
      note: r.note ?? "No Meta campaign spend in this period to allocate.",
    });
  }

  // Break-even ROAS = 1 / gross margin. Without a configured margin we assume 2.0×
  // (a 50%-margin business breaks even at 2×) — clearly labeled so it can be tuned.
  const breakEven = r.mer?.breakEven ?? 2.0;
  const marginKnown = r.mer?.breakEven != null;

  const campaigns: CampaignForBudget[] = r.campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    objective: c.objective,
    spend: c.spend,
    trueRoas: c.trueRoas,
    frequency: r.frequencyById[c.id] ?? 0,
    conversions: c.metaConversions,
  }));

  const buckets = bucketize(campaigns);
  const plan = allocate(buckets, r.totalSpend, breakEven);

  return NextResponse.json({
    ok: true,
    available: true,
    dateRange: r.dateRange,
    mer: r.mer,
    marginKnown,
    plan,
  });
}
