"use client";
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { Card, Spinner, Empty, DateFilter, CopyButton, fmtInt, WH_ACCENT, MovementReceipt, type MoveRow } from "@/components/warehouse/shared";
import { ArrowDownCircle, ArrowUpCircle, Check, AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";

interface Line { item_no: string; description: string; qty: number; current: number; value: number }
interface Doc { doc: string; cust: string; custName: string; date: string; applied: boolean; overridden: boolean; lines: Line[]; totalQty: number; totalValue: number; anyNegative: boolean }
type Kind = "invoice" | "creditmemo";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function HoSalesTab() {
  const [kind, setKind] = useState<Kind>("invoice");
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 90 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [creditMemos, setCreditMemos] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [active, setActive] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // session accumulator of deducted invoice lines (item → qty) for the reconciled PO copy
  const [session, setSession] = useState<Map<string, number>>(new Map());
  const [sessionDocs, setSessionDocs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (doc: string) => setExpanded(s => { const n = new Set(s); n.has(doc) ? n.delete(doc) : n.add(doc); return n; });
  // Documents ticked for the PO copy (the PO is built from the SELECTION, not the date range).
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const toggleSelect = (doc: string) => setSelectedDocs(s => { const n = new Set(s); n.has(doc) ? n.delete(doc) : n.add(doc); return n; });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/warehouse/ho-sales?from=${from}&to=${to}`).then(x => x.json());
      setInvoices(r.invoices || []); setCreditMemos(r.creditMemos || []); setDegraded(!!r.degraded);
    } catch { setError("Couldn't load HO sales."); } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const docs = kind === "invoice" ? invoices : creditMemos;
  const sign = kind === "invoice" ? -1 : 1;
  const handled = (d: Doc) => d.applied || d.overridden;
  const sorted = useMemo(() => [...docs].sort((a, b) => (handled(a) === handled(b) ? b.date.localeCompare(a.date) : handled(a) ? 1 : -1)), [docs]);
  const pendingCount = docs.filter(d => !handled(d)).length;

  const override = useCallback(async (doc: string, on: boolean) => {
    setError(null);
    try {
      const r = await fetch("/api/warehouse/ho-apply", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc, kind, mode: on ? "override" : "unoverride" }),
      }).then(x => x.json());
      if (r.ok) await load(); else setError(r.error || "Failed.");
    } catch { setError("Failed."); }
  }, [kind, load]);

  const preview: MoveRow[] | null = active
    ? active.lines.map(l => ({ item_no: l.item_no, description: l.description, current: l.current, delta: sign * l.qty, next: l.current + sign * l.qty }))
    : null;

  const confirm = useCallback(async () => {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/warehouse/ho-apply", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc: active.doc, kind }),
      }).then(x => x.json());
      if (r.ok) {
        if (kind === "invoice") {
          setSession(prev => { const m = new Map(prev); for (const l of active.lines) m.set(l.item_no, (m.get(l.item_no) || 0) + l.qty); return m; });
          setSessionDocs(prev => prev.includes(active.doc) ? prev : [...prev, active.doc]);
        }
        setActive(null);
        await load();
      } else setError(r.error || "Failed to apply.");
    } catch { setError("Failed to apply."); } finally { setBusy(false); }
  }, [active, kind, load]);

  const sessionPo = useMemo(() => [...session.entries()].map(([item, qty]) => `${item}\t${qty}`).join("\n"), [session]);
  const sessionUnits = useMemo(() => [...session.values()].reduce((s, q) => s + q, 0), [session]);

  // The PO copy is built from the SELECTED documents (checkboxes), not the date range — the user
  // ticks exactly which posted docs go on the ERP PO. Consolidated per item across the selected
  // docs of the CURRENT view (invoices = qty to re-purchase).
  const selectedBalance = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) if (selectedDocs.has(d.doc)) for (const l of d.lines) m.set(l.item_no, (m.get(l.item_no) || 0) + l.qty);
    return [...m.entries()].filter(([, q]) => q !== 0).sort((a, b) => b[1] - a[1]);
  }, [docs, selectedDocs]);
  const selectedPo = useMemo(() => selectedBalance.map(([item, q]) => `${item}\t${q}`).join("\n"), [selectedBalance]);
  const selectedUnits = useMemo(() => selectedBalance.reduce((s, [, q]) => s + q, 0), [selectedBalance]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>HO Sales</p>
          <p style={{ fontSize: "0.7rem", color: "var(--text3)" }}>
            Posted invoices deduct HO stock (can go negative); credit memos add it back. Each document applies <strong>once</strong> — re-applying is blocked, so nothing double-deducts. <strong>Tick</strong> the documents you want to re-purchase and use <strong>Copy PO</strong> to paste just those into one ERP PO. Every deduct/add is recorded in the <strong>Log</strong> tab (by document, item, qty &amp; time).
          </p>
        </div>

        {/* Invoice vs Credit memo */}
        <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--surface3)", borderRadius: 12, maxWidth: 420, marginTop: 14 }}>
          {([["invoice", "Invoices — deduct", ArrowDownCircle], ["creditmemo", "Credit memos — add", ArrowUpCircle]] as const).map(([key, text, Icon]) => {
            const on = key === kind;
            const tone = key === "invoice" ? "#EF4444" : "#10B981";
            return (
              <button key={key} onClick={() => { setKind(key); setSelectedDocs(new Set()); }} style={{
                flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                background: on ? tone : "transparent", color: on ? "white" : "var(--text3)", fontWeight: on ? 700 : 600, fontSize: "0.78rem", transition: "all 0.12s",
              }}>
                <Icon size={15} /> {text}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
          <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <span style={{ fontSize: "0.72rem", color: "var(--text3)" }}>{loading ? "loading…" : `${pendingCount} pending · ${docs.length} document${docs.length === 1 ? "" : "s"}`}</span>
          {degraded && <span style={{ fontSize: "0.7rem", color: "#F59E0B", fontWeight: 700 }}>⚠ NAV degraded — list may be incomplete</span>}
        </div>
      </Card>

      {/* Copy PO for the SELECTED documents (ticked below) — not the whole date range */}
      {selectedDocs.size > 0 && (
        <Card style={{ padding: "14px 20px", background: "rgba(13,148,136,0.06)", border: `1px solid ${WH_ACCENT}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ marginRight: "auto" }}>
              <p style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--text)" }}>Copy PO · {selectedDocs.size} selected {kind === "invoice" ? "invoice" : "credit memo"}{selectedDocs.size === 1 ? "" : "s"}</p>
              <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>
                <strong>{selectedBalance.length}</strong> item{selectedBalance.length === 1 ? "" : "s"} · <strong>{fmtInt(selectedUnits)}</strong> units consolidated from the ticked documents. Paste into one ERP PO.
              </p>
            </div>
            <CopyButton text={selectedPo} label="Copy PO" />
            <button onClick={() => setSelectedDocs(new Set())} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.74rem", fontWeight: 700, color: "var(--text3)" }}>Clear</button>
          </div>
        </Card>
      )}

      {/* Reconciled PO copy — invoices deducted this session */}
      {kind === "invoice" && session.size > 0 && (
        <Card style={{ padding: "14px 20px", background: "rgba(13,148,136,0.06)", border: `1px solid ${WH_ACCENT}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ marginRight: "auto" }}>
              <p style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--text)" }}>Reconciled PO — this session</p>
              <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>
                {session.size} item{session.size === 1 ? "" : "s"} · {fmtInt(sessionUnits)} units across {sessionDocs.length} invoice{sessionDocs.length === 1 ? "" : "s"}. Paste into the ERP PO to cover the negatives.
              </p>
            </div>
            <CopyButton text={sessionPo} label="Copy reconciled PO" />
            <button onClick={() => { setSession(new Map()); setSessionDocs([]); }} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.74rem", fontWeight: 700, color: "var(--text3)" }}>Clear</button>
          </div>
        </Card>
      )}

      {error && (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "11px 16px" }}>
          <span style={{ fontSize: "0.78rem", color: "#EF4444", fontWeight: 700 }}>⚠ {error}</span>
        </div>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : sorted.length === 0 ? (
          <Empty icon="🧾" title={`No posted ${kind === "invoice" ? "invoices" : "credit memos"}`} sub="Try widening the date range." />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead><tr style={{ background: "var(--surface3)" }}>
              {["", "Document", "Customer", "Date", "Items", "Qty", "Value", ""].map((h, i) => (
                <th key={i} style={{ padding: "10px 16px", textAlign: i >= 4 && i <= 6 ? "right" : "left", fontSize: "0.56rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map(d => {
                const exp = expanded.has(d.doc);
                return (
                <Fragment key={d.doc}>
                <tr style={{ borderTop: "1px solid var(--border)", opacity: d.applied ? 0.6 : 1, background: selectedDocs.has(d.doc) ? "rgba(13,148,136,0.06)" : undefined }}>
                  <td style={{ padding: "10px 6px 10px 14px", width: 56, whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={selectedDocs.has(d.doc)} onChange={() => toggleSelect(d.doc)} title="Select for PO copy" style={{ width: 15, height: 15, accentColor: WH_ACCENT, cursor: "pointer", verticalAlign: "middle", marginRight: 8 }} />
                    <button onClick={() => toggleExpand(d.doc)} title="Show invoice lines" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text4)", padding: 2, verticalAlign: "middle" }}>
                      {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </td>
                  <td style={{ padding: "10px 16px", fontWeight: 700, color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>
                    {d.doc}
                    {d.anyNegative && !d.applied && <AlertTriangle size={12} style={{ color: "#F59E0B", marginLeft: 7, verticalAlign: "middle" }} />}
                  </td>
                  <td style={{ padding: "10px 16px", color: "var(--text2)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${d.custName} (${d.cust})`}>{d.custName}</td>
                  <td style={{ padding: "10px 16px", color: "var(--text3)" }}>{d.date}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{d.lines.length}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtInt(d.totalQty)}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{fmtInt(d.totalValue)}<span style={{ color: "var(--text4)", fontWeight: 500, fontSize: "0.62rem", marginLeft: 3 }}>EGP</span></td>
                  <td style={{ padding: "10px 16px", textAlign: "right" }}>
                    {d.applied ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: "#10B981" }}>
                        <Check size={13} /> {kind === "invoice" ? "Deducted" : "Added"}
                      </span>
                    ) : d.overridden ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: "var(--text3)" }}>
                          <Check size={12} /> Reconciled (override)
                        </span>
                        <button onClick={() => override(d.doc, false)} style={{ padding: "4px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.66rem", fontWeight: 700, color: "var(--text3)" }}>Undo</button>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => setActive(d)} style={{
                          padding: "7px 14px", borderRadius: 9, border: "none", cursor: "pointer",
                          background: kind === "invoice" ? "#EF4444" : "#10B981", color: "white", fontWeight: 700, fontSize: "0.74rem",
                        }}>
                          {kind === "invoice" ? "Deduct stock" : "Add stock"}
                        </button>
                        <button onClick={() => override(d.doc, true)} title="Mark as already reconciled — no stock change" style={{
                          padding: "7px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, color: "var(--text2)",
                        }}>
                          Override
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
                {exp && (
                  <tr style={{ background: "var(--surface3)" }}>
                    <td colSpan={8} style={{ padding: "2px 16px 12px 44px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                        <thead><tr>
                          {["Item", "Description", "Qty", "On hand", "Value (EGP)"].map((h, i) => (
                            <th key={i} style={{ padding: "6px 12px", textAlign: i >= 2 ? "right" : "left", fontSize: "0.52rem", fontWeight: 700, color: "var(--text4)", textTransform: "uppercase" }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {d.lines.map((l, i) => (
                            <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={{ padding: "5px 12px", fontWeight: 700, color: "var(--text2)", fontFamily: "ui-monospace, monospace" }}>{l.item_no}</td>
                              <td style={{ padding: "5px 12px", color: "var(--text3)", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.description}</td>
                              <td style={{ padding: "5px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtInt(l.qty)}</td>
                              <td style={{ padding: "5px 12px", textAlign: "right", color: l.current < 0 ? "#EF4444" : "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{fmtInt(l.current)}</td>
                              <td style={{ padding: "5px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text2)" }}>{fmtInt(l.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {active && preview && (
        <MovementReceipt
          title={kind === "invoice" ? `Deduct invoice ${active.doc}` : `Add credit memo ${active.doc}`}
          subtitle={`${active.custName} · ${active.date} · ${active.lines.length} item${active.lines.length === 1 ? "" : "s"} · ${fmtInt(active.totalValue)} EGP`}
          rows={preview}
          busy={busy}
          confirmLabel={kind === "invoice" ? "Confirm — deduct" : "Confirm — add"}
          onConfirm={confirm}
          onCancel={() => { if (!busy) setActive(null); }}
        />
      )}
    </div>
  );
}
