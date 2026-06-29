import { query } from "@/lib/db";

// Time-aware FX. Egypt has devalued repeatedly (≈15 → 30 → 50 EGP/USD), so a
// single "latest" rate badly distorts historical USD. fx_rates holds a weekly
// history; this converts each value at the rate IN EFFECT on its own date.

interface RatePoint { t: number; rate: number } // t = week_start epoch ms

let _cache: { at: number; rates: RatePoint[] } | null = null;
const TTL = 5 * 60 * 1000;
const FALLBACK = 50;

async function loadRates(): Promise<RatePoint[]> {
  if (_cache && Date.now() - _cache.at < TTL) return _cache.rates;
  const rows = await query<{ week_start: string; egp_per_usd: string }>(
    "SELECT week_start, egp_per_usd FROM fx_rates ORDER BY week_start ASC");
  const rates = rows
    .map(r => ({ t: new Date(r.week_start).getTime(), rate: parseFloat(r.egp_per_usd) }))
    .filter(r => Number.isFinite(r.t) && r.rate > 0);
  _cache = { at: Date.now(), rates };
  return rates;
}

function rateOn(rates: RatePoint[], date: string | Date): number {
  if (!rates.length) return FALLBACK;
  const t = (date instanceof Date ? date : new Date(date)).getTime();
  if (!Number.isFinite(t)) return rates[rates.length - 1].rate;
  // most recent week_start <= date (binary search; rates sorted ascending)
  let lo = 0, hi = rates.length - 1, ans = rates[0].rate;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid].t <= t) { ans = rates[mid].rate; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans || FALLBACK;
}

export interface Fx {
  /** EGP/USD rate in effect on a specific date (its week). */
  rateOn: (date: string | Date) => number;
  /** USD value of an EGP amount earned on a specific date. */
  toUsd: (egp: number, date: string | Date) => number;
  /** Rate to use for a whole period total ending at `to` (the period's rate). */
  forPeriod: (to: string | Date) => number;
  /** Newest rate on file — for "today" / live figures. */
  latest: number;
}

/** Build a converter from the weekly rate history (call once per request). */
export async function getFx(): Promise<Fx> {
  const rates = await loadRates();
  const latest = rates.length ? rates[rates.length - 1].rate : FALLBACK;
  return {
    rateOn:    (date) => rateOn(rates, date),
    toUsd:     (egp, date) => Math.round((Number(egp) || 0) / rateOn(rates, date)),
    forPeriod: (to) => rateOn(rates, to),
    latest,
  };
}

/** Convenience: just the rate for a period ending at `to`. */
export async function fxForPeriod(to: string | Date): Promise<number> {
  return (await getFx()).forPeriod(to);
}
