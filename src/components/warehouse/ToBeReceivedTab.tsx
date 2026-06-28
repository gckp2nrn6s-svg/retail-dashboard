"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Spinner, Empty, DateFilter, fmtInt, WH_ACCENT, storeName, DownloadButton, downloadCsv } from "@/components/warehouse/shared";
import { Check } from "lucide-react";

export interface TBRRow {
  id: number; doc_no: string; store: string; status_at_submit: string; current_status: string;
  stock_deducted: boolean; nav_received: boolean; paper_checked: boolean; done: boolean;
}

function iso(d: Date) { return d.toISOString().slice(0, 10); }

export function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 16, height: 16, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: on ? "#10B981" : "var(--surface3)", border: on ? "none" : "1px solid var(--border)", flexShrink: 0 }}>
        {on && <Check size={11} style={{ color: "white" }} strokeWidth={3} />}
      </span>
      <span style={{ fontSize: "0.66rem", fontWeight: 600, color: on ? "var(--text2)" : "var(--text4)" }}>{label}</span>
    </div>
  );
}

export default function ToBeReceivedTab() {
  const [rows, setRows] = useState<TBRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current; setLoading(true);
    try {
      const r = await fetch(`/api/warehouse/to-be-received?from=${from}&to=${to}`).then(x => x.json());
      if (my !== reqId.current) return;
      setRows(Array.isArray(r) ? r : (r.rows || []));
    } catch { if (my === reqId.current) setRows([]); } finally { if (my === reqId.current) setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const doneCount = rows.filter(r => r.done).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text2)" }}>Submitted transfers · live NAV status</p>
        <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <DownloadButton disabled={rows.length === 0} onClick={() => downloadCsv(`to-be-received-${from}_${to}`, ["Transfer", "Store", "Status", "Stock deducted", "Shipped", "Paper checked", "Done"], rows.map(r => [r.doc_no, storeName(r.store), r.current_status || r.status_at_submit || "", r.stock_deducted ? "Yes" : "No", r.nav_received ? "Yes" : "No", r.paper_checked ? "Yes" : "No", r.done ? "Yes" : "No"]))} />
        {rows.length > 0 && <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--text3)" }}><strong style={{ color: "#10B981" }}>{doneCount}</strong> / {rows.length} done</span>}
      </div>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 66, borderRadius: 12 }} />)}</div>
      ) : rows.length === 0 ? (
        <Empty icon="📥" title="Nothing awaiting receipt" sub="Transfers you SUBMIT in the PO tab land here." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(r => (
            <Card key={r.id} style={{ padding: "13px 16px", border: r.done ? "1.5px solid #10B981" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ minWidth: 180, flex: "1 1 180px" }}>
                  <p style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--text)" }}>{r.doc_no} <span style={{ color: "var(--text3)", fontWeight: 500 }}>→ {storeName(r.store)}</span></p>
                  <p style={{ fontSize: "0.64rem", color: "var(--text3)", marginTop: 1 }}>status: <strong style={{ color: r.nav_received ? "#10B981" : "var(--text2)" }}>{r.current_status || r.status_at_submit}</strong></p>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <Tick on={r.stock_deducted} label="Stock deducted" />
                  <Tick on={r.nav_received} label="Shipped (to receive)" />
                  <Tick on={r.paper_checked} label="Paper checked" />
                </div>
                {r.done && <span style={{ marginLeft: "auto", fontSize: "0.62rem", fontWeight: 800, color: "#10B981", background: "rgba(16,185,129,0.12)", padding: "3px 10px", borderRadius: 8 }}>DONE</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p style={{ fontSize: "0.66rem", color: "var(--text4)" }}>“Shipped (to receive)” ticks automatically once the transfer is shipped in NAV (Qty Shipped &gt; 0, or it has left NAV's open-transfer list as fully received). The status pill shows the live NAV status. “Paper checked” is set in the Paper Check tab.</p>
    </div>
  );
}
