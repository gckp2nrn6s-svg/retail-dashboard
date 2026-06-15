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
