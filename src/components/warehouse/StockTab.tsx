"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { Search } from "lucide-react";
import { Card, Spinner, Empty, fmtInt, DownloadButton, downloadCsv } from "@/components/warehouse/shared";

interface Row {
  item_no: string; description: string; in_stock: number; quantity: number;
  out_qty: number; unit_price: number; brand: string; item_group: string;
}
interface Totals { items: number; units: number }

export default function StockTab() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [zero, setZero] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals>({ items: 0, units: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // debounce the search input (~300ms)
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams();
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      if (zero) params.set("zero", "1");
      const r = await fetch(`/api/warehouse/stock?${params.toString()}`).then(x => x.json());
      if (myReq !== reqIdRef.current) return; // stale — ignore
      setRows(r.rows || []);
      setTotals(r.totals || { items: 0, units: 0 });
    } catch {
      if (myReq === reqIdRef.current) { setError(true); setRows([]); }
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [debouncedQ, zero]);

  useEffect(() => { load(); }, [load]);

  const ICOL = { padding: "9px 14px", textAlign: "right", fontSize: "0.58rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", position: "sticky", top: 0, background: "var(--surface3)", zIndex: 1 } as React.CSSProperties;
  const LCOL = { ...ICOL, textAlign: "left" } as React.CSSProperties;
  const num = { padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" } as React.CSSProperties;

  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text4)" }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search item no., description, brand…"
              style={{ width: "100%", padding: "10px 12px 10px 34px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" }}
            />
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "0.74rem", color: "var(--text2)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={zero} onChange={e => setZero(e.target.checked)} style={{ accentColor: "#0D9488", width: 15, height: 15, cursor: "pointer" }} />
            Show zero-stock
          </label>
          <DownloadButton disabled={rows.length === 0} onClick={() => downloadCsv(`warehouse-stock-${new Date().toISOString().slice(0, 10)}`, ["Item no", "Description", "On hand"], rows.map(r => [r.item_no, r.description, Math.round(r.in_stock)]))} />
        </div>

        {/* Totals strip */}
        <div style={{ fontSize: "0.72rem", color: "var(--text3)" }}>
          {loading ? "Loading…" : error ? <span style={{ color: "#EF4444" }}>Couldn't load stock.</span> : (
            <span><strong style={{ color: "var(--text)" }}>{fmtInt(totals.items)}</strong> items in stock · <strong style={{ color: "var(--text)" }}>{fmtInt(totals.units)}</strong> units</span>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ padding: "40px 0", display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty title={debouncedQ.trim() ? "No items match" : "Nothing in stock"} sub={debouncedQ.trim() ? "Try a different search." : zero ? undefined : "Tick “show zero-stock” to include emptied items."} />
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "auto", maxHeight: 560 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  <th style={LCOL}>Item no.</th>
                  <th style={LCOL}>Description</th>
                  <th style={ICOL}>On hand</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.item_no || i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 14px", fontWeight: 700, color: "var(--text)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{r.item_no}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text2)", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</td>
                    <td style={{ ...num, fontWeight: 800, color: "var(--text)" }}>{fmtInt(r.in_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
