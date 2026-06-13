"use client";
import { useEffect, useState } from "react";
import { X, Download, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useCurrency } from "@/components/CurrencyToggle";

export interface DrillParams { title: string; endpoint: string }

interface Row { [key: string]: string | number | null }
interface Col  { key: string; label: string; type: "text"|"number"|"currency"|"date"|"units" }
interface DrillData { columns: Col[]; rows: Row[]; summary?: { label: string; value: string }[]; fx?: number }

// Human names for store codes displayed in drill tables
const STORE_NAMES: Record<string,string> = {
  "CSTARS":"City Stars","CF-HOS":"Festival of Hope","ALMAZA":"Almaza City Center",
  "P90":"Patio 90","CCA":"Cairo Festival City","ONLINE":"Online Store",
  "AMAZON BAN":"Amazon Banha","AMAZON KAM":"Amazon Kamal",
  "SHOPIFY-AMT":"AT Online","SHOPIFY-SAM":"Samsonite Online",
  "HO":"Head Office","NOON":"Noon","AMAZON":"Amazon Egypt","JUMIA":"Jumia",
  "DUTY FREE":"Duty Free","FOUR SEASO":"Four Seasons","GO SPORT1":"Go Sport",
  "MOA":"Mall of Arabia","MOE":"Mall of Egypt","SPINNEYS":"Spinneys",
};

