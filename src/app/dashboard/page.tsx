"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { RefreshCw, ChevronRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useCurrency, CurrencyToggle, fmt } from "@/components/CurrencyToggle";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill, DrillParams } from "@/components/DrillDownSheet";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { Insight } from "@/app/api/insights/route";

interface KPI {
  revenue: { egp: number; usd: number };
  units: number;
  avgTicket: { egp: number; usd: number };
  activeStores: number;
  revChange: number | null;
  unitsChange: number | null;
  fx: number;
}

interface ChartPoint { date: string; egp: number; usd: number; units: number }

const TYPE_STYLES: Record<Insight["type"], { bg: string; border: string; pill: string; text: string; metricColor: string }> = {
  critical:    { bg: "#FFF1F2", border: "#FDA4AF", pill: "#EF4444", text: "#991B1B", metricColor: "#EF4444" },
  warning:     { bg: "#FFFBEB", border: "#FCD34D", pill: "#F59E0B", text: "#78350F", metricColor: "#D97706" },
  opportunity: { bg: "#F0FDF4", border: "#86EFAC", pill: "#10B981", text: "#064E3B", metricColor: "#10B981" },
  win:         { bg: "#EFF6FF", border: "#93C5FD", pill: "#2563EB", text: "#1E3A8A", metricColor: "#2563EB" },
};

function InsightCard({ insight }: { insight: Insight }) {
  const s = TYPE_STYLES[insight.type];
  return (
    <Link href={insight.link} style={{ textDecoration: "none" }}>
      <div style={{
        background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 16,
        padding: "14px 16px", minWidth: 260, maxWidth: 280,
        display: "flex", flexDirection: "column", gap: 8, cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "1.1rem" }}>{insight.icon}</span>
            <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: s.pill, background: `${s.pill}20`, padding: "2px 7px", borderRadius: 20 }}>
              {insight.type === "critical" ? "URGENT" : insight.type === "warning" ? "ACTION" : insight.type === "opportunity" ? "OPPORTUNITY" : "WIN"}
            </span>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontSize: "1.1rem", fontWeight: 800, color: s.metricColor, lineHeight: 1 }}>{insight.metric}</p>
            {insight.metricSub && <p style={{ fontSize: "0.6rem", color: s.text, opacity: 0.7, marginTop: 1 }}>{insight.metricSub}</p>}
          </div>
        </div>
        <div>
          <p style={{ fontSize: "0.78rem", fontWeight: 700, color: s.text, lineHeight: 1.3, marginBottom: 4 }}>{insight.title}</p>
          <p style={{ fontSize: "0.68rem", color: s.text, opacity: 0.75, lineHeight: 1.45 }}>{insight.body}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 600, color: s.pill }}>{insight.action}</span>
          <ChevronRight size={11} style={{ color: s.pill }} />
        </div>
      </div>
    </Link>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null) return null;
  const up = v >= 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: "0.68rem", fontWeight: 700, color: up ? "var(--green)" : "var(--red)" }}>
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(v).toFixed(1)}%
    </span>
  );
}

// Dual currency display
function DualMoney({ egp, usd, large = false }: { egp: number; usd: number; large?: boolean }) {
  const { currency } = useCurrency();
  const primary = currency === "EGP" ? fmt(egp, usd, "EGP") : fmt(egp, usd, "USD");
  const secondary = currency === "EGP"
    ? `$${Math.round(usd).toLocaleString()}`
    : `EGP ${Math.round(egp).toLocaleString()}`;
  return (
    <div>
      <p style={{ fontSize: large ? "1.6rem" : "1.2rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--text)" }}>{primary}</p>
      <p style={{ fontSize: "0.65rem", color: "var(--text3)", marginTop: 3 }}>{secondary}</p>
    </div>
  );
}

