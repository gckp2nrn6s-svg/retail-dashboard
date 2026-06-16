"use client";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend, ReferenceLine,
} from "recharts";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

type GroupOption = "all" | "retail" | "ecom" | "ho";

interface ChartPoint { date: string; egp: number; usd: number; units: number }
interface Store { code: string; group: string; revenue: { egp: number; usd: number }; units: number; pct: number }
interface Channel { group: string; revenue: { egp: number; usd: number }; units: number; pct: number }
interface Category { category: string; revenue: { egp: number; usd: number }; units: number; pct: number }

const GROUP_LABELS: Record<GroupOption, string> = { all: "All", retail: "Retail", ecom: "Ecom", ho: "B2B" };

// Semantic channel colors — consistent with home page
const CHANNEL_COLORS: Record<string, string> = { Retail: "#0D9488", Ecom: "#7C3AED", B2B: "#EA580C" };
const CAT_COLORS = ["#2563EB","#0D9488","#7C3AED","#EA580C","#EC4899","#06B6D4","#F59E0B"];

// Human-readable store names (mirrors db.ts for client-side display)
const STORE_NAMES: Record<string,string> = {
  "CSTARS":"City Stars","CF-HOS":"Cairo Festival City","ALMAZA":"Almaza City Center",
  "P90":"Point 90","CCA":"Alexandria","ONLINE":"Online Store",
  "AMAZON BAN":"Amazon Banha","AMAZON KAM":"Amazon Kamal",
  "NOON":"Noon","JUMIA":"Jumia","HO":"HO / Wholesale",
  "AMAZON":"Amazon Egypt",
  "DUTY FREE":"Duty Free","FOUR SEASO":"Four Seasons","GO SPORT1":"Go Sport",
  "MOA":"Mall of Arabia","MOE":"Mall of Egypt","SPINNEYS":"Spinneys",
};
const STORE_COLORS: Record<string,string> = {
  "CSTARS":"#2563EB","CF-HOS":"#0D9488","ALMAZA":"#7C3AED","P90":"#EA580C",
  "CCA":"#EC4899","ONLINE":"#0891B2","AMAZON BAN":"#F59E0B","AMAZON KAM":"#D97706",
  "SHOPIFY-AMT":"#10B981","SHOPIFY-SAM":"#059669","NOON":"#FBBF24","AMAZON":"#F97316",
  "JUMIA":"#EF4444","DUTY FREE":"#8B5CF6",
};
function sName(code: string) { return STORE_NAMES[code] ?? code; }
function sColor(code: string) { return STORE_COLORS[code] ?? "#94A3B8"; }

function formatDate(d: string, days: number) {
  const dt = new Date(d);
  return days > 91
    ? dt.toLocaleDateString("en", { month: "short" })
    : dt.toLocaleDateString("en", { month: "short", day: "numeric" });
}

