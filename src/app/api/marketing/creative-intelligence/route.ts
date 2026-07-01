import { NextRequest, NextResponse } from "next/server";
import { metaGet, metaMetric, hasMetaCreds } from "@/lib/meta-ads";
import { getAttributedOrders } from "@/lib/shopify";
import { attributeOrders, rollupByAd } from "@/lib/attribution";
import Anthropic from "@anthropic-ai/sdk";

// The designer brain runs on Opus (on-demand, deep reasoning). The always-on
// dashboard advice stays on Sonnet; the reconciliation numbers use no LLM at all.
const BRIEF_MODEL = "claude-opus-4-8";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdPerf {
  id: string;
  name: string;
  format: "Video" | "Image" | "Carousel";
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  conversions: number;
  impressions: number;
  frequency: number;
  headline: string;
  body: string;
  thumbnailUrl: string | null;
  /** "shopify" = ROAS from real attributed orders; "meta" = pixel-reported fallback. */
  revenueSource?: "shopify" | "meta";
}

interface FormatSummary {
  format: string;
  avgRoas: number;
  totalSpend: number;
  count: number;
}

interface CreativeBrief {
  campaign_concept: string;
  hero_format: string;
  format_breakdown: { format: string; allocation: number; reason: string }[];
  visual_direction: {
    scene: string;
    do: string[];
    avoid: string[];
    color_palette: { hex: string; role: string; why: string }[];
    reference: string;
  };
  copy_direction: {
    arabic_headlines: string[];
    english_headlines: string[];
    body_copy: string;
    cta: string;
    copy_rules: string[];
  };
  audience_targeting: {
    primary: string;
    secondary: string;
    avoid: string;
  };
  placement_specs: { placement: string; dimensions: string; safe_zone: string; notes: string }[];
  urgency_score: number;
  urgency_reason: string;
  confidence_score: number;
  data_basis: string;
}

interface AnalysisPayload {
  topAds: AdPerf[];
  bottomAds: AdPerf[];
  formatSummary: FormatSummary[];
  fatigueAds: AdPerf[];
  dateRange: { from: string; to: string };
  totalSpend: number;
  totalRevenue: number;
  blendedRoas: number;
  adsCount: number;
}

// ─── Mock data (used when Meta creds are absent) ─────────────────────────────

