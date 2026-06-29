"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, Spinner, Empty, DateFilter, fmtInt, downloadCsv, DownloadButton } from "@/components/warehouse/shared";

interface Row { id: number; item_no: string; ts: string; type: string; source_ref: string; qty_delta: number; note: string | null; description: string | null }
interface ByType { type: string; n: number; sum: number }

const LABELS: Record<string, string> = { baseline: "Baseline", receipt: "Receipt", transfer_out: "Transfer out", ho_invoice_out: "HO invoice", credit_memo_in: "Credit memo", return_in: "Return", adjust: "Adjustment", stocktake: "Stock take" };
const COLORS: Record<string, string> = { baseline: "#64748B", receipt: "#10B981", transfer_out: "#2563EB", ho_invoice_out: "#EF4444", credit_memo_in: "#0D9488", return_in: "#0891B2", adjust: "#F59E0B", stocktake: "#7C3AED" };
const label = (t: string) => LABELS[t] ?? t;
const color = (t: string) => COLORS[t] ?? "#94A3B8";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtTs = (ts: string) => { const d = new Date(ts); return `${iso(d)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; };

export default function LogTab() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [type, setType] = useState("all");
  const [item, setItem] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [byType, setByType] = useState<ByType[]>([]);
  const [mismatches, setMismatches] = useState(0);
  const [count, setCount] = useState(0);
  const [limit, setLimit] = useState(500);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ from, to, type });
      if (item.trim()) q.set("item", item.trim());
      const r = await fetch(`/api/warehouse/ledger?${q.toString()}`).then(x => x.json());
      setRows(r.rows || []); setByType(r.byType || []); setMismatches(r.mismatches || 0); setCount(r.count || 0); setLimit(r.limit || 500);
    } finally { setLoading(false); }
  }, [from, to, type, item]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const exportCsv = () => downloadCsv(
    `stock-log-${from}_${to}`,
    ["Date", "Type", "Item", "Description", "Change", "Source", "Note"],
    rows.map(r => [fmtTs(r.ts), label(r.type), r.item_no, r.description || "", r.qty_delta, r.source_ref, r.note || ""])
  );

  const chips = [{ type: "all", n: byType.reduce((s, b) => s + b.n, 0) }, ...byType];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ marginRight: "auto" }}>
            <p style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Stock movement log</p>
            <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>Every change to HO on-hand — receipts, transfers, HO sales, adjustments, stock-takes.</p>
          </div>
          {mismatches === 0
            ? <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#10B981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", padding: "6px 12px", borderRadius: 10 }}>✓ Ledger in sync</span>
            : <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "6px 12px", borderRadius: 10 }}>⚠ {mismatches} item{mismatches === 1 ? "" : "s"} out of sync</span>}
        </div>

        {/* type chips */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
          {chips.map(c => {
            const on = type === c.type;
            const col = c.type === "all" ? "var(--text)" : color(c.type);
            return (
              <button key={c.type} onClick={() => setType(c.type)} style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 9, cursor: "pointer",
                border: on ? `1.5px solid ${col}` : "1px solid var(--border)", background: on ? `${col}14` : "var(--surface3)",
                fontSize: "0.72rem", fontWeight: 700, color: on ? col : "var(--text2)",
              }}>
                {c.type !== "all" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: col }} />}
                {c.type === "all" ? "All" : label(c.type)}
                <span style={{ color: "var(--text4)", fontWeight: 600 }}>{c.n}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <input value={item} onChange={e => setItem(e.target.value)} placeholder="filter by item / description"
            style={{ padding: "7px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.74rem", outline: "none", minWidth: 220 }} />
          <DownloadButton onClick={exportCsv} disabled={!rows.length} />
          <span style={{ fontSize: "0.7rem", color: "var(--text3)", marginLeft: "auto" }}>{loading ? "loading…" : `${count} row${count === 1 ? "" : "s"}${count >= limit ? ` (capped at ${limit})` : ""}`}</span>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty icon="📒" title="No movements" sub="Nothing recorded in this range / filter." />
        ) : (
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
              <thead><tr style={{ background: "var(--surface3)", position: "sticky", top: 0 }}>
                {["When", "Type", "Item", "Change", "Source", "Note"].map((h, i) => (
                  <th key={i} style={{ padding: "9px 14px", textAlign: i === 3 ? "right" : "left", fontSize: "0.56rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", color: "var(--text3)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtTs(r.ts)}</td>
                    <td style={{ padding: "8px 14px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.68rem", fontWeight: 700, color: color(r.type) }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color(r.type) }} />{label(r.type)}
                      </span>
                    </td>
                    <td style={{ padding: "8px 14px", maxWidth: 320 }}>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>{r.item_no}</span>
                      {r.description && <span style={{ color: "var(--text3)", marginLeft: 8, fontSize: "0.68rem" }}>{r.description.length > 34 ? r.description.slice(0, 34) + "…" : r.description}</span>}
                    </td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.qty_delta >= 0 ? "#10B981" : "#EF4444" }}>{r.qty_delta >= 0 ? "+" : "−"}{fmtInt(Math.abs(r.qty_delta))}</td>
                    <td style={{ padding: "8px 14px", color: "var(--text3)", fontFamily: "ui-monospace, monospace", fontSize: "0.7rem" }}>{r.source_ref}</td>
                    <td style={{ padding: "8px 14px", color: "var(--text3)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
