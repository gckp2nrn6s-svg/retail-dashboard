// ══════════════════════════════════════════════════════════════════════════════
//  ATTRIBUTION ENGINE — first-party truth for ad performance
// ══════════════════════════════════════════════════════════════════════════════
//
//  Post-iOS-14, Meta's pixel can't see most conversions, so it *models* (guesses)
//  them. Its per-campaign revenue/ROAS is therefore unreliable — usually inflated.
//
//  This engine ignores Meta's revenue claim and instead reads the ONLY source of
//  truth about money: the actual Shopify order. Every order carries a `landing_site`
//  URL — the page the buyer first hit — which (when the ad is tagged) contains:
//     utm_campaign = <Meta campaign id>   ← joins straight back to the Meta API
//     utm_content  = <Meta ad id / label>
//     utm_term     = <Meta adset/ad id>
//     fbclid       = Facebook click id    ← proof the click came from Meta at all
//
//  So a real order → the exact campaign that produced it. No modeling, no pixel.
//
//  EVERYTHING HERE IS DETERMINISTIC. No LLM ever touches these numbers. On a large
//  ad budget we cannot tolerate a hallucinated figure — the AI only ever writes
//  prose on top of numbers this file computed.
// ══════════════════════════════════════════════════════════════════════════════

// ── Types ─────────────────────────────────────────────────────────────────────

export type Channel = "meta" | "google" | "tiktok" | "direct" | "other";
/** How deep we could attribute an order. ad > campaign > channel > untracked. */
export type AttrTier = "ad" | "campaign" | "channel" | "untracked";

/** Raw order as it comes from Shopify, before classification. */
export interface RawOrder {
  id: string;
  createdAt: string;
  brand: string;
  revenue: number;
  units: number;
  landingSite?: string | null;
  referringSite?: string | null;
  sourceName?: string | null; // "web" | "pos" | ...
}

/** An order with its attribution resolved. */
export interface OrderAttribution extends RawOrder {
  channel: Channel;
  rawSource: string | null; // utm_source verbatim (e.g. "facebook", "AT6")
  medium: string | null; // utm_medium (e.g. "paid", "social")
  paid: boolean; // best-effort: was this a *paid* click (vs organic/link-in-bio)
  campaignId: string | null; // numeric Meta campaign id — the join key
  campaignLabel: string | null; // raw utm_campaign (may be a code like "AT6")
  adId: string | null; // numeric Meta ad id (from utm_content)
  adsetId: string | null; // numeric Meta adset/ad id (from utm_term)
  hasClickId: boolean; // fbclid/gclid/ttclid present
  tier: AttrTier;
  /** Meta click but no numeric campaign id we could join — a tagging problem. */
  metaUntagged: boolean;
}

export interface Agg {
  revenue: number;
  units: number;
  orders: number;
}

