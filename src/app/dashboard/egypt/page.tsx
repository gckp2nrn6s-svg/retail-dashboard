"use client";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell,
} from "recharts";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";

interface LineSummary {
  line: string; code: string;
  revenue_all: number; revenue_period: number; revenue_prev: number;
  units_all: number; units_period: number; units_prev: number;
}
interface Monthly { line: string; month: string; units: string; revenue: string; }
interface StoreRow { line: string; store_code: string; storeName: string; units_period: number; revenue_period: number; units_all: number; revenue_all: number; }
interface Sku {
  item_no: string; description: string; line: string;
  in_stock: number; unit_price: number;
  units_period: number; units_all: number; units_30d: number;
  revenue_period: number; revenue_all: number;
  daysCover: number | null; reorderNow: boolean; stockout: boolean;
}

const LINE_COLORS: Record<string, string> = {
  SKYTRAC: "#2563EB",
  "SKY PARK": "#10B981",
  BRICKLANE: "#F59E0B",
  PRESTON: "#EF4444",
  "TWIST WAVES": "#8B5CF6",
};

function fmt(n: number) { return Math.round(n).toLocaleString(); }
function fmtM(n: number) { return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(Math.round(n)); }
function fmtUsd(egp: number, fx: number) { return fx > 0 ? `$${fmtM(egp / fx)}` : ""; }
function growth(cur: number, prev: number): number | null { return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null; }
function Delta({ v }: { v: number | null }) {
  if (v === null) return <span style={{ fontSize: "0.6rem", color: "var(--text4)" }}>—</span>;
  const up = v >= 0;
  return <span style={{ fontSize: "0.62rem", fontWeight: 700, color: up ? "#10B981" : "#EF4444" }}>{up ? "▲" : "▼"} {Math.abs(v)}%</span>;
}

function parseDesc(desc: string): { color: string; size: string } {
  const sizeMatch = desc.match(/\b(55(?:\/20)?|68(?:\/25)?|69(?:\/25)?|77(?:\/28)?|78|79(?:\/29)?|80(?:\/30)?|66(?:\/24)?|82|67|81)\s*(?:CM|cm)?/i);
  const size = sizeMatch ? sizeMatch[0].toUpperCase().replace("CM", "").trim() : "—";
  const colorMatch = desc.match(/(?:SPINNER\s+|SP\s+|BP\s+)[\d\/]+\s+([A-Z][A-Z\s]+?)(?:\s+[A-Z]{2,3}\d|$)/i);
  let color = colorMatch ? colorMatch[1].trim() : "";
  if (!color) {
    const parts = desc.split(/\s+/);
    const codeIdx = parts.findIndex(p => /^[A-Z]{2,3}\d/.test(p));
    if (codeIdx > 1) color = parts.slice(Math.max(0, codeIdx - 3), codeIdx).filter(p => !/^\d/.test(p)).join(" ");
  }
  return { color: color || "—", size };
}

