// NAV returns dates differently depending on transport:
//   • direct mssql mode (local dev)  → JS Date object
//   • proxy/JSON mode (Railway prod) → ISO string
// These helpers normalize both so date handling can't crash one mode while
// silently working in the other.

/** Normalize a NAV date (Date | ISO string | null) to "YYYY-MM-DD", or null. */
export function navDateToISO(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Whole days between an ISO date and now (>= 0), or null if unparseable. */
export function lagDaysFrom(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// ── Cairo "today" ────────────────────────────────────────────────────────────
// The business runs on Egypt time (Africa/Cairo, UTC+2/+3 with DST). Computing
// "today" with toISOString() uses UTC, so between Cairo-midnight and UTC-midnight
// (00:00–03:00 Cairo in summer) "today" lagged a day and the dashboard showed
// yesterday's numbers. Africa/Cairo via Intl handles DST automatically — never
// hardcode the offset. Both server (Railway, UTC) and client agree on the date.
export const CAIRO_TZ = "Africa/Cairo";

/** Current calendar date in Cairo, "YYYY-MM-DD". */
export function todayCairo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: CAIRO_TZ });
}

/** n calendar days before Cairo-today, "YYYY-MM-DD". */
export function cairoDaysAgo(n: number): string {
  const [y, m, d] = todayCairo().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

/** First day of the current Cairo month, "YYYY-MM-DD". */
export function cairoStartOfMonth(): string {
  return todayCairo().slice(0, 8) + "01";
}

/** First day of the current Cairo year, "YYYY-MM-DD". */
export function cairoStartOfYear(): string {
  return `${todayCairo().slice(0, 4)}-01-01`;
}