export interface Coverage {
  totalOrders: number;
  totalRevenue: number;
  // by depth (revenue-weighted — money matters more than order count)
  adRevenue: number;
  campaignRevenue: number; // includes adRevenue's orders too (all with a campaign id)
  channelRevenue: number; // meta/google/tiktok known, no campaign id
  untrackedRevenue: number;
  // meta-specific
  metaTouchedRevenue: number; // any order with a Meta signal (fbclid or meta source)
  metaJoinableRevenue: number; // meta orders we could tie to a campaign id
  // headline percentages (0–100)
  trackedPct: number; // has any channel signal
  campaignPct: number; // has a joinable campaign id
  /** Of Meta-touched revenue, how much carried a joinable campaign id (0–1).
   *  This is the scale factor used to lift the verified floor toward the truth. */
  metaCaptureRate: number;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

// Meta object ids are long integers (campaign/adset/ad). 10+ digits is a safe test
// (real ids are ~15–18 digits; a short "6" style code won't match).
const META_ID_RE = /^\d{10,}$/;

/** Pull the query string from a full URL *or* a bare path, tolerantly. */
function paramsOf(url: string | null | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const q = url.indexOf("?");
  if (q === -1) return new URLSearchParams();
  try {
    // Everything after the first '?'. Guard against malformed encodings.
    return new URLSearchParams(url.slice(q + 1));
  } catch {
    return new URLSearchParams();
  }
}

/**
 * Classify a single order into its attribution. Pure, deterministic, total —
 * never throws, always returns a usable classification (worst case: untracked).
 */
export function classifyOrder(o: RawOrder): OrderAttribution {
  const lp = paramsOf(o.landingSite);
  const rp = paramsOf(o.referringSite);
  // Landing site wins; referrer is a fallback (some themes stash utms there).
  const get = (k: string): string => (lp.get(k) ?? rp.get(k) ?? "").trim();
  const has = (k: string): boolean => lp.has(k) || rp.has(k);

  const rawSource = get("utm_source") || null;
  const src = (rawSource ?? "").toLowerCase();
  const medium = (get("utm_medium") || "").toLowerCase() || null;

  const fbclid = has("fbclid");
  const gclid = has("gclid");
  const ttclid = has("ttclid");
  const hasClickId = fbclid || gclid || ttclid;

  // ── Channel (priority: hard click-ids first, then source string) ──
  let channel: Channel;
  if (gclid || src.includes("google") || src.includes("gads")) channel = "google";
  else if (ttclid || src.includes("tiktok")) channel = "tiktok";
  else if (fbclid || /^(facebook|fb|ig|instagram|meta)$/.test(src) || src.includes("facebook") || src.includes("insta"))
    channel = "meta";
  else if (src) channel = "other";
  else channel = "direct";

  // ── Ids (only trust numeric Meta-shaped values as join keys) ──
  const campaignLabel = get("utm_campaign") || null;
  const campaignId = campaignLabel && META_ID_RE.test(campaignLabel) ? campaignLabel : null;
  const contentRaw = get("utm_content");
  const termRaw = get("utm_term");
  const adId = META_ID_RE.test(contentRaw) ? contentRaw : null;
  const adsetId = META_ID_RE.test(termRaw) ? termRaw : null;

  // ── Paid vs organic ──
  // A campaign/ad id only exists on *paid* traffic. medium=paid/cpc is explicit.
  // link_in_bio / social / email / referral are organic even if they carry fbclid
  // (an organic FB reshare still stamps fbclid).
  const paidMedium = /^(paid|cpc|ppc|paid[_-]?social|paidsocial|display)$/.test(medium ?? "");
  const organicMedium = /(social|organic|referral|email|link[_-]?in[_-]?bio|bio|newsletter|sms)/.test(medium ?? "");
  let paid = paidMedium || campaignId != null || adId != null || adsetId != null;
  if (organicMedium && campaignId == null && adId == null && adsetId == null) paid = false;

  // ── Tier (depth of attribution) ──
  let tier: AttrTier;
  if (adId) tier = "ad";
  else if (campaignId) tier = "campaign";
  else if (channel !== "direct") tier = "channel";
  else tier = "untracked";

  // A Meta click we couldn't tie to a campaign = the account has tagging gaps.
  const metaUntagged = channel === "meta" && campaignId == null;

  return {
    ...o,
    channel,
    rawSource,
    medium,
    paid,
    campaignId,
    campaignLabel,
    adId,
    adsetId,
    hasClickId,
    tier,
    metaUntagged,
  };
}

export function attributeOrders(orders: RawOrder[]): OrderAttribution[] {
  return orders.map(classifyOrder);
}

/**
 * Recover campaign attribution for orders that carried a numeric AD id (utm_content)
 * but no joinable campaign id — because utm_campaign was a manual code ("AT6"),
 * truncated, or absent. In this account ad-ids are tagged far more reliably than
 * campaign-ids (observed: ~26% of revenue has a numeric ad id vs ~7% a numeric
 * campaign id), so rolling ad → campaign through the Meta API map is the single
 * biggest coverage lever. `adToCampaign` comes from the Meta ads endpoint
 * (each ad returns its campaign_id). Returns a new array; never mutates input.
 */
export function enrichWithAdMap(
  attrs: OrderAttribution[],
  adToCampaign: Map<string, string>,
): OrderAttribution[] {
  return attrs.map((o) => {
    if (o.campaignId || !o.adId) return o; // already resolved, or nothing to roll up
    const cid = adToCampaign.get(o.adId);
    if (!cid) return o;
    return { ...o, campaignId: cid, metaUntagged: false };
  });
}

// ── Rollups ───────────────────────────────────────────────────────────────────

function add(m: Map<string, Agg>, key: string, o: OrderAttribution): void {
  const a = m.get(key) ?? { revenue: 0, units: 0, orders: 0 };
  a.revenue += o.revenue;
  a.units += o.units;
  a.orders += 1;
  m.set(key, a);
}

/** Shopify revenue per Meta campaign id (only orders that carried one). */
export function rollupByCampaign(attrs: OrderAttribution[]): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const o of attrs) if (o.campaignId) add(m, o.campaignId, o);
  return m;
}

