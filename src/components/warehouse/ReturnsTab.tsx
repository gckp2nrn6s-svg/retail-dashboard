"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, Spinner, Empty, fmtInt, storeName, MovementReceipt, type MoveRow } from "@/components/warehouse/shared";
import { Check } from "lucide-react";

interface Line { item_no: string; description: string | null; qty: number; current: number }
interface Doc { doc: string; store: string; date: string | null; applied: boolean; lines: Line[]; totalQty: number }

export default function ReturnsTab() {
  const [returns, setReturns] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [active, setActive] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await fetch("/api/warehouse/ho-returns").then(x => x.json()); setReturns(r.returns || []); setDegraded(!!r.degraded); }
    catch { setError("Couldn't load returns."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sorted = [...returns].sort((a, b) => (a.applied === b.applied ? (b.date || "").localeCompare(a.date || "") : a.applied ? 1 : -1));
  const pending = returns.filter(d => !d.applied).length;
  const preview: MoveRow[] | null = active ? active.lines.map(l => ({ item_no: l.item_no, description: l.description, current: l.current, delta: l.qty, next: l.current + l.qty })) : null;

  const confirm = useCallback(async () => {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/warehouse/return-apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc: active.doc }) }).then(x => x.json());
      if (r.ok) { setActive(null); await load(); } else setError(r.error || "Failed to receive.");
    } catch { setError("Failed to receive."); } finally { setBusy(false); }
  }, [active, load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ marginRight: "auto" }}>
            <p style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Returns to HO</p>
            <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>Transfers coming back into HO (destination = HO). Receiving one adds the quantities to HO on-hand. Each receives once — re-receiving is blocked.</p>
          </div>
          <span style={{ fontSize: "0.72rem", color: "var(--text3)" }}>{loading ? "loading…" : `${pending} pending · ${returns.length} return${returns.length === 1 ? "" : "s"}`}</span>
          {degraded && <span style={{ fontSize: "0.7rem", color: "#F59E0B", fontWeight: 700 }}>⚠ NAV degraded</span>}
        </div>
      </Card>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "11px 16px" }}>
          <span style={{ fontSize: "0.78rem", color: "#EF4444", fontWeight: 700 }}>⚠ {error}</span>
        </div>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : sorted.length === 0 ? (
          <Empty icon="↩️" title="No returns to HO" sub="Store→HO transfers will appear here when they exist." />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead><tr style={{ background: "var(--surface3)" }}>
              {["Document", "From", "Date", "Items", "Qty", ""].map((h, i) => (
                <th key={i} style={{ padding: "10px 16px", textAlign: i >= 3 && i <= 4 ? "right" : "left", fontSize: "0.56rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map(d => (
                <tr key={d.doc} style={{ borderTop: "1px solid var(--border)", opacity: d.applied ? 0.6 : 1 }}>
                  <td style={{ padding: "10px 16px", fontWeight: 700, color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{d.doc}</td>
                  <td style={{ padding: "10px 16px", color: "var(--text2)" }}>{storeName(d.store)}</td>
                  <td style={{ padding: "10px 16px", color: "var(--text3)" }}>{d.date || "—"}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{d.lines.length}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtInt(d.totalQty)}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right" }}>
                    {d.applied ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: "#10B981" }}><Check size={13} /> Received</span>
                    ) : (
                      <button onClick={() => setActive(d)} style={{ padding: "7px 14px", borderRadius: 9, border: "none", cursor: "pointer", background: "#10B981", color: "white", fontWeight: 700, fontSize: "0.74rem" }}>Receive to HO</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {active && preview && (
        <MovementReceipt
          title={`Receive return ${active.doc}`}
          subtitle={`From ${storeName(active.store)}${active.date ? ` · ${active.date}` : ""} · ${active.lines.length} item${active.lines.length === 1 ? "" : "s"} back into HO`}
          rows={preview}
          busy={busy}
          confirmLabel="Confirm — add to HO"
          onConfirm={confirm}
          onCancel={() => { if (!busy) setActive(null); }}
        />
      )}
    </div>
  );
}
