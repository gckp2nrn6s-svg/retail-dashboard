"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CopyButton, Spinner, Empty, DateFilter, fmtInt, WH_ACCENT, storeName } from "@/components/warehouse/shared";
import { Download, ChevronDown, ChevronRight, Check, ArrowLeft } from "lucide-react";

interface TLine { item_no: string; description: string | null; qty: number }
interface Transfer { doc_no: string; store: string; status: string; shipment_date: string | null; lines: TLine[]; total_qty: number }
interface POLine { item_no: string; description: string | null; transfer_qty: number; ho_qty: number; po_qty: number }
interface PO { lines: POLine[]; totals: { transfer_qty: number; po_qty: number; items: number }; copyText: string }

function iso(d: Date) { return d.toISOString().slice(0, 10); }

export default function POTab() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<string>("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"select" | "review">("select");
  const [po, setPo] = useState<PO | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/warehouse/transfers?from=${from}&to=${to}`).then(x => x.json());
      setTransfers(r.transfers || []);
      setSources(r.sources?.mock ? "mock data (NAV transfer table not connected yet)" : "");
    } catch { setTransfers([]); } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const toggle = (doc: string) => setSel(s => { const n = new Set(s); n.has(doc) ? n.delete(doc) : n.add(doc); return n; });
  const toggleExp = (doc: string) => setExpanded(s => { const n = new Set(s); n.has(doc) ? n.delete(doc) : n.add(doc); return n; });

  const proceed = async () => {
    const docNos = [...sel]; if (!docNos.length) return;
    setBusy(true); setMsg(null);
    try {
      const r: PO = await fetch(`/api/warehouse/po`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ docNos }) }).then(x => x.json());
      if (r.lines) { setPo(r); setPhase("review"); } else setMsg({ kind: "err", text: "Couldn't build the PO." });
    } catch { setMsg({ kind: "err", text: "Couldn't build the PO." }); } finally { setBusy(false); }
  };

  const submit = async () => {
    const docNos = [...sel];
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/warehouse/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ docNos }) }).then(x => x.json());
      if (r.runId) {
        setMsg({ kind: "ok", text: `Submitted ${r.transfers} transfer(s) · ${fmtInt(r.units)} units deducted from HO stock · run #${r.runId}. They're now in “To Be Received”.` });
        setSel(new Set()); setPo(null); setPhase("select"); load();
      } else setMsg({ kind: "err", text: "Submit failed." });
    } catch { setMsg({ kind: "err", text: "Submit failed." }); } finally { setBusy(false); }
  };

  const downloadExcel = () => {
    if (!po) return;
    const rows = [["Item no", "Description", "Transfer qty", "HO on-hand", "PO qty"], ...po.lines.map(l => [l.item_no, l.description || "", l.transfer_qty, l.ho_qty, l.po_qty])];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "purchase-order.csv"; a.click();
  };

  const banner = msg && (
    <div style={{ padding: "10px 14px", borderRadius: 12, fontSize: "0.78rem", fontWeight: 600, background: msg.kind === "ok" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.1)", color: msg.kind === "ok" ? "#10B981" : "#EF4444", border: `1px solid ${msg.kind === "ok" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}` }}>{msg.text}</div>
  );

  // ── Review phase ─────────────────────────────────────────────────────────────
  if (phase === "review" && po) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {banner}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => setPhase("select")} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.76rem", fontWeight: 600, color: "var(--text2)" }}><ArrowLeft size={14} /> Back</button>
          <span style={{ fontSize: "0.82rem", color: "var(--text2)" }}><strong style={{ color: "var(--text)" }}>{sel.size}</strong> transfers · <strong style={{ color: "var(--text)" }}>{po.totals.items}</strong> items · PO <strong style={{ color: WH_ACCENT }}>{fmtInt(po.totals.po_qty)}</strong> units</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={downloadExcel} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, color: "var(--text)" }}><Download size={14} /> Excel</button>
            <CopyButton text={po.copyText} label="Copy PO" />
          </div>
        </div>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ maxHeight: "55vh", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead><tr style={{ background: "var(--surface3)", position: "sticky", top: 0 }}>
                {["Item no.", "Description", "Transfer", "HO on-hand", "PO qty"].map((h, i) => <th key={i} style={{ padding: "10px 14px", textAlign: i > 1 ? "right" : "left", fontSize: "0.58rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {po.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 700 }}>{l.item_no}</td>
                    <td style={{ padding: "8px 14px", color: "var(--text2)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.description || "—"}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtInt(l.transfer_qty)}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{fmtInt(l.ho_qty)}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 800, color: l.po_qty > 0 ? WH_ACCENT : "var(--text4)", fontVariantNumeric: "tabular-nums" }}>{fmtInt(l.po_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p style={{ fontSize: "0.66rem", color: "var(--text4)" }}>PO qty = consolidated transfer qty − current HO on-hand (floored at 0). “Copy PO” copies only item-no⇥qty rows with PO qty &gt; 0, ready to paste into NAV.</p>
        <button onClick={submit} disabled={busy} style={{ alignSelf: "flex-start", padding: "12px 28px", borderRadius: 12, border: "none", cursor: busy ? "default" : "pointer", background: WH_ACCENT, color: "white", fontWeight: 800, fontSize: "0.9rem", opacity: busy ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
          {busy ? <Spinner size={16} /> : <Check size={16} />} SUBMIT — deduct stock &amp; move to “To Be Received”
        </button>
      </div>
    );
  }

  // ── Select phase ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {banner}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text2)" }}>Live transfers from NAV</p>
        <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {sources && <span style={{ fontSize: "0.62rem", color: "#F59E0B", background: "rgba(245,158,11,0.1)", padding: "3px 9px", borderRadius: 8, fontWeight: 600 }}>⚠ {sources}</span>}
        <button onClick={proceed} disabled={busy || sel.size === 0} style={{ marginLeft: "auto", padding: "10px 20px", borderRadius: 11, border: "none", cursor: sel.size === 0 ? "default" : "pointer", background: sel.size === 0 ? "var(--surface3)" : WH_ACCENT, color: sel.size === 0 ? "var(--text4)" : "white", fontWeight: 800, fontSize: "0.82rem", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {busy ? <Spinner size={14} /> : <>Proceed{sel.size > 0 ? ` (${sel.size})` : ""} <ChevronRight size={15} /></>}
        </button>
      </div>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 12 }} />)}</div>
      ) : transfers.length === 0 ? (
        <Empty icon="🚚" title="No open transfers" sub="They'll appear here from NAV once the transfer table is connected." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {transfers.map(t => {
            const on = sel.has(t.doc_no), exp = expanded.has(t.doc_no);
            return (
              <Card key={t.doc_no} style={{ padding: 0, border: on ? `1.5px solid ${WH_ACCENT}` : "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(t.doc_no)} style={{ width: 18, height: 18, accentColor: WH_ACCENT, cursor: "pointer", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => toggle(t.doc_no)}>
                    <p style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--text)" }}>{t.doc_no} <span style={{ color: "var(--text3)", fontWeight: 500 }}>→ {storeName(t.store)}</span></p>
                    <p style={{ fontSize: "0.64rem", color: "var(--text3)", marginTop: 1 }}>{t.lines.length} items · {fmtInt(t.total_qty)} units{t.shipment_date ? ` · ${t.shipment_date}` : ""}</p>
                  </div>
                  <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "var(--text2)", background: "var(--surface3)", padding: "3px 9px", borderRadius: 7 }}>{t.status}</span>
                  <button onClick={() => toggleExp(t.doc_no)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text4)", padding: 4 }}>{exp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                </div>
                {exp && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "4px 0" }}>
                    {t.lines.map((l, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "5px 16px 5px 46px", fontSize: "0.72rem" }}>
                        <span style={{ fontWeight: 600, color: "var(--text)", minWidth: 60 }}>{l.item_no}</span>
                        <span style={{ color: "var(--text3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.description || ""}</span>
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtInt(l.qty)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
