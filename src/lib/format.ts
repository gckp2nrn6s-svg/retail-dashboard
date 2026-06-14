// Number formatting utilities — used everywhere for consistent display

export function fmt(n: number, currency = false): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const prefix = currency ? "EGP " : "";

  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000)     return `${sign}${prefix}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}${prefix}${abs.toLocaleString("en-EG", { maximumFractionDigits: 0 })}`;
}

export function fmtEGP(n: number): string {
  return fmt(n, true);
}

export function fmtUSD(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtPct(n: number, decimals = 1): string {
  if (!isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

export function fmtDelta(n: number, currency = false): string {
  if (!isFinite(n)) return "—";
  return `${n >= 0 ? "↑" : "↓"} ${fmt(Math.abs(n), currency)}`;
}

export function arrow(n: number): "↑" | "↓" | "→" {
  if (n > 0.5) return "↑";
  if (n < -0.5) return "↓";
  return "→";
}

// For metrics where lower = better (CPC, CAC, return rate) — invert color logic
export function deltaColor(pct: number, invertLogic = false): string {
  const positive = invertLogic ? pct < 0 : pct > 0;
  const negative = invertLogic ? pct > 0 : pct < 0;
  if (positive) return "#10B981";
  if (negative) return "#EF4444";
  return "#94A3B8";
}

export function deltaBackground(pct: number, invertLogic = false): string {
  const positive = invertLogic ? pct < 0 : pct > 0;
  const negative = invertLogic ? pct > 0 : pct < 0;
  if (positive) return "rgba(16,185,129,0.1)";
  if (negative) return "rgba(239,68,68,0.1)";
  return "rgba(148,163,184,0.1)";
}

export function magnitude(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 20) return "strong";
  if (abs >= 5)  return "moderate";
  return "flat";
}
