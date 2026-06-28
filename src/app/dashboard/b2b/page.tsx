"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";
import { ChevronRight } from "lucide-react";

interface Customer { code: string; name: string; named: boolean; egp: number; usd: number; units: number; txns: number; pct: number; factory?: boolean; client_key?: string }
interface DayPoint { date: string; egp: number; units: number }

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const custColor = (code: string) => `hsl(${(parseInt(code.replace(/\D/g, "") || "0", 10) * 47) % 360} 55% 55%)`;

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

export default function B2BPage() {
  const { currency } = useCurrency();
  const { range } = useDateRange();
  const { stack, open: openDrill, push: pushDrill, close: closeDrill } = useDrill();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [total, setTotal] = useState<{ egp: number; usd: number; units: number }>({ egp: 0, usd: 0, units: 0 });
  const [through, setThrough] = useState<string | null>(null);
  const [factory, setFactory] = useState<{ egp: number; clients: number; syncedAt: string | null }>({ egp: 0, clients: 0, syncedAt: null });
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
      const r = await fetch(`/api/b2b?from=${range.from}&to=${range.to}`).then(x => x.json());
      if (myReq !== reqIdRef.current) return;
      setCustomers(r.customers || []);
      setSeries(r.series || []);
      setTotal(r.total || { egp: 0, usd: 0, units: 0 });
      setThrough(r.through || null);
      setFactory(r.factory || { egp: 0, clients: 0, syncedAt: null });
      setFx(r.fx || 52);
      setNavOffline(r.sources?.nav === "offline");
    } catch {
      if (myReq === reqIdRef.current) setLoadError(true);
    } finally { if (myReq === reqIdRef.current) setLoading(false); }
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const val = (egp: number) => fmt(egp, Math.round(egp / fx), currency);
  const avgRev = series.length > 0 ? series.reduce((s, d) => s + (currency === "USD" ? Math.round(d.egp / fx) : d.egp), 0) / series.length : 0;

  const drillCustomer = (c: Customer) => openDrill({
    title: `${c.name} · ${range.label}`,
    endpoint: c.factory && c.client_key
      ? `/api/drill?type=factory-client-items&client=${encodeURIComponent(c.client_key)}&from=${range.from}&to=${range.to}`
      : `/api/drill?type=b2b-customer-items&customer=${encodeURIComponent(c.code)}&from=${range.from}&to=${range.to}`,
  });

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(160deg, #0c1f2e 0%, #123047 50%, #1b4965 100%)" }}>
        <div style={{ padding: "clamp(20px,4vw,28px) 24px 18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>B2B · Head Office sales</p>
            <h1 style={{ color: "white", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3 }}>
              {loading ? "—" : val(total.egp)}
            </h1>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7rem", marginTop: 3 }}>
              {loading ? "Loading…" : `${total.units.toLocaleString()} units · ${customers.length} customers · ${range.label}`}
            </p>
          </div>
          <DateRangePicker dark />
        </div>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* NAV-offline / error banner — B2B is NAV-only */}
        {!loading && (loadError || navOffline) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: loadError ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${loadError ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.3)"}`, borderRadius: 12, padding: "9px 14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.72rem", color: loadError ? "#EF4444" : "#F59E0B", fontWeight: 700 }}>{loadError ? "⚠ Couldn't load" : "⚠ NAV offline"}</span>
            <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>{loadError ? "The data service didn't respond." : "B2B data comes from NAV, which is temporarily unavailable."}</span>
            <button onClick={load} style={{ marginLeft: "auto", fontSize: "0.65rem", color: loadError ? "#EF4444" : "#F59E0B", background: "none", border: `1px solid ${loadError ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)"}`, borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>Retry</button>
          </div>
        )}

        {/* Lag note */}
        {!loading && !loadError && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface3)", borderRadius: 10, padding: "8px 14px" }}>
            <span style={{ fontSize: "0.7rem" }}>🧾</span>
            <span style={{ fontSize: "0.66rem", color: "var(--text3)" }}>
              HO invoices post 2–4 days after the sale, so recent days fill in late{through ? ` · data through ${through}` : ""}. Net of credit memos (returns).
            </span>
          </div>
        )}

        {/* Factory-direct note */}
        {!loading && !loadError && factory.egp > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.2)", borderRadius: 10, padding: "8px 14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.7rem" }}>🏭</span>
            <span style={{ fontSize: "0.66rem", color: "var(--text3)" }}>
              Includes <strong style={{ color: "var(--text2)" }}>direct factory sales</strong> from the live sheet — {factory.clients} client{factory.clients !== 1 ? "s" : ""} folded in (tagged <span style={{ color: "#0D9488", fontWeight: 700 }}>factory</span>){factory.syncedAt ? ` · synced ${timeAgo(factory.syncedAt)}` : ""}.
            </span>
          </div>
        )}

        {/* Trend */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)", marginBottom: 14 }}>B2B revenue over time</p>
          {loading ? <div className="skeleton" style={{ height: 180 }} /> : series.length === 0 ? (
            <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text4)", fontSize: "0.8rem" }}>No B2B sales in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={series} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                <defs><linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1b4965" stopOpacity={0.3} /><stop offset="100%" stopColor="#1b4965" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, days)} tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text4)" }} tickLine={false} axisLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <ReferenceLine y={avgRev} stroke="rgba(27,73,101,0.4)" strokeDasharray="4 4" />
                <Tooltip content={({ active, payload }) => <ChartTip active={active} payload={payload as unknown as { payload: DayPoint }[] | undefined} currency={currency} fx={fx} />} />
                <Area type="monotone" dataKey={currency === "USD" ? "usd" : "egp"} stroke="#2C7DA0" strokeWidth={2.5} fill="url(#bg2)" dot={false} activeDot={{ r: 5, fill: "#2C7DA0", strokeWidth: 2, stroke: "white" }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By customer */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text2)" }}>By customer</p>
            <p style={{ fontSize: "0.62rem", color: "var(--text4)" }}>click to see products sold</p>
          </div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 12 }} />)}</div>
          ) : customers.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--text4)", padding: "20px 0", textAlign: "center" }}>No B2B sales in this period</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {customers.map(c => (
                <div key={c.code} onClick={() => drillCustomer(c)} className="card-hover" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: custColor(c.code), flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.name}
                      {c.factory && <span style={{ fontSize: "0.55rem", fontWeight: 700, color: "#0D9488", background: "rgba(13,148,136,0.14)", padding: "1px 6px", borderRadius: 6, marginLeft: 6 }}>factory</span>}
                      {!c.named && <span style={{ fontSize: "0.55rem", fontWeight: 700, color: "#F59E0B", background: "rgba(245,158,11,0.12)", padding: "1px 6px", borderRadius: 6, marginLeft: 6 }}>no name</span>}
                    </p>
                    <p style={{ fontSize: "0.62rem", color: "var(--text3)", marginTop: 1 }}>
                      {c.named ? `${c.code} · ` : ""}{c.units.toLocaleString()} units · {c.txns.toLocaleString()} invoices · {c.pct}%
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{val(c.egp)}</p>
                  </div>
                  <ChevronRight size={15} style={{ color: "var(--text4)", flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
          {!loading && customers.length > 0 && (
            <p style={{ fontSize: "0.58rem", color: "var(--text4)", marginTop: 12 }}>
              B2B = Head-Office invoices (NAV SalesInvoiceLine) net of credit memos, by Sell-to customer, plus direct factory sales from the live sheet (tagged <span style={{ color: "#0D9488", fontWeight: 700 }}>factory</span>, merged by client). Names from the CEO customer list; unmatched codes show the code. Separate from retail/Ecom — not in the headline total.
            </p>
          )}
        </div>
      </div>

      {stack.length > 0 && <DrillDownSheet stack={stack} onClose={closeDrill} onPush={pushDrill} />}
    </div>
  );
}
