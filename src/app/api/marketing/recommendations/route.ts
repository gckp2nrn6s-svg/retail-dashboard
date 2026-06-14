import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest) {
  const data = {
    actions: [
      {
        priority: "high",
        type: "scale",
        title: "Scale Back-to-School Meta Campaign",
        description:
          "The Back-to-School American Tourister campaign is delivering 5.30× ROAS with strong CTR of 3.0%. Increase daily budget by 40% to capture remaining season demand before September.",
        impact: "Estimated +EGP 66,800 incremental revenue over 3 weeks at current ROAS.",
        campaign: "cmp_002",
      },
      {
        priority: "high",
        type: "pause",
        title: "Pause Ramadan Eid Special Campaign",
        description:
          "The Ramadan Eid Special campaign on Google has ROAS of 1.40×, well below the 2.5× break-even threshold. Audience fatigue is evident — frequency hit 7.2×. Reallocate EGP 10,600 remaining budget to the Summer Collection campaign.",
        impact: "Prevent further EGP loss and redeploy budget to 5×+ ROAS campaigns.",
        campaign: "cmp_004",
      },
      {
        priority: "high",
        type: "scale",
        title: "Increase Retargeting Budget – Cairo Airport Segment",
        description:
          "Cart-abandonment retargeting is delivering 6.0× ROAS with only EGP 4,800 spent. This is the highest-performing ad set in the account. Budget is capped too conservatively — increase by 60% immediately.",
        impact: "Estimated +EGP 28,800 incremental revenue per month.",
        campaign: "cmp_009",
      },
      {
        priority: "medium",
        type: "adjust",
        title: "Reduce TikTok Frequency — Gen Z Cairo",
        description:
          "Ad frequency for the TikTok Gen Z Cairo 18-24 ad set has reached 8.2×, causing creative fatigue. Introduce 2 new video creatives (pack-with-me format) and set a frequency cap of 4×.",
        impact: "Expected CTR improvement from 1.0% to 1.6–1.8%, reducing CPA by ~25%.",
        campaign: "cmp_007",
      },
      {
        priority: "medium",
        type: "adjust",
        title: "Switch Google Shopping to Target ROAS Bidding",
        description:
          "The Google Shopping – Luggage All Brands campaign is currently on Manual CPC. With 648 conversions in the period, it has enough data to switch to Target ROAS bidding at 3.5× to improve efficiency.",
        impact: "Estimated 15–20% improvement in ROAS over 4-week learning period.",
        campaign: "cmp_005",
      },
      {
        priority: "medium",
        type: "test",
        title: "Test Arabic-Language Creatives on Meta",
        description:
          "All current top-performing creatives use English copy. Test Arabic headlines and body text for the Summer Collection campaign targeting Cairo Travelers 25-44. Arabic copy typically improves CTR by 20–35% in Egyptian markets.",
        impact: "Potential CTR uplift from 2.88% to 3.5%+, reducing CPC by ~18%.",
        campaign: "cmp_001",
      },
      {
        priority: "low",
        type: "test",
        title: "Launch Google Performance Max Campaign",
        description:
          "No Performance Max campaigns are currently running. Create a PMax campaign with Samsonite & American Tourister product feeds to capture cross-channel demand across Search, Shopping, Display, and YouTube.",
        impact: "Estimated 15–25% incremental conversions from untapped Google inventory.",
      },
      {
        priority: "low",
        type: "adjust",
        title: "Exclude Converted Users from Awareness Campaigns",
        description:
          "Recent purchasers (last 90 days) are not excluded from the TikTok awareness campaigns, wasting spend on already-converted users. Add a 'Purchased – 90 Days' exclusion audience.",
        impact: "Estimated 8–12% reduction in wasted spend on TikTok.",
        campaign: "cmp_007",
      },
    ],
    creativeInsights: [
      {
        insight: "Video outperforms static images by 38% in ROAS",
        detail:
          "Across all Meta campaigns, video creatives average 5.2× ROAS vs 3.8× for static images. Prioritize video production for Q3, especially short-form 15-second formats.",
      },
      {
        insight: "Carousel format drives highest CTR for product discovery",
        detail:
          "Carousel ads achieve an average CTR of 3.15% vs 2.6% for single-image ads. Use carousels for collection launches and multi-product promotions.",
      },
      {
        insight: "Urgency messaging in retargeting increases conversions by 22%",
        detail:
          "Ads using 'limited stock' or 'offer expires' language in retargeting ad sets convert 22% higher than generic reminder ads. Apply consistently to all cart-abandonment creatives.",
      },
      {
        insight: "Summer travel imagery outperforms product-only shots",
        detail:
          "Creatives showing people using luggage in travel contexts (airports, beaches, hotels) achieve 1.4× higher ROAS than plain product-on-white-background images.",
      },
    ],
    audienceInsights: [
      {
        insight: "Cairo Travelers 25-44 is the highest-value segment",
        detail:
          "This segment delivers 5.45× ROAS with low CPA of EGP 36. Expand lookalike audiences from this seed pool to 2% and 3% similarity for the Summer and Eid campaigns.",
      },
      {
        insight: "Alexandria audience significantly underfunded",
        detail:
          "The Alexandria Families 28-50 ad set delivers 4.91× ROAS but receives only 29% of campaign spend vs Cairo. Rebalance geographic budget allocation.",
      },
      {
        insight: "Discount-seeker audiences underperform in premium campaigns",
        detail:
          "Audiences with 'Discount & Sale' interests show 40% lower ROAS than travel-interest audiences. Avoid using these for Samsonite premium tier campaigns; reserve for American Tourister promotions.",
      },
      {
        insight: "Retargeting windows beyond 30 days show diminishing returns",
        detail:
          "30-day retargeting audiences convert at 3.5× vs 14-day audiences at 5.0×. Tighten retargeting windows to 7–14 days for higher-intent, lower-waste spend.",
      },
    ],
    avoidList: [
      "Running Samsonite premium campaigns to broad 'discount-seeker' interest audiences — ROAS averages 1.3× in this segment.",
      "Using frequency caps above 5× without refreshing creatives — fatigue begins at 4× and ROAS drops sharply after 6×.",
      "Generic product-on-white-background static images as primary creatives for prospecting campaigns.",
      "Running seasonal campaigns (Eid, Ramadan) beyond the seasonal window — CPAs inflate 3–4× post-holiday.",
      "Manual CPC bidding on Google Shopping with more than 500 conversions/month — switch to Target ROAS.",
      "Ignoring audience exclusions — converted users and irrelevant demographics waste 12–18% of budget across campaigns.",
      "TikTok for direct conversion campaigns targeting 35+ — this audience converts poorly on TikTok; use Meta instead.",
    ],
    doList: [
      "Prioritize video-first creative strategy across all Meta campaigns — 38% higher ROAS vs static.",
      "Create dedicated Arabic-language ad variants for all Egyptian city targeting segments.",
      "Use 1% lookalike audiences built from your top-ROAS customer segments (Cairo Travelers 25-44).",
      "Implement dayparting — 70% of Egyptian e-commerce conversions occur between 8 PM and 1 AM local time.",
      "Set up Google Shopping Product Listing Ads with separate campaigns for Samsonite vs American Tourister brands.",
      "Refresh creatives every 3–4 weeks for active ad sets with frequency above 3×.",
      "Allocate 70% of budget to proven campaigns (≥4× ROAS) and 30% to testing new audiences and formats.",
      "Add cart-abandonment email retargeting alongside Meta retargeting for users who don't engage with paid ads.",
      "Test Ramadan-specific creative angles (gifting, family travel, charitable giving) early — start campaigns 3 weeks before Ramadan.",
      "Use Google Brand Search campaigns to protect branded keywords and reduce CPA — currently delivering 5.0× ROAS.",
    ],
    dailyBrief:
      "Today's performance marketing overview for your Egyptian luggage portfolio looks strong but uneven: Meta continues to drive the majority of attributed revenue at 5.3× ROAS, led by the Back-to-School and Summer Collection campaigns, while the paused Ramadan Eid campaign on Google remains a drag on overall account efficiency at 1.4× ROAS. Your top priority today should be scaling the cart-abandonment retargeting segment (6.0× ROAS) and pausing the underperforming Ramadan campaign to free up budget — together these two moves could add an estimated EGP 95,600 in net revenue improvement this month.",
  };

  return NextResponse.json(data);
}
