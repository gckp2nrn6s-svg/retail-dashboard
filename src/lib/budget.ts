// ══════════════════════════════════════════════════════════════════════════════
//  BUDGET ALLOCATOR — how to split spend across the funnel (Sales / Traffic /
//  Awareness), grounded in first-party true ROAS + saturation, with full-funnel
//  guardrails. Transparent rule-based model a media buyer would agree with — NOT a
//  black box. Deterministic; no LLM. The AI only narrates on top of this.
//
//  Why a full funnel: Sales (conversion) campaigns harvest warm audiences. If you
//  stop feeding the top (Awareness/Traffic), the warm pool dries up and Sales ROAS
//  quietly collapses. So we protect a top-funnel floor even when Sales looks best.
// ══════════════════════════════════════════════════════════════════════════════

export type FunnelStage = "sales" | "traffic" | "awareness";

export interface CampaignForBudget {
  id: string;
  name: string;
  objective: string; // humanized ("Sales", "Traffic", "Awareness", ...)
  spend: number;
  trueRoas: number; // first-party estimate from reconciliation
  frequency: number;
  conversions: number;
}

export interface BucketStat {
  stage: FunnelStage;
  label: string;
  spend: number;
  sharePct: number; // current share of total spend
  trueRoas: number; // spend-weighted true ROAS
  avgFrequency: number; // spend-weighted frequency
  conversions: number;
  campaigns: number;
}

export interface Allocation {
  stage: FunnelStage;
  label: string;
  currentPct: number;
  recommendedPct: number;
  currentSpend: number;
  recommendedSpend: number;
  deltaPct: number; // recommendedPct − currentPct
  action: "scale" | "hold" | "cut";
  reason: string;
  formats: string[]; // format guidance for this stage
  design: string; // design direction for this stage
}

export interface BudgetPlan {
  headline: string;
  breakEvenRoas: number;
  totalBudget: number;
  buckets: BucketStat[];
  allocations: Allocation[];
  warnings: string[];
}

const STAGE_LABEL: Record<FunnelStage, string> = {
  sales: "Sales / Conversions",
  traffic: "Traffic / Consideration",
  awareness: "Awareness / Engagement",
};

/** Map a humanized Meta objective to a funnel stage. */
export function stageOf(objective: string): FunnelStage {
  const o = objective.toLowerCase();
  if (/(sale|conversion|catalog|purchase|checkout)/.test(o)) return "sales";
  if (/(traffic|click|lead|landing)/.test(o)) return "traffic";
  if (/(aware|reach|engage|video|brand|follow|like|view|message)/.test(o)) return "awareness";
  return "traffic"; // safe mid-funnel default for unknown objectives
}

// Format + design guidance per funnel stage. Stable best-practice for a premium
// luggage/retail brand in the Egyptian market; the Sales stage is enriched with the
// account's actual winning format when available (see enrichSalesFormat).
const STAGE_GUIDANCE: Record<FunnelStage, { formats: string[]; design: string }> = {
  sales: {
    formats: ["Dynamic product ads (retargeting)", "Carousel — 3–5 hero SKUs", "UGC testimonial video (15s)"],
    design:
      "Product-forward with price/offer visible. Arabic CTA. Trust signals: reviews, COD badge, warranty. Show the bag in real use, not a white studio.",
  },
  traffic: {
    formats: ["Single strong hero image", "6–10s hook video", "Collection ad"],
    design:
      "One clear benefit-led hook in the first 2 seconds. Minimal on-image text. Curiosity or seasonal angle that earns the click, not a hard sell.",
  },
  awareness: {
    formats: ["15–30s brand story video", "Reels-native vertical (9:16)", "Cinematic lifestyle"],
    design:
      "Emotional, aspirational travel storytelling. Golden-hour light, real journeys. Low text density, logo end-card. Built to be watched, not skipped.",
  },
};

const round = (n: number) => Math.round(n * 10) / 10;
const round0 = (n: number) => Math.round(n);

function emptyBucket(stage: FunnelStage): BucketStat {
  return {
    stage,
    label: STAGE_LABEL[stage],
    spend: 0,
    sharePct: 0,
    trueRoas: 0,
    avgFrequency: 0,
    conversions: 0,
    campaigns: 0,
  };
}

/** Group campaigns into funnel buckets with spend-weighted ROAS + frequency. */
export function bucketize(campaigns: CampaignForBudget[]): BucketStat[] {
  const total = campaigns.reduce((s, c) => s + c.spend, 0) || 1;
  const stages: FunnelStage[] = ["sales", "traffic", "awareness"];
  return stages.map((stage) => {
    const cs = campaigns.filter((c) => stageOf(c.objective) === stage);
    const spend = cs.reduce((s, c) => s + c.spend, 0);
    const wRoas = spend > 0 ? cs.reduce((s, c) => s + c.trueRoas * c.spend, 0) / spend : 0;
    const wFreq = spend > 0 ? cs.reduce((s, c) => s + c.frequency * c.spend, 0) / spend : 0;
    return {
      stage,
      label: STAGE_LABEL[stage],
      spend: round0(spend),
      sharePct: round((spend / total) * 100),
      trueRoas: round(wRoas),
      avgFrequency: round(wFreq),
      conversions: cs.reduce((s, c) => s + c.conversions, 0),
      campaigns: cs.length,
    };
  });
}

/**
 * Recommend a budget split. `breakEvenRoas` is the profitability line (1/margin);
 * below it a sale loses money. The model reads the Sales bucket's health +
 * saturation, sets a target split, then clamps to full-funnel guardrails.
 */
