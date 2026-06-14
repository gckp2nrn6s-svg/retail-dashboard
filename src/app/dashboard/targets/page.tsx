"use client";
import { useEffect, useState, useCallback } from "react";
import { useCurrency } from "@/components/CurrencyToggle";
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from "recharts";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CHANNEL_COLOR: Record<string,string> = { Retail:"#0D9488", Online:"#7C3AED", B2B:"#EA580C" };
const STORE_COLORS: Record<string,string> = {
  "CF-HOS":"#2563EB","CSTARS":"#0D9488","ALMAZA":"#7C3AED","P90":"#EA580C","CCA":"#EC4899",
  "SHOPIFY-AMT":"#10B981","SHOPIFY-SAM":"#059669",
};

interface StoreTarget {
  code: string; name: string; channel: string;
  target: number; actual: number; projected: number; dailyRate: number;
  pctDone: number|null; pctProject: number|null; gap: number|null; onTrack: boolean|null;
  daysElapsed: number; totalDays: number;
}
interface ChannelRollup {
  target: number; actual: number; projected: number;
  pctDone: number|null; pctProject: number|null; gap: number|null; onTrack: boolean|null;
}
interface TargetsData {
  year: number; month: number; daysElapsed: number; totalDays: number; fx: number;
  stores: StoreTarget[];
  retail: ChannelRollup;
  online: ChannelRollup;
  overall: ChannelRollup;
}

