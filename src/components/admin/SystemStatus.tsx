"use client";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

type Health = "ok" | "degraded" | "down";
interface SystemRow { key: string; label: string; group: string; status: Health; detail: string; lastUpdated: string | null }
interface StatusData { checkedAt: string; summary: { ok: number; total: number; allOk: boolean }; systems: SystemRow[] }

const TONE: Record<Health, { color: string; bg: string; word: string }> = {
  ok:       { color: "#10B981", bg: "rgba(16,185,129,0.12)", word: "Operational" },
  degraded: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)", word: "Degraded" },
  down:     { color: "#EF4444", bg: "rgba(239,68,68,0.1)",  word: "Down" },
};

function fmtUpdated(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const hasTime = s.includes("T") || s.includes(":");
  if (!hasTime) return d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function SystemStatus() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { const r = await fetch("/api/status").then(x => x.json()); if (r.systems) setData(r); else setError(true); }
    catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const groups = data ? [...new Set(data.systems.map(s => s.group))] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {data && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.84rem", fontWeight: 700, color: data.summary.allOk ? "#10B981" : "#F59E0B" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: data.summary.allOk ? "#10B981" : "#F59E0B", boxShadow: `0 0 8px ${data.summary.allOk ? "#10B981" : "#F59E0B"}` }} />
            {data.summary.allOk ? "All systems operational" : `${data.summary.ok} / ${data.summary.total} operational`}
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {data && <span style={{ fontSize: "0.68rem", color: "var(--text4)" }}>checked {fmtUpdated(data.checkedAt)}</span>}
          <button onClick={load} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.74rem", fontWeight: 700, color: "var(--text2)" }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }} /> Refresh
          </button>
        </span>
      </div>

      {error ? (
        <div className="card" style={{ padding: 30, textAlign: "center", color: "#EF4444", fontSize: "0.82rem", fontWeight: 600 }}>Couldn't load system status.</div>
      ) : !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 58, borderRadius: 12 }} />)}</div>
      ) : (
        groups.map(group => (
          <div key={group}>
            <p style={{ fontSize: "0.6rem", fontWeight: 700, color: "var(--text4)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 2px 7px" }}>{group}</p>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {data.systems.filter(s => s.group === group).map((s, i) => {
                const t = TONE[s.status];
                return (
                  <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, boxShadow: `0 0 7px ${t.color}aa`, flexShrink: 0 }} />
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <p style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--text)" }}>{s.label}</p>
                      <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginTop: 1 }}>{s.detail}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: "0.6rem", fontWeight: 800, color: t.color, background: t.bg, padding: "2px 9px", borderRadius: 7, textTransform: "uppercase", letterSpacing: "0.03em" }}>{t.word}</span>
                      <p style={{ fontSize: "0.62rem", color: "var(--text4)", marginTop: 3 }}>updated {fmtUpdated(s.lastUpdated)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
