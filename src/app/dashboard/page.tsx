"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  RefreshCw, ChevronRight, ArrowUpRight, ArrowDownRight,
  TrendingUp, Package, MessageCircle, BarChart2, Store,
} from "lucide-react";
import { useCurrency, CurrencyToggle, fmt } from "@/components/CurrencyToggle";
import { LiveBadge } from "@/components/LiveBadge";
import { fmt as fmtNum } from "@/lib/format";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { Insight } from "@/app/api/insights/route";

type Sources = { nav?: string; shopify?: string; pg?: string };
interface KPI {
  revenue: { egp: number; usd: number };
  units: number;
  avgTicket: { egp: number; usd: number };
  activeStores: number;
  revChange: number | null;
  unitsChange: number | null;
  fx: number;
  sources?: Sources;
  degraded?: boolean;
}
interface ChartPoint { date: string; egp: number; usd: number; units: number }
interface StoreRow  { code: string; name: string; group: string; egp: number; usd: number; units: number; pct: number; wow: number | null; this7: number }
interface Channel   { group: string; egp: number; usd: number; units: number; pct: number; storeCount: number }
interface BrandRow  { brand: string; egp: number; usd: number; units: number; pct: number }
interface CatRow    { category: string; egp: number; usd: number; units: number; pct: number }
interface ProductRow{ item_no: string; description: string; brand: string; category: string; egp: number; usd: number; units: number; pct: number }

interface FreshnessRow { source: string; maxDate: string; lagDays: number }
interface HomeData {
  stores: StoreRow[];
  channelTotals: Channel[];
  brands: BrandRow[];
  categories: CatRow[];
  products: ProductRow[];
  totalRev: number;
  fx: number;
  freshness: FreshnessRow[];
  sources?: Sources;
  degraded?: boolean;
}

const TYPE_CFG = {
  critical:    { accent: "#EF4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.2)",  label: "URGENT" },
  warning:     { accent: "#F59E0B", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", label: "ACTION" },
  opportunity: { accent: "#10B981", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)", label: "OPPORTUNITY" },
  win:         { accent: "#2563EB", bg: "rgba(37,99,235,0.08)",  border: "rgba(37,99,235,0.2)",  label: "WIN" },
} as const;

const CHANNEL_COLORS: Record<string,string> = { Retail: "#0D9488", Ecom: "#7C3AED", B2B: "#EA580C" };
const STORE_COLORS: Record<string,string> = {
  "CSTARS":"#2563EB","CF-HOS":"#0D9488","ALMAZA":"#7C3AED","P90":"#EA580C",
  "CCA":"#EC4899","SHOPIFY-AMT":"#10B981","SHOPIFY-SAM":"#059669",
  "NOON":"#FBBF24","AMAZON":"#F97316","JUMIA":"#EF4444",
};
function sColor(code: string) { return STORE_COLORS[code] ?? "#94A3B8"; }

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

function Delta({ v, large = false, dark = false, showNa = false }: { v: number | null; large?: boolean; dark?: boolean; showNa?: boolean }) {
  if (v === null) return showNa ? <span style={{ fontSize: "0.62rem", color: "var(--text4)", background: "var(--surface3)", padding: "2px 8px", borderRadius: 20 }}>N/A</span> : null;
  const up = v >= 0;
  const green = dark ? "#34D399" : "var(--green)";
  const red   = dark ? "#F87171" : "var(--red)";
  const greenBg = dark ? "rgba(52,211,153,0.15)" : "var(--green-light)";
  const redBg   = dark ? "rgba(248,113,113,0.15)" : "var(--red-light)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: large ? "0.8rem" : "0.65rem", fontWeight: 700, color: up ? green : red, background: up ? greenBg : redBg, padding: "2px 8px", borderRadius: 20 }}>
      {up ? <ArrowUpRight size={large ? 13 : 11} /> : <ArrowDownRight size={large ? 13 : 11} />}
      {Math.abs(v).toFixed(1)}%
    </span>
  );
}

