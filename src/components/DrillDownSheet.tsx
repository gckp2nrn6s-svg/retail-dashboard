"use client";
import { useEffect, useState, useRef } from "react";
import { X, Download, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useCurrency } from "@/components/CurrencyToggle";

export interface DrillParams {
  title: string;
  endpoint: string; // e.g. /api/drill?type=store&store=CSTARS&from=...&to=...
}

interface Row { [key: string]: string | number | null }

interface DrillData {
  columns: { key: string; label: string; type: "text" | "number" | "currency" | "date" | "units" }[];
  rows: Row[];
  summary?: { label: string; value: string }[];
  fx?: number;
}

function fmtCell(val: string | number | null, type: string, currency: string, fx: number): string {
  if (val === null || val === undefined) return "—";
  if (type === "currency") {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (currency === "USD") return `$${(n / fx).toLocaleString("en", { maximumFractionDigits: 0 })}`;
    if (n >= 1_000_000) return `EGP ${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `EGP ${(n / 1_000).toFixed(1)}K`;
    return `EGP ${n.toLocaleString("en", { maximumFractionDigits: 0 })}`;
  }
  if (type === "units") return Number(val).toLocaleString();
  if (type === "number") return Number(val).toLocaleString("en", { maximumFractionDigits: 2 });
  return String(val);
}

function exportCSV(columns: DrillData["columns"], rows: Row[], title: string) {
  const header = columns.map(c => c.label).join(",");
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key];
    return typeof v === "string" && v.includes(",") ? `"${v}"` : (v ?? "");
  }).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/\s+/g, "-").toLowerCase()}.csv`; a.click();
}

export function DrillDownSheet({ params, onClose }: { params: DrillParams; onClose: () => void }) {
  const { currency } = useCurrency();
  const [data, setData] = useState<DrillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(params.endpoint)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.endpoint]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sortedRows = data ? [...data.rows].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey], bv = b[sortKey];
    const an = parseFloat(String(av)), bn = parseFloat(String(bv));
    const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  }) : [];

  const fx = data?.fx || 52;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, backdropFilter: "blur(2px)" }} />

      {/* Sheet */}
      <div ref={sheetRef} style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
        background: "var(--surface)", borderRadius: "20px 20px 0 0",
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.2)",
      }}
      className="drill-sheet"
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 12px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "var(--text)", letterSpacing: "-0.01em" }}>{params.title}</p>
            {data?.summary && (
              <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                {data.summary.map(s => (
                  <span key={s.label} style={{ fontSize: "0.65rem", color: "var(--text3)" }}>
                    <span style={{ fontWeight: 700, color: "var(--text2)" }}>{s.value}</span> {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {data && (
              <button onClick={() => exportCSV(data.columns, data.rows, params.title)} style={{
                padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                fontSize: "0.68rem", color: "var(--text2)", fontWeight: 600,
              }}>
                <Download size={13} /> CSV
              </button>
            )}
            <button onClick={onClose} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", cursor: "pointer" }}>
              <X size={16} style={{ color: "var(--text3)" }} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          {loading ? (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 40, borderRadius: 8 }} />)}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: "0.8rem" }}>
              No data for this period
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ background: "var(--bg)", position: "sticky", top: 0 }}>
                  {data.columns.map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)} style={{
                      padding: "10px 16px", textAlign: col.type === "text" || col.type === "date" ? "left" : "right",
                      fontWeight: 700, fontSize: "0.65rem", color: "var(--text3)",
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--border)",
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {col.label}
                        {sortKey === col.key
                          ? (sortDir === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />)
                          : <ArrowUpDown size={10} style={{ opacity: 0.3 }} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--bg)" }}>
                    {data.columns.map(col => (
                      <td key={col.key} style={{
                        padding: "10px 16px",
                        textAlign: col.type === "text" || col.type === "date" ? "left" : "right",
                        color: "var(--text)",
                        fontWeight: col.type === "currency" ? 600 : 400,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}>
                        {col.type === "currency" ? (
                          <span>
                            {fmtCell(row[col.key], "currency", currency, fx)}
                            <span style={{ fontSize: "0.62rem", color: "var(--text3)", marginLeft: 4 }}>
                              {currency === "EGP"
                                ? `$${Math.round(parseFloat(String(row[col.key] ?? 0)) / fx).toLocaleString()}`
                                : `EGP ${Math.round(parseFloat(String(row[col.key] ?? 0))).toLocaleString()}`}
                            </span>
                          </span>
                        ) : fmtCell(row[col.key], col.type, currency, fx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .drill-sheet {
            left: 220px !important;
            border-radius: 0 !important;
            max-height: 100vh !important;
            top: 0 !important;
            width: 65vw !important;
            left: auto !important;
            right: 0 !important;
          }
        }
      `}</style>
    </>
  );
}

export function useDrill() {
  const [drill, setDrill] = useState<DrillParams | null>(null);
  const open = (params: DrillParams) => setDrill(params);
  const close = () => setDrill(null);
  return { drill, open, close };
}
