"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";
import { ChevronRight } from "lucide-react";

interface Marketplace { code: string; name: string; egp: number; usd: number; units: number; txns: number; pct: number }
interface DayPoint { date: string; egp: number; units: number }

const MP_COLORS: Record<string, string> = {
  Amazon: "#FF9900", Jumia: "#F68B1E", Noon: "#FEEE00", "B-Tech": "#E4002B",
};
const mpColor = (n: string) => MP_COLORS[n] ?? "#7C3AED";

function formatDate(d: string, days: number) {
  const dt = new Date(d);
  return days > 91 ? dt.toLocaleDateString("en", { month: "short" }) : dt.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function ChartTip({ active, payload, currency, fx }: { active?: boolean; payload?: { payload: DayPoint }[]; currency: string; fx: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rev = currency === "USD" ? Math.round(d.egp / fx) : d.egp;
  return (
    <div style={{ background: "var(--navy)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px" }}>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.62rem", marginBottom: 4 }}>{d.date}</p>
      <p style={{ color: "white", fontSize: "1rem", fontWeight: 800 }}>{currency === "USD" ? `$${rev.toLocaleString()}` : `EGP ${rev.toLocaleString()}`}</p>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.62rem", marginTop: 2 }}>{d.units.toLocaleString()} units</p>
    </div>
  );
}

export default function MarketplacePage() {
  const { currency } = useCurrency();
  const { range } = useDateRange();
  const { stack, open: openDrill, push: pushDrill, close: closeDrill } = useDrill();

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [total, setTotal] = useState<{ egp: number; usd: number; units: number }>({ egp: 0, usd: 0, units: 0 });
  const [fx, setFx] = useState(52);
  const [loading, setLoading] = useState(true);
  const [navOffline, setNavOffline] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const reqIdRef = useRef(0);

  const days = Math.ceil((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true); setLoadError(false);
    try {
      const r = await fetch(`/api/marketplace?from=${range.from}&to=${range.to}`).then(x => x.json());
      if (myReq !== reqIdRef.current) return;
      setMarketplaces(r.marketplaces || []);
      setSeries(r.series || []);
      setTotal(r.total || { egp: 0, usd: 0, units: 0 });
      setFx(r.fx || 52);
      setNavOffline(r.sources?.nav === "offline");
    } catch {
      if (myReq === reqIdRef.current) setLoadError(true);
    } finally { if (myReq === reqIdRef.current) setLoading(false); }
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const val = (egp: number) => fmt(egp, Math.round(egp / fx), currency);
  const avgRev = series.length > 0 ? series.reduce((s, d) => s + (currency === "USD" ? Math.round(d.egp / fx) : d.egp), 0) / series.length : 0;

  const drillMarketplace = (m: Marketplace) => openDrill({
    title: `${m.name} · ${range.label}`,
    endpoint: `/api/drill?type=marketplace-items&staff=${m.code}&from=${range.from}&to=${range.to}`,
  });

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(160deg, #1a0b2e 0%, #2a1245 50%, #3a1d5c 100%)" }}>
        <div style={{ padding: "clamp(20px,4vw,28px) 24px 18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Marketplace</p>
            <h1 style={{ color: "white", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3 }}>
              {loading ? "—" : val(total.egp)}
            </h1>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7rem", marginTop: 3 }}>
              {loading ? "Loading…" : `${total.units.toLocaleString()} units · Noon · Jumia · Amazon · B-Tech · ${range.label}`}
            </p>
          </div>
          <DateRangePicker dark />
        </div>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* NAV-offline / error banner — marketplace is NAV-only */}
        {!loading && (loadError || navOffline) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: loadError ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${loadError ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.3)"}`, borderRadius: 12, padding: "9px 14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.72rem", color: loadError ? "#EF4444" : "#F59E0B", fontWeight: 700 }}>{loadError ? "⚠ Couldn't load" : "⚠ NAV offline"}</span>
            <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>{loadError ? "The data service didn't respond." : "Marketplace data comes from NAV, which is temporarily unavailable."}</span>
            <button onClick={load} style={{ marginLeft: "auto", fontSize: "0.65rem", color: loadError ? "#EF4444" : "#F59E0B", background: "none", border: `1px solid ${loadError ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)"}`, borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>Retry</button>
          </div>
        )}

        {/* Trend */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)", marginBottom: 14 }}>Marketplace revenue over time</p>
          {loading ? <div className="skeleton" style={{ height: 180 }} /> : series.length === 0 ? (
            <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text4)", fontSize: "0.8rem" }}>No marketplace sales in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={series} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7C3AED" stopOpacity={0.25} /><stop offset="100%" stopColor="#7C3AED" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, days)} tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <ReferenceLine y={avgRev} stroke="rgba(124,58,237,0.3)" strokeDasharray="4 4" />
                <Tooltip content={({ active, payload }) => <ChartTip active={active} payload={payload as unknown as { payload: DayPoint }[] | undefined} currency={currency} fx={fx} />} />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#7C3AED" strokeWidth={2.5} fill="url(#mg)" dot={false} activeDot={{ r: 5, fill: "#7C3AED", strokeWidth: 2, stroke: "white" }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By marketplace */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)" }}>By marketplace</p>
            <p style={{ fontSize: "0.62rem", color: "var(--text4)" }}>click to see products sold</p>
          </div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 12 }} />)}</div>
          ) : marketplaces.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--text4)", padding: "20px 0", textAlign: "center" }}>No marketplace sales in this period</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {marketplaces.map(m => (
                <div key={m.code} onClick={() => drillMarketplace(m)} className="card-hover" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: mpColor(m.name), flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text)" }}>{m.name}</p>
                    <p style={{ fontSize: "0.62rem", color: "var(--text3)", marginTop: 1 }}>{m.units.toLocaleString()} units · {m.txns.toLocaleString()} orders · {m.pct}% of marketplace</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{val(m.egp)}</p>
                  </div>
                  <ChevronRight size={15} style={{ color: "var(--text4)", flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
          {!loading && marketplaces.length > 0 && (
            <p style={{ fontSize: "0.58rem", color: "var(--text4)", marginTop: 12 }}>
              Marketplace = NAV online sales tagged Amazon / Jumia / Noon / B-Tech. Own-website (Sam + AMT) is counted separately under Ecom via Shopify.
            </p>
          )}
        </div>
      </div>

      {stack.length > 0 && <DrillDownSheet stack={stack} onClose={closeDrill} onPush={pushDrill} />}
    </div>
  );
}
