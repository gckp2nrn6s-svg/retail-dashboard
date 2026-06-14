"use client";
import { fmt, fmtPct, deltaColor, deltaBackground, arrow } from "@/lib/format";
import { SparklineChart } from "@/components/SparklineChart";

export interface KPIComparison {
  label: string;   // "vs Yesterday", "vs 7d avg", etc.
  pct: number;
  abs?: number;
}

export interface KPICardProps {
  title: string;
  value: number;
  valuePrefix?: string;
  valueSuffix?: string;
  format?: "currency" | "number" | "percent";
  comparisons?: KPIComparison[];
  sparkline?: number[];   // last N data points
  invertLogic?: boolean;  // lower is better (CPC, return rate)
  subtitle?: string;
  icon?: React.ReactNode;
  accentColor?: string;
  pace?: { current: number; target: number; label: string };
}

export function KPICard({
  title, value, valuePrefix = "", valueSuffix = "",
  format = "currency", comparisons = [], sparkline = [],
  invertLogic = false, subtitle, icon, accentColor = "#2563EB", pace,
}: KPICardProps) {
  function display(n: number) {
    if (format === "percent") return `${n.toFixed(1)}%`;
    if (format === "number") return fmt(n);
    return fmt(n, true);
  }

  const primaryComp = comparisons[0];

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16,
      padding: "18px 20px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      position: "relative",
      overflow: "hidden",
      transition: "border-color 0.2s, background 0.2s",
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)";
      (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.05)";
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
      (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
    }}
    >
      {/* Accent bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accentColor, borderRadius: "16px 16px 0 0", opacity: 0.6 }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title}
        </span>
        {icon && <span style={{ color: "rgba(255,255,255,0.2)", display: "flex" }}>{icon}</span>}
      </div>

      {/* Value */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <span style={{ fontSize: "1.7rem", fontWeight: 800, color: "white", letterSpacing: "-0.03em", lineHeight: 1 }}>
          {valuePrefix}{display(value)}{valueSuffix}
        </span>
        {primaryComp && (
          <span style={{
            fontSize: "0.72rem", fontWeight: 700, marginBottom: 3,
            color: deltaColor(primaryComp.pct, invertLogic),
          }}>
            {arrow(invertLogic ? -primaryComp.pct : primaryComp.pct)} {Math.abs(primaryComp.pct).toFixed(1)}%
          </span>
        )}
      </div>

      {subtitle && (
        <p style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{subtitle}</p>
      )}

      {/* Sparkline */}
      {sparkline.length > 1 && (
        <div style={{ margin: "8px -4px 2px" }}>
          <SparklineChart data={sparkline} color={accentColor} />
        </div>
      )}

      {/* Pace bar */}
      {pace && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.3)" }}>{pace.label}</span>
            <span style={{ fontSize: "0.6rem", color: pace.current >= 100 ? "#10B981" : "rgba(255,255,255,0.4)", fontWeight: 600 }}>
              {Math.min(pace.current, 100).toFixed(0)}% to target
            </span>
          </div>
          <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: pace.current >= 100 ? "#10B981" : pace.current >= 75 ? "#F59E0B" : "#EF4444",
              width: `${Math.min(pace.current, 100)}%`,
              transition: "width 0.6s ease",
            }} />
          </div>
        </div>
      )}

      {/* Multi-period comparisons */}
      {comparisons.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {comparisons.map((c, i) => (
            <span key={i} style={{
              fontSize: "0.58rem", fontWeight: 600, padding: "2px 7px", borderRadius: 20,
              color: deltaColor(c.pct, invertLogic),
              background: deltaBackground(c.pct, invertLogic),
            }}>
              {arrow(invertLogic ? -c.pct : c.pct)} {Math.abs(c.pct).toFixed(1)}% {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