function mockAdPerf(): AdPerf[] {
  return [
    { id: "ad1", name: "Samsonite Cosmolite — Lifestyle Video 15s", format: "Video", spend: 8400, revenue: 38220, roas: 4.55, ctr: 3.8, conversions: 312, impressions: 210000, frequency: 2.1, headline: "السفر بأناقة مع سامسونايت", body: "حقائب فاخرة تدوم معك كل رحلة. شحن مجاني فوق 500 جنيه.", thumbnailUrl: null },
    { id: "ad2", name: "American Tourister Spinner — Carousel 4-card", format: "Carousel", spend: 6200, revenue: 24428, roas: 3.94, ctr: 4.2, conversions: 198, impressions: 148000, frequency: 2.8, headline: "اختر لونك — 8 ألوان جديدة", body: "تشكيلة الصيف وصلت. تسوّق الآن قبل ما تخلص.", thumbnailUrl: null },
    { id: "ad3", name: "Luxury Travel Retargeting — Static Image", format: "Image", spend: 3100, revenue: 11377, roas: 3.67, ctr: 2.9, conversions: 89, impressions: 107000, frequency: 3.4, headline: "Carry the World in Style", body: "Le Souverain — Egypt's #1 premium luggage destination.", thumbnailUrl: null },
    { id: "ad4", name: "Cosmolite 360° — Video 30s Feature", format: "Video", spend: 5800, revenue: 19836, roas: 3.42, ctr: 3.1, conversions: 154, impressions: 187000, frequency: 2.3, headline: "ليست مجرد شنطة — دي تجربة", body: "360 درجة. 4 عجلات. خامة ألمانية. اكتشف Cosmolite.", thumbnailUrl: null },
    { id: "ad5", name: "Back to School Bundle — Carousel 3-card", format: "Carousel", spend: 4400, revenue: 14564, roas: 3.31, ctr: 3.7, conversions: 122, impressions: 119000, frequency: 1.9, headline: "بقى الوقت — العروض مش هتستنى", body: "حقيبة + تروللي + محفظة سفر. وفّر أكتر.", thumbnailUrl: null },
    { id: "ad6", name: "Summer Flash Sale — Static Image", format: "Image", spend: 2900, revenue: 8323, roas: 2.87, ctr: 2.2, conversions: 67, impressions: 132000, frequency: 4.1, headline: "تخفيضات الصيف — حتى 40%", body: "عروض محدودة. اطلب دلوقتي.", thumbnailUrl: null },
    { id: "ad7", name: "Brand Story — Video 60s", format: "Video", spend: 4100, revenue: 11439, roas: 2.79, ctr: 1.8, conversions: 88, impressions: 228000, frequency: 2.7, headline: "Since 1910 — A Century of Travel", body: "Samsonite has been the world's trusted travel companion for over 100 years.", thumbnailUrl: null },
    { id: "ad8", name: "Generic Promo — Static Image ENG", format: "Image", spend: 3600, revenue: 4680, roas: 1.30, ctr: 1.1, conversions: 31, impressions: 327000, frequency: 5.8, headline: "Great Deals on Luggage", body: "Shop now for the best prices.", thumbnailUrl: null },
    { id: "ad9", name: "Wide Audience Prospecting — Video", format: "Video", spend: 5200, revenue: 6344, roas: 1.22, ctr: 0.9, conversions: 28, impressions: 578000, frequency: 1.6, headline: "Discover Le Souverain", body: "Premium luggage for every journey.", thumbnailUrl: null },
    { id: "ad10", name: "Discounts — Carousel No Creative Hook", format: "Carousel", spend: 2800, revenue: 2212, roas: 0.79, ctr: 0.7, conversions: 12, impressions: 400000, frequency: 6.2, headline: "Sale Sale Sale", body: "Big discounts. Limited time.", thumbnailUrl: null },
  ];
}

// ─── Format detection ─────────────────────────────────────────────────────────

function detectFormat(creative: any): "Image" | "Video" | "Carousel" {
  if (!creative) return "Image";
  if (creative.video_id) return "Video";
  if (creative.object_story_spec?.link_data?.child_attachments?.length) return "Carousel";
  return "Image";
}

// ─── Fetch real Meta ad data ──────────────────────────────────────────────────

async function fetchMetaAds(from: string, to: string): Promise<AdPerf[]> {
  const accountId = process.env.META_AD_ACCOUNT_ID!;
  const timeRange = JSON.stringify({ since: from, until: to });

  const [adsRes, insightsRes] = await Promise.all([
    metaGet<any>(`/${accountId}/ads`, {
      fields: "id,name,effective_status,creative{id,title,body,thumbnail_url,image_url,video_id,object_story_spec}",
      limit: "100",
    }),
    metaGet<any>(`/${accountId}/insights`, {
      fields: "ad_id,spend,impressions,clicks,ctr,actions,action_values,frequency",
      time_range: timeRange,
      level: "ad",
      limit: "100",
    }),
  ]);

  const insightMap = new Map<string, any>();
  for (const i of insightsRes.data ?? []) insightMap.set(i.ad_id, i);

  return (adsRes.data ?? [])
    .map((ad: any): AdPerf => {
      const ins = insightMap.get(ad.id) ?? {};
      const spend = parseFloat(ins.spend ?? "0");
      const revenue = metaMetric(ins.action_values, "purchase");
      const conversions = Math.round(metaMetric(ins.actions, "purchase"));
      const impressions = parseInt(ins.impressions ?? "0");
      const roas = spend > 0 ? revenue / spend : 0;
      const creative = ad.creative ?? {};
      return {
        id: ad.id,
        name: ad.name,
        format: detectFormat(creative),
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: parseFloat(roas.toFixed(2)),
        ctr: parseFloat(parseFloat(ins.ctr ?? "0").toFixed(2)),
        conversions,
        impressions,
        frequency: parseFloat(parseFloat(ins.frequency ?? "0").toFixed(1)),
        headline: creative.title ?? ad.name,
        body: creative.body ?? "",
        thumbnailUrl: creative.thumbnail_url ?? creative.image_url ?? null,
      };
    })
    .filter((ad: AdPerf) => ad.spend > 0);
}