function MiniKpi({ label, value, sub, delta, onClick, dark = false }: { label: string; value: string; sub?: string; delta?: number | null; onClick?: () => void; dark?: boolean }) {
  const bg  = dark ? "rgba(255,255,255,0.05)" : "var(--surface)";
  const bdr = dark ? "rgba(255,255,255,0.09)" : "var(--border)";
  const txt = dark ? "white"                   : "var(--text)";
  const lbl = dark ? "rgba(255,255,255,0.35)" : "var(--text3)";
  return (
    <div onClick={onClick}
      style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 18, padding: "14px 16px", cursor: onClick ? "pointer" : "default", transition: "all 0.18s", backdropFilter: dark ? "blur(8px)" : undefined }}
      onMouseEnter={e => onClick && (e.currentTarget.style.background = dark ? "rgba(255,255,255,0.09)" : "var(--surface3)")}
      onMouseLeave={e => { e.currentTarget.style.background = bg; }}
    >
      <p style={{ fontSize: "0.55rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: lbl, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: "1.35rem", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: txt }}>{value}</p>
      {sub && <p style={{ fontSize: "0.58rem", color: lbl, marginTop: 5 }}>{sub}</p>}
      {delta !== undefined && delta !== null && <div style={{ marginTop: 7 }}><Delta v={delta} dark={dark} /></div>}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
      <p style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text3)" }}>{title}</p>
      {sub && <p style={{ fontSize: "0.58rem", color: "var(--text4)" }}>{sub}</p>}
    </div>
  );
}

