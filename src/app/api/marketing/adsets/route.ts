import { NextRequest, NextResponse } from "next/server";
import { metaGet, metaMetric, hasMetaCreds } from "@/lib/meta-ads";

function mockAdSets() {
  return [
    { id: "as1", name: "Lookalike 1% — Purchasers", audience: "LAL 1% Buyers", spend: 9200, revenue: 34000, roas: 3.7, reach: 280000, frequency: 2.4, ctr: 2.8, conversions: 534 },
    { id: "as2", name: "Interest — Fashion & Style", audience: "Fashion Interest", spend: 7800, revenue: 24600, roas: 3.15, reach: 420000, frequency: 1.9, ctr: 2.1, conversions: 388 },
    { id: "as3", name: "Broad — 25-44", audience: "Broad Demo", spend: 6100, revenue: 14800, roas: 2.43, reach: 680000, frequency: 1.4, ctr: 1.6, conversions: 218 },
    { id: "as4", name: "Retargeting — Video Viewers 50%+", audience: "Video Viewers", spend: 5300, revenue: 22600, roas: 4.26, reach: 94000, frequency: 3.8, ctr: 4.2, conversions: 311 },
  ];
}

function audienceLabel(targeting: any): string {
  if (!targeting) return "Egypt";
  const parts: string[] = [];
  const cities = targeting.geo_locations?.cities?.map((c: any) => c.name) ?? [];
  const countries = targeting.geo_locations?.countries ?? [];
  if (cities.length) parts.push(cities.slice(0, 2).join(", "));
  else if (countries.length) parts.push(countries.join(", "));
  if (targeting.age_min && targeting.age_max) parts.push(`${targeting.age_min}-${targeting.age_max}`);
  return parts.join(", ") || "Egypt";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");

  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  if (!hasMetaCreds()) return NextResponse.json(mockAdSets());

  const accountId = process.env.META_AD_ACCOUNT_ID!;
  const to = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const timeRange = JSON.stringify({ since: from, until: to });

  try {
    const [adsetsRes, insightsRes] = await Promise.all([
      metaGet<any>(`/${campaignId}/adsets`, {
        fields: "id,name,effective_status,targeting",
        limit: "50",
      }),
      metaGet<any>(`/${accountId}/insights`, {
        fields: "adset_id,spend,impressions,clicks,ctr,actions,action_values,reach,frequency",
        time_range: timeRange,
        level: "adset",
        filtering: JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]),
        limit: "50",
      }),
    ]);

    const insightMap = new Map<string, any>();
    for (const i of insightsRes.data ?? []) insightMap.set(i.adset_id, i);

    const adsets = (adsetsRes.data ?? []).map((as: any) => {
      const ins = insightMap.get(as.id) ?? {};
      const spend = parseFloat(ins.spend ?? "0");
      const revenue = metaMetric(ins.action_values, "purchase");
      const conversions = Math.round(metaMetric(ins.actions, "purchase"));
      const roas = spend > 0 ? revenue / spend : 0;
      return {
        id: as.id,
        campaignId,
        name: as.name,
        audience: audienceLabel(as.targeting),
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: parseFloat(roas.toFixed(2)),
        ctr: parseFloat(parseFloat(ins.ctr ?? "0").toFixed(2)),
        conversions,
        reach: parseInt(ins.reach ?? "0"),
        frequency: parseFloat(parseFloat(ins.frequency ?? "0").toFixed(1)),
      };
    });

    return NextResponse.json(adsets);
  } catch (err) {
    console.error("[marketing/adsets] Meta error:", err);
    return NextResponse.json(mockAdSets());
  }
}
