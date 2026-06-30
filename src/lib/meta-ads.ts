const META_BASE = "https://graph.facebook.com/v21.0";

export async function metaGet<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not set");

  const url = new URL(`${META_BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { next: { revalidate: 900 } });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Pull numeric value from Meta actions / action_values array */
export function metaMetric(arr: any[] | undefined, type: string): number {
  if (!Array.isArray(arr)) return 0;
  for (const a of arr) {
    if (a.action_type === type || a.action_type === `offsite_conversion.fb_pixel_${type}`) {
      return parseFloat(a.value ?? "0");
    }
  }
  return 0;
}

export function metaStatus(s: string): "Active" | "Paused" | "Ended" {
  if (s === "ACTIVE") return "Active";
  if (s === "PAUSED") return "Paused";
  return "Ended";
}

export function metaObjective(o: string): string {
  return ({
    CONVERSIONS: "Conversions",
    OUTCOME_SALES: "Sales",
    OUTCOME_TRAFFIC: "Traffic",
    OUTCOME_ENGAGEMENT: "Engagement",
    OUTCOME_AWARENESS: "Awareness",
    OUTCOME_LEADS: "Leads",
    LINK_CLICKS: "Traffic",
    REACH: "Reach",
    BRAND_AWARENESS: "Awareness",
    VIDEO_VIEWS: "Video Views",
    LEAD_GENERATION: "Leads",
    CATALOG_SALES: "Catalog Sales",
  } as Record<string, string>)[o] ?? o;
}

/** Shift a date range backward by the same duration for trend comparison */
export function priorPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(from);
  const t = new Date(to);
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const pTo = new Date(f.getTime() - 86400000);
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86400000);
  return {
    from: pFrom.toISOString().split("T")[0],
    to: pTo.toISOString().split("T")[0],
  };
}

export function pct(current: number, prior: number): number {
  if (prior === 0) return 0;
  return parseFloat(((current - prior) / prior * 100).toFixed(1));
}

export function hasMetaCreds(): boolean {
  return !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}