// Custom tooltip for charts
function ChartTip({ active, payload, currency, fx }: { active?: boolean; payload?: { payload: ChartPoint }[]; currency: string; fx: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rev = currency === "USD" ? d.usd : d.egp;
  const other = currency === "USD" ? `EGP ${Math.round(d.egp).toLocaleString()}` : `$${Math.round(d.usd).toLocaleString()}`;
  return (
    <div style={{ background: "var(--navy)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.62rem", marginBottom: 4 }}>{d.date}</p>
      <p style={{ color: "white", fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
        {currency === "USD" ? `$${Math.round(rev).toLocaleString()}` : `EGP ${Math.round(rev).toLocaleString()}`}
      </p>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.62rem", marginTop: 2 }}>{other} · {d.units.toLocaleString()} units</p>
    </div>
  );
}

function SalesContent() {
  const { currency } = useCurrency();
  const { range } = useDateRange();
  const sp = useSearchParams();
  const { stack, open: openDrill, push: pushDrill, close: closeDrill } = useDrill();

  const [group, setGroup] = useState<GroupOption>((sp.get("group") as GroupOption) || "all");
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<{ egp: number; usd: number }>({ egp: 0, usd: 0 });
  const [fx, setFx] = useState(52);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"area" | "bar">("area");
  const [autoOpened, setAutoOpened] = useState(false);
  const [navOffline, setNavOffline] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const days = Math.ceil((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000);
  const chartRange = days <= 8 ? "7d" : days <= 32 ? "30d" : days <= 92 ? "90d" : "12m";

  const reqIdRef = useRef(0); // discards stale-response races (MTD load resolving after Today)

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [chartRes, storesRes] = await Promise.all([
        fetch(`/api/sales/chart?range=${chartRange}&group=${group}&from=${range.from}&to=${range.to}`).then(x => x.json()),
        fetch(`/api/sales/stores?range=${chartRange}&from=${range.from}&to=${range.to}`).then(x => x.json()),
      ]);
      if (myReq !== reqIdRef.current) return; // superseded by a newer load
      setChartData(chartRes.series || []);
      const allStores = storesRes.stores || [];
      const filtered = group === "all" ? allStores : allStores.filter((s: Store) => s.group.toLowerCase() === group);
      setStores(filtered);
      setChannels(storesRes.channelTotals || []);
      setCategories(storesRes.categories || []);
      setTotal(storesRes.total || { egp: 0, usd: 0 });
      setFx(storesRes.fx || 52);
      setNavOffline(storesRes.sources?.nav === "offline");
    } catch {
      if (myReq === reqIdRef.current) setLoadError(true);
    } finally { if (myReq === reqIdRef.current) setLoading(false); }
  }, [range.from, range.to, group, chartRange]);

  useEffect(() => { load(); }, [load]);

  // Auto-open store drill when navigated from insight card with ?store=CODE
  useEffect(() => {
    const storeParam = sp.get("store");
    if (!storeParam || autoOpened || loading) return;
    setAutoOpened(true);
    openDrill({
      title: `${sName(storeParam)} · ${range.label}`,
      endpoint: `/api/drill?type=store&store=${encodeURIComponent(storeParam)}&from=${range.from}&to=${range.to}`,
    });
  }, [loading, sp, autoOpened, openDrill, range]);

  const val = (v: { egp: number; usd: number }) => fmt(v.egp, v.usd, currency);
  const sub = (v: { egp: number; usd: number }) => currency === "USD" ? `EGP ${Math.round(v.egp).toLocaleString()}` : `$${Math.round(v.usd).toLocaleString()}`;
  const drillUrl = (p: Record<string, string>) => "/api/drill?" + new URLSearchParams({ ...p, from: range.from, to: range.to }).toString();

  // Map group option key → channelTotals group name
  const groupToChannel: Record<GroupOption, string | null> = { all: null, retail: "Retail", ecom: "Ecom", ho: "B2B" };
  const activeChannel = groupToChannel[group];
  const channelRow = activeChannel ? channels.find(c => c.group === activeChannel) : null;

  // Use channel-specific total when a tab is selected (includes Shopify for Ecom)
  const displayTotal  = channelRow ? channelRow.revenue : total;
  const displayUnits  = channelRow ? channelRow.units : chartData.reduce((s, d) => s + d.units, 0);

  // Avg daily revenue for reference line
  const avgRev = chartData.length > 0 ? chartData.reduce((s,d) => s + (currency === "USD" ? d.usd : d.egp), 0) / chartData.length : 0;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 80 }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(160deg, #050D1A 0%, #0D1B2A 50%, #0f2d4a 100%)" }}>
        <div style={{ padding: "clamp(20px,4vw,28px) 24px 8px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Sales Analytics</p>
            <h1 style={{ color: "white", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3 }}>
              {loading ? "—" : val(displayTotal)}
            </h1>
            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem", marginTop: 3 }}>
              {loading ? "Loading…" : `${displayUnits.toLocaleString()} units · ${range.label}`}
            </p>
          </div>
          <DateRangePicker dark />
        </div>
        <div className="scroll-x" style={{ padding: "8px 24px 16px", gap: 8 }}>
          {(Object.keys(GROUP_LABELS) as GroupOption[]).map(g => (
            <button key={g} onClick={() => setGroup(g)} style={{
              padding: "5px 14px", borderRadius: 20, fontSize: "0.7rem", fontWeight: 600,
              border: "none", cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
              background: group === g ? "white" : "rgba(255,255,255,0.08)",
              color: group === g ? "#0D1B2A" : "rgba(255,255,255,0.5)",
            }}>{GROUP_LABELS[g]}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* NAV-offline / load-error banner */}
        {!loading && (loadError || navOffline) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: loadError ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${loadError ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.3)"}`, borderRadius: 12, padding: "9px 14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.72rem", color: loadError ? "#EF4444" : "#F59E0B", fontWeight: 700 }}>
              {loadError ? "⚠ Couldn't load sales data" : "⚠ NAV offline"}
            </span>
            <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>
              {loadError
                ? "The data service didn't respond. Tap retry."
                : "Showing online (Shopify) sales only — retail, B2B & marketplace figures are temporarily unavailable."}
            </span>
            <button onClick={load} style={{ marginLeft: "auto", fontSize: "0.65rem", color: loadError ? "#EF4444" : "#F59E0B", background: "none", border: `1px solid ${loadError ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)"}`, borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>Retry</button>
          </div>
        )}

        {/* Revenue chart */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)" }}>Revenue over time</p>
            <div style={{ display: "flex", gap: 6 }}>
              {(["area","bar"] as const).map(t => (
                <button key={t} onClick={() => setChartType(t)} style={{
                  padding: "4px 12px", borderRadius: 8, fontSize: "0.65rem", fontWeight: 700, border: "none", cursor: "pointer",
                  background: chartType === t ? "var(--navy)" : "var(--surface3)",
                  color: chartType === t ? "white" : "var(--text3)",
                }}>{t === "area" ? "Line" : "Bar"}</button>
              ))}
            </div>
          </div>
          {loading ? <div className="skeleton" style={{ height: 180 }} /> : chartType === "area" ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}
                onClick={(e) => { const ae = e as { activePayload?: { payload: ChartPoint }[] }; if (ae?.activePayload?.[0]) { const d = ae.activePayload[0].payload; openDrill({ title: `${d.date} · All Items`, endpoint: drillUrl({ type: "daily-detail", date: d.date }) }); } }}>
                <defs>
                  <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#2563EB" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, days)} tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <ReferenceLine y={avgRev} stroke="rgba(37,99,235,0.3)" strokeDasharray="4 4" />
                <Tooltip content={({ active, payload }) => <ChartTip active={active} payload={payload as unknown as { payload: ChartPoint }[] | undefined} currency={currency} fx={fx} />} />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#2563EB" strokeWidth={2.5} fill="url(#sg)" dot={false} activeDot={{ r: 5, fill: "#2563EB", strokeWidth: 2, stroke: "white" }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}
                onClick={(e) => { const ae = e as { activePayload?: { payload: ChartPoint }[] }; if (ae?.activePayload?.[0]) { const d = ae.activePayload[0].payload; openDrill({ title: `${d.date} · All Items`, endpoint: drillUrl({ type: "daily-detail", date: d.date }) }); } }}>
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, days)} tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <ReferenceLine y={avgRev} stroke="rgba(37,99,235,0.3)" strokeDasharray="4 4" />
                <Tooltip content={({ active, payload }) => <ChartTip active={active} payload={payload as unknown as { payload: ChartPoint }[] | undefined} currency={currency} fx={fx} />} />
                <Bar dataKey={currency === "USD" ? "usd" : "egp"} radius={[4,4,0,0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={`hsl(${220 + i * 2}, 80%, 55%)`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p style={{ fontSize: "0.58rem", color: "var(--text4)", textAlign: "right", marginTop: 4 }}>dashed line = period average</p>
        </div>

        {/* By channel */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)", marginBottom: 14 }}>By channel</p>
          {channels.map(ch => {
            const color = CHANNEL_COLORS[ch.group] || "#94A3B8";
            return (
              <div key={ch.group} onClick={() => openDrill({ title: `${ch.group} · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: ch.group }) })}
                style={{ marginBottom: 16, cursor: "pointer", borderRadius: 10, padding: "6px 8px", margin: "0 -8px 12px", transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--surface3)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text)" }}>{ch.group}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: "0.65rem", color: "var(--text3)" }}>{ch.units.toLocaleString()} units</span>
                    <span style={{ fontSize: "0.65rem", color: "var(--text3)" }}>{sub(ch.revenue)}</span>
                    <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--text)" }}>{val(ch.revenue)}</span>
                    <span style={{ fontSize: "0.62rem", fontWeight: 700, color, background: `${color}14`, padding: "2px 7px", borderRadius: 12 }}>{ch.pct}%</span>
                  </div>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${ch.pct}%`, background: `linear-gradient(90deg, ${color}, ${color}90)`, borderRadius: 3, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Category pie */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>By product category</p>
          {loading ? <div className="skeleton" style={{ height: 180 }} /> : (
            <>
              <ResponsiveContainer width="100%" height={185}>
                <PieChart>
                  <Pie data={categories} dataKey={currency === "USD" ? "revenue.usd" : "revenue.egp"} nameKey="category"
                    cx="40%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={3}
                    onClick={d => { const cat = (d as unknown as Category).category; openDrill({ title: `${cat} · ${range.label}`, endpoint: drillUrl({ type: "category", category: cat }) }); }}
                    style={{ cursor: "pointer" }}>
                    {categories.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as Category;
                    return (
                      <div style={{ background: "var(--navy)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px" }}>
                        <p style={{ color: "white", fontWeight: 700, fontSize: "0.82rem" }}>{d.category}</p>
                        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.65rem", marginTop: 2 }}>{val(d.revenue)} · {d.pct}%</p>
                        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.62rem" }}>{d.units.toLocaleString()} units</p>
                      </div>
                    );
                  }} />
                  <Legend layout="vertical" align="right" verticalAlign="middle"
                    formatter={(v, _, i) => <span style={{ fontSize: "0.65rem", color: "var(--text2)", fontWeight: 500 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <p style={{ fontSize: "0.58rem", color: "var(--text4)", textAlign: "center", marginTop: 2 }}>Tap a slice to drill into products</p>
            </>
          )}
        </div>

        {/* Store breakdown */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid var(--border)" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)" }}>Store breakdown · {GROUP_LABELS[group]}</p>
          </div>
          {loading ? (
            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(5)].map((_,i) => <div key={i} className="skeleton" style={{ height: 48 }} />)}
            </div>
          ) : stores.map((s, idx) => (
            <div key={s.code}
              onClick={() => openDrill({ title: `${sName(s.code)} · ${range.label}`, endpoint: drillUrl({ type: "store", store: s.code }) })}
              className="fade-up"
              style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "background 0.1s", animationDelay: `${idx * 0.04}s` }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface3)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              {/* Store avatar */}
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${sColor(s.code)}18`, border: `1.5px solid ${sColor(s.code)}40`, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12, flexShrink: 0 }}>
                <span style={{ fontSize: "0.65rem", fontWeight: 800, color: sColor(s.code) }}>{s.code.slice(0,2)}</span>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text)" }}>{sName(s.code)}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: "0.6rem", fontWeight: 600, color: CHANNEL_COLORS[s.group] ?? "var(--text3)", background: `${CHANNEL_COLORS[s.group] ?? "#94A3B8"}14`, padding: "1px 6px", borderRadius: 8 }}>{s.group}</span>
                  <span style={{ fontSize: "0.6rem", color: "var(--text3)" }}>{s.units.toLocaleString()} units</span>
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                <p style={{ fontSize: "0.88rem", fontWeight: 800, color: "var(--text)" }}>{val(s.revenue)}</p>
                <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 2 }}>{sub(s.revenue)}</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 }}>
                  <div style={{ width: Math.max(s.pct * 1.2, 4), height: 3, background: sColor(s.code), borderRadius: 2 }} />
                  <span style={{ fontSize: "0.58rem", color: "var(--text4)" }}>{s.pct}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>

      {stack.length > 0 && <DrillDownSheet stack={stack} onClose={closeDrill} onPush={pushDrill} />}
    </div>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>Loading…</div>}>
      <SalesContent />
    </Suspense>
  );
}
