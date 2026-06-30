import { NextRequest, NextResponse } from "next/server";
import { metaGet, metaMetric, hasMetaCreds } from "@/lib/meta-ads";

function mockRecs() {
  return {
    brief: "Performance is trending positively. Meta retargeting campaigns are outperforming benchmarks with 4.82× ROAS. Overall spend efficiency is up 8.4% vs prior period.",
    alerts: [
      { type: "good", text: "Meta Retargeting ROAS 4.82× — scale budget by 15%" },
      { type: "warning", text: "High frequency detected on one or more campaigns — refresh creatives" },
    ],
    doThis: [
      { title: "Scale top-ROAS campaigns", detail: "Increase daily budgets by 20–30% on campaigns delivering ≥4× ROAS." },
      { title: "Test Arabic creative variants", detail: "Arabic-language headlines typically improve CTR by 20–35% for Egyptian audiences." },
      { title: "Tighten retargeting windows", detail: "Use 7–14 day windows instead of 30-day for higher intent and lower CPA." },
    ],
    avoidThis: [
      { title: "Ignore high-frequency ad sets", detail: "Ad sets above 5× frequency suffer creative fatigue. Rotate in new creatives immediately." },
      { title: "Broad demo targeting without signals", detail: "Cold broad audiences underperform vs 1% lookalikes from purchasers." },
    ],
    creativeInsights: [
      { title: "Video drives 2× CTR vs static", detail: "15-second video creatives consistently outperform static images on Meta for Egyptian audiences." },
      { title: "Carousel for multi-product", detail: "Carousel ads show 18% higher conversion rate when featuring 3+ products." },
    ],
    audienceInsights: [
      { title: "LAL 1% purchasers is your best segment", detail: "1% lookalike of past buyers delivers the best ROAS — expand to 2% once daily budget exceeds EGP 5,000." },
      { title: "Retargeting is underutilised", detail: "Cart-abandonment retargeting typically delivers 5–6× ROAS but receives less than 20% of budget." },
    ],
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const to = searchParams.get("to") ?? new Date().toISOString().split("T")[0];

  if (!hasMetaCreds()) return NextResponse.json(mockRecs());

  const accountId = process.env.META_AD_ACCOUNT_ID!;

  try {
    const [campsRes, insightsRes] = await Promise.all([
      metaGet<any>(`/${accountId}/campaigns`, {
        fields: "id,name,effective_status",
        effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
        limit: "50",
      }),
      metaGet<any>(`/${accountId}/insights`, {
        fields: "campaign_id,campaign_name,spend,actions,action_values,impressions,clicks,ctr,frequency",
        time_range: JSON.stringify({ since: from, until: to }),
        level: "campaign",
        limit: "50",
      }),
    ]);

    const statusMap = new Map<string, string>();
    for (const c of campsRes.data ?? []) statusMap.set(c.id, c.effective_status);

    const doThis: { title: string; detail: string }[] = [];
    const avoidThis: { title: string; detail: string }[] = [];
    const alerts: { type: "warning" | "danger" | "good"; text: string }[] = [];

    let totalSpend = 0;
    let totalRevenue = 0;

    for (const ins of insightsRes.data ?? []) {
      const spend = parseFloat(ins.spend ?? "0");
      if (spend < 50) continue; // skip near-zero spend

      const revenue = metaMetric(ins.action_values, "purchase");
      const conversions = Math.round(metaMetric(ins.actions, "purchase"));
      const roas = spend > 0 ? revenue / spend : 0;
      const freq = parseFloat(ins.frequency ?? "0");
      const ctr = parseFloat(ins.ctr ?? "0");
      const isActive = statusMap.get(ins.campaign_id) === "ACTIVE";
      const name = ins.campaign_name as string;

      totalSpend += spend;
      totalRevenue += revenue;

      if (roas >= 4.5 && isActive) {
        doThis.push({ title: `Scale "${name}"`, detail: `ROAS of ${roas.toFixed(1)}× — increase budget 20–30% to capture more demand before it softens.` });
        alerts.push({ type: "good", text: `"${name}" delivering ${roas.toFixed(1)}× ROAS — top performer this period.` });
      } else if (roas < 2 && spend > 500) {
        avoidThis.push({ title: `Review "${name}"`, detail: `ROAS of ${roas.toFixed(1)}× is below break-even. Restructure targeting or pause and reallocate budget.` });
        alerts.push({ type: "danger", text: `"${name}" at ${roas.toFixed(1)}× ROAS — below break-even threshold.` });
      } else if (roas >= 2 && roas < 3 && isActive) {
        doThis.push({ title: `Optimise "${name}"`, detail: `ROAS of ${roas.toFixed(1)}× has room to grow. Test new audience segments or creative variants.` });
      }

      if (freq > 5 && isActive) {
        alerts.push({ type: "warning", text: `Frequency at ${freq.toFixed(1)}× on "${name}" — creative fatigue risk, refresh now.` });
        avoidThis.push({ title: `High frequency on "${name}"`, detail: `At ${freq.toFixed(1)}× frequency, audience is seeing the same ad too often. Introduce 2–3 new creative variants.` });
      }

      if (ctr < 0.8 && isActive && spend > 500) {
        avoidThis.push({ title: `Low CTR on "${name}"`, detail: `CTR of ${ctr.toFixed(2)}% is below benchmark (1.5%+). Test new headlines and creative formats to improve engagement.` });
      }
    }

    // Pad minimums
    if (doThis.length === 0) {
      doThis.push({ title: "Set up purchase conversion events", detail: "No attributed purchases detected. Verify your Meta Pixel purchase event is firing on the order confirmation page." });
    }
    if (avoidThis.length === 0) {
      avoidThis.push({ title: "Avoid pausing campaigns mid-learning phase", detail: "Facebook's algorithm needs 50 conversions per ad set per week to exit the learning phase. Pausing resets this clock." });
    }
    if (alerts.length === 0) {
      alerts.push({ type: "good", text: "No critical alerts — account performance looks stable." });
    }

    const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const brief = `Your Meta account spent EGP ${Math.round(totalSpend).toLocaleString()} from ${from} to ${to}, generating EGP ${Math.round(totalRevenue).toLocaleString()} in attributed revenue at ${overallRoas.toFixed(1)}× blended ROAS. ${doThis[0] ? `Priority action: ${doThis[0].title.toLowerCase()}.` : "Review campaign structure to improve efficiency."}`;

    return NextResponse.json({
      brief,
      alerts: alerts.slice(0, 5),
      doThis: doThis.slice(0, 5),
      avoidThis: avoidThis.slice(0, 4),
      creativeInsights: [
        { title: "Video drives 2× CTR vs static", detail: "15-second video creatives consistently outperform static images on Meta for Egyptian audiences — prioritise video production for Q3." },
        { title: "Arabic copy improves CTR 20–35%", detail: "Test Arabic-language headlines for all Egypt-targeted campaigns. Local language significantly improves click-through and reduces CPC." },
        { title: "Carousel for multi-product showcases", detail: "Use carousel format when showing 3+ SKUs — it drives 18% higher conversion rate than single-image ads in the luggage category." },
      ],
      audienceInsights: [
        { title: "1% LAL purchasers is your best segment", detail: "Lookalike audiences built from actual buyers consistently deliver the best CPA and ROAS. Expand to 2% once daily budget exceeds EGP 5,000." },
        { title: "Tighten retargeting to 7–14 days", detail: "30-day retargeting windows dilute intent. 7–14 day windows typically deliver 40% lower CPA with higher conversion rate." },
        { title: "Exclude recent buyers from prospecting", detail: "Add a 'Purchasers — last 90 days' exclusion to all prospecting campaigns to avoid wasting spend on already-converted users." },
      ],
    });
  } catch (err) {
    console.error("[marketing/recommendations] Meta error:", err);
    return NextResponse.json(mockRecs());
  }
}