export function allocate(
  buckets: BucketStat[],
  totalBudget: number,
  breakEvenRoas: number,
  winningSalesFormat?: string,
): BudgetPlan {
  const get = (s: FunnelStage) => buckets.find((b) => b.stage === s) ?? emptyBucket(s);
  const sales = get("sales");
  const budget = totalBudget > 0 ? totalBudget : buckets.reduce((s, b) => s + b.spend, 0);
  const warnings: string[] = [];

  const salesHealthy = sales.trueRoas >= breakEvenRoas;
  const salesStrong = sales.trueRoas >= breakEvenRoas * 1.3;
  const salesSaturated = sales.avgFrequency >= 4.5;
  const salesHeadroom = sales.avgFrequency > 0 && sales.avgFrequency < 3.2;
  const hasSalesSignal = sales.spend > 0 && sales.conversions > 0;

  // Target split (percent) chosen by Sales health, then guardrail-clamped.
  let target: Record<FunnelStage, number>;
  let headline: string;

  if (!hasSalesSignal) {
    target = { sales: 45, traffic: 20, awareness: 35 };
    headline =
      "Building phase — no clear sales signal yet. Weight toward prospecting and awareness to build the audiences that Sales will later harvest.";
  } else if (!salesHealthy) {
    target = { sales: 50, traffic: 18, awareness: 32 };
    headline = `Sales true ROAS (${sales.trueRoas.toFixed(1)}×) is below break-even (${breakEvenRoas.toFixed(
      1,
    )}×). Hold Sales spend, rebuild the funnel, and fix creative/targeting before scaling — pouring in more now amplifies the loss.`;
    warnings.push(`Sales below break-even (${sales.trueRoas.toFixed(1)}× < ${breakEvenRoas.toFixed(1)}×) — do not scale until creative/offer improves.`);
  } else if (salesSaturated) {
    target = { sales: 48, traffic: 17, awareness: 35 };
    headline = `Sales audiences are saturating (frequency ${sales.avgFrequency.toFixed(
      1,
    )}×). Shift budget up-funnel to refill the warm pool before ROAS decays, and refresh creative now.`;
    warnings.push(`Sales frequency ${sales.avgFrequency.toFixed(1)}× — creative fatigue; refresh ads and widen prospecting.`);
  } else if (salesStrong && salesHeadroom) {
    target = { sales: 68, traffic: 12, awareness: 20 };
    headline = `Sales is strong (${sales.trueRoas.toFixed(
      1,
    )}× true ROAS) with audience headroom. Scale Sales aggressively while keeping a healthy top-funnel feed so it doesn't starve.`;
  } else {
    target = { sales: 62, traffic: 14, awareness: 24 };
    headline = `Sales is profitable (${sales.trueRoas.toFixed(
      1,
    )}× true ROAS). Hold a disciplined full-funnel split with a modest scale on Sales.`;
  }

  // Full-funnel guardrails: never starve the top, never over-concentrate.
  target.awareness = Math.max(10, target.awareness);
  target.traffic = Math.max(8, target.traffic);
  target.sales = Math.max(40, Math.min(72, target.sales));
  const sum = target.sales + target.traffic + target.awareness;
  const norm: Record<FunnelStage, number> = {
    sales: round((target.sales / sum) * 100),
    traffic: round((target.traffic / sum) * 100),
    awareness: 0,
  };
  norm.awareness = round(100 - norm.sales - norm.traffic); // exact 100

  const stages: FunnelStage[] = ["sales", "traffic", "awareness"];
  const allocations: Allocation[] = stages.map((stage) => {
    const b = get(stage);
    const recommendedPct = norm[stage];
    const deltaPct = round(recommendedPct - b.sharePct);
    const action: Allocation["action"] = deltaPct > 3 ? "scale" : deltaPct < -3 ? "cut" : "hold";
    const g = STAGE_GUIDANCE[stage];
    const formats =
      stage === "sales" && winningSalesFormat
        ? [`${winningSalesFormat} (your top performer)`, ...g.formats.slice(0, 2)]
        : g.formats;
    return {
      stage,
      label: STAGE_LABEL[stage],
      currentPct: b.sharePct,
      recommendedPct,
      currentSpend: b.spend,
      recommendedSpend: round0((recommendedPct / 100) * budget),
      deltaPct,
      action,
      reason: reasonFor(stage, b, deltaPct, breakEvenRoas),
      formats,
      design: g.design,
    };
  });

  return { headline, breakEvenRoas: round(breakEvenRoas), totalBudget: round0(budget), buckets, allocations, warnings };
}

function reasonFor(stage: FunnelStage, b: BucketStat, delta: number, breakEven: number): string {
  const dir = delta > 3 ? "Increase" : delta < -3 ? "Reduce" : "Hold";
  if (stage === "sales") {
    if (b.spend === 0) return "No Sales campaigns running — stand up conversion campaigns once prospecting builds a warm pool.";
    const health = b.trueRoas >= breakEven ? `profitable at ${b.trueRoas.toFixed(1)}× true ROAS` : `below break-even at ${b.trueRoas.toFixed(1)}×`;
    const fatigue = b.avgFrequency >= 4.5 ? ` Frequency ${b.avgFrequency.toFixed(1)}× signals fatigue.` : "";
    return `${dir} — Sales is ${health}.${fatigue}`;
  }
  if (stage === "traffic") {
    return `${dir} — Traffic warms cold users into the audiences Sales converts. Keep it lean but never zero.`;
  }
  return `${dir} — Awareness fills the top of the funnel. It won't show last-click ROAS, but starving it collapses Sales ROAS over weeks.`;
}
