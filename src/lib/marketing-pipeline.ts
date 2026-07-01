// ══════════════════════════════════════════════════════════════════════════════
//  MARKETING PIPELINE — the one place that fetches Meta + Shopify and reconciles.
//  Both /api/marketing/attribution and /api/marketing/budget call loadReconciliation
//  so they can never disagree on a number. Deterministic; no LLM.
// ══════════════════════════════════════════════════════════════════════════════

import { metaGet, metaMetric, metaObjective, hasMetaCreds } from "@/lib/meta-ads";
import { getAttributedOrders } from "@/lib/shopify";
import {
  attributeOrders,
  enrichWithAdMap,
  computeCoverage,
  rollupByCampaign,
  rollupByChannel,
  rollupByAd,
  computeMER,
  reconcileCampaigns,
  type MetaCampaignInput,
  type ReconciledCampaign,
  type Coverage,
  type MER,
  type Channel,
  type Agg,
} from "@/lib/attribution";

export interface ReconResult {
  ok: boolean;
  generatedBy: "first-party" | "first-party-no-meta" | "first-party-degraded";
  dateRange: { from: string; to: string };
  mer: MER | null;
  coverage: Coverage;
  channels: Record<Channel, Agg>;
  campaigns: ReconciledCampaign[];
  /** Per-campaign avg frequency from Meta (saturation signal for the budget model). */
  frequencyById: Record<string, number>;
  taggingIssues: ReconciledCampaign[];
  totalSpend: number;
  totalRevenue: number;
  note?: string;
}

/**
 * Targeted ad→campaign map for exactly the ad ids seen in Shopify orders (cheap:
 * ~2 batched calls). A deleted ad id can 400 a batch, so on failure we retry ids
 * one-by-one so one dead ad never drops the rest.
 */
async function fetchAdCampaignMap(adIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50);
    try {
      const res = await metaGet<Record<string, { campaign_id?: string }>>("", {
        ids: batch.join(","),
        fields: "campaign_id",
      });
      for (const [adId, obj] of Object.entries(res)) {
        if (obj?.campaign_id) map.set(adId, String(obj.campaign_id));
      }
    } catch {
      for (const id of batch) {
        try {
          const one = await metaGet<{ campaign_id?: string }>(`/${id}`, { fields: "campaign_id" });
          if (one?.campaign_id) map.set(id, String(one.campaign_id));
        } catch {
          /* deleted/invalid ad id — skip */
        }
      }
    }
  }
  return map;
}

export async function loadReconciliation(
  from: string,
  to: string,
  margin?: number,
): Promise<ReconResult> {
  // First-party truth (never throws — [] on failure).
  const rawOrders = await getAttributedOrders(from, to);
  let attrs = attributeOrders(rawOrders);
  const totalRevenue = attrs.reduce((s, o) => s + o.revenue, 0);

  const base = {
    dateRange: { from, to },
    channels: rollupByChannel(attrs),
    frequencyById: {} as Record<string, number>,
    campaigns: [] as ReconciledCampaign[],
    taggingIssues: [] as ReconciledCampaign[],
    totalSpend: 0,
    totalRevenue,
  };

  if (!hasMetaCreds()) {
    return {
      ok: true,
      generatedBy: "first-party-no-meta",
      mer: null,
      coverage: computeCoverage(attrs),
      ...base,
      note: "Connect Meta (META_ACCESS_TOKEN + META_AD_ACCOUNT_ID) to reconcile campaigns and compute MER.",
    };
  }

  const account = process.env.META_AD_ACCOUNT_ID!;
  try {
    const [campsRes, insightsRes] = await Promise.all([
      metaGet<{ data: { id: string; name: string; objective?: string; effective_status?: string }[] }>(
        `/${account}/campaigns`,
        { fields: "id,name,objective,effective_status", limit: "300" },
      ),
      metaGet<{ data: any[] }>(`/${account}/insights`, {
        level: "campaign",
        // frequency + impressions power the budget model's saturation signal.
        fields: "campaign_id,campaign_name,spend,action_values,actions,frequency,impressions",
        time_range: JSON.stringify({ since: from, until: to }),
        limit: "300",
      }),
    ]);

    // Recover campaign attribution via ad ids (the well-tagged key in this account).
    const adIds = [...rollupByAd(attrs).keys()];
    if (adIds.length) {
      attrs = enrichWithAdMap(attrs, await fetchAdCampaignMap(adIds));
    }

    const meta = new Map<string, { name: string; objective: string }>();
    for (const c of campsRes.data ?? []) {
      meta.set(c.id, { name: c.name, objective: metaObjective(c.objective ?? "") });
    }
    const metaCampaigns: MetaCampaignInput[] = [];
    const frequencyById: Record<string, number> = {};
    let totalSpend = 0;
    for (const ins of insightsRes.data ?? []) {
      const spend = parseFloat(ins.spend ?? "0");
      totalSpend += spend;
      frequencyById[ins.campaign_id] = parseFloat(ins.frequency ?? "0");
      const m = meta.get(ins.campaign_id) ?? { name: ins.campaign_name ?? ins.campaign_id, objective: "" };
      metaCampaigns.push({
        id: ins.campaign_id,
        name: m.name,
        objective: m.objective,
        spend,
        metaRevenue: metaMetric(ins.action_values, "purchase"),
        metaConversions: Math.round(metaMetric(ins.actions, "purchase")),
      });
    }

    const coverage = computeCoverage(attrs);
    const reconciled = reconcileCampaigns(
      metaCampaigns,
      rollupByCampaign(attrs),
      coverage.metaCaptureRate,
    ).sort((a, b) => b.spend - a.spend);

    return {
      ok: true,
      generatedBy: "first-party",
      mer: computeMER(totalRevenue, totalSpend, margin),
      coverage,
      dateRange: { from, to },
      channels: rollupByChannel(attrs),
      frequencyById,
      campaigns: reconciled,
      taggingIssues: reconciled.filter((c) => c.checkTagging),
      totalSpend,
      totalRevenue,
    };
  } catch (err) {
    console.error("[marketing-pipeline] Meta error:", err);
    return {
      ok: true,
      generatedBy: "first-party-degraded",
      mer: null,
      coverage: computeCoverage(attrs),
      ...base,
      note: "Meta fetch failed — showing first-party attribution only.",
    };
  }
}