// ─── Ground ad ROAS in real Shopify orders ───────────────────────────────────
// Meta's per-ad revenue is modeled (unreliable post-iOS14). Where an ad's id shows
// up in Shopify orders (via utm_content), we replace its revenue/ROAS with the real
// attributed figure — so the brief's "winning format" is decided by money in the
// bank, not the pixel's guess. Ads with no matched orders keep Meta's number as a
// clearly-flagged fallback. Window MUST match the ads' insight window.
async function applyTrueRoas(
  ads: AdPerf[],
  from: string,
  to: string,
): Promise<{ ads: AdPerf[]; verifiedAds: number; verifiedRevenue: number }> {
  try {
    const attrs = attributeOrders(await getAttributedOrders(from, to));
    const byAd = rollupByAd(attrs);
    let verifiedAds = 0;
    let verifiedRevenue = 0;
    const out = ads.map((ad): AdPerf => {
      const s = byAd.get(ad.id);
      if (s && s.revenue > 0) {
        verifiedAds++;
        verifiedRevenue += s.revenue;
        const trueRoas = ad.spend > 0 ? s.revenue / ad.spend : 0;
        return {
          ...ad,
          revenue: Math.round(s.revenue),
          roas: parseFloat(trueRoas.toFixed(2)),
          conversions: s.orders, // real orders beat modeled conversions
          revenueSource: "shopify",
        };
      }
      return { ...ad, revenueSource: "meta" };
    });
    return { ads: out, verifiedAds, verifiedRevenue: Math.round(verifiedRevenue) };
  } catch (e) {
    console.error("[creative-intelligence] true-ROAS join failed, using Meta revenue:", e instanceof Error ? e.message : e);
    return { ads, verifiedAds: 0, verifiedRevenue: 0 };
  }
}

// ─── Analyse ad data ──────────────────────────────────────────────────────────

function analyse(ads: AdPerf[], from: string, to: string): AnalysisPayload {
  const sorted = [...ads].sort((a, b) => b.roas - a.roas);
  const topAds = sorted.slice(0, 10);
  const bottomAds = sorted.slice(-5).reverse();
  const fatigueAds = ads.filter((a) => a.frequency > 4);

  // Format summary
  const fmtMap = new Map<string, { totalRevenue: number; totalSpend: number; count: number }>();
  for (const ad of ads) {
    const e = fmtMap.get(ad.format) ?? { totalRevenue: 0, totalSpend: 0, count: 0 };
    e.totalRevenue += ad.revenue;
    e.totalSpend += ad.spend;
    e.count += 1;
    fmtMap.set(ad.format, e);
  }

  const formatSummary: FormatSummary[] = Array.from(fmtMap.entries()).map(([format, v]) => ({
    format,
    avgRoas: v.totalSpend > 0 ? parseFloat((v.totalRevenue / v.totalSpend).toFixed(2)) : 0,
    totalSpend: v.totalSpend,
    count: v.count,
  }));

  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalRevenue = ads.reduce((s, a) => s + a.revenue, 0);

  return {
    topAds,
    bottomAds,
    formatSummary,
    fatigueAds,
    dateRange: { from, to },
    totalSpend,
    totalRevenue,
    blendedRoas: totalSpend > 0 ? parseFloat((totalRevenue / totalSpend).toFixed(2)) : 0,
    adsCount: ads.length,
  };
}

// ─── Rule-based fallback brief (no Claude key) ───────────────────────────────