// Clickable KPI card
function KpiCard({ label, onClick, loading, children }: { label: string; onClick?: () => void; loading: boolean; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className="card p-3"
      style={{ cursor: onClick ? "pointer" : "default", transition: "all 0.15s", position: "relative" }}
    >
      <p style={{ fontSize: "0.6rem", color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</p>
      {loading ? <div className="skeleton h-8 w-24 mt-1" /> : children}
      {onClick && <ChevronRight size={12} style={{ position: "absolute", top: 12, right: 12, color: "var(--text3)" }} />}
    </div>
  );
}

export default function HomePage() {
  const { currency } = useCurrency();
  const { range } = useDateRange();
  const { drill, open: openDrill, close: closeDrill } = useDrill();

  const [kpi, setKpi] = useState<KPI | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const days = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
      const chartRange = days <= 8 ? "7d" : days <= 32 ? "30d" : days <= 92 ? "90d" : "12m";
      const [kpiRes, chartRes] = await Promise.all([
        fetch(`/api/kpis?from=${from}&to=${to}`).then(x => x.json()),
        fetch(`/api/sales/chart?range=${chartRange}&from=${from}&to=${to}`).then(x => x.json()),
      ]);
      setKpi(kpiRes);
      setChart(chartRes.series || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const res = await fetch("/api/insights").then(x => x.json());
      setInsights(res.insights || []);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => { load(range.from, range.to); }, [range.from, range.to, load]);
  useEffect(() => { loadInsights(); }, [loadInsights]);

  const refresh = () => { setRefreshing(true); load(range.from, range.to); loadInsights(); };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const dateStr = new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "short" });

  const criticalCount = insights.filter(x => x.type === "critical").length;
  const warningCount  = insights.filter(x => x.type === "warning").length;

  const drillUrl = (params: Record<string, string>) =>
    "/api/drill?" + new URLSearchParams({ ...params, from: range.from, to: range.to }).toString();

  return (
    <div style={{ paddingBottom: 80, maxWidth: 1400, margin: "0 auto" }}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(160deg, #0D1B2A 0%, #0f2d4a 60%, #1a3a5c 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "clamp(20px,4vw,28px) 24px 8px" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem" }}>{greeting} · {dateStr}</p>
            <h1 style={{ color: "white", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 1 }}>Le Souverain</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CurrencyToggle />
            <button onClick={refresh} style={{ color: "rgba(255,255,255,0.4)", padding: 7, background: "rgba(255,255,255,0.07)", borderRadius: 10, border: "none", cursor: "pointer" }}
              className={refreshing ? "animate-spin" : ""}>
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {/* Alert bar */}
        {!insightsLoading && (criticalCount > 0 || warningCount > 0) && (
          <div style={{ margin: "6px 24px 0", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "7px 12px", display: "flex", gap: 12 }}>
            {criticalCount > 0 && <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#FCA5A5" }}>🚨 {criticalCount} urgent</span>}
            {warningCount > 0  && <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#FCD34D" }}>⚠️ {warningCount} actions needed</span>}
          </div>
        )}

        {/* Date picker row */}
        <div style={{ padding: "10px 24px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <DateRangePicker dark />
        </div>
      </div>

      {/* ── Two-column grid ──────────────────────────────────────── */}
      <div style={{ padding: "0 24px" }} className="dashboard-content">
        <div className="home-grid">

          {/* LEFT COLUMN */}
          <div className="home-col-left">

            {/* KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
              <KpiCard label="Revenue" loading={loading}
                onClick={kpi ? () => openDrill({ title: `Revenue · ${range.label}`, endpoint: drillUrl({ type: "daily" }) }) : undefined}>
                {kpi && (
                  <>
                    <DualMoney egp={kpi.revenue.egp} usd={kpi.revenue.usd} large />
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                      <Delta v={kpi.revChange} />
                      <span style={{ fontSize: "0.6rem", color: "var(--text3)" }}>vs prev</span>
                    </div>
                  </>
                )}
              </KpiCard>

              <KpiCard label="Units Sold" loading={loading}
                onClick={kpi ? () => openDrill({ title: `Units Sold · ${range.label}`, endpoint: drillUrl({ type: "daily" }) }) : undefined}>
                {kpi && (
                  <>
                    <p style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{kpi.units.toLocaleString()}</p>
                    <Delta v={kpi.unitsChange} />
                  </>
                )}
              </KpiCard>

              <KpiCard label="Avg Ticket" loading={loading}
                onClick={kpi ? () => openDrill({ title: `Top Products · ${range.label}`, endpoint: drillUrl({ type: "items" }) }) : undefined}>
                {kpi && <DualMoney egp={kpi.avgTicket.egp} usd={kpi.avgTicket.usd} />}
              </KpiCard>

              <KpiCard label="Active Stores" loading={loading}
                onClick={kpi ? () => openDrill({ title: `Store Breakdown · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: "all" }) }) : undefined}>
                {kpi && (
                  <>
                    <p style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{kpi.activeStores}</p>
                    <p style={{ fontSize: "0.62rem", color: "var(--text3)", marginTop: 3 }}>1 EGP = ${kpi.fx.toFixed(2)}</p>
                  </>
                )}
              </KpiCard>
            </div>

            {/* Sparkline */}
            <div className="card" style={{ marginTop: 8, padding: "14px 16px 10px", cursor: "pointer" }}
              onClick={() => openDrill({ title: `Daily Revenue · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text2)" }}>Revenue trend</p>
                <Link href="/dashboard/sales" onClick={e => e.stopPropagation()} style={{ fontSize: "0.62rem", color: "var(--accent)", display: "flex", alignItems: "center", gap: 2 }}>
                  Full analysis <ChevronRight size={11} />
                </Link>
              </div>
              {loading ? <div className="skeleton h-20 w-full" /> : (
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={chart} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as ChartPoint;
                      return (
                        <div className="card p-2" style={{ fontSize: "0.65rem" }}>
                          <p style={{ color: "var(--text3)" }}>{d.date}</p>
                          <p style={{ fontWeight: 700 }}>{fmt(d.egp, d.usd, currency)}</p>
                          <p style={{ color: "var(--text3)" }}>{d.usd > 0 ? `$${d.usd.toLocaleString()}` : ""}</p>
                          <p style={{ color: "var(--text3)" }}>{d.units} units</p>
                        </div>
                      );
                    }} />
                    <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#2563EB" strokeWidth={2} fill="url(#grad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel pills */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
              {[
                { label: "Retail", color: "#2563EB", bg: "#EFF6FF", ch: "Retail", icon: "🏪" },
                { label: "Online", color: "#10B981", bg: "#F0FDF4", ch: "Online", icon: "🌐" },
                { label: "B2B",    color: "#F59E0B", bg: "#FFFBEB", ch: "B2B",    icon: "🤝" },
              ].map(c => (
                <button key={c.ch}
                  onClick={() => openDrill({ title: `${c.label} Channel · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: c.ch }) })}
                  style={{ padding: "12px 8px", borderRadius: 14, border: `1.5px solid ${c.color}30`, background: c.bg, cursor: "pointer", textAlign: "center" }}>
                  <p style={{ fontSize: "1.2rem", marginBottom: 4 }}>{c.icon}</p>
                  <p style={{ fontSize: "0.72rem", fontWeight: 700, color: c.color }}>{c.label}</p>
                  <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 1 }}>tap to drill</p>
                </button>
              ))}
            </div>

            {/* Quick actions */}
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Quick Actions</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Stock Alerts",   sub: "Low & critical", icon: "🚨", href: "/dashboard/stock?tab=low",  color: "#EF4444" },
                  { label: "Fast Movers",    sub: "Top selling now", icon: "🔥", href: "/dashboard/stock?tab=fast", color: "#F59E0B" },
                  { label: "Sales Analysis", sub: "Channels & stores",icon:"📊", href: "/dashboard/sales",          color: "#2563EB" },
                  { label: "Ask AI",         sub: "Get recommendations",icon:"✨",href:"/dashboard/ask",           color: "#8B5CF6" },
                ].map(q => (
                  <Link key={q.href} href={q.href} style={{ textDecoration: "none" }}>
                    <div className="card" style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${q.color}15`, fontSize: "1rem" }}>
                        {q.icon}
                      </div>
                      <div>
                        <p style={{ fontSize: "0.73rem", fontWeight: 700, color: "var(--text)" }}>{q.label}</p>
                        <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 1 }}>{q.sub}</p>
                      </div>
                      <ChevronRight size={13} style={{ color: "var(--text3)", marginLeft: "auto" }} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Mobile intelligence feed */}
            <div style={{ marginTop: 20 }} className="mobile-intel-feed">
              <p style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>Intelligence Feed</p>
              {insightsLoading ? (
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ minWidth: 260, height: 140, borderRadius: 16, flexShrink: 0 }} />)}
                </div>
              ) : (
                <div ref={scrollRef} style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }} className="hide-scrollbar">
                  {insights.map(i => <div key={i.id} style={{ flexShrink: 0, scrollSnapAlign: "start" }}><InsightCard insight={i} /></div>)}
                </div>
              )}
            </div>

          </div>{/* end left col */}

          {/* RIGHT COLUMN — intelligence feed (desktop) */}
          <div className="home-col-right">
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <p style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--text)" }}>Intelligence Feed</p>
                  <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 1 }}>Auto-generated · live</p>
                </div>
                {!insightsLoading && <span style={{ fontSize: "0.62rem", color: "var(--text3)" }}>{insights.length} insights</span>}
              </div>
              {insightsLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 130, borderRadius: 16 }} />)}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {insights.map(i => <InsightCard key={i.id} insight={i} />)}
                </div>
              )}
            </div>
          </div>

        </div>{/* end home-grid */}
      </div>

      {/* Drill-down sheet */}
      {drill && <DrillDownSheet params={drill} onClose={closeDrill} />}

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @media (min-width: 768px) {
          .home-grid { display: grid; grid-template-columns: 1fr 360px; gap: 24px; align-items: start; }
          .home-col-left { min-width: 0; }
          .home-col-right { position: sticky; top: 16px; }
          .mobile-intel-feed { display: none !important; }
          .dashboard-content { padding: 0 32px !important; }
        }
        @media (max-width: 767px) {
          .home-grid { display: block; }
          .home-col-right { display: none; }
        }
      `}</style>
    </div>
  );
}
