"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";

type GroupOption = "all" | "retail" | "online" | "ho";

interface ChartPoint { date: string; egp: number; usd: number; units: number }
interface Store { code: string; group: string; revenue: { egp: number; usd: number }; units: number; pct: number }
interface Channel { group: string; revenue: { egp: number; usd: number }; units: number; pct: number }
interface Category { category: string; revenue: { egp: number; usd: number }; units: number; pct: number }

const GROUP_LABELS: Record<GroupOption, string> = { all: "All", retail: "Retail", online: "Online", ho: "B2B" };
const CAT_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899"];
const STORE_COLORS: Record<string, string> = { Retail: "#2563EB", Online: "#10B981", B2B: "#F59E0B" };

function formatDate(d: string, days: number) {
  const dt = new Date(d);
  if (days > 91) return dt.toLocaleDateString("en", { month: "short" });
  return dt.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function SalesContent() {
  const { currency } = useCurrency();
  const { range } = useDateRange();
  const sp = useSearchParams();
  const { drill, open: openDrill, close: closeDrill } = useDrill();

  const [group, setGroup] = useState<GroupOption>((sp.get("group") as GroupOption) || "all");
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<{ egp: number; usd: number }>({ egp: 0, usd: 0 });
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"area" | "bar">("area");

  const days = Math.ceil((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000);
  const chartRange = days <= 8 ? "7d" : days <= 32 ? "30d" : days <= 92 ? "90d" : "12m";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chartRes, storesRes] = await Promise.all([
        fetch(`/api/sales/chart?range=${chartRange}&group=${group}&from=${range.from}&to=${range.to}`).then(x => x.json()),
        fetch(`/api/sales/stores?range=${chartRange}&from=${range.from}&to=${range.to}`).then(x => x.json()),
      ]);
      setChartData(chartRes.series || []);
      const filtered = group === "all"
        ? storesRes.stores
        : storesRes.stores.filter((s: Store) => s.group.toLowerCase() === group);
      setStores(filtered || []);
      setChannels(storesRes.channelTotals || []);
      setCategories(storesRes.categories || []);
      setTotal(storesRes.total || { egp: 0, usd: 0 });
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, group, chartRange]);

  useEffect(() => { load(); }, [load]);

  const val = (v: { egp: number; usd: number }) => fmt(v.egp, v.usd, currency);
  const drillUrl = (params: Record<string, string>) =>
    "/api/drill?" + new URLSearchParams({ ...params, from: range.from, to: range.to }).toString();

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ background: "linear-gradient(135deg, #0D1B2A 0%, #1a3a5c 100%)" }}>
        <div style={{ padding: "clamp(20px,4vw,28px) 24px 8px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ color: "white", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Sales Analytics</h1>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: 2 }}>
              {loading ? "Loading…" : `${val(total)} · ${chartData.reduce((s,d) => s + d.units, 0).toLocaleString()} units`}
            </p>
          </div>
          <DateRangePicker dark />
        </div>
        <div className="scroll-x px-4 pb-3 pt-1 gap-2">
          {(Object.keys(GROUP_LABELS) as GroupOption[]).map(g => (
            <button key={g} onClick={() => setGroup(g)} style={{
              padding: "5px 14px", borderRadius: 20, fontSize: "0.7rem", fontWeight: 600,
              border: "none", cursor: "pointer", flexShrink: 0,
              background: group === g ? "#2563EB" : "rgba(255,255,255,0.1)",
              color: group === g ? "white" : "rgba(255,255,255,0.6)",
            }}>{GROUP_LABELS[g]}</button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3 pt-3">
        {/* Revenue chart */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-3">
            <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)" }}>Revenue over time</p>
            <div className="flex gap-1">
              {(["area", "bar"] as const).map(t => (
                <button key={t} onClick={() => setChartType(t)} style={{
                  padding: "3px 10px", borderRadius: 6, fontSize: "0.62rem", fontWeight: 600,
                  border: "none", cursor: "pointer",
                  background: chartType === t ? "var(--navy)" : "var(--surface2)",
                  color: chartType === t ? "white" : "var(--text3)",
                }}>{t === "area" ? "Line" : "Bar"}</button>
              ))}
            </div>
          </div>
          {loading ? <div className="skeleton h-40 w-full" /> : chartType === "area" ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, days)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as ChartPoint;
                  return <div className="card p-2" style={{ fontSize: "0.65rem" }}>
                    <p style={{ color: "var(--text3)" }}>{d.date}</p>
                    <p style={{ fontWeight: 700 }}>{fmt(d.egp, d.usd, currency)}</p>
                    <p style={{ color: "var(--text3)" }}>{d.units} units</p>
                  </div>;
                }} />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#2563EB" strokeWidth={2} fill="url(#sg)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, days)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as ChartPoint;
                  return <div className="card p-2" style={{ fontSize: "0.65rem" }}>
                    <p style={{ fontWeight: 700 }}>{fmt(d.egp, d.usd, currency)}</p>
                    <p style={{ color: "var(--text3)" }}>{d.units} units</p>
                  </div>;
                }} />
                <Bar dataKey={currency === "USD" ? "usd" : "egp"} fill="#2563EB" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By channel — clickable */}
        <div className="card p-3">
          <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)", marginBottom: 10 }}>By channel</p>
          {channels.map(ch => (
            <div key={ch.group} className="mb-3" onClick={() => openDrill({ title: `${ch.group} Channel · ${range.label}`, endpoint: drillUrl({ type: "channel", channel: ch.group }) })}
              style={{ cursor: "pointer", borderRadius: 8, padding: "6px 4px", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div className="flex justify-between mb-1">
                <span style={{ fontSize: "0.72rem", fontWeight: 600 }}>{ch.group}</span>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "0.72rem", color: "var(--text2)" }}>{ch.units.toLocaleString()} units</span>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700 }}>{val(ch.revenue)}</span>
                  <span className="badge badge-blue">{ch.pct}%</span>
                </div>
              </div>
              <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${ch.pct}%`, background: STORE_COLORS[ch.group] || "#94A3B8", borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              {/* Dual currency */}
              <p style={{ fontSize: "0.6rem", color: "var(--text3)", marginTop: 4 }}>
                {currency === "EGP" ? `$${Math.round(ch.revenue.usd).toLocaleString()} USD` : `EGP ${Math.round(ch.revenue.egp).toLocaleString()}`}
                {" · tap to drill →"}
              </p>
            </div>
          ))}
        </div>

        {/* By category — clickable */}
        <div className="card p-3">
          <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>By product category</p>
          {loading ? <div className="skeleton h-40 w-full" /> : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={categories} dataKey={currency === "USD" ? "revenue.usd" : "revenue.egp"} nameKey="category"
                    cx="40%" cy="50%" outerRadius={65} innerRadius={38} paddingAngle={2}
                    onClick={(d) => { const cat = (d as unknown as Category).category; openDrill({ title: `${cat} · ${range.label}`, endpoint: drillUrl({ type: "category", category: cat }) }); }}
                    style={{ cursor: "pointer" }}>
                    {categories.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as Category;
                    return <div className="card p-2" style={{ fontSize: "0.65rem" }}>
                      <p style={{ fontWeight: 700 }}>{d.category}</p>
                      <p>{val(d.revenue)} · {d.pct}%</p>
                      <p style={{ color: "var(--text3)" }}>{d.units.toLocaleString()} units</p>
                    </div>;
                  }} />
                  <Legend layout="vertical" align="right" verticalAlign="middle" formatter={v => <span style={{ fontSize: "0.62rem" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <p style={{ fontSize: "0.62rem", color: "var(--text3)", textAlign: "center", marginTop: 4 }}>Tap a slice to drill into products</p>
            </>
          )}
        </div>

        {/* Store breakdown — clickable rows */}
        <div className="card overflow-hidden">
          <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)" }}>
              Store breakdown · {GROUP_LABELS[group]}
            </p>
          </div>
          {loading ? (
            <div className="p-3 space-y-2">{[...Array(5)].map((_,i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
          ) : stores.map(s => (
            <div key={s.code} className="list-row px-3"
              onClick={() => openDrill({ title: `${s.code} · ${range.label}`, endpoint: drillUrl({ type: "store", store: s.code }) })}
              style={{ cursor: "pointer" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", marginRight: 10, flexShrink: 0, background: STORE_COLORS[s.group] || "#94A3B8" }} />
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: "0.75rem", fontWeight: 600 }}>{s.code}</p>
                <p style={{ fontSize: "0.62rem", color: "var(--text3)" }}>
                  {s.group} · {s.units.toLocaleString()} units · {currency === "EGP" ? `$${Math.round(s.revenue.usd).toLocaleString()}` : `EGP ${Math.round(s.revenue.egp).toLocaleString()}`}
                </p>
              </div>
              <div className="text-right shrink-0 ml-2">
                <p style={{ fontSize: "0.8rem", fontWeight: 700 }}>{val(s.revenue)}</p>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <div style={{ width: Math.max(s.pct * 0.8, 2), height: 3, background: STORE_COLORS[s.group], borderRadius: 2 }} />
                  <span style={{ fontSize: "0.62rem", color: "var(--text3)" }}>{s.pct}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ height: 8 }} />
      </div>

      {drill && <DrillDownSheet params={drill} onClose={closeDrill} />}
    </div>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center" style={{ color: "var(--text3)" }}>Loading…</div>}>
      <SalesContent />
    </Suspense>
  );
}