function displayVal(val: string|number|null, col: Col, currency: string, fx: number): string {
  if (val === null || val === undefined) return "—";
  if (col.key === "store_code") return STORE_NAMES[String(val)] ?? String(val);
  if (col.type === "currency") {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (currency === "USD") return `$${(n / fx).toLocaleString("en", { maximumFractionDigits: 0 })}`;
    if (n >= 1_000_000) return `EGP ${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `EGP ${(n / 1_000).toFixed(1)}K`;
    return `EGP ${n.toLocaleString("en", { maximumFractionDigits: 0 })}`;
  }
  if (col.type === "units")  return Number(val).toLocaleString();
  if (col.type === "number") return Number(val).toLocaleString("en", { maximumFractionDigits: 2 });
  return String(val);
}

function secondaryVal(val: string|number|null, col: Col, currency: string, fx: number): string {
  if (col.type !== "currency" || val === null) return "";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return currency === "USD" ? `EGP ${Math.round(n).toLocaleString()}` : `$${Math.round(n/fx).toLocaleString()}`;
}

function exportCSV(columns: Col[], rows: Row[], title: string) {
  const header = columns.map(c => c.label).join(",");
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key]; return typeof v === "string" && v.includes(",") ? `"${v}"` : (v ?? "");
  }).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([header + "\n" + body], { type: "text/csv" }));
  a.download = `${title.replace(/\s+/g,"-").toLowerCase()}.csv`; a.click();
}

// Auto-compute 3 highlights from the data
function computeHighlights(columns: Col[], rows: Row[], fx: number, currency: string) {
  if (!rows.length) return [];
  const revCol = columns.find(c => c.type === "currency");
  const unitCol = columns.find(c => c.type === "units");
  const hl: { icon: string; label: string; value: string }[] = [];

  if (revCol) {
    const vals = rows.map(r => parseFloat(String(r[revCol.key] ?? 0)));
    const total = vals.reduce((s,v) => s+v, 0);
    const topIdx = vals.indexOf(Math.max(...vals));
    const topRow = rows[topIdx];
    const nameCol = columns.find(c => c.type === "text" || c.type === "date");
    hl.push({ icon: "💰", label: "Total", value: currency === "USD" ? `$${Math.round(total/fx).toLocaleString()}` : `EGP ${Math.round(total).toLocaleString()}` });
    if (nameCol) {
      const lbl = displayVal(topRow[nameCol.key], nameCol, currency, fx);
      hl.push({ icon: "🏆", label: `Top: ${lbl}`, value: displayVal(topRow[revCol.key], revCol, currency, fx) });
    }
  }
  if (unitCol) {
    const total = rows.reduce((s,r) => s + parseFloat(String(r[unitCol.key] ?? 0)), 0);
    hl.push({ icon: "📦", label: "Total units", value: total.toLocaleString() });
  }
  return hl.slice(0, 3);
}

export function DrillDownSheet({ params, onClose }: { params: DrillParams; onClose: () => void }) {
  const { currency } = useCurrency();
  const [data, setData] = useState<DrillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  useEffect(() => {
    setLoading(true); setData(null);
    fetch(params.endpoint).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
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
  const highlights = data ? computeHighlights(data.columns, data.rows, fx, currency) : [];

  const SortIcon = ({ col }: { col: Col }) => {
    if (sortKey !== col.key) return <ArrowUpDown size={10} style={{ opacity: 0.3 }} />;
    return sortDir === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, backdropFilter: "blur(4px)" }} />

      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
        background: "var(--surface)", borderRadius: "22px 22px 0 0",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 -12px 60px rgba(0,0,0,0.25)",
      }} className="drill-sheet">

        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 6px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border2)" }} />
        </div>

        {/* Header */}
        <div style={{ padding: "4px 20px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>{params.title}</p>
            <div style={{ display: "flex", gap: 8, marginLeft: 12, flexShrink: 0 }}>
              {data && (
                <button onClick={() => exportCSV(data.columns, data.rows, params.title)}
                  style={{ padding: "6px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.68rem", color: "var(--text2)", fontWeight: 600 }}>
                  <Download size={13} /> CSV
                </button>
              )}
              <button onClick={onClose}
                style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} style={{ color: "var(--text3)" }} />
              </button>
            </div>
          </div>

          {/* Highlights strip */}
          {highlights.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {highlights.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface3)", borderRadius: 10, padding: "6px 12px" }}>
                  <span style={{ fontSize: "0.75rem" }}>{h.icon}</span>
                  <div>
                    <p style={{ fontSize: "0.58rem", color: "var(--text3)", fontWeight: 600 }}>{h.label}</p>
                    <p style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--text)" }}>{h.value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          {loading ? (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 46, borderRadius: 10 }} />)}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <p style={{ fontSize: "2rem", marginBottom: 12 }}>📭</p>
              <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text2)" }}>No data for this period</p>
              <p style={{ fontSize: "0.72rem", color: "var(--text3)", marginTop: 4 }}>Try adjusting the date range</p>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ background: "var(--surface3)", position: "sticky", top: 0 }}>
                  {data.columns.map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)} style={{
                      padding: "11px 16px",
                      textAlign: col.type === "text" || col.type === "date" ? "left" : "right",
                      fontWeight: 700, fontSize: "0.62rem", color: sortKey === col.key ? "var(--action)" : "var(--text3)",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--border)",
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {col.label} <SortIcon col={col} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface3)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {data.columns.map(col => (
                      <td key={col.key} style={{
                        padding: "11px 16px",
                        textAlign: col.type === "text" || col.type === "date" ? "left" : "right",
                        color: "var(--text)", fontWeight: col.type === "currency" ? 700 : 400,
                        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                      }}>
                        {col.type === "currency" ? (
                          <span>
                            {displayVal(row[col.key], col, currency, fx)}
                            <span style={{ fontSize: "0.6rem", color: "var(--text3)", marginLeft: 5 }}>
                              {secondaryVal(row[col.key], col, currency, fx)}
                            </span>
                          </span>
                        ) : displayVal(row[col.key], col, currency, fx)}
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
            top: 0 !important;
            bottom: 0 !important;
            left: auto !important;
            right: 0 !important;
            width: min(60vw, 720px) !important;
            border-radius: 0 !important;
            max-height: 100vh !important;
          }
        }
      `}</style>
    </>
  );
}

export function useDrill() {
  const [drill, setDrill] = useState<DrillParams | null>(null);
  return { drill, open: (p: DrillParams) => setDrill(p), close: () => setDrill(null) };
}
