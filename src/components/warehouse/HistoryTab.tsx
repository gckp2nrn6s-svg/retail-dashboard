"use client";
import { useEffect, useState, useRef, useCallback, Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, DateFilter, Spinner, Empty, fmtInt, DownloadButton, downloadCsv } from "@/components/warehouse/shared";

interface Receipt {
  id: number | string; kind: "outside" | "factory"; reference: string | null;
  note: string | null; created_at: string; lines: number; units: number;
}
interface DetailLine { item_no: string; description: string | null; qty: number }

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}

function KindBadge({ kind }: { kind: Receipt["kind"] }) {
  const outside = kind === "outside";
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: "0.6rem", fontWeight: 800,
      textTransform: "capitalize", letterSpacing: "0.02em",
      background: outside ? "rgba(245,158,11,0.14)" : "rgba(13,148,136,0.14)",
      color: outside ? "#F59E0B" : "#0D9488",
    }}>
      {outside ? "Outside" : "Factory"}
    </span>
  );
}

export default function HistoryTab() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [rows, setRows] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, DetailLine[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | number | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true); setError(false);
    try {
      const r = await fetch(`/api/warehouse/receipts?from=${from}&to=${to}`).then(x => x.json());
      if (myReq !== reqIdRef.current) return; // stale
      setRows(r.rows || []);
    } catch {
      if (myReq === reqIdRef.current) { setError(true); setRows([]); }
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (id: string | number) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (detailCache[String(id)]) return; // cached — instant
    setDetailLoading(id);
    try {
      const r = await fetch(`/api/warehouse/receipts?id=${id}`).then(x => x.json());
      setDetailCache(prev => ({ ...prev, [String(id)]: r.lines || [] }));
    } catch {
      setDetailCache(prev => ({ ...prev, [String(id)]: [] }));
    } finally {
      setDetailLoading(cur => (cur === id ? null : cur));
    }
  }, [expanded, detailCache]);

  const TH = { padding: "9px 14px", textAlign: "left", fontSize: "0.58rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", position: "sticky", top: 0, background: "var(--surface3)", zIndex: 1 } as React.CSSProperties;
  const THR = { ...TH, textAlign: "right" } as React.CSSProperties;
  const td = { padding: "11px 14px", color: "var(--text2)" } as React.CSSProperties;
  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" } as React.CSSProperties;

  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Header + filter */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Receipt history</p>
            <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>
              {loading ? "Loading…" : error ? <span style={{ color: "#EF4444" }}>Couldn't load.</span> : `${rows.length} ${rows.length === 1 ? "receipt" : "receipts"}`}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DownloadButton disabled={rows.length === 0} onClick={() => downloadCsv(`receipt-history-${from}_${to}`, ["Date", "Type", "Reference", "Lines", "Units", "Note"], rows.map(r => [fmtDate(r.created_at), r.kind, r.reference || "", r.lines, r.units, r.note || ""]))} />
            <DateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ padding: "40px 0", display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty icon="🗂️" title="No receipts in this range" sub="Adjust the date filter to see more." />
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "auto", maxHeight: 600 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width: 28 }}></th>
                  <th style={TH}>Date</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Reference</th>
                  <th style={THR}>Lines</th>
                  <th style={THR}>Units</th>
                  <th style={TH}>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const open = expanded === r.id;
                  const lines = detailCache[String(r.id)];
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(r.id)} className="card-hover" style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: open ? "var(--surface3)" : "transparent" }}>
                        <td style={{ ...td, paddingRight: 0, color: "var(--text4)" }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td style={{ ...td, color: "var(--text)", whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                        <td style={td}><KindBadge kind={r.kind} /></td>
                        <td style={{ ...td, fontFamily: r.reference ? "ui-monospace, monospace" : undefined, color: r.reference ? "var(--text2)" : "var(--text4)" }}>{r.reference || "—"}</td>
                        <td style={tdNum}>{fmtInt(r.lines)}</td>
                        <td style={{ ...tdNum, fontWeight: 700, color: "var(--text)" }}>{fmtInt(r.units)}</td>
                        <td style={{ ...td, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.note ? "var(--text3)" : "var(--text4)" }}>{r.note || "—"}</td>
                      </tr>
                      {open && (
                        <tr style={{ background: "var(--bg)" }}>
                          <td colSpan={7} style={{ padding: 0, borderTop: "1px solid var(--border)" }}>
                            {detailLoading === r.id ? (
                              <div style={{ padding: "16px", display: "flex", justifyContent: "center" }}><Spinner size={15} /></div>
                            ) : !lines || lines.length === 0 ? (
                              <div style={{ padding: "14px 18px", fontSize: "0.72rem", color: "var(--text4)" }}>No line detail.</div>
                            ) : (
                              <div style={{ padding: "10px 18px 14px 42px" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem" }}>
                                  <tbody>
                                    {lines.map((l, i) => (
                                      <tr key={i}>
                                        <td style={{ padding: "5px 12px 5px 0", fontWeight: 700, color: "var(--text)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", width: 1 }}>{l.item_no}</td>
                                        <td style={{ padding: "5px 12px", color: "var(--text2)" }}>{l.description || "—"}</td>
                                        <td style={{ padding: "5px 0", textAlign: "right", fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtInt(l.qty)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