function fmtEGP(n: number) {
  if (Math.abs(n) >= 1_000_000) return `EGP ${(n/1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `EGP ${(n/1_000).toFixed(0)}K`;
  return `EGP ${Math.round(n).toLocaleString()}`;
}
function fmtUSD(n: number, fx: number) {
  const u = n / fx;
  if (Math.abs(u) >= 1_000_000) return `$${(u/1_000_000).toFixed(2)}M`;
  if (Math.abs(u) >= 1_000)     return `$${(u/1_000).toFixed(0)}K`;
  return `$${Math.round(u).toLocaleString()}`;
}

// ── Arc gauge (single store) ─────────────────────────────────────────────────
function ArcGauge({ pct, color, size = 120 }: { pct: number; color: string; size?: number }) {
  const clamped = Math.min(pct, 120);
  const data = [{ value: clamped, fill: color }, { value: 120 - clamped, fill: "var(--border)" }];
  return (
    <div style={{ width: size, height: size * 0.6, position: "relative" }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart cx="50%" cy="90%" innerRadius="70%" outerRadius="100%"
          startAngle={180} endAngle={0} data={data} barSize={10}>
          <RadialBar dataKey="value" cornerRadius={5} background={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div style={{ position:"absolute", bottom:0, left:0, right:0, textAlign:"center" }}>
        <p style={{ fontSize:"0.95rem", fontWeight:900, color:"var(--text)", letterSpacing:"-0.04em" }}>
          {Math.round(pct)}%
        </p>
      </div>
    </div>
  );
}

// ── Linear progress bar ──────────────────────────────────────────────────────
function ProgressBar({ pct, color, projected }: { pct: number; color: string; projected?: number }) {
  const safe = Math.min(pct, 100);
  const projSafe = projected !== undefined ? Math.min(projected, 100) : undefined;
  return (
    <div style={{ position:"relative", height:10, background:"var(--border)", borderRadius:6, overflow:"hidden" }}>
      {/* projected (lighter) */}
      {projSafe !== undefined && projSafe > safe && (
        <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${projSafe}%`,
          background:`${color}30`, borderRadius:6, transition:"width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
      )}
      {/* actual */}
      <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${safe}%`,
        background:`linear-gradient(90deg,${color},${color}cc)`,
        borderRadius:6, transition:"width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
    </div>
  );
}

// ── Gap badge ────────────────────────────────────────────────────────────────
function GapBadge({ gap, fx, currency }: { gap: number|null; fx: number; currency: string }) {
  if (gap === null) return <span style={{color:"var(--text4)",fontSize:"0.6rem"}}>No target</span>;
  const above = gap >= 0;
  const val = currency === "USD" ? fmtUSD(Math.abs(gap), fx) : fmtEGP(Math.abs(gap));
  return (
    <span style={{
      fontSize:"0.62rem", fontWeight:700,
      color: above ? "var(--green)" : "var(--red)",
      background: above ? "var(--green-light)" : "var(--red-light)",
      padding:"2px 8px", borderRadius:20,
    }}>
      {above ? "↑ " : "↓ "}{val} {above ? "above" : "short"}
    </span>
  );
}

// ── Editable target cell ──────────────────────────────────────────────────────
function TargetInput({ store, year, month, current, onSaved }: {
  store: string; year: number; month: number; current: number; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(Math.round(current)));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_code: store, year, month, target_egp: parseFloat(val.replace(/,/g,"")) }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  if (!editing) return (
    <span onClick={() => setEditing(true)}
      style={{ cursor:"pointer", borderBottom:"1px dashed var(--border2)", fontSize:"0.78rem",
        fontWeight:700, color:"var(--text)", display:"inline-block" }}
      title="Click to edit target">
      {current > 0 ? fmtEGP(current) : <span style={{color:"var(--text4)"}}>Set target</span>}
    </span>
  );

  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
      <input
        autoFocus value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key==="Enter") save(); if (e.key==="Escape") setEditing(false); }}
        style={{ width:120, fontSize:"0.78rem", fontWeight:700, padding:"3px 8px",
          border:"1.5px solid var(--action)", borderRadius:8, background:"var(--surface3)",
          color:"var(--text)", outline:"none" }}
        placeholder="e.g. 5000000"
      />
      <button onClick={save} disabled={saving}
        style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 10px", borderRadius:8,
          background:"var(--action)", color:"white", border:"none", cursor:"pointer" }}>
        {saving ? "…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)}
        style={{ fontSize:"0.65rem", color:"var(--text3)", border:"none", background:"none", cursor:"pointer" }}>
        ✕
      </button>
    </span>
  );
}

export default function TargetsPage() {
  const { currency } = useCurrency();
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data,  setData]  = useState<TargetsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/targets?year=${year}&month=${month}`).then(x => x.json());
    setData(r);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => currency === "USD" ? fmtUSD(n, data?.fx ?? 52) : fmtEGP(n);

  const retailStores = data?.stores.filter(s => s.channel === "Retail") ?? [];
  const onlineStores = data?.stores.filter(s => s.channel === "Online") ?? [];

  const daysLeft = data ? data.totalDays - data.daysElapsed : 0;
  const pctMonth = data ? Math.round((data.daysElapsed / data.totalDays) * 100) : 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 20px 80px" }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ background:"linear-gradient(160deg,#050D1A 0%,#0D1B2A 50%,#0f2d4a 100%)", padding:"24px 24px 20px", margin:"0 -20px 20px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div>
            <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.6rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em" }}>
              Targets & Projections
            </p>
            <h1 style={{ color:"white", fontSize:"1.5rem", fontWeight:900, letterSpacing:"-0.04em", marginTop:2 }}>
              {MONTH_NAMES[month-1]} {year}
            </h1>
            {data && (
              <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.7rem", marginTop:4 }}>
                Day {data.daysElapsed} of {data.totalDays} · {daysLeft} days remaining · {pctMonth}% through month
              </p>
            )}
          </div>

          {/* Month picker */}
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            {MONTH_NAMES.map((m,i) => (
              <button key={i} onClick={() => setMonth(i+1)}
                style={{ padding:"4px 10px", borderRadius:20, fontSize:"0.65rem", fontWeight:600,
                  border:"none", cursor:"pointer", transition:"all 0.15s",
                  background: month===i+1 ? "white" : "rgba(255,255,255,0.08)",
                  color: month===i+1 ? "#0D1B2A" : "rgba(255,255,255,0.45)" }}>
                {m}
              </button>
            ))}
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              style={{ padding:"4px 8px", borderRadius:10, fontSize:"0.65rem", fontWeight:700,
                border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.08)",
                color:"white", cursor:"pointer" }}>
              {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Overall summary pills */}
        {data && (
          <div style={{ display:"flex", gap:10, marginTop:16, flexWrap:"wrap" }}>
            {[
              { label:"MTD Revenue",  val: money(data.overall.actual),    sub: "" },
              { label:"Projected EOD",val: money(data.overall.projected), sub: "at current pace" },
              { label:"Total Target", val: money(data.overall.target),    sub: `${MONTH_NAMES[month-1]} ${year}` },
              { label:"Overall",      val: data.overall.pctDone !== null ? `${data.overall.pctDone}%` : "—", sub: "of target reached" },
            ].map(p => (
              <div key={p.label} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:14, padding:"10px 16px", minWidth:130 }}>
                <p style={{ fontSize:"0.55rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"rgba(255,255,255,0.35)", marginBottom:4 }}>{p.label}</p>
                <p style={{ fontSize:"1.1rem", fontWeight:900, color:"white", letterSpacing:"-0.03em", lineHeight:1 }}>{p.val}</p>
                {p.sub && <p style={{ fontSize:"0.58rem", color:"rgba(255,255,255,0.3)", marginTop:3 }}>{p.sub}</p>}
              </div>
            ))}
            <div style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:14, padding:"10px 16px", minWidth:130, display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <p style={{ fontSize:"0.55rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"rgba(255,255,255,0.35)", marginBottom:6 }}>Projection status</p>
              {data.overall.gap !== null ? (
                <GapBadge gap={data.overall.gap} fx={data.fx} currency={currency} />
              ) : <span style={{color:"rgba(255,255,255,0.3)",fontSize:"0.65rem"}}>No target set</span>}
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height:120, borderRadius:18 }} />)}
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── RETAIL STORES ──────────────────────────────── */}
          <div style={{ marginBottom:8 }}>
            <p style={{ fontSize:"0.6rem", fontWeight:800, textTransform:"uppercase", letterSpacing:"0.1em",
              color:"var(--text3)", marginBottom:12 }}>
              Retail Stores · <span style={{ color:"#0D9488" }}>
                {data.retail.pctDone !== null ? `${data.retail.pctDone}% achieved` : "No targets"}
              </span>
              {data.retail.gap !== null && (
                <span style={{ marginLeft:8, fontWeight:700, color: data.retail.gap >= 0 ? "var(--green)" : "var(--red)" }}>
                  · Projected {data.retail.pctProject}% of target
                </span>
              )}
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {retailStores.map(s => <StoreCard key={s.code} store={s} year={year} month={month} currency={currency} fx={data.fx} money={money} onSaved={load} />)}
            </div>
          </div>

          {/* ── RETAIL TOTAL ─────────────────────────────── */}
          <div className="card" style={{ padding:"14px 18px", marginBottom:20, borderLeft:"3px solid #0D9488" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <p style={{ fontWeight:800, fontSize:"0.8rem", color:"var(--text)" }}>Retail Total</p>
              <GapBadge gap={data.retail.gap} fx={data.fx} currency={currency} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
              {[
                { l:"MTD Actual", v: money(data.retail.actual) },
                { l:"Projected", v: money(data.retail.projected) },
                { l:"Target",    v: data.retail.target > 0 ? money(data.retail.target) : "—" },
              ].map(x => (
                <div key={x.l}>
                  <p style={{ fontSize:"0.55rem", fontWeight:700, textTransform:"uppercase", color:"var(--text4)", marginBottom:2 }}>{x.l}</p>
                  <p style={{ fontSize:"0.88rem", fontWeight:800, color:"var(--text)", letterSpacing:"-0.02em" }}>{x.v}</p>
                </div>
              ))}
            </div>
            <ProgressBar pct={data.retail.pctDone ?? 0} color="#0D9488" projected={data.retail.pctProject ?? 0} />
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              <span style={{ fontSize:"0.58rem", color:"var(--text4)" }}>{data.retail.pctDone ?? 0}% done</span>
              <span style={{ fontSize:"0.58rem", color:"var(--text3)" }}>Projected {data.retail.pctProject ?? 0}%</span>
            </div>
          </div>

          {/* ── ONLINE STORES ────────────────────────────── */}
          <div style={{ marginBottom:8 }}>
            <p style={{ fontSize:"0.6rem", fontWeight:800, textTransform:"uppercase", letterSpacing:"0.1em",
              color:"var(--text3)", marginBottom:12 }}>
              Online Channels · <span style={{ color:"#7C3AED" }}>
                {data.online.pctDone !== null ? `${data.online.pctDone}% achieved` : "Set targets to track"}
              </span>
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {onlineStores.map(s => <StoreCard key={s.code} store={s} year={year} month={month} currency={currency} fx={data.fx} money={money} onSaved={load} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Store card component ─────────────────────────────────────────────────────
function StoreCard({ store: s, year, month, currency, fx, money, onSaved }: {
  store: StoreTarget; year: number; month: number; currency: string; fx: number;
  money: (n: number) => string; onSaved: () => void;
}) {
  const color  = STORE_COLORS[s.code] ?? CHANNEL_COLOR[s.channel] ?? "#94A3B8";
  const pct    = s.pctDone    ?? 0;
  const projPct= s.pctProject ?? 0;
  const hasTarget = s.target > 0;

  const statusColor = !hasTarget ? "var(--text4)"
    : s.onTrack ? "var(--green)" : projPct >= 80 ? "#D97706" : "var(--red)";
  const statusLabel = !hasTarget ? "No target"
    : s.onTrack ? "On track 🟢" : projPct >= 80 ? "At risk 🟡" : "Off track 🔴";

  return (
    <div className="card" style={{ padding:"16px 18px", borderLeft:`3px solid ${color}` }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>

        {/* Arc gauge */}
        {hasTarget && (
          <div style={{ flexShrink:0 }}>
            <ArcGauge pct={pct} color={color} size={100} />
          </div>
        )}

        {/* Main info */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6, flexWrap:"wrap", gap:6 }}>
            <div>
              <p style={{ fontWeight:800, fontSize:"0.9rem", color:"var(--text)" }}>{s.name}</p>
              <span style={{ fontSize:"0.58rem", fontWeight:700, color:statusColor }}>{statusLabel}</span>
            </div>
            <div style={{ textAlign:"right" }}>
              <p style={{ fontSize:"0.55rem", fontWeight:700, textTransform:"uppercase", color:"var(--text4)", marginBottom:2 }}>Target</p>
              <TargetInput store={s.code} year={year} month={month} current={s.target} onSaved={onSaved} />
            </div>
          </div>

          {/* Three stats */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <div>
              <p style={{ fontSize:"0.52rem", fontWeight:700, textTransform:"uppercase", color:"var(--text4)", marginBottom:2 }}>MTD Actual</p>
              <p style={{ fontSize:"0.82rem", fontWeight:800, color:"var(--text)", letterSpacing:"-0.02em" }}>{money(s.actual)}</p>
            </div>
            <div>
              <p style={{ fontSize:"0.52rem", fontWeight:700, textTransform:"uppercase", color:"var(--text4)", marginBottom:2 }}>Projected EOD</p>
              <p style={{ fontSize:"0.82rem", fontWeight:800, color:"var(--text)", letterSpacing:"-0.02em" }}>{money(s.projected)}</p>
            </div>
            <div>
              <p style={{ fontSize:"0.52rem", fontWeight:700, textTransform:"uppercase", color:"var(--text4)", marginBottom:2 }}>Daily Rate</p>
              <p style={{ fontSize:"0.82rem", fontWeight:800, color:"var(--text)", letterSpacing:"-0.02em" }}>{money(s.dailyRate)}/d</p>
            </div>
          </div>

          {/* Progress bar */}
          {hasTarget && (
            <>
              <ProgressBar pct={pct} color={color} projected={projPct} />
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:5, flexWrap:"wrap", gap:4 }}>
                <div style={{ display:"flex", gap:10 }}>
                  <span style={{ fontSize:"0.58rem", color:color, fontWeight:700 }}>■ {pct}% achieved</span>
                  <span style={{ fontSize:"0.58rem", color:"var(--text4)" }}>░ {projPct}% projected</span>
                </div>
                <GapBadge gap={s.gap} fx={fx} currency={currency} />
              </div>
              {/* Days needed to hit target */}
              {s.gap !== null && s.gap < 0 && s.dailyRate > 0 && (
                <p style={{ fontSize:"0.6rem", color:"var(--red)", marginTop:5, fontWeight:600 }}>
                  Need {money(s.dailyRate + Math.abs(s.gap) / Math.max(s.totalDays - s.daysElapsed, 1))}/day to catch up
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
