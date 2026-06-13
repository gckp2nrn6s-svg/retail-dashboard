"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Package, AlertTriangle,
  RefreshCw, ChevronRight, Zap, Store, ShoppingBag,
} from "lucide-react";
import { useCurrency, CurrencyToggle, fmt } from "@/components/CurrencyToggle";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";

type Range = "today" | "week" | "month" | "year";

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

interface Mover {
  item_no: string; description: string; brand: string; category: string;
  colour_exact: string; size: string; units_sold: number;
  revenue: { egp: number; usd: number }; in_stock: number; daysRemaining: number | null;
}

interface LowStock {
  item_no: string; description: string; brand: string; category: string;
  colour_exact: string; in_stock: number; units_sold_30d: number; daysRemaining: number | null;
}

const RANGE_LABELS: Record<Range, string> = {
  today: "Today", week: "This week", month: "This month", year: "This year",
};

function Delta({ v }: { v: number | null }) {
  if (v === null) return null;
  const up = v >= 0;
  return (
    <span className={`badge ${up ? "badge-green" : "badge-red"}`}>
      {up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {Math.abs(v).toFixed(1)}%
    </span>
  );
}

export default function HomePage() {
  const { currency } = useCurrency();
  const [range, setRange] = useState<Range>("week");
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const [kpiRes, chartRes, moversRes, lowRes] = await Promise.all([
        fetch(`/api/kpis?range=${r}`).then((x) => x.json()),
        fetch(`/api/sales/chart?range=${r === "year" ? "12m" : r === "month" ? "30d" : r === "week" ? "7d" : "7d"}`).then((x) => x.json()),
        fetch("/api/stock/movers?type=fast&range=30d").then((x) => x.json()),
        fetch("/api/stock/movers?type=low").then((x) => x.json()),
      ]);
      setKpi(kpiRes);
      setChart(chartRes.series || []);
      setMovers(moversRes.items?.slice(0, 5) || []);
      setLowStock(lowRes.items?.slice(0, 4) || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  const refresh = () => { setRefreshing(true); load(range); };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D1B2A 0%, #1a3a5c 100%)" }}>
        <div className="flex items-center justify-between px-4 pt-12 pb-2">
          <div>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem" }}>{greeting}</p>
            <h1 style={{ color: "white", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              Le Souverain
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <CurrencyToggle />
            <button
              onClick={refresh}
              style={{ color: "rgba(255,255,255,0.5)", padding: 4 }}
              className={refreshing ? "animate-spin" : ""}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Range tabs */}
        <div className="flex gap-1 px-4 pb-3 pt-1">
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "5px 12px",
                borderRadius: 20,
                fontSize: "0.7rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: range === r ? "white" : "rgba(255,255,255,0.1)",
                color: range === r ? "#0D1B2A" : "rgba(255,255,255,0.6)",
                transition: "all 0.15s",
              }}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3 pt-3">
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="card p-3">
            <p style={{ fontSize: "0.65rem", color: "var(--text3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Revenue</p>
            {loading ? (
              <div className="skeleton h-7 w-24 mt-1" />
            ) : (
              <>
                <p className="kpi-value mt-1">
                  {kpi ? fmt(kpi.revenue.egp, kpi.revenue.usd, currency) : "—"}
                </p>
                <div className="kpi-sub flex items-center gap-1 mt-1">
                  <Delta v={kpi?.revChange ?? null} />
                  <span>vs prev</span>
                </div>
              </>
            )}
          </div>
          <div className="card p-3">
            <p style={{ fontSize: "0.65rem", color: "var(--text3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Units Sold</p>
            {loading ? (
              <div className="skeleton h-7 w-16 mt-1" />
            ) : (
              <>
                <p className="kpi-value mt-1">{kpi?.units.toLocaleString() ?? "—"}</p>
                <div className="kpi-sub flex items-center gap-1 mt-1">
                  <Delta v={kpi?.unitsChange ?? null} />
                  <span>vs prev</span>
                </div>
              </>
            )}
          </div>
          <div className="card p-3">
            <p style={{ fontSize: "0.65rem", color: "var(--text3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Ticket</p>
            {loading ? (
              <div className="skeleton h-7 w-20 mt-1" />
            ) : (
              <p className="kpi-value mt-1">
                {kpi ? fmt(kpi.avgTicket.egp, kpi.avgTicket.usd, currency) : "—"}
              </p>
            )}
          </div>
          <div className="card p-3">
            <p style={{ fontSize: "0.65rem", color: "var(--text3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Rate</p>
            {loading ? (
              <div className="skeleton h-7 w-20 mt-1" />
            ) : (
              <>
                <p className="kpi-value mt-1" style={{ fontSize: "1.3rem" }}>
                  {kpi ? `${kpi.fx.toFixed(1)}` : "—"}
                </p>
                <p className="kpi-sub">EGP / USD</p>
              </>
            )}
          </div>
        </div>

        {/* Sparkline chart */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)" }}>Revenue trend</p>
            <Link href="/dashboard/sales" style={{ fontSize: "0.65rem", color: "var(--accent)" }} className="flex items-center gap-0.5">
              Full view <ChevronRight size={11} />
            </Link>
          </div>
          {loading ? (
            <div className="skeleton h-16 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={64}>
              <AreaChart data={chart} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as ChartPoint;
                    return (
                      <div className="card p-2" style={{ fontSize: "0.65rem" }}>
                        <p style={{ color: "var(--text3)" }}>{d.date}</p>
                        <p style={{ fontWeight: 700 }}>{fmt(d.egp, d.usd, currency)}</p>
                        <p style={{ color: "var(--text3)" }}>{d.units} units</p>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#2563EB" strokeWidth={2} fill="url(#grad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Low stock alerts */}
        {lowStock.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)", background: "#FFF7ED" }}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} style={{ color: "#D97706" }} />
                <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#92400E" }}>
                  {lowStock.length} critical stock alerts
                </p>
              </div>
              <Link href="/dashboard/stock?tab=low" style={{ fontSize: "0.65rem", color: "#D97706" }} className="flex items-center">
                See all <ChevronRight size={11} />
              </Link>
            </div>
            {lowStock.map((item) => (
              <div key={item.item_no} className="list-row px-3">
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: "0.75rem", fontWeight: 600 }} className="truncate">
                    {item.description || item.item_no}
                  </p>
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)" }}>
                    {item.brand} · {item.category}
                  </p>
                </div>
                <div className="ml-2 text-right shrink-0">
                  <p style={{
                    fontSize: "0.85rem", fontWeight: 700,
                    color: item.in_stock <= 2 ? "var(--red)" : "#D97706"
                  }}>
                    {item.in_stock} left
                  </p>
                  {item.daysRemaining !== null && (
                    <p style={{ fontSize: "0.6rem", color: "var(--text3)" }}>{item.daysRemaining}d stock</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fast movers */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: "var(--gold)" }} />
              <p style={{ fontSize: "0.72rem", fontWeight: 700 }}>Fast movers · last 30 days</p>
            </div>
            <Link href="/dashboard/stock?tab=fast" style={{ fontSize: "0.65rem", color: "var(--accent)" }} className="flex items-center">
              See all <ChevronRight size={11} />
            </Link>
          </div>
          {loading ? (
            <div className="p-3 space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 w-full" />)}
            </div>
          ) : (
            movers.map((item, i) => (
              <div key={item.item_no} className="list-row px-3">
                <div
                  className="shrink-0 flex items-center justify-center"
                  style={{
                    width: 24, height: 24, borderRadius: 8, marginRight: 10, fontWeight: 700, fontSize: "0.7rem",
                    background: i === 0 ? "#FEF3C7" : i === 1 ? "#F3F4F6" : "#F8FAFC",
                    color: i === 0 ? "#D97706" : "var(--text3)",
                  }}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: "0.75rem", fontWeight: 600 }} className="truncate">
                    {item.description || item.item_no}
                  </p>
                  <p style={{ fontSize: "0.62rem", color: "var(--text3)" }}>
                    {[item.brand, item.colour_exact, item.size].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="ml-2 text-right shrink-0">
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--green)" }}>{item.units_sold} sold</p>
                  <p style={{ fontSize: "0.62rem", color: "var(--text3)" }}>{item.in_stock} in stock</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Channel pills */}
        <div className="card p-3">
          <p style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Channels
          </p>
          <div className="flex gap-2">
            <Link href="/dashboard/sales?group=retail" className="flex-1 flex flex-col items-center gap-1 rounded-xl p-2.5" style={{ background: "var(--accent-light)" }}>
              <Store size={18} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--accent)" }}>Retail</span>
            </Link>
            <Link href="/dashboard/sales?group=online" className="flex-1 flex flex-col items-center gap-1 rounded-xl p-2.5" style={{ background: "var(--green-light)" }}>
              <ShoppingBag size={18} style={{ color: "var(--green)" }} />
              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--green)" }}>Online</span>
            </Link>
            <Link href="/dashboard/sales?group=ho" className="flex-1 flex flex-col items-center gap-1 rounded-xl p-2.5" style={{ background: "var(--gold-light)" }}>
              <TrendingUp size={18} style={{ color: "var(--gold)" }} />
              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--gold)" }}>HO / B2B</span>
            </Link>
          </div>
        </div>

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}
