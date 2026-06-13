"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw, ChevronRight, ArrowUpRight, ArrowDownRight,
  TrendingUp, Package, MessageCircle, BarChart2,
} from "lucide-react";
import { useCurrency, CurrencyToggle, fmt } from "@/components/CurrencyToggle";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";
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

const TYPE_CFG = {
  critical:    { accent: "#EF4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.2)",  label: "URGENT" },
  warning:     { accent: "#F59E0B", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", label: "ACTION" },
  opportunity: { accent: "#10B981", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)", label: "OPPORTUNITY" },
  win:         { accent: "#2563EB", bg: "rgba(37,99,235,0.08)",  border: "rgba(37,99,235,0.2)",  label: "WIN" },
} as const;

function InsightCard({ insight, idx }: { insight: Insight; idx: number }) {
  const c = TYPE_CFG[insight.type];
  return (
    <Link href={insight.link} style={{ textDecoration: "none", display: "block" }} className={`fade-up fade-up-${Math.min(idx + 1, 5)}`}>
      <div
        style={{ background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: 18, padding: "16px 18px", minWidth: 270, maxWidth: 290, cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s" }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${c.accent}25`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "1rem" }}>{insight.icon}</span>
            <span style={{ fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.1em", color: c.accent, background: `${c.accent}18`, padding: "3px 8px", borderRadius: 20 }}>{c.label}</span>
          </div>
          <ChevronRight size={13} style={{ color: c.accent, opacity: 0.6 }} />
        </div>
        <p style={{ fontSize: "2rem", fontWeight: 900, color: c.accent, letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 4 }}>{insight.metric}</p>
        {insight.metricSub && <p style={{ fontSize: "0.62rem", color: c.accent, opacity: 0.7, fontWeight: 600, marginBottom: 8 }}>{insight.metricSub}</p>}
        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text)", lineHeight: 1.35, marginBottom: 4 }}>{insight.title}</p>
        <p style={{ fontSize: "0.65rem", color: "var(--text3)", lineHeight: 1.5 }}>{insight.action}</p>
      </div>
    </Link>
  );
}

function Delta({ v, large = false }: { v: number | null; large?: boolean }) {
  if (v === null) return null;
  const up = v >= 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: large ? "0.8rem" : "0.65rem", fontWeight: 700, color: up ? "var(--green)" : "var(--red)", background: up ? "var(--green-light)" : "var(--red-light)", padding: "2px 8px", borderRadius: 20 }}>
      {up ? <ArrowUpRight size={large ? 13 : 11} /> : <ArrowDownRight size={large ? 13 : 11} />}
      {Math.abs(v).toFixed(1)}%
    </span>
  );
}

function MiniKpi({ label, value, sub, delta, onClick, dark = false }: { label: string; value: string; sub?: string; delta?: number | null; onClick?: () => void; dark?: boolean }) {
  const bg  = dark ? "rgba(255,255,255,0.06)" : "var(--surface)";
  const bdr = dark ? "rgba(255,255,255,0.1)"  : "var(--border)";
  const txt = dark ? "white"                   : "var(--text)";
  const lbl = dark ? "rgba(255,255,255,0.4)"  : "var(--text3)";
  return (
    <div onClick={onClick}
      style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 16, padding: "14px 16px", cursor: onClick ? "pointer" : "default", transition: "all 0.15s" }}
      onMouseEnter={e => onClick && (e.currentTarget.style.background = dark ? "rgba(255,255,255,0.1)" : "var(--surface3)")}
      onMouseLeave={e => { e.currentTarget.style.background = bg; }}
    >
      <p style={{ fontSize: "0.58rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: lbl, marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: txt }}>{value}</p>
      {sub && <p style={{ fontSize: "0.6rem", color: lbl, marginTop: 4 }}>{sub}</p>}
      {delta !== undefined && delta !== null && <div style={{ marginTop: 6 }}><Delta v={delta} /></div>}
    </div>
  );
}

function ChannelPill({ label, icon, color, onClick }: { label: string; icon: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: "14px 8px", borderRadius: 16, border: `1.5px solid ${color}25`, background: `${color}08`, cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color}15`; e.currentTarget.style.borderColor = `${color}50`; }}
      onMouseLeave={e => { e.currentTarget.style.background = `${color}08`; e.currentTarget.style.borderColor = `${color}25`; }}
    >
      <p style={{ fontSize: "1.4rem", marginBottom: 5 }}>{icon}</p>
      <p style={{ fontSize: "0.72rem", fontWeight: 700, color }}>{label}</p>
      <p style={{ fontSize: "0.58rem", color: "var(--text4)", marginTop: 2 }}>drill down →</p>
    </button>
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

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const days = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
      const cr = days <= 8 ? "7d" : days <= 32 ? "30d" : days <= 92 ? "90d" : "12m";
      const [kpiRes, chartRes] = await Promise.all([
        fetch(`/api/kpis?from=${from}&to=${to}`).then(x => x.json()),
        fetch(`/api/sales/chart?range=${cr}&from=${from}&to=${to}`).then(x => x.json()),
      ]);
      setKpi(kpiRes);
      setChart(chartRes.series || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    try { const r = await fetch("/api/insights").then(x => x.json()); setInsights(r.insights || []); }
    finally { setInsightsLoading(false); }
  }, []);

  useEffect(() => { load(range.from, range.to); }, [range.from, range.to, load]);
  useEffect(() => { loadInsights(); }, [loadInsights]);

  const refresh = () => { setRefreshing(true); load(range.from, range.to); loadInsights(); };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const criticalCount = insights.filter(x => x.type === "critical").length;
  const winCount      = insights.filter(x => x.type === "win").length;

  const drillUrl = (p: Record<string, string>) =>
    "/api/drill?" + new URLSearchParams({ ...p, from: range.from, to: range.to }).toString();

  const fmtMoney = (v: { egp: number; usd: number }) =>
    currency === "USD" ? `$${Math.round(v.usd).toLocaleString()}` : `EGP ${Math.round(v.egp).toLocaleString()}`;
  const secondaryCcy = (v: { egp: number; usd: number }) =>
    currency === "USD" ? `EGP ${Math.round(v.egp).toLocaleString()}` : `$${Math.round(v.usd).toLocaleString()}`;

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)", paddingBottom: 80 }}>

      {/* ── HERO HEADER ─────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(160deg, #050D1A 0%, #0D1B2A 50%, #0f2d4a 100%)", paddingBottom: 28, position: "relative", overflow: "hidden" }}>
        {/* bg glow */}
        <div style={{ position: "absolute", top: -100, right: -60, width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 0", position: "relative" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "0.62rem", fontWeight: 500 }}>{greeting}</p>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.76rem", fontWeight: 600, marginTop: 1 }}>{dateStr}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DateRangePicker dark />
            <CurrencyToggle />
            <button onClick={refresh} style={{ color: "rgba(255,255,255,0.4)", padding: 8, background: "rgba(255,255,255,0.07)", borderRadius: 10, border: "none", cursor: "pointer" }} className={refreshing ? "animate-spin" : ""}><RefreshCw size={14} /></button>
          </div>
        </div>

        {/* Alert */}
        {!insightsLoading && criticalCount > 0 && (
          <div style={{ margin: "12px 24px 0", display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "8px 14px" }}>
            <span style={{ fontSize: "0.75rem" }}>🚨</span>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#FCA5A5" }}>{criticalCount} urgent item{criticalCount > 1 ? "s" : ""} need your attention — scroll the feed</span>
          </div>
        )}

        {/* HERO revenue */}
        <div style={{ padding: "24px 24px 0", cursor: "pointer" }} onClick={() => openDrill({ title: `Revenue · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })}>
          <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
            Total Revenue · {range.label}
          </p>
          {loading ? (
            <div style={{ height: 68, width: 280, borderRadius: 12, background: "rgba(255,255,255,0.07)", animation: "shimmer 1.6s ease-in-out infinite", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%)" }} />
          ) : (
            <div className="fade-up">
              <p style={{ fontSize: "clamp(38px,8vw,58px)", fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 1, color: "white" }}>
                {kpi ? fmtMoney(kpi.revenue) : "—"}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <Delta v={kpi?.revChange ?? null} large />
                <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)" }}>vs previous period</span>
                {kpi && <><span style={{ color: "rgba(255,255,255,0.2)" }}>·</span><span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)" }}>{secondaryCcy(kpi.revenue)}</span></>}
              </div>
            </div>
          )}
        </div>

        {/* Sub KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: "18px 24px 0" }} className="kpi-sub-grid">
          <MiniKpi label="Units Sold"    value={loading ? "—" : kpi!.units.toLocaleString()} delta={kpi?.unitsChange ?? null} dark onClick={() => openDrill({ title: `Units · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })} />
          <MiniKpi label="Avg Ticket"    value={loading ? "—" : fmtMoney(kpi!.avgTicket)} sub={loading ? "" : secondaryCcy(kpi!.avgTicket)} dark onClick={() => openDrill({ title: `Top Products · ${range.label}`, endpoint: drillUrl({ type: "items" }) })} />
          <MiniKpi label="Active Stores" value={loading ? "—" : String(kpi?.activeStores ?? "—")} sub={loading ? "" : `1 EGP = $${kpi!.fx.toFixed(2)}`} dark onClick={() => openDrill({ title: `All Channels · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: "all" }) })} />
        </div>

        {/* Sparkline */}
        <div style={{ padding: "18px 24px 0", cursor: "pointer" }} onClick={() => openDrill({ title: `Daily Revenue · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })}>
          {loading ? (
            <div style={{ height: 66, borderRadius: 10, background: "rgba(255,255,255,0.05)" }} />
          ) : (
            <ResponsiveContainer width="100%" height={66}>
              <AreaChart data={chart} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as ChartPoint;
                  return (
                    <div style={{ background: "rgba(5,13,26,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 12px", backdropFilter: "blur(8px)" }}>
                      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.6rem" }}>{d.date}</p>
                      <p style={{ color: "white", fontSize: "0.85rem", fontWeight: 700, marginTop: 2 }}>{fmt(d.egp, d.usd, currency)}</p>
                      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.6rem" }}>{d.units.toLocaleString()} units</p>
                    </div>
                  );
                }} />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#3B82F6" strokeWidth={2.5} fill="url(#hg)" dot={false} activeDot={{ r: 4, fill: "#60A5FA", strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <p style={{ fontSize: "0.56rem", color: "rgba(255,255,255,0.18)", textAlign: "right", marginTop: 4, paddingRight: 2 }}>tap chart for daily breakdown</p>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      <div style={{ padding: "0 20px", maxWidth: 1400, margin: "0 auto" }}>
        <div className="home-grid">

          {/* LEFT COLUMN */}
          <div className="home-col-left">

            {/* Channels */}
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text3)", marginBottom: 10 }}>By Channel</p>
              <div style={{ display: "flex", gap: 10 }}>
                <ChannelPill label="Retail" icon="🏪" color="#0D9488" onClick={() => openDrill({ title: `Retail Stores · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: "Retail" }) })} />
                <ChannelPill label="Online" icon="🌐" color="#7C3AED" onClick={() => openDrill({ title: `Online Channels · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: "Online" }) })} />
                <ChannelPill label="B2B"    icon="🤝" color="#EA580C" onClick={() => openDrill({ title: `B2B Accounts · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: "B2B" }) })} />
              </div>
            </div>

            {/* Quick actions */}
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text3)", marginBottom: 10 }}>Quick Actions</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Sales Analysis",  sub: "Channels & stores",   icon: <TrendingUp    size={17}/>, href: "/dashboard/sales",         color: "#2563EB" },
                  { label: "Stock Alerts",    sub: "Critical & low stock", icon: <Package       size={17}/>, href: "/dashboard/stock?tab=low",  color: "#EF4444" },
                  { label: "Fast Movers",     sub: "Top selling now",      icon: <BarChart2     size={17}/>, href: "/dashboard/stock?tab=fast", color: "#F59E0B" },
                  { label: "Ask AI",          sub: "Get recommendations",  icon: <MessageCircle size={17}/>, href: "/dashboard/ask",            color: "#8B5CF6" },
                ].map(q => (
                  <Link key={q.href} href={q.href} style={{ textDecoration: "none" }}>
                    <div className="card card-hover" style={{ padding: "13px 15px", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${q.color}14`, color: q.color }}>{q.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text)" }}>{q.label}</p>
                        <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 1 }}>{q.sub}</p>
                      </div>
                      <ChevronRight size={14} style={{ color: "var(--text4)", flexShrink: 0 }} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Win banner */}
            {winCount > 0 && !insightsLoading && (
              <div className="fade-up" style={{ marginTop: 14, background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(37,99,235,0.05))", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "1.1rem" }}>🏆</span>
                <div>
                  <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--green)" }}>{winCount} positive signal{winCount > 1 ? "s" : ""} detected</p>
                  <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 2 }}>See intelligence feed →</p>
                </div>
              </div>
            )}

            {/* Mobile feed */}
            <div className="mobile-intel-feed" style={{ marginTop: 20 }}>
              <p style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text3)", marginBottom: 10 }}>Intelligence Feed</p>
              {insightsLoading ? (
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ minWidth: 270, height: 160, borderRadius: 18, flexShrink: 0 }} />)}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }} className="hide-scrollbar">
                  {insights.map((ins, i) => (
                    <div key={ins.id} style={{ flexShrink: 0, scrollSnapAlign: "start" }}>
                      <InsightCard insight={ins} idx={i} />
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT — desktop feed */}
          <div className="home-col-right" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <p style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text3)" }}>Intelligence Feed</p>
                {!insightsLoading && <p style={{ fontSize: "0.6rem", color: "var(--text4)", marginTop: 2 }}>{insights.length} insights · live</p>}
              </div>
            </div>
            {insightsLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 160, borderRadius: 18 }} />)}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {insights.map((ins, i) => <InsightCard key={ins.id} insight={ins} idx={i} />)}
              </div>
            )}
          </div>

        </div>
      </div>

      {drill && <DrillDownSheet params={drill} onClose={closeDrill} />}

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .home-grid { display: block; }
        .home-col-right { display: none; }
        @media (min-width: 900px) {
          .home-grid { display: grid; grid-template-columns: 1fr 310px; gap: 24px; align-items: start; }
          .home-col-left { min-width: 0; }
          .home-col-right { display: block; position: sticky; top: 16px; max-height: calc(100vh - 40px); overflow-y: auto; scrollbar-width: none; }
          .home-col-right::-webkit-scrollbar { display: none; }
          .mobile-intel-feed { display: none !important; }
        }
        @media (max-width: 479px) { .kpi-sub-grid { grid-template-columns: 1fr 1fr !important; } }
      `}</style>
    </div>
  );
}