/** Shopify revenue per Meta ad id (recovery path when campaign id is missing). */
export function rollupByAd(attrs: OrderAttribution[]): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const o of attrs) if (o.adId) add(m, o.adId, o);
  return m;
}

export function rollupByChannel(attrs: OrderAttribution[]): Record<Channel, Agg> {
  const base: Record<Channel, Agg> = {
    meta: { revenue: 0, units: 0, orders: 0 },
    google: { revenue: 0, units: 0, orders: 0 },
    tiktok: { revenue: 0, units: 0, orders: 0 },
    direct: { revenue: 0, units: 0, orders: 0 },
    other: { revenue: 0, units: 0, orders: 0 },
  };
  for (const o of attrs) {
    base[o.channel].revenue += o.revenue;
    base[o.channel].units += o.units;
    base[o.channel].orders += 1;
  }
  return base;
}

// ── Coverage ──────────────────────────────────────────────────────────────────

export function computeCoverage(attrs: OrderAttribution[]): Coverage {
  let totalRevenue = 0;
  let adRevenue = 0;
  let campaignRevenue = 0;
  let channelRevenue = 0;
  let untrackedRevenue = 0;
  let metaTouchedRevenue = 0;
  let metaJoinableRevenue = 0;

  for (const o of attrs) {
    totalRevenue += o.revenue;
    if (o.tier === "ad") adRevenue += o.revenue;
    if (o.campaignId) campaignRevenue += o.revenue;
    if (o.tier === "channel") channelRevenue += o.revenue;
    if (o.tier === "untracked") untrackedRevenue += o.revenue;
    if (o.channel === "meta") {
      metaTouchedRevenue += o.revenue;
      if (o.campaignId) metaJoinableRevenue += o.revenue;
    }
  }

  const trackedRevenue = totalRevenue - untrackedRevenue;
  return {
    totalOrders: attrs.length,
    totalRevenue: round2(totalRevenue),
    adRevenue: round2(adRevenue),
    campaignRevenue: round2(campaignRevenue),
    channelRevenue: round2(channelRevenue),
    untrackedRevenue: round2(untrackedRevenue),
    metaTouchedRevenue: round2(metaTouchedRevenue),
    metaJoinableRevenue: round2(metaJoinableRevenue),
    trackedPct: pctOf(trackedRevenue, totalRevenue),
    campaignPct: pctOf(campaignRevenue, totalRevenue),
    metaCaptureRate: metaTouchedRevenue > 0 ? metaJoinableRevenue / metaTouchedRevenue : 0,
  };
}

// ── Reconciliation: Meta's claim vs first-party truth ─────────────────────────

export interface MetaCampaignInput {
  id: string;
  name: string;
  objective?: string;
  spend: number;
  metaRevenue: number; // Meta's (modeled) attributed revenue
  metaConversions: number;
}

export type Trust = "verified" | "partial" | "meta-only";

export interface ReconciledCampaign {
  id: string;
  name: string;
  objective: string;
  spend: number;
  // Meta's claim
  metaRevenue: number;
  metaRoas: number;
  metaConversions: number;
  // First-party truth (orders we matched by utm_campaign)
  shopifyRevenue: number;
  shopifyOrders: number;
  shopifyRoas: number; // a verified FLOOR — real is ≥ this
  // Reconciliation
  trueRoas: number; // best estimate: floor lifted by capture rate, capped at Meta's claim
  inflationFactor: number | null; // metaRoas / shopifyRoas (how much Meta over-claims)
  trust: Trust;
  /** Spent real money but produced zero matchable orders → fix the URL tags. */
  checkTagging: boolean;
}