export default function EgyptPage() {
  const { range } = useDateRange();
  const [data, setData] = useState<{ summary: LineSummary[]; monthly: Monthly[]; byStore: StoreRow[]; skus: Sku[]; fx: number; dataThrough: string | null; from: string; to: string } | null>(null);
  const [activeLine, setActiveLine] = useState("SKYTRAC");
  const [tab, setTab] = useState<"overview" | "stock" | "stores" | "trend">("overview");

  useEffect(() => {
    let ignore = false; // discard a stale response if the range changes mid-flight
    setData(null);
    fetch(`/api/egypt?from=${range.from}&to=${range.to}`).then(r => r.json()).then(d => { if (!ignore) setData(d); });
    return () => { ignore = true; };
  }, [range.from, range.to]);

  const isAll = activeLine === "ALL";
  const lineData = isAll ? null : data?.summary.find(s => s.line === activeLine);
  const lineMonthly = isAll
    ? [] // handled separately for all-lines chart
    : (data?.monthly || []).filter(m => m.line === activeLine).map(m => ({ ...m, revenue: parseFloat(m.revenue), units: parseFloat(m.units) }));
  const lineStores = isAll
    ? Object.values(
        (data?.byStore || []).reduce((acc, s) => {
          if (!acc[s.store_code]) acc[s.store_code] = { ...s };
          else { acc[s.store_code].revenue_period += s.revenue_period; acc[s.store_code].units_period += s.units_period; acc[s.store_code].revenue_all += s.revenue_all; acc[s.store_code].units_all += s.units_all; }
          return acc;
        }, {} as Record<string, StoreRow>)
      ).sort((a, b) => b.revenue_period - a.revenue_period)
    : (data?.byStore || []).filter(s => s.line === activeLine).sort((a, b) => b.revenue_period - a.revenue_period);
  const lineSkus = isAll ? (data?.skus || []) : (data?.skus || []).filter(s => s.line === activeLine);
  const totalRevAll = (data?.summary || []).reduce((a, s) => a + s.revenue_all, 0);
  const totalRevPeriod = (data?.summary || []).reduce((a, s) => a + s.revenue_period, 0);
  const totalRevPrev = (data?.summary || []).reduce((a, s) => a + s.revenue_prev, 0);
  const totalUnitsPeriod = (data?.summary || []).reduce((a, s) => a + s.units_period, 0);
  const fx = data?.fx ?? 50;
  const reorderCount = (data?.skus || []).filter(s => s.reorderNow).length;
  const stockoutCount = (data?.skus || []).filter(s => s.stockout).length;

  const color = LINE_COLORS[activeLine] || "#6366F1";

  const colorGroups: Record<string, Record<string, Sku>> = {};
  lineSkus.forEach(sku => {
    const { color: c, size: sz } = parseDesc(sku.description);
    if (!colorGroups[c]) colorGroups[c] = {};
    colorGroups[c][sz] = sku;
  });
  const allSizes = [...new Set(lineSkus.map(s => parseDesc(s.description).size))].sort();
  const allColors = Object.keys(colorGroups).sort();

  return (
    <div style={{ background: "var(--bg)", minHeight: "100%", paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(160deg, #0D1B2A 0%, #0f2d4a 70%, #1a3a5c 100%)", padding: "28px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "1.3rem" }}>🇪🇬</span>
            <h1 style={{ color: "white", fontWeight: 900, fontSize: "1.3rem", letterSpacing: "-0.03em" }}>Made in Egypt</h1>
          </div>
          <DateRangePicker />
        </div>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem" }}>5 local lines · 1-month restock lead time</p>
        {data ? (
          <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
            {([
              { label: "All-time revenue", value: `EGP ${fmtM(totalRevAll)}`, sub: fmtUsd(totalRevAll, fx) },
              { label: range.label, value: `EGP ${fmtM(totalRevPeriod)}`, sub: fmtUsd(totalRevPeriod, fx), delta: growth(totalRevPeriod, totalRevPrev) },
              { label: "Units sold", value: fmt(totalUnitsPeriod) },
              { label: "⚠️ Reorder now", value: String(reorderCount), alert: true },
              { label: "🔴 Stocked out", value: String(stockoutCount), alert: stockoutCount > 0 },
            ] as { label: string; value: string; sub?: string; delta?: number | null; alert?: boolean }[]).map(k => (
              <div key={k.label}>
                <div style={{ color: k.alert ? "#FCA5A5" : "rgba(255,255,255,0.4)", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <div style={{ color: "white", fontWeight: 800, fontSize: "1rem" }}>{k.value}</div>
                  {k.delta !== undefined && <Delta v={k.delta} />}
                </div>
                {k.sub && <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.62rem", fontWeight: 600 }}>{k.sub} <span style={{ color: "rgba(255,255,255,0.22)" }}>· $1≈{fx.toFixed(1)}</span></div>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>{[1,2,3,4,5].map(i => (<div key={i} style={{ height: 36, borderRadius: 8, background: "rgba(255,255,255,0.05)", animation: "shimmer 1.5s infinite" }} />))}</div>
        )}
      </div>

      {data?.dataThrough && data.dataThrough < new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) && (
        <div style={{ margin: "12px 16px 0", padding: "10px 14px", borderRadius: 12, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", fontSize: "0.7rem", color: "var(--text2)", lineHeight: 1.5 }}>
          ⚠️ <strong>Current-period figures are live.</strong> All-time totals &amp; the monthly trend reflect the synced snapshot through <strong>{data.dataThrough}</strong> — they&apos;ll catch up once the NAV→Postgres sync resumes.
        </div>
      )}

      {/* Line selector */}
      <div style={{ display: "flex", gap: 8, padding: "14px 16px 0", overflowX: "auto" }} className="hide-scrollbar">
        <button onClick={() => setActiveLine("ALL")} style={{
          padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
          fontWeight: 700, fontSize: "0.72rem", flexShrink: 0, transition: "all 0.15s",
          background: activeLine === "ALL" ? "#6366F1" : "var(--surface)",
          color: activeLine === "ALL" ? "white" : "var(--text3)",
          boxShadow: activeLine === "ALL" ? "0 4px 12px rgba(99,102,241,0.4)" : "none",
        }}>All Lines</button>
        {(data?.summary || []).map(s => (
          <button key={s.line} onClick={() => setActiveLine(s.line)} style={{
            padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
            fontWeight: 700, fontSize: "0.72rem", flexShrink: 0, transition: "all 0.15s",
            background: activeLine === s.line ? LINE_COLORS[s.line] : "var(--surface)",
            color: activeLine === s.line ? "white" : "var(--text3)",
            boxShadow: activeLine === s.line ? `0 4px 12px ${LINE_COLORS[s.line]}40` : "none",
          }}>
            {s.line} <span style={{ opacity: 0.7 }}>({s.code})</span>
          </button>
        ))}
      </div>

      {/* Line KPI strip */}
      {data && (
        <div style={{ display: "flex", gap: 10, padding: "12px 16px", overflowX: "auto" }} className="hide-scrollbar">
          {((isAll ? [
            { label: "All-time", value: `EGP ${fmtM(totalRevAll)}`, sub: fmtUsd(totalRevAll, fx) },
            { label: range.label, value: `EGP ${fmtM(totalRevPeriod)}`, sub: fmtUsd(totalRevPeriod, fx), delta: growth(totalRevPeriod, totalRevPrev) },
            { label: "Units (period)", value: fmt(totalUnitsPeriod) },
            { label: "Avg/unit", value: totalUnitsPeriod > 0 ? `EGP ${fmt(totalRevPeriod / totalUnitsPeriod)}` : "—" },
          ] : lineData ? [
            { label: "All-time", value: `EGP ${fmtM(lineData.revenue_all)}`, sub: fmtUsd(lineData.revenue_all, fx) },
            { label: range.label, value: `EGP ${fmtM(lineData.revenue_period)}`, sub: fmtUsd(lineData.revenue_period, fx), delta: growth(lineData.revenue_period, lineData.revenue_prev) },
            { label: "Units (period)", value: fmt(lineData.units_period) },
            { label: "Avg/unit", value: lineData.units_period > 0 ? `EGP ${fmt(lineData.revenue_period / lineData.units_period)}` : "—" },
          ] : []) as { label: string; value: string; sub?: string; delta?: number | null }[]).map(k => (
            <div key={k.label} style={{ background: "var(--surface)", borderRadius: 12, padding: "10px 14px", minWidth: 112, flexShrink: 0, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.58rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "var(--text)" }}>{k.value}</div>
                {k.delta !== undefined && <Delta v={k.delta} />}
              </div>
              {k.sub && <div style={{ fontSize: "0.6rem", color: "var(--text4)", fontWeight: 600, marginTop: 1 }}>{k.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, padding: "0 16px 12px", borderBottom: "1px solid var(--border)" }}>
        {(["overview", "trend", "stores", "stock"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            fontWeight: 600, fontSize: "0.7rem", textTransform: "capitalize",
            background: tab === t ? color : "transparent",
            color: tab === t ? "white" : "var(--text3)",
            transition: "all 0.15s",
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: "16px" }}>
        {!data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 0" }}>{[1,2,3].map(i => (<div key={i} style={{ height: 48, borderRadius: 10, background: "rgba(255,255,255,0.05)", animation: "shimmer 1.5s infinite" }} />))}</div>
        )}

        {/* OVERVIEW */}
        {tab === "overview" && data && (isAll ? (
          <div>
            <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginBottom: 12 }}>Line performance · {range.label} — tap a line for its colour×size grid</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {data.summary.map(s => {
                const g = growth(s.revenue_period, s.revenue_prev);
                const share = totalRevPeriod > 0 ? Math.round((s.revenue_period / totalRevPeriod) * 100) : 0;
                const col = LINE_COLORS[s.line] || "#6366F1";
                const lineReorder = data.skus.filter(k => k.line === s.line && (k.reorderNow || k.stockout)).length;
                return (
                  <button key={s.line} onClick={() => setActiveLine(s.line)} style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${col}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.84rem", color: "var(--text)" }}>{s.line}</span>
                      <span style={{ fontSize: "0.6rem", fontWeight: 700, color: col, background: `${col}1a`, padding: "2px 7px", borderRadius: 6 }}>{s.code}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: "1.15rem", color: "var(--text)", letterSpacing: "-0.02em" }}>EGP {fmtM(s.revenue_period)}</span>
                      <Delta v={g} />
                    </div>
                    <div style={{ fontSize: "0.64rem", color: "var(--text3)", marginTop: 2 }}>{fmtUsd(s.revenue_period, fx)} · {fmt(s.units_period)} units · {share}% of lines</div>
                    {lineReorder > 0 && <div style={{ fontSize: "0.62rem", color: "#EF4444", fontWeight: 700, marginTop: 6 }}>⚠ {lineReorder} need reorder</div>}
                    <div style={{ height: 5, background: "var(--border)", borderRadius: 3, marginTop: 10 }}>
                      <div style={{ height: "100%", width: `${share}%`, background: col, borderRadius: 3 }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginBottom: 12 }}>
              Colour × Size — stock / units sold in period / price. <span style={{ color: "#EF4444" }}>Red = reorder now</span> · <span style={{ color: "#F59E0B" }}>Amber = &lt;60d cover</span>
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--text3)", fontWeight: 700, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>Colour</th>
                    {allSizes.map(sz => (
                      <th key={sz} style={{ textAlign: "center", padding: "6px 8px", color: "var(--text3)", fontWeight: 700, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{sz}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allColors.map(c => (
                    <tr key={c} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", maxWidth: 160 }}>
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{c}</span>
                      </td>
                      {allSizes.map(sz => {
                        const sku = colorGroups[c]?.[sz];
                        if (!sku) return <td key={sz} style={{ padding: "8px 6px", textAlign: "center", color: "var(--text3)" }}>—</td>;
                        const bg = sku.stockout ? "rgba(239,68,68,0.12)" : sku.reorderNow ? "rgba(239,68,68,0.08)" : sku.daysCover !== null && sku.daysCover < 60 ? "rgba(245,158,11,0.08)" : "transparent";
                        const textColor = sku.stockout ? "#EF4444" : sku.reorderNow ? "#EF4444" : sku.daysCover !== null && sku.daysCover < 60 ? "#F59E0B" : "var(--text)";
                        return (
                          <td key={sz} style={{ padding: "4px 6px", textAlign: "center", background: bg, borderRadius: 6 }}>
                            <div style={{ fontWeight: 800, color: textColor, fontSize: "0.75rem" }}>{sku.stockout ? "OUT" : sku.in_stock}</div>
                            <div style={{ color: "var(--text3)", fontSize: "0.6rem" }}>{sku.units_period > 0 ? `${sku.units_period} sold` : "no sales"}</div>
                            <div style={{ color: "var(--text3)", fontSize: "0.6rem" }}>EGP {fmtM(sku.unit_price)}</div>
                            {sku.daysCover !== null && <div style={{ fontSize: "0.58rem", color: textColor }}>{sku.daysCover}d</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lineSkus.filter(s => s.reorderNow || s.stockout).length > 0 && (
              <div style={{ marginTop: 20 }}>
                <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "#EF4444", marginBottom: 8 }}>⚠️ ORDER NOW — Under 30-day cover (based on last 30d sales)</p>
                {lineSkus.filter(s => s.reorderNow || s.stockout).sort((a, b) => (a.daysCover ?? -1) - (b.daysCover ?? -1)).map(sku => (
                  <div key={sku.item_no} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 10, marginBottom: 4, border: "1px solid rgba(239,68,68,0.2)" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.72rem", color: "var(--text)" }}>{sku.description.replace(/\s+[A-Z]{2,3}\d.*/,"")}</div>
                      <div style={{ fontSize: "0.62rem", color: "var(--text3)" }}>EGP {fmt(sku.unit_price)} · {sku.units_30d}/mo sales</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 800, fontSize: "0.8rem", color: "#EF4444" }}>{sku.stockout ? "STOCKED OUT" : `${sku.in_stock} left`}</div>
                      <div style={{ fontSize: "0.62rem", color: "#EF4444" }}>{sku.daysCover !== null ? `${sku.daysCover}d cover` : "0d cover"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* TREND */}
        {tab === "trend" && data && (() => {
          const lines = ["SKYTRAC", "SKY PARK", "BRICKLANE", "PRESTON", "TWIST WAVES"];
          // Build pivot: month → { SKYTRAC: rev, ... }
          const allMonths = [...new Set(data.monthly.map(m => m.month))].sort();
          const pivoted = allMonths.map(month => {
            const row: Record<string, number | string> = { month };
            lines.forEach(l => {
              const m = data.monthly.find(x => x.line === l && x.month === month);
              row[l] = m ? parseFloat(m.revenue) : 0;
            });
            return row;
          });
          return (
            <div>
              {isAll ? (
                <>
                  <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginBottom: 16 }}>Monthly revenue — all lines stacked</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={pivoted} margin={{ left: -10, right: 5, top: 5, bottom: 30 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtM(v)} />
                      <Tooltip formatter={(v) => `EGP ${fmt(Number(v))}`} contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
                      <Line type="monotone" dataKey="month" hide />
                      {lines.map(l => <Bar key={l} dataKey={l} stackId="a" fill={LINE_COLORS[l]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                    {lines.map(l => (
                      <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: LINE_COLORS[l] }} />
                        <span style={{ fontSize: "0.65rem", color: "var(--text3)" }}>{l}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)", marginTop: 24, marginBottom: 8 }}>{range.label} — revenue by line</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.summary} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtM(v)} />
                      <YAxis type="category" dataKey="line" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip formatter={(v) => `EGP ${fmt(Number(v))}`} contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
                      <Bar dataKey="revenue_period" radius={[0, 4, 4, 0]}>
                        {data.summary.map(s => <Cell key={s.line} fill={LINE_COLORS[s.line] || "#888"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <>
                  <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginBottom: 16 }}>Monthly revenue & units — {activeLine}</p>
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)", marginBottom: 8 }}>Revenue (EGP)</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={lineMonthly} margin={{ left: -10, right: 5, top: 5, bottom: 30 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtM(v)} />
                      <Tooltip formatter={(v) => `EGP ${fmt(Number(v))}`} contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
                      <Bar dataKey="revenue" radius={[3, 3, 0, 0]} fill={color} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)", marginTop: 20, marginBottom: 8 }}>Units sold</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={lineMonthly} margin={{ left: -10, right: 5, top: 5, bottom: 30 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
                      <Line type="monotone" dataKey="units" stroke={color} strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)", marginTop: 24, marginBottom: 8 }}>All lines — {range.label} comparison</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.summary} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtM(v)} />
                      <YAxis type="category" dataKey="line" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip formatter={(v) => `EGP ${fmt(Number(v))}`} contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
                      <Bar dataKey="revenue_period" radius={[0, 4, 4, 0]}>
                        {data.summary.map(s => <Cell key={s.line} fill={LINE_COLORS[s.line] || "#888"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          );
        })()}

        {/* STORES */}
        {tab === "stores" && data && (
          <div>
            <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginBottom: 16 }}>Channel breakdown — {activeLine} · {range.label}</p>
            {lineStores.filter(s => s.revenue_period > 0).map((s) => {
              const max = lineStores[0]?.revenue_period || 1;
              const pct = (s.revenue_period / max) * 100;
              return (
                <div key={s.store_code} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" }}>{s.storeName}{s.store_code?.startsWith("FD:") && <span style={{ fontSize: "0.5rem", fontWeight: 700, color: "#0D9488", background: "rgba(13,148,136,0.14)", padding: "1px 5px", borderRadius: 5, marginLeft: 5, verticalAlign: "middle" }}>factory</span>}</span>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text)" }}>EGP {fmtM(s.revenue_period)}</span>
                      <span style={{ fontSize: "0.65rem", color: "var(--text3)", marginLeft: 6 }}>{Math.round(s.units_period)} units</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s" }} />
                  </div>
                </div>
              );
            })}

            <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginTop: 24, marginBottom: 8 }}>All-time by channel</p>
            {lineStores.filter(s => s.revenue_all > 0).map((s) => {
              const maxAll = Math.max(...lineStores.map(x => x.revenue_all));
              const pct = (s.revenue_all / maxAll) * 100;
              return (
                <div key={`all-${s.store_code}`} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text)" }}>{s.storeName}{s.store_code?.startsWith("FD:") && <span style={{ fontSize: "0.5rem", fontWeight: 700, color: "#0D9488", background: "rgba(13,148,136,0.14)", padding: "1px 5px", borderRadius: 5, marginLeft: 5, verticalAlign: "middle" }}>factory</span>}</span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text)" }}>EGP {fmtM(s.revenue_all)}</span>
                  </div>
                  <div style={{ height: 5, background: "var(--border)", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: `${color}80`, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* STOCK */}
        {tab === "stock" && data && (
          <div>
            <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginBottom: 12 }}>Full SKU table — {activeLine} · {range.label}</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.7rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    {["SKU", "Description", "Price", "Stock", "Sold (period)", "Rev (period)", "Cover", "Status"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: h === "Description" ? "left" : "right", color: "var(--text3)", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineSkus.sort((a, b) => b.revenue_period - a.revenue_period).map(sku => {
                    const statusColor = sku.stockout ? "#EF4444" : sku.reorderNow ? "#EF4444" : sku.daysCover !== null && sku.daysCover < 60 ? "#F59E0B" : "#10B981";
                    const statusLabel = sku.stockout ? "OUT" : sku.reorderNow ? "ORDER" : sku.daysCover !== null && sku.daysCover < 60 ? "LOW" : "OK";
                    return (
                      <tr key={sku.item_no} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "7px 8px", color: "var(--text3)", textAlign: "right" }}>{sku.item_no}</td>
                        <td style={{ padding: "7px 8px", color: "var(--text)", maxWidth: 200 }}>
                          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {sku.description.replace(/\s+[A-Z]{2,3}\d.*/,"").trim()}
                          </span>
                        </td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--text)" }}>{fmt(sku.unit_price)}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: sku.stockout ? "#EF4444" : "var(--text)" }}>{sku.in_stock}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--text)" }}>{sku.units_period}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--text)" }}>{fmtM(sku.revenue_period)}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: "var(--text)" }}>{sku.daysCover !== null ? `${sku.daysCover}d` : "—"}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right" }}>
                          <span style={{ background: `${statusColor}20`, color: statusColor, padding: "2px 7px", borderRadius: 6, fontWeight: 700, fontSize: "0.65rem" }}>{statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <style>{`.hide-scrollbar::-webkit-scrollbar{display:none}.hide-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}
