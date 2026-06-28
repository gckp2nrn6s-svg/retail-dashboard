"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Spinner, Empty, DateFilter, WH_ACCENT, storeName } from "@/components/warehouse/shared";
import { Check } from "lucide-react";
import type { TBRRow } from "./ToBeReceivedTab";

function iso(d: Date) { return d.toISOString().slice(0, 10); }

export default function PaperCheckTab() {
  const [rows, setRows] = useState<TBRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set()); // optimistic, this session
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current; setLoading(true);
    try {
      const r = await fetch(`/api/warehouse/to-be-received?from=${from}&to=${to}`).then(x => x.json());
      if (my !== reqId.current) return;
      const all: TBRRow[] = Array.isArray(r) ? r : (r.rows || []);
      // Paper-check applies to transfers that reached "to be received" in NAV and aren't yet checked.
      setRows(all.filter(t => t.nav_received && !t.paper_checked));
    } catch { if (my === reqId.current) setRows([]); } finally { if (my === reqId.current) setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const check = async (id: number) => {
    setChecking(id);
    try {
      const r = await fetch(`/api/warehouse/paper-check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transferId: id }) }).then(x => x.json());
      if (r.ok) setChecked(s => new Set(s).add(id));
    } catch { /* ignore */ } finally { setChecking(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text2)" }}>Awaiting the signed paper from the warehouse</p>
        <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 12 }} />)}</div>
      ) : rows.length === 0 ? (
        <Empty icon="🧾" title="Nothing to check" sub="Transfers that reach “to be received” in NAV appear here for the signed-paper tick." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(r => {
            const isChecked = checked.has(r.id);
            return (
              <Card key={r.id} style={{ padding: "13px 16px", border: isChecked ? "1.5px solid #10B981" : "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                    <p style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--text)" }}>{r.doc_no} <span style={{ color: "var(--text3)", fontWeight: 500 }}>→ {storeName(r.store)}</span></p>
                    <p style={{ fontSize: "0.64rem", color: "var(--text3)", marginTop: 1 }}>status: {r.current_status || r.status_at_submit}</p>
                  </div>
                  {isChecked ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 11, background: "rgba(16,185,129,0.12)", color: "#10B981", fontWeight: 800, fontSize: "0.8rem" }}>
                      <Check size={16} strokeWidth={3} /> CHECKED THANKS
                    </span>
                  ) : (
                    <button onClick={() => check(r.id)} disabled={checking === r.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 22px", borderRadius: 11, border: "none", cursor: checking === r.id ? "default" : "pointer", background: WH_ACCENT, color: "white", fontWeight: 800, fontSize: "0.8rem", opacity: checking === r.id ? 0.6 : 1 }}>
                      {checking === r.id ? <Spinner size={15} /> : "CHECK"}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