function ruleBasedBrief(payload: AnalysisPayload): CreativeBrief {
  const { topAds, bottomAds, formatSummary, fatigueAds, dateRange } = payload;
  const totalAds = payload.adsCount;

  const bestFmt = [...formatSummary].sort((a, b) => b.avgRoas - a.avgRoas)[0];
  const worstFmt = [...formatSummary].sort((a, b) => a.avgRoas - b.avgRoas)[0];
  const top1 = topAds[0];
  const top3 = topAds.slice(0, 3);

  const videoFmt = formatSummary.find((f) => f.format === "Video");
  const imageFmt = formatSummary.find((f) => f.format === "Image");
  const carouselFmt = formatSummary.find((f) => f.format === "Carousel");

  const videoRoas = videoFmt?.avgRoas ?? 0;
  const imageRoas = imageFmt?.avgRoas ?? 0;
  const carouselRoas = carouselFmt?.avgRoas ?? 0;

  const topHasArabic = top3.some((a) => /[؀-ۿ]/.test(a.headline + a.body));
  const bottomHasArabic = bottomAds.some((a) => /[؀-ۿ]/.test(a.headline + a.body));

  const urgencyScore = fatigueAds.length > 2 ? 9 : fatigueAds.length > 0 ? 7 : 5;
  const hasHighFreq = fatigueAds.some((a) => a.frequency > 5);

  // Allocations based on format ROAS
  const formats = [
    { format: "15s Vertical Video", baseRoas: videoRoas, tag: "Video" },
    { format: "Carousel 3-card", baseRoas: carouselRoas, tag: "Carousel" },
    { format: "Static Image", baseRoas: imageRoas, tag: "Image" },
  ].sort((a, b) => b.baseRoas - a.baseRoas);

  const [first, second, third] = formats;
  const formatBreakdown = [
    { format: first.format, allocation: 60, reason: `${first.tag} is top format at ${first.baseRoas.toFixed(1)}× ROAS — lead with it` },
    { format: second.format, allocation: 30, reason: `${second.tag} at ${second.baseRoas.toFixed(1)}× ROAS supports reach and retargeting` },
    { format: third.format, allocation: 10, reason: `${third.tag} at ${third.baseRoas.toFixed(1)}× ROAS — use for A/B testing only` },
  ];

  const topAdRef = top1
    ? `"${top1.name}" (${top1.roas.toFixed(1)}× ROAS, ${top1.ctr.toFixed(1)}% CTR) — replicate its ${top1.format.toLowerCase()} format and hook approach.`
    : "Replicate the structure and energy of your top performing ads.";

  const avoidRef = bottomAds[0]
    ? `Avoid the approach in "${bottomAds[0].name}" which only achieved ${bottomAds[0].roas.toFixed(1)}× ROAS.`
    : "Avoid generic copy and broad targeting without a specific hook.";

  return {
    campaign_concept:
      "A confidence-led luxury travel campaign positioning Le Souverain as the definitive choice for Egyptians who travel with intent — elegant visuals, Arabic-first copy, and product-hero storytelling.",
    hero_format: `${bestFmt?.format ?? "Video"} — delivering ${bestFmt?.avgRoas.toFixed(1) ?? "~4"}× blended ROAS vs ${worstFmt?.avgRoas.toFixed(1) ?? "~1.2"}× for ${worstFmt?.format ?? "the weakest format"}. Lead every campaign with this format.`,
    format_breakdown: formatBreakdown,
    visual_direction: {
      scene:
        "A stylish Egyptian woman in her 30s wheels a Samsonite Cosmolite through a sunlit airport terminal. She moves with calm authority. The suitcase reflects the terminal lights. Close-up on the spinner wheels in motion. Cut to her face — confident smile. Product floated in the final frame with logo lock-up.",
      do: [
        "Show the product in motion — spinning wheels, zippers opening — not static on a white background",
        "Feature a relatable Egyptian protagonist (25–40 age range, stylish but not out-of-reach)",
        "Use natural warm Arabic daylight or golden-hour airport/travel environments",
        topHasArabic ? "Lead with Arabic headline as first text on screen — top performers do this" : "Test Arabic-first headline overlays",
        "Cut to product hero in the final 3 seconds with clear logo and CTA overlay",
      ],
      avoid: [
        worstFmt ? `Avoid pure ${worstFmt.format.toLowerCase()} ads without a narrative hook — ${worstFmt.avgRoas.toFixed(1)}× ROAS confirms this underperforms` : "Avoid static product-only shots without context or story",
        "Avoid long copy in the visual — if text overlays are used, keep under 5 words",
        bottomHasArabic ? "Avoid English-only ads targeting Egyptian audiences — your worst performers use English only" : "Avoid copy that doesn't resonate with Egyptian travel culture",
        "Avoid white-background studio-only shots — lifestyle outperforms catalogue",
        hasHighFreq ? `Avoid reusing creative from fatigued ad sets (${fatigueAds[0]?.name ?? "high-frequency ads"} is at ${fatigueAds[0]?.frequency.toFixed(1) ?? "5+"}× frequency)` : "Avoid repurposing the same creative across too many audiences",
      ],
      color_palette: [
        { hex: "#1B2A4A", role: "primary", why: "Navy conveys premium travel — appears in top-performing lifestyle ads" },
        { hex: "#C9A84C", role: "secondary", why: "Gold accent signals luxury positioning — consistent with Samsonite brand system" },
        { hex: "#F5F0E8", role: "accent", why: "Warm off-white gives breathing room without sterile white-bg look that underperforms" },
      ],
      reference: topAdRef,
    },
    copy_direction: {
      arabic_headlines: [
        "سافر بأناقة — سامسونايت بيصحبك في كل رحلة",
        "مش بس شنطة — ده أسلوب حياة",
        "خليك الأول — تشكيلة الصيف وصلت",
      ],
      english_headlines: [
        "Travel is Your Statement — Make It Count",
        "Built for Every Journey. Designed for Egypt.",
        "Le Souverain — Where Luxury Meets the Road",
      ],
      body_copy:
        "Keep body copy under 90 characters for feed placements — top performers average 65–80 characters. Lead with the product benefit (durability, style, freedom) before the promotional hook. Pair Arabic headline with bilingual body when targeting mixed-language audiences.",
      cta: "تسوّق دلوقتي",
      copy_rules: [
        topHasArabic ? "Arabic headline FIRST — your top ads by ROAS use Arabic-lead copy" : "Test Arabic-first headlines — data suggests higher CTR for Egyptian audiences",
        "Keep primary text under 90 characters — audience drops off on longer copy in feed",
        "Use urgency triggers sparingly — only when there is a genuine scarcity event (sale ending, limited stock)",
        "Avoid all-caps — it reads as low-quality and depresses CTR vs sentence case",
        "Include one concrete product feature in the copy (4 wheels, lightweight, TSA lock) — specificity converts better than generic luxury claims",
      ],
    },
    audience_targeting: {
      primary: top1
        ? `Replicate the audience profile of "${top1.name}" — it achieved ${top1.roas.toFixed(1)}× ROAS. Focus on 1% LAL of past purchasers, women 25–45, travel-interested, Cairo + Alexandria.`
        : "1% Lookalike of purchasers (last 180 days) — women 25–45, travel & fashion interests, Cairo/Alex",
      secondary: "Retargeting: website visitors 14-day, video viewers 50%+ (last 30 days) — these are warm audiences with proven intent",
      avoid: bottomAds[0]
        ? `Broad interest-only targeting without LAL or retargeting signals — "${bottomAds[0].name}" at ${bottomAds[0].roas.toFixed(1)}× ROAS demonstrates this wastes budget. Also exclude recent purchasers (90 days) from prospecting.`
        : "Broad targeting without purchase signals or LAL seeds. Always exclude recent buyers (90-day window) from cold prospecting.",
    },
    placement_specs: [
      { placement: "Reels / Stories", dimensions: "1080x1920", safe_zone: "top and bottom 20%", notes: "Keep hero visual and CTA in middle 60% of frame — UI elements cover top/bottom on Reels" },
      { placement: "Feed (Square)", dimensions: "1080x1350", safe_zone: "keep text in center 60%", notes: "4:5 ratio performs better than 1:1 in feed — more screen real estate for the product" },
      { placement: "Carousel Card", dimensions: "1080x1080", safe_zone: "center", notes: "First card is the hook — show the most visually striking product or lifestyle scene; cards 2–3 can show variants or features" },
    ],
    urgency_score: urgencyScore,
    urgency_reason: fatigueAds.length > 0
      ? `${fatigueAds.length} ad set(s) showing frequency above 4× (${fatigueAds.map((a) => `"${a.name}" at ${a.frequency.toFixed(1)}×`).join(", ")}). Creative fatigue is actively suppressing ROAS — new creative is urgent.`
      : `Blended ROAS of ${payload.blendedRoas.toFixed(1)}× — proactive creative refresh before fatigue sets in will defend performance.`,
    confidence_score: payload.adsCount >= 8 ? 82 : payload.adsCount >= 4 ? 68 : 55,
    data_basis: `Based on ${payload.adsCount} ads across EGP ${payload.totalSpend.toLocaleString()} in spend from ${dateRange.from} to ${dateRange.to}, generating ${payload.blendedRoas.toFixed(1)}× blended ROAS.`,
  };
}