export default function HomePage() {
  const { currency } = useCurrency();
  const { range } = useDateRange();
  const { stack, open: openDrill, push: pushDrill, close: closeDrill } = useDrill();

  const [kpi, setKpi] = useState<KPI | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [home, setHome] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [homeLoading, setHomeLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(async (from: string, to: string, silent = false) => {
    if (!silent) { setLoading(true); setHomeLoading(true); }
    setError(null);
    try {
      const days = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
      const cr = days <= 8 ? "7d" : days <= 32 ? "30d" : days <= 92 ? "90d" : "12m";
      const [kpiRes, chartRes, homeRes] = await Promise.all([
        fetch(`/api/kpis?from=${from}&to=${to}`).then(x => x.json()),
        fetch(`/api/sales/chart?range=${cr}&from=${from}&to=${to}`).then(x => x.json()),
        fetch(`/api/home?from=${from}&to=${to}`).then(x => x.json()),
      ]);
      setKpi(kpiRes);
      setChart(chartRes.series || []);
      setHome(homeRes);
      setLastUpdated(new Date());
    } catch (e) {
      setError("Failed to load data. Check your connection.");
    } finally { setLoading(false); setHomeLoading(false); setRefreshing(false); }
  }, []);

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    try { const r = await fetch("/api/insights").then(x => x.json()); setInsights(r.insights || []); }
    finally { setInsightsLoading(false); }
  }, []);

  // Initial load on date range change
  useEffect(() => { load(range.from, range.to); }, [range.from, range.to, load]);
  useEffect(() => { loadInsights(); }, [loadInsights]);

  // Auto-refresh every 5 minutes (silent — no loading spinner)
  useEffect(() => {
    const interval = setInterval(() => {
      load(rangeRef.current.from, rangeRef.current.to, true);
      loadInsights();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load, loadInsights]);

  const refresh = () => { setRefreshing(true); load(range.from, range.to); loadInsights(); };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const criticalCount = insights.filter(x => x.type === "critical").length;

  const drillUrl = (params: Record<string, string>) =>
    "/api/drill?" + new URLSearchParams({ ...params, from: range.from, to: range.to }).toString();

  const fmtMoney = (egp: number, usd: number) => fmt(egp, usd, currency);
  const fmtKpi   = (v: { egp: number; usd: number }) => fmtMoney(v.egp, v.usd);
  const altKpi   = (v: { egp: number; usd: number }) => currency === "USD" ? fmt(v.egp, v.usd, "EGP") : fmt(v.egp, v.usd, "USD");

  const topStore = home?.stores[0];
  const maxRev   = topStore?.egp ?? 1;

  // NAV offline → NAV figures (retail/B2B/marketplaces) are unavailable; Shopify still shows.
  const navOffline = kpi?.sources?.nav === "offline" || home?.sources?.nav === "offline";

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)", paddingBottom: 80 }}>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(160deg, #030B16 0%, #0B1A2E 55%, #0D2440 100%)", paddingBottom: 32, position: "relative", overflow: "hidden" }}>
        {/* Ambient glow orbs */}
        <div style={{ position: "absolute", top: -120, right: -80, width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.14) 0%, transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "40%", left: "30%", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(13,148,136,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 0", position: "relative" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "0.62rem", fontWeight: 500 }}>{greeting}</p>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.76rem", fontWeight: 600, marginTop: 1 }}>{dateStr}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <LiveBadge lastUpdated={lastUpdated} refreshing={refreshing} />
            <DateRangePicker dark />
            <CurrencyToggle />
            <button onClick={refresh} style={{ color: "rgba(255,255,255,0.4)", padding: 8, background: "rgba(255,255,255,0.07)", borderRadius: 10, border: "none", cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
            ><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ margin: "10px 24px 0", display: "flex", alignItems: "center", gap: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "7px 12px" }}>
            <span style={{ fontSize: "0.7rem", color: "#EF4444", fontWeight: 600 }}>⚠ {error}</span>
            <button onClick={refresh} style={{ marginLeft: "auto", fontSize: "0.65rem", color: "#EF4444", background: "none", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, padding: "2px 8px", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {/* NAV-offline degraded banner — Shopify still shows, NAV figures don't */}
        {!loading && !error && navOffline && (
          <div style={{ margin: "10px 24px 0", display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "7px 12px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.7rem", color: "#F59E0B", fontWeight: 700 }}>⚠ NAV offline</span>
            <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.6)" }}>Showing online (Shopify) sales only — retail, B2B &amp; marketplace figures are temporarily unavailable.</span>
            <button onClick={refresh} style={{ marginLeft: "auto", fontSize: "0.65rem", color: "#F59E0B", background: "none", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: "2px 8px", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {/* Data freshness banner */}
        {home && home.freshness?.some(f => f.lagDays > 3) && (
          <div style={{ margin: "10px 24px 0", display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: "7px 12px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem" }}>⚠️</span>
            <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "#FDE68A" }}>Data lag detected:</span>
            {home.freshness.filter(f => f.lagDays > 3).map(f => (
              <span key={f.source} style={{ fontSize: "0.62rem", color: "rgba(253,230,138,0.75)", background: "rgba(245,158,11,0.12)", padding: "2px 8px", borderRadius: 8 }}>
                {f.source} last synced {f.maxDate} ({f.lagDays}d ago)
              </span>
            ))}
          </div>
        )}

        {/* Alert banner */}
        {!insightsLoading && criticalCount > 0 && (
          <div style={{ margin: "12px 24px 0", display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "8px 14px" }}>
            <span style={{ fontSize: "0.75rem" }}>🚨</span>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#FCA5A5" }}>{criticalCount} urgent item{criticalCount > 1 ? "s" : ""} need your attention</span>
            <Link href="/dashboard/stock?tab=low" style={{ marginLeft: "auto", fontSize: "0.62rem", color: "#FCA5A5", textDecoration: "none", fontWeight: 700 }}>View →</Link>
          </div>
        )}

        {/* Revenue hero */}
        <div style={{ padding: "24px 24px 0", cursor: "pointer" }} onClick={() => openDrill({ title: `Revenue · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })}>
          <p style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>
            Total Revenue · {range.label}
          </p>
          {loading ? (
            <div style={{ height: 76, width: 300, borderRadius: 12, background: "rgba(255,255,255,0.07)" }} className="skeleton" />
          ) : (
            <div className="fade-up">
              <p className="num-hero" style={{ color: "white", textShadow: "0 0 80px rgba(96,165,250,0.2)" }}>
                {kpi ? fmtKpi(kpi.revenue) : "—"}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <Delta v={kpi?.revChange ?? null} large dark />
                <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.28)" }}>vs previous period</span>
                {kpi && <><span style={{ color: "rgba(255,255,255,0.15)" }}>·</span><span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.28)" }}>{altKpi(kpi.revenue)}</span></>}
              </div>
            </div>
          )}
        </div>

        {/* Sub KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: "20px 24px 0" }} className="kpi-sub-grid">
          <MiniKpi label="Units Sold"    value={loading || !kpi ? "—" : kpi.units.toLocaleString()} delta={kpi?.unitsChange ?? null} dark onClick={() => openDrill({ title: `Daily Units · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })} />
          <MiniKpi label="Avg Ticket"    value={loading || !kpi ? "—" : fmtKpi(kpi.avgTicket)} sub={loading || !kpi ? "" : altKpi(kpi.avgTicket)} dark onClick={() => openDrill({ title: `Top Products · ${range.label}`, endpoint: drillUrl({ type: "items" }) })} />
          <MiniKpi label="Active Stores" value={loading ? "—" : String(kpi?.activeStores ?? "—")} sub={loading ? "" : `$1 = ${(kpi?.fx ?? 52).toFixed(1)} EGP`} dark onClick={() => openDrill({ title: `All Channels · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: "all" }) })} />
        </div>

        {/* Sparkline */}
        <div style={{ padding: "20px 24px 0", cursor: "pointer" }} onClick={() => openDrill({ title: `Daily Revenue · ${range.label}`, endpoint: drillUrl({ type: "daily" }) })}>
          {loading ? <div style={{ height: 84, borderRadius: 12, background: "rgba(255,255,255,0.05)" }} className="skeleton" /> : (
            <ResponsiveContainer width="100%" height={84}>
              <AreaChart data={chart} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
                onClick={(e) => { const ae = e as { activePayload?: { payload: ChartPoint }[] }; if (ae?.activePayload?.[0]) { const d = ae.activePayload[0].payload; openDrill({ title: `${d.date} · All Sales`, endpoint: drillUrl({ type: "daily-detail", date: d.date }) }); } }}>
                <defs>
                  <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3B82F6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as ChartPoint;
                  return (
                    <div style={{ background: "rgba(4,12,24,0.97)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 12, padding: "10px 14px", backdropFilter: "blur(8px)" }}>
                      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.6rem" }}>{d.date}</p>
                      <p style={{ color: "white", fontSize: "0.9rem", fontWeight: 800, marginTop: 2, letterSpacing: "-0.03em" }}>{fmt(d.egp, d.usd, currency)}</p>
                      <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.6rem", marginTop: 2 }}>{d.units.toLocaleString()} units</p>
                    </div>
                  );
                }} />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#3B82F6" strokeWidth={2} fill="url(#hg)" dot={false} activeDot={{ r: 4, fill: "#60A5FA", strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <p style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.14)", textAlign: "right", marginTop: 4, paddingRight: 2 }}>tap any point for daily breakdown</p>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────── */}
      <div style={{ padding: "0 20px", maxWidth: 1400, margin: "0 auto" }}>
        <div className="home-grid">

          {/* LEFT COLUMN */}
          <div className="home-col-left">

            {/* ── CHANNEL SUMMARY ────────────────────────── */}
            <div style={{ marginTop: 20 }}>
              <SectionHeader title="By Channel" sub="click to drill into stores" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {homeLoading ? [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 18 }} />) :
                  home?.channelTotals.map(ch => {
                    const color = CHANNEL_COLORS[ch.group] ?? "#94A3B8";
                    return (
                      <div key={ch.group}
                        onClick={() => openDrill({ title: `${ch.group} · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: ch.group }) })}
                        style={{ background: `${color}0A`, border: `1.5px solid ${color}30`, borderRadius: 18, padding: "16px 14px", cursor: "pointer", transition: "all 0.18s", textAlign: "center", position: "relative", overflow: "hidden" }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${color}18`; e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${color}20`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${color}0A`; e.currentTarget.style.borderColor = `${color}30`; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
                      >
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.6 }} />
                        <p style={{ fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color }}>{ch.group}</p>
                        <p style={{ fontSize: "1.15rem", fontWeight: 900, color: "var(--text)", marginTop: 8, letterSpacing: "-0.03em", lineHeight: 1 }}>
                          {fmt(ch.egp, ch.usd, currency)}
                        </p>
                        <p style={{ fontSize: "0.58rem", color: "var(--text4)", marginTop: 5 }}>{ch.units.toLocaleString()} u · <span style={{ color, fontWeight: 700 }}>{ch.pct}%</span></p>
                      </div>
                    );
                  })
                }
              </div>
            </div>

            {/* ── STORE PERFORMANCE ──────────────────────── */}
            <div className="card" style={{ overflow: "hidden", marginTop: 20 }}>
              <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <SectionHeader title="Store Performance" sub={`${range.label} · click for top products`} />
                <Store size={14} style={{ color: "var(--text4)" }} />
              </div>
              {homeLoading ? (
                <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 44 }} />)}
                </div>
              ) : home?.stores.slice(0, 10).map((s, idx) => {
                const color = sColor(s.code);
                const barW  = Math.round((s.egp / maxRev) * 100);
                return (
                  <div key={s.code}
                    onClick={() => openDrill({ title: `${s.name} · Top Products · ${range.label}`, endpoint: drillUrl({ type: "store", store: s.code }) })}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: idx < (home.stores.length - 1) ? "1px solid var(--border)" : "none", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface3)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    {/* Rank */}
                    <span style={{ fontSize: "0.58rem", fontWeight: 700, color: "var(--text4)", width: 16, textAlign: "center", flexShrink: 0 }}>#{idx + 1}</span>

                    {/* Avatar */}
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}18`, border: `1.5px solid ${color}35`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: "0.58rem", fontWeight: 800, color }}>{s.code.slice(0,2)}</span>
                    </div>

                    {/* Name + bar */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text)" }}>{s.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Delta v={s.wow} showNa />
                          <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--text)" }}>
                            {fmt(s.egp, s.usd, currency)}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${barW}%`, background: `linear-gradient(90deg, ${color}, ${color}80)`, borderRadius: 2, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                        </div>
                        <span style={{ fontSize: "0.56rem", color: "var(--text4)", flexShrink: 0, width: 28, textAlign: "right" }}>{s.units}u</span>
                      </div>
                    </div>
                    <ChevronRight size={12} style={{ color: "var(--text4)", flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>

            {/* ── TOP PRODUCTS ───────────────────────────── */}
            <div className="card" style={{ overflow: "hidden", marginTop: 14 }}>
              <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <SectionHeader title="Top Products" sub={`by revenue · ${range.label}`} />
                <button onClick={() => openDrill({ title: `All Products · ${range.label}`, endpoint: drillUrl({ type: "items" }) })} style={{ fontSize: "0.6rem", color: "var(--action)", background: "var(--action-light)", border: "none", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>See all</button>
              </div>
              {homeLoading ? (
                <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 44 }} />)}
                </div>
              ) : home?.products.map((p, idx) => {
                const catColors: Record<string,string> = { Luggage: "#2563EB", Backpacks: "#0D9488", Bags: "#7C3AED", Accessories: "#EA580C", "Travel Accessories": "#F59E0B" };
                const color = catColors[p.category] ?? "#94A3B8";
                const pBarW = home.totalRev > 0 ? Math.round((p.egp / home.totalRev) * 100 * 3) : 0;
                return (
                  <div key={p.item_no}
                    onClick={() => openDrill({ title: `${p.description} · All Stores`, endpoint: drillUrl({ type: "item", item: p.item_no }) })}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: idx < (home.products.length - 1) ? "1px solid var(--border)" : "none", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface3)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    {/* Rank badge */}
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: idx < 3 ? `${color}20` : "var(--surface3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: "0.62rem", fontWeight: 800, color: idx < 3 ? color : "var(--text4)" }}>#{idx + 1}</span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                        <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{p.description || p.item_no}</p>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: "0.58rem", color: "var(--text4)" }}>{p.units}u</span>
                          <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "var(--text)" }}>
                            {fmt(p.egp, p.usd, currency)}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: "0.56rem", fontWeight: 600, color, background: `${color}15`, padding: "1px 5px", borderRadius: 5, flexShrink: 0 }}>{p.category || "Other"}</span>
                        {p.brand && <span style={{ fontSize: "0.56rem", color: "var(--text4)" }}>{p.brand}</span>}
                        <div style={{ flex: 1, height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(pBarW, 100)}%`, background: color, borderRadius: 2 }} />
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={12} style={{ color: "var(--text4)", flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>

            {/* ── BRAND SPLIT ────────────────────────────── */}
            {!homeLoading && home && home.brands.length > 0 && (
              <div className="card" style={{ padding: "14px 16px", marginTop: 14 }}>
                <SectionHeader title="Brand Breakdown" sub="click to drill into products" />
                {home.brands.map((b, idx) => {
                  const brandColors: Record<string,string> = { "Samsonite": "#003087", "American Tourister": "#E4002B", "Tumi": "#B8860B", "Hartmann": "#4A4A4A" };
                  const color = brandColors[b.brand] ?? ["#2563EB","#0D9488","#7C3AED","#EA580C","#EC4899","#F59E0B"][idx % 6];
                  return (
                    <div key={b.brand}
                      onClick={() => openDrill({ title: `${b.brand} Products · ${range.label}`, endpoint: drillUrl({ type: "items", brand: b.brand }) })}
                      style={{ marginBottom: 12, cursor: "pointer", borderRadius: 10, padding: "6px 8px", margin: "0 -8px 8px", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface3)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text)" }}>{b.brand}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: "0.6rem", color: "var(--text4)" }}>{b.units.toLocaleString()} units</span>
                          <span style={{ fontSize: "0.8rem", fontWeight: 800, color: "var(--text)" }}>
                            {fmt(b.egp, b.usd, currency)}
                          </span>
                          <span style={{ fontSize: "0.62rem", fontWeight: 700, color, background: `${color}14`, padding: "2px 7px", borderRadius: 12 }}>{b.pct}%</span>
                        </div>
                      </div>
                      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${b.pct}%`, background: `linear-gradient(90deg, ${color}, ${color}80)`, borderRadius: 3, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── CATEGORY BREAKDOWN ─────────────────────── */}
            {!homeLoading && home && home.categories.length > 0 && (
              <div className="card" style={{ padding: "14px 16px", marginTop: 14 }}>
                <SectionHeader title="Category Breakdown" sub="click to see products in each category" />
                {home.categories.slice(0, 8).map((c, idx) => {
                  const catColors: Record<string,string> = { Luggage: "#2563EB", Backpacks: "#0D9488", Bags: "#7C3AED", Accessories: "#EA580C", "Travel Accessories": "#F59E0B", "Online Other": "#6366F1" };
                  const color = catColors[c.category] ?? ["#06B6D4","#EC4899","#84CC16","#FB923C"][idx % 4];
                  return (
                    <div key={c.category}
                      onClick={() => openDrill({ title: `${c.category} Products · ${range.label}`, endpoint: drillUrl({ type: "category", category: c.category }) })}
                      style={{ marginBottom: 8, cursor: "pointer", borderRadius: 10, padding: "6px 8px", margin: "0 -8px 8px", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface3)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text)" }}>{c.category}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: "0.6rem", color: "var(--text4)" }}>{c.units.toLocaleString()} u</span>
                          <span style={{ fontSize: "0.8rem", fontWeight: 800, color: "var(--text)" }}>
                            {fmt(c.egp, c.usd, currency)}
                          </span>
                          <span style={{ fontSize: "0.62rem", fontWeight: 700, color, background: `${color}14`, padding: "2px 7px", borderRadius: 12 }}>{c.pct}%</span>
                        </div>
                      </div>
                      <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${c.pct}%`, background: `linear-gradient(90deg, ${color}, ${color}80)`, borderRadius: 3, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── QUICK ACTIONS ──────────────────────────── */}
            <div style={{ marginTop: 14 }}>
              <SectionHeader title="Quick Actions" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Sales Analysis",  sub: "Channels & stores",    icon: <TrendingUp    size={17}/>, href: "/dashboard/sales",         color: "#2563EB" },
                  { label: "Stock Alerts",    sub: "Critical & low stock",  icon: <Package       size={17}/>, href: "/dashboard/stock?tab=low",  color: "#EF4444" },
                  { label: "Fast Movers",     sub: "Top selling now",       icon: <BarChart2     size={17}/>, href: "/dashboard/stock?tab=fast", color: "#F59E0B" },
                  { label: "Ask AI",          sub: "Get recommendations",   icon: <MessageCircle size={17}/>, href: "/dashboard/ask",            color: "#8B5CF6" },
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

            {/* Mobile intel feed */}
            <div className="mobile-intel-feed" style={{ marginTop: 20 }}>
              <SectionHeader title="Intelligence Feed" />
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

          {/* RIGHT — desktop intelligence feed */}
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

      {stack.length > 0 && <DrillDownSheet stack={stack} onClose={closeDrill} onPush={pushDrill} />}

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
