import { NextRequest, NextResponse } from "next/server";
import { metaGet, metaMetric, metaStatus, metaObjective, hasMetaCreds } from "@/lib/meta-ads";

type Platform = "All" | "Meta" | "Google" | "TikTok";

function mockCampaigns(platform: Platform) {
  const all = [
    { id: "c1", name: "Summer Collection — Prospecting", platform: "Meta", status: "Active", objective: "Conversions", spend: 28400, revenue: 96000, roas: 3.38, ctr: 2.4, cpa: 17.2, conversions: 1651, budgetUsed: 71 },
    { id: "c2", name: "Retargeting — Cart Abandoners", platform: "Meta", status: "Active", objective: "Conversions", spend: 14200, revenue: 68400, roas: 4.82, ctr: 3.1, cpa: 11.4, conversions: 1245, budgetUsed: 88 },
    { id: "c3", name: "Brand Awareness — Reach", platform: "Meta", status: "Paused", objective: "Reach", spend: 9800, revenue: 18600, roas: 1.9, ctr: 1.2, cpa: 42.1, conversions: 233, budgetUsed: 100 },
    { id: "c4", name: "Google Search — Brand", platform: "Google", status: "Active", objective: "Conversions", spend: 18600, revenue: 82400, roas: 4.43, ctr: 5.8, cpa: 14.2, conversions: 1310, budgetUsed: 64 },
    { id: "c5", name: "Google PMax — All Products", platform: "Google", status: "Active", objective: "Sales", spend: 22100, revenue: 58700, roas: 2.66, ctr: 1.9, cpa: 22.8, conversions: 969, budgetUsed: 79 },
    { id: "c6", name: "TikTok — UGC Spark Ads", platform: "TikTok", status: "Active", objective: "Conversions", spend: 16400, revenue: 51200, roas: 3.12, ctr: 2.8, cpa: 19.4, conversions: 845, budgetUsed: 55 },
    { id: "c7", name: "TikTok — Creator Partnership", platform: "TikTok", status: "Ended", objective: "Awareness", spend: 8200, revenue: 6400, roas: 0.78, ctr: 4.1, cpa: 68.3, conversions: 120, budgetUsed: 100 },
  ];
  if (platform === "All") return all;
  return all.filter((c) => c.platform === platform);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const to = searchParams.get("to") ?? new Date().toISOString().split("T")[0];
  const platform = (searchParams.get("platform") ?? "All") as Platform;
  const status = searchParams.get("status");

  // Google/TikTok not connected yet — return empty so mock campaigns below stay Meta-only in All view
  if (!hasMetaCreds() || (platform !== "All" && platform !== "Meta")) {
    return NextResponse.json(mockCampaigns(platform));
  }

  const accountId = process.env.META_AD_ACCOUNT_ID!;

  try {
    const timeRange = JSON.stringify({ since: from, until: to });

    const [campsRes, insightsRes] = await Promise.all([
      metaGet<any>(`/${accountId}/campaigns`, {
        fields: "id,name,effective_status,objective,daily_budget,lifetime_budget",
        limit: "100",
      }),
      metaGet<any>(`/${accountId}/insights`, {
        fields: "campaign_id,spend,impressions,clicks,ctr,cpc,actions,action_values",
        time_range: timeRange,
        level: "campaign",
        limit: "100",
      }),
    ]);

    const insightMap = new Map<string, any>();
    for (const i of insightsRes.data ?? []) insightMap.set(i.campaign_id, i);

    const campaigns = (campsRes.data ?? []).map((c: any) => {
      const ins = insightMap.get(c.id) ?? {};
      const spend = parseFloat(ins.spend ?? "0");
      const revenue = metaMetric(ins.action_values, "purchase");
      const conversions = Math.round(metaMetric(ins.actions, "purchase"));
      const roas = spend > 0 ? revenue / spend : 0;
      const ctr = parseFloat(ins.ctr ?? "0");
      const cpa = conversions > 0 ? spend / conversions : 0;

      // Budgets come back in minor currency units (piastres) — divide by 100
      const budgetRaw = parseFloat(c.lifetime_budget ?? c.daily_budget ?? "0") / 100;
      const budgetUsed = budgetRaw > 0 ? Math.min(100, (spend / budgetRaw) * 100) : 0;

      const mapped = {
        id: c.id,
        name: c.name,
        platform: "Meta" as const,
        status: metaStatus(c.effective_status ?? "PAUSED"),
        objective: metaObjective(c.objective ?? ""),
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: parseFloat(roas.toFixed(2)),
        ctr: parseFloat(ctr.toFixed(2)),
        cpa: parseFloat(cpa.toFixed(2)),
        conversions,
        budgetUsed: parseFloat(budgetUsed.toFixed(1)),
      };
      return mapped;
    }).filter((c: any) => {
      if (status && c.status.toLowerCase() !== status.toLowerCase()) return false;
      return true;
    });

    return NextResponse.json(campaigns);
  } catch (err) {
    console.error("[marketing/campaigns] Meta error:", err);
    return NextResponse.json(mockCampaigns(platform));
  }
}