// ─── Claude-powered brief ─────────────────────────────────────────────────────

async function claudeBrief(payload: AnalysisPayload): Promise<CreativeBrief> {
  const { topAds, bottomAds, formatSummary, dateRange } = payload;
  const month = new Date(dateRange.to).toLocaleString("en-US", { month: "long", year: "numeric" });

  const topAdsText = topAds
    .map(
      (a, i) =>
        `${i + 1}. "${a.name}" | Format: ${a.format} | ROAS: ${a.roas.toFixed(2)}× | CTR: ${a.ctr.toFixed(2)}% | Spend: EGP ${a.spend.toLocaleString()} | Conversions: ${a.conversions} | Headline: "${a.headline}" | Body: "${a.body}"`
    )
    .join("\n");

  const formatText = formatSummary
    .map((f) => `${f.format}: avg ROAS ${f.avgRoas.toFixed(2)}×, total spend EGP ${f.totalSpend.toLocaleString()}, ${f.count} ads`)
    .join(" | ");

  const worstText = bottomAds
    .map(
      (a, i) =>
        `${i + 1}. "${a.name}" | Format: ${a.format} | ROAS: ${a.roas.toFixed(2)}× | CTR: ${a.ctr.toFixed(2)}% | Headline: "${a.headline}" | Body: "${a.body}"`
    )
    .join("\n");

  const verified = topAds.filter((a) => a.revenueSource === "shopify").length;
  const groundingNote =
    verified > 0
      ? `IMPORTANT: ROAS figures below are FIRST-PARTY VERIFIED — computed from real Shopify orders matched to each ad (not Meta's modeled/pixel numbers, which over-report post-iOS14). Trust these numbers; they are money that actually landed. ${verified} of the top ads are order-verified.`
      : `NOTE: ROAS figures are Meta-reported (pixel-modeled) — directional, treat with mild skepticism.`;

  const prompt = `You are a world-class creative director and performance strategist for an Egyptian luxury luggage brand (Le Souverain — sells Samsonite and American Tourister). Your briefs are followed to the letter by the design and media teams, so be precise, opinionated, and grounded strictly in the data.

${groundingNote}

Here is the performance data from our Meta ad account for ${month}:

TOP 10 ADS BY ROAS:
${topAdsText}

FORMAT PERFORMANCE SUMMARY:
${formatText}

WORST 5 ADS:
${worstText}

CURRENT PERIOD: ${month}

Based on this data, generate a creative brief for our next campaign. Be extremely specific and opinionated. Reference actual ads by name when relevant.

Return a JSON object with exactly this structure (no markdown, no explanation, just raw JSON):
{
  "campaign_concept": "One compelling campaign concept/theme in 1-2 sentences",
  "hero_format": "The single best format to lead with and exactly why based on data",
  "format_breakdown": [
    {"format": "15s Vertical Video", "allocation": 60, "reason": "specific reason from data"},
    {"format": "Carousel 3-card", "allocation": 30, "reason": "..."},
    {"format": "Static Image", "allocation": 10, "reason": "..."}
  ],
  "visual_direction": {
    "scene": "Extremely specific scene description — what do we see, who, where, what action",
    "do": ["list of 5 specific visual DOs based on what performed well"],
    "avoid": ["list of 5 specific visual DONTs based on what performed poorly"],
    "color_palette": [
      {"hex": "#hex", "role": "primary/secondary/accent", "why": "data reason"}
    ],
    "reference": "Reference to a specific top-performing ad and what made it work visually"
  },
  "copy_direction": {
    "arabic_headlines": ["3 specific Arabic headline options"],
    "english_headlines": ["3 specific English headline options"],
    "body_copy": "2-3 sentence body copy recommendation with the approach to use",
    "cta": "Exact CTA text recommendation",
    "copy_rules": ["5 copy rules based on data — what length, tone, language mix works"]
  },
  "audience_targeting": {
    "primary": "Most specific audience recommendation based on performance data",
    "secondary": "Second audience",
    "avoid": "Who to exclude and why"
  },
  "placement_specs": [
    {"placement": "Reels / Stories", "dimensions": "1080x1920", "safe_zone": "top and bottom 20%", "notes": "specific note"},
    {"placement": "Feed", "dimensions": "1080x1350", "safe_zone": "keep text in center 60%", "notes": "..."},
    {"placement": "Carousel", "dimensions": "1080x1080", "safe_zone": "center", "notes": "..."}
  ],
  "urgency_score": 8,
  "urgency_reason": "Why this creative refresh is urgent based on frequency/ROAS data",
  "confidence_score": 85,
  "data_basis": "One sentence on what data this brief is based on"
}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (message.content[0] as any).text as string;

  // Strip markdown code fences if present
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  return JSON.parse(jsonText) as CreativeBrief;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to") ?? new Date().toISOString().split("T")[0];

  // Use the requested window (the user's date picker) so Meta spend and the Shopify
  // true-ROAS join cover the SAME period — otherwise ROAS is nonsense. Widen to 90d
  // only if the requested window has no ads (sparse account).
  const reqFrom = searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const from90 = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

  let ads: AdPerf[] = [];
  let usedFrom = reqFrom;
  let verifiedAds = 0;
  let verifiedRevenue = 0;
  let isMock = false;

  if (!hasMetaCreds()) {
    ads = mockAdPerf();
    isMock = true;
  } else {
    try {
      ads = await fetchMetaAds(reqFrom, to);
      usedFrom = reqFrom;
      if (ads.length === 0) {
        ads = await fetchMetaAds(from90, to);
        usedFrom = from90;
      }
    } catch (err) {
      console.error("[creative-intelligence] Meta fetch error:", err);
      try {
        ads = await fetchMetaAds(from90, to);
        usedFrom = from90;
      } catch {
        ads = mockAdPerf();
        isMock = true;
      }
    }
    // Replace pixel ROAS with real order-verified ROAS where we can (window-aligned).
    if (!isMock && ads.length > 0) {
      const t = await applyTrueRoas(ads, usedFrom, to);
      ads = t.ads;
      verifiedAds = t.verifiedAds;
      verifiedRevenue = t.verifiedRevenue;
    }
  }

  const payload = analyse(ads, usedFrom, to);

  let brief: CreativeBrief;
  let generatedBy: "claude" | "rules" = "rules";

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      brief = await claudeBrief(payload);
      generatedBy = "claude";
    } catch (err) {
      console.error("[creative-intelligence] Claude error, falling back to rules:", err);
      brief = ruleBasedBrief(payload);
    }
  } else {
    brief = ruleBasedBrief(payload);
  }

  return NextResponse.json({
    brief,
    generatedBy,
    generatedAt: new Date().toISOString(),
    dateRange: { from: usedFrom, to },
    // How much of this analysis is grounded in real orders vs Meta's pixel.
    grounding: {
      verifiedAds,
      verifiedRevenue,
      totalAds: payload.adsCount,
      basis: verifiedAds > 0 ? "first-party" : "meta-reported",
    },
    performanceData: {
      topAds: payload.topAds,
      bottomAds: payload.bottomAds,
      formatSummary: payload.formatSummary,
      fatigueAds: payload.fatigueAds,
      totalSpend: payload.totalSpend,
      totalRevenue: payload.totalRevenue,
      blendedRoas: payload.blendedRoas,
    },
  });
}
