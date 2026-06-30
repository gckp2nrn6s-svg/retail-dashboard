import { NextRequest, NextResponse } from "next/server";
import { metaGet, metaMetric, hasMetaCreds } from "@/lib/meta-ads";

function mockAds() {
  return [
    { id: "ad1", headline: "Elevate Your Summer Wardrobe", body: "Discover our new collection. Free shipping over EGP 500.", format: "Video", spend: 4800, revenue: 18200, roas: 3.79, ctr: 3.4, conversions: 284, impressions: 141000, trend: [2.8, 3.1, 3.4, 3.6, 3.79, 4.1] },
    { id: "ad2", headline: "New Arrivals Just Dropped", body: "Shop the looks everyone is talking about. Limited stock.", format: "Image", spend: 3200, revenue: 9800, roas: 3.06, ctr: 2.8, conversions: 156, impressions: 114000, trend: [2.4, 2.6, 2.9, 3.1, 3.0, 3.06] },
    { id: "ad3", headline: "Style Quiz → Find Your Look", body: "Take our 60-second style quiz and get personalized picks.", format: "Carousel", spend: 2900, revenue: 11400, roas: 3.93, ctr: 4.1, conversions: 178, impressions: 70000, trend: [3.2, 3.5, 3.7, 3.8, 3.93, 4.0] },
    { id: "ad4", headline: "Last Chance — Summer Sale", body: "Up to 40% off before the season ends.", format: "Image", spend: 1900, revenue: 2200, roas: 1.16, ctr: 1.2, conversions: 34, impressions: 158000, trend: [1.8, 1.5, 1.3, 1.2, 1.1, 1.16] },
  ];
}

function detectFormat(creative: any): "Image" | "Video" | "Carousel" {
  if (!creative) return "Image";
  if (creative.video_id) return "Video";
  if (creative.object_story_spec?.link_data?.child_attachments?.length) return "Carousel";
  return "Image";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const adsetId = searchParams.get("adsetId");

  if (!adsetId) return NextResponse.json({ error: "adsetId required" }, { status: 400 });
  if (!hasMetaCreds()) return NextResponse.json(mockAds());

  const accountId = process.env.META_AD_ACCOUNT_ID!;
  const to = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const timeRange = JSON.stringify({ since: from, until: to });

  try {
    const [adsRes, insightsRes] = await Promise.all([
      metaGet<any>(`/${adsetId}/ads`, {
        fields: "id,name,effective_status,creative{id,title,body,thumbnail_url,image_url,video_id,object_story_spec}",
        limit: "50",
      }),
      metaGet<any>(`/${accountId}/insights`, {
        fields: "ad_id,spend,impressions,clicks,ctr,actions,action_values",
        time_range: timeRange,
        level: "ad",
        filtering: JSON.stringify([{ field: "adset.id", operator: "EQUAL", value: adsetId }]),
        limit: "50",
      }),
    ]);

    const insightMap = new Map<string, any>();
    for (const i of insightsRes.data ?? []) insightMap.set(i.ad_id, i);

    const ads = (adsRes.data ?? []).map((ad: any) => {
      const ins = insightMap.get(ad.id) ?? {};
      const spend = parseFloat(ins.spend ?? "0");
      const revenue = metaMetric(ins.action_values, "purchase");
      const conversions = Math.round(metaMetric(ins.actions, "purchase"));
      const impressions = parseInt(ins.impressions ?? "0");
      const roas = spend > 0 ? revenue / spend : 0;
      const creative = ad.creative ?? {};
      return {
        id: ad.id,
        adsetId,
        headline: creative.title ?? ad.name,
        body: creative.body ?? "",
        format: detectFormat(creative),
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: parseFloat(roas.toFixed(2)),
        ctr: parseFloat(parseFloat(ins.ctr ?? "0").toFixed(2)),
        conversions,
        impressions,
        trend: [],
        thumbnailUrl: creative.thumbnail_url ?? creative.image_url ?? null,
      };
    });

    return NextResponse.json(ads);
  } catch (err) {
    console.error("[marketing/ads] Meta error:", err);
    return NextResponse.json(mockAds());
  }
}