const MIN_VERIFIED_ORDERS = 5; // ≥5 matched orders → we trust the first-party number
const CHECK_TAGGING_MIN_SPEND = 300; // EGP: below this, zero matches isn't alarming

/**
 * Reconcile Meta's per-campaign claim against Shopify-attributed revenue.
 *
 * `metaCaptureRate` (0–1) is the account-wide fraction of Meta-touched revenue we
 * could join to a campaign. We use its inverse to lift each campaign's *verified
 * floor* toward reality (some real orders from the campaign lost their UTM), but
 * never above Meta's own claim — Meta over-reports, it rarely under-reports.
 */
export function reconcileCampaigns(
  metaCampaigns: MetaCampaignInput[],
  shopifyByCampaign: Map<string, Agg>,
  metaCaptureRate: number,
): ReconciledCampaign[] {
  // Guard the scale factor into a sane band. If capture is unknown/low, don't
  // wildly inflate; if it's high, barely lift.
  const capture = metaCaptureRate > 0 ? Math.min(1, Math.max(0.2, metaCaptureRate)) : 0.5;
  const lift = 1 / capture; // e.g. 50% capture → ×2 to estimate the missed orders

  return metaCampaigns.map((c) => {
    const s = shopifyByCampaign.get(c.id) ?? { revenue: 0, units: 0, orders: 0 };
    const metaRoas = c.spend > 0 ? c.metaRevenue / c.spend : 0;
    const shopifyRoas = c.spend > 0 ? s.revenue / c.spend : 0;

    let trust: Trust;
    if (s.orders >= MIN_VERIFIED_ORDERS) trust = "verified";
    else if (s.orders > 0) trust = "partial";
    else trust = "meta-only";

    // Best estimate of true ROAS:
    //  - verified/partial → lift the first-party floor by the capture factor,
    //    but never exceed Meta's own claim (Meta is the optimistic ceiling).
    //  - meta-only (no matches) → we can't verify; fall back to Meta but discount
    //    it 25% as a standing haircut for known post-iOS14 over-reporting.
    let trueRoas: number;
    if (trust === "meta-only") {
      trueRoas = metaRoas * 0.75;
    } else {
      trueRoas = Math.min(metaRoas > 0 ? metaRoas : Infinity, shopifyRoas * lift);
      if (!isFinite(trueRoas)) trueRoas = shopifyRoas * lift;
    }

    const checkTagging =
      c.spend >= CHECK_TAGGING_MIN_SPEND && s.orders === 0 && c.metaConversions > 0;

    return {
      id: c.id,
      name: c.name,
      objective: c.objective ?? "",
      spend: round2(c.spend),
      metaRevenue: round2(c.metaRevenue),
      metaRoas: round2(metaRoas),
      metaConversions: c.metaConversions,
      shopifyRevenue: round2(s.revenue),
      shopifyOrders: s.orders,
      shopifyRoas: round2(shopifyRoas),
      trueRoas: round2(trueRoas),
      inflationFactor: shopifyRoas > 0 ? round2(metaRoas / shopifyRoas) : null,
      trust,
      checkTagging,
    };
  });
}

// ── MER — the north star ──────────────────────────────────────────────────────

export interface MER {
  totalRevenue: number; // ALL Shopify revenue in the window (not just attributed)
  totalSpend: number; // ALL ad spend
  mer: number; // revenue / spend — the number that cannot lie
  /** Break-even MER given gross margin: 1 / margin. Below this you lose money. */
  breakEven: number | null;
  healthy: boolean | null;
}

/**
 * Marketing Efficiency Ratio: total first-party revenue ÷ total ad spend.
 * This is the CEO number — 100% first-party, immune to the pixel problem.
 * Pass grossMargin (0–1) to also get the break-even line.
 */
export function computeMER(totalRevenue: number, totalSpend: number, grossMargin?: number): MER {
  const mer = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const breakEven = grossMargin && grossMargin > 0 ? 1 / grossMargin : null;
  return {
    totalRevenue: round2(totalRevenue),
    totalSpend: round2(totalSpend),
    mer: round2(mer),
    breakEven: breakEven != null ? round2(breakEven) : null,
    healthy: breakEven != null ? mer >= breakEven : null,
  };
}

// ── small helpers ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
