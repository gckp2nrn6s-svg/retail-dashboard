import { NextRequest, NextResponse } from "next/server";

function generateDailyTrend(from: string, to: string) {
  const start = new Date(from);
  const end = new Date(to);
  const days: { date: string; spend: number; revenue: number; roas: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const spend = Math.round(2800 + Math.random() * 2400);
    const roas = parseFloat((2.1 + Math.random() * 2.8).toFixed(2));
    const revenue = Math.round(spend * roas);
    days.push({
      date: cursor.toISOString().split("T")[0],
      spend,
      revenue,
      roas,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "2025-05-15";
  const to = searchParams.get("to") ?? "2025-06-14";

  const dailyTrend = generateDailyTrend(from, to);

  const spend = dailyTrend.reduce((s, d) => s + d.spend, 0);
  const revenue = dailyTrend.reduce((s, d) => s + d.revenue, 0);
  const roas = parseFloat((revenue / spend).toFixed(2));
  const impressions = Math.round(spend * 180 + Math.random() * 50000);
  const clicks = Math.round(impressions * 0.028);
  const ctr = parseFloat(((clicks / impressions) * 100).toFixed(2));
  const conversions = Math.round(clicks * 0.031);
  const cpc = parseFloat((spend / clicks).toFixed(2));
  const cpa = parseFloat((spend / conversions).toFixed(2));

  const data = {
    spend,
    revenue,
    roas,
    impressions,
    clicks,
    ctr,
    cpc,
    cpa,
    conversions,
    platforms: [
      {
        name: "Meta",
        spend: Math.round(spend * 0.58),
        revenue: Math.round(revenue * 0.61),
        roas: parseFloat((revenue * 0.61 / (spend * 0.58)).toFixed(2)),
        impressions: Math.round(impressions * 0.62),
        clicks: Math.round(clicks * 0.59),
        conversions: Math.round(conversions * 0.63),
      },
      {
        name: "Google",
        spend: Math.round(spend * 0.34),
        revenue: Math.round(revenue * 0.32),
        roas: parseFloat((revenue * 0.32 / (spend * 0.34)).toFixed(2)),
        impressions: Math.round(impressions * 0.28),
        clicks: Math.round(clicks * 0.33),
        conversions: Math.round(conversions * 0.31),
      },
      {
        name: "TikTok",
        spend: Math.round(spend * 0.08),
        revenue: Math.round(revenue * 0.07),
        roas: parseFloat((revenue * 0.07 / (spend * 0.08)).toFixed(2)),
        impressions: Math.round(impressions * 0.10),
        clicks: Math.round(clicks * 0.08),
        conversions: Math.round(conversions * 0.06),
      },
    ],
    dailyTrend,
    topCreative: {
      id: "cr_001",
      name: "Samsonite Lite-Box – Summer Escape Video",
      thumbnail: "https://placehold.co/320x180/1a1a2e/ffffff?text=Samsonite+Summer",
      spend: 18400,
      roas: 5.12,
      ctr: 4.71,
    },
    alerts: [
      {
        level: "danger",
        message: "Ramadan Eid campaign ROAS dropped below 1.5× — consider pausing or reallocating budget.",
      },
      {
        level: "warning",
        message: "TikTok ad frequency exceeds 6× for the 18-24 Cairo segment — audience fatigue risk.",
      },
      {
        level: "good",
        message: "Back-to-School Meta carousel is outperforming benchmarks with 5.3× ROAS — scale budget.",
      },
      {
        level: "warning",
        message: "Google Shopping CPC rose 18% week-over-week — review bidding strategy.",
      },
    ],
  };

  return NextResponse.json(data);
}
