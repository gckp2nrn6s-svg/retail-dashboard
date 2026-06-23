"use client";
import { useEffect, useState, useCallback } from "react";
import { X, Download, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronLeft, RotateCcw } from "lucide-react";
import { useCurrency } from "@/components/CurrencyToggle";

export interface DrillParams { title: string; endpoint: string }
export type DrillVariant = "table" | "cards";

// Arabic labels for the common drill columns — used in the big "cards" view so the
// Live board's drill reads in Arabic for the (older) user. Falls back to col.label.
const AR_COL: Record<string, string> = {
  brand: "العلامة", egp: "الإيراد", revenue: "الإيراد", units: "القطع", skus: "الأصناف",
  pct: "النسبة", description: "المنتج", product: "المنتج", size: "المقاس",
  color: "اللون", colour: "اللون", store_display: "المتجر", store: "المتجر", days: "الأيام", date: "التاريخ",
};
const colLabel = (col: Col, rtl: boolean) => (rtl && AR_COL[col.key]) ? AR_COL[col.key] : col.label;

interface Row { [key: string]: string | number | null }
interface Col  {
  key:    string;
  label:  string;
  type:   "text"|"number"|"currency"|"date"|"units";
  hidden?: boolean;
}
interface DrillData {
  columns:  Col[];
  rows:     Row[];
  summary?: { label: string; value: string }[];
  fx?:      number;
}

const STORE_NAMES: Record<string,string> = {
  "CSTARS":"City Stars","CF-HOS":"Cairo Festival City","ALMAZA":"Almaza City Center",
  "P90":"Point 90","CCA":"Alexandria","ONLINE":"Online Store",
  "AMAZON BAN":"Amazon Banha","AMAZON KAM":"Amazon Kamal",
  "SHOPIFY-AMT":"AT Online","SHOPIFY-SAM":"Samsonite Online",
  "HO":"Head Office","NOON":"Noon","AMAZON":"Amazon Egypt","JUMIA":"Jumia",
  "DUTY FREE":"Duty Free","FOUR SEASO":"Four Seasons","GO SPORT1":"Go Sport",
  "MOA":"Mall of Arabia","MOE":"Mall of Egypt","SPINNEYS":"Spinneys",
};

function displayVal(val: string|number|null, col: Col, currency: string, fx: number): string {
  if (val === null || val === undefined || val === "") return "—";
  if (col.key === "pct") return `${Math.round(Number(val))}%`;
  if (col.key === "store_code" || col.key === "store") return STORE_NAMES[String(val)] ?? String(val);
  if (col.type === "currency") {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (currency === "USD") return `$${(n/fx).toLocaleString("en",{maximumFractionDigits:0})}`;
    if (n >= 1_000_000) return `EGP ${(n/1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `EGP ${(n/1_000).toFixed(1)}K`;
    return `EGP ${n.toLocaleString("en",{maximumFractionDigits:0})}`;
  }
  if (col.type === "units")  return Number(val).toLocaleString();
  if (col.type === "number") return Number(val).toLocaleString("en",{maximumFractionDigits:2});
  return String(val);
}

function secondaryVal(val: string|number|null, col: Col, currency: string, fx: number): string {
  if (col.type !== "currency" || val === null) return "";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return currency === "USD" ? `EGP ${Math.round(n).toLocaleString()}` : `$${Math.round(n/fx).toLocaleString()}`;
}

function exportCSV(columns: Col[], rows: Row[], title: string) {
  const visibleCols = columns.filter(c => !c.hidden && !c.key.startsWith("_"));
  const header = visibleCols.map(c => c.label).join(",");
  const body = rows.map(r => visibleCols.map(c => {
    const v = r[c.key]; return typeof v === "string" && v.includes(",") ? `"${v}"` : (v ?? "");
  }).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([header+"\n"+body], {type:"text/csv"}));
  a.download = `${title.replace(/\s+/g,"-").toLowerCase()}.csv`; a.click();
}

function computeHighlights(columns: Col[], rows: Row[], fx: number, currency: string, rtl: boolean) {
  if (!rows.length) return [];
  const revCol  = columns.find(c => c.type === "currency");
  const unitCol = columns.find(c => c.type === "units");
  const hl: {icon:string; label:string; value:string; key:string}[] = [];
  if (revCol) {
    const vals = rows.map(r => parseFloat(String(r[revCol.key]??0)));
    const total = vals.reduce((s,v)=>s+v,0);
    const topIdx = vals.indexOf(Math.max(...vals));
    const nameCol = columns.find(c => c.type==="text"||c.type==="date");
    hl.push({ key:"total", icon:"💰", label: rtl?"الإجمالي":"Total", value: currency==="USD" ? `$${Math.round(total/fx).toLocaleString()}` : `EGP ${Math.round(total).toLocaleString()}` });
    if (nameCol) hl.push({ key:"top", icon:"🏆", label: rtl?"الأعلى":"Top", value: displayVal(rows[topIdx][nameCol.key], nameCol, currency, fx) });
  }
  if (unitCol) {
    const total = rows.reduce((s,r)=>s+parseFloat(String(r[unitCol.key]??0)),0);
    hl.push({ key:"units", icon:"📦", label: rtl?"القطع":"Units", value: total.toLocaleString() });
  }
  return hl.slice(0,3);
}

// Build the "sales list" drill for whatever context the current view represents,
// so the Units stat can expand into the actual line-item sales at any stage.
// Preserves the active filters (store / category / channel / brand / size + dates)
// and re-points them at the items view. Returns null when the current view is
// already a granular sales/item list (nothing more to expand).
function buildUnitsDrill(endpoint: string, title: string): DrillParams | null {
  try {
    const p = new URL(endpoint, "http://x").searchParams;
    const type = p.get("type") || "";
    if (["items", "store-subcat", "item", "daily-detail"].includes(type)) return null;
    const np = new URLSearchParams({ type: "items" });
    for (const k of ["store", "category", "channel", "brand", "size", "from", "to"]) {
      const v = p.get(k);
      if (v) np.set(k, v);
    }
    return { title: `${title} · Sales`, endpoint: `/api/drill?${np.toString()}` };
  } catch {
    return null;
  }
}

// ── Level: one drill view in the stack ──────────────────────────────────────
function DrillLevel({
  params, onDrill, isTop, variant = "table", rtl = false,
}: {
  params: DrillParams;
  onDrill: (p: DrillParams) => void;
  isTop: boolean;
  variant?: DrillVariant;
  rtl?: boolean;
}) {
  const { currency } = useCurrency();
  const [data, setData]       = useState<DrillData|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [sortKey, setSortKey] = useState<string|null>(null);
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  const fetchData = useCallback(() => {
    setLoading(true); setError(false); setData(null);
    fetch(params.endpoint)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [params.endpoint]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSort = (key: string) => {
    if (sortKey===key) setSortDir(d => d==="asc"?"desc":"asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const visibleCols = (data?.columns ?? []).filter(c => !c.hidden && !c.key.startsWith("_"));
  // For the big "cards" view: the name (text/date) headlines each card, the first
  // currency column is the big number, everything else becomes a chip.
  const nameCol  = visibleCols.find(c => c.type === "text" || c.type === "date");
  const revCol   = visibleCols.find(c => c.type === "currency");
  const otherCols = visibleCols.filter(c => c !== nameCol && c !== revCol);
  const Chevron = rtl ? ChevronLeft : ChevronRight;

  const sortedRows = data ? [...data.rows].sort((a,b) => {
    if (!sortKey) return 0;
    const av=a[sortKey], bv=b[sortKey];
    const an=parseFloat(String(av)), bn=parseFloat(String(bv));
    const cmp = !isNaN(an)&&!isNaN(bn) ? an-bn : String(av).localeCompare(String(bv));
    return sortDir==="asc" ? cmp : -cmp;
  }) : [];

  const fx         = data?.fx || 52;
  const highlights = data ? computeHighlights(visibleCols, data.rows, fx, currency, rtl) : [];
  const unitsDrill = data ? buildUnitsDrill(params.endpoint, params.title) : null;

  const SortIcon = ({col}:{col:Col}) => {
    if (sortKey!==col.key) return <ArrowUpDown size={10} style={{opacity:0.3}} />;
    return sortDir==="desc" ? <ArrowDown size={10}/> : <ArrowUp size={10}/>;
  };

  const handleRowClick = (row: Row) => {
    const url   = row["_drill_url"]   ? String(row["_drill_url"])   : null;
    const title = row["_drill_title"] ? String(row["_drill_title"]) : "";
    if (url) onDrill({ title, endpoint: url });
  };

  const isDrillable = (row: Row) => !!row["_drill_url"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Highlights — the Units card expands into the underlying sales list */}
      {highlights.length > 0 && (
        <div dir={rtl ? "rtl" : undefined} style={{ padding: "12px 20px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {highlights.map((h,i) => {
            const clickable = h.key === "units" && !!unitsDrill;
            const big = variant === "cards";
            return (
              <div key={i}
                onClick={clickable ? () => onDrill(unitsDrill!) : undefined}
                title={clickable ? "View the sales behind these units" : undefined}
                style={{
                  display:"flex", alignItems:"center", gap:6,
                  background: clickable ? "var(--action-light)" : "var(--surface3)",
                  borderRadius:10, padding: big ? "9px 15px" : "6px 12px",
                  border: clickable ? "1px solid var(--action)" : "1px solid transparent",
                  cursor: clickable ? "pointer" : "default",
                  transition:"background 0.1s",
                }}
              >
                <span style={{fontSize: big ? "0.95rem" : "0.75rem"}}>{h.icon}</span>
                <div>
                  <p style={{fontSize: big ? "0.66rem" : "0.58rem", color:"var(--text3)", fontWeight:600}}>
                    {h.label}{clickable ? (rtl ? " · اضغط للتفاصيل" : " · tap to view sales") : ""}
                  </p>
                  <p style={{fontSize: big ? "1rem" : "0.72rem", fontWeight:800, color:"var(--text)"}}>{h.value}</p>
                </div>
                {clickable && <Chevron size={big ? 16 : 13} style={{color:"var(--action)"}}/>}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary pills from API */}
      {data?.summary && data.summary.length > 0 && (
        <div style={{ padding: "8px 20px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.summary.map((s,i) => (
            <span key={i} style={{ fontSize:"0.62rem", background:"var(--surface3)", borderRadius:8, padding:"3px 10px", color:"var(--text2)" }}>
              <span style={{color:"var(--text3)"}}>{s.label}: </span><strong>{s.value}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ flex:1, minHeight:0, overflowY:"auto", overflowX:"auto", marginTop:8, overscrollBehavior:"contain", WebkitOverflowScrolling:"touch" }}>
        {loading ? (
          <div style={{padding:20, display:"flex", flexDirection:"column", gap:8}}>
            {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{height:44, borderRadius:10}} />)}
          </div>
        ) : error ? (
          <div style={{padding:60, textAlign:"center"}}>
            <p style={{fontSize:"1.8rem", marginBottom:12}}>⚠️</p>
            <p style={{fontSize:"0.9rem", fontWeight:700, color:"var(--text2)"}}>{rtl ? "تعذّر تحميل البيانات" : "Failed to load data"}</p>
            <p style={{fontSize:"0.75rem", color:"var(--text3)", marginTop:4, marginBottom:16}}>{rtl ? "تحقّق من الاتصال وحاول مجددًا" : "Check your connection and try again"}</p>
            <button onClick={fetchData} style={{display:"inline-flex", alignItems:"center", gap:6, padding:"9px 20px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface3)", cursor:"pointer", fontSize:"0.8rem", color:"var(--text)", fontWeight:600}}>
              <RotateCcw size={14}/> {rtl ? "إعادة المحاولة" : "Retry"}
            </button>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div style={{padding:60, textAlign:"center"}}>
            <p style={{fontSize:"1.8rem", marginBottom:12}}>📭</p>
            <p style={{fontSize:"0.95rem", fontWeight:700, color:"var(--text2)"}}>{rtl ? "لا توجد بيانات في هذه الفترة" : "No data for this period"}</p>
            <p style={{fontSize:"0.78rem", color:"var(--text3)", marginTop:4}}>{rtl ? "جرّب توسيع الفترة" : "Try widening your date range"}</p>
          </div>
        ) : variant === "cards" ? (
          <div dir={rtl ? "rtl" : "ltr"} style={{display:"flex", flexDirection:"column", gap:12, padding:"14px 16px"}}>
            {sortedRows.map((row, i) => {
              const drillable = isDrillable(row);
              return (
                <button key={i} onClick={drillable ? () => handleRowClick(row) : undefined} style={{
                  width:"100%", textAlign: rtl ? "right" : "left", border:"1px solid var(--border)",
                  background:"var(--surface3)", borderRadius:18, padding:"16px 18px",
                  cursor: drillable ? "pointer" : "default", display:"flex", flexDirection:"column", gap:10,
                }}>
                  <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12}}>
                    <span style={{fontSize:"1.15rem", fontWeight:800, color:"var(--text)", lineHeight:1.25, overflow:"hidden", textOverflow:"ellipsis"}}>
                      {nameCol ? displayVal(row[nameCol.key], nameCol, currency, fx) : `#${i + 1}`}
                    </span>
                    {drillable && <Chevron size={22} style={{color:"var(--action)", flexShrink:0}}/>}
                  </div>
                  {revCol && (
                    <div style={{fontSize:"1.75rem", fontWeight:900, color:"var(--text)", letterSpacing:"-0.02em", lineHeight:1}}>
                      {displayVal(row[revCol.key], revCol, currency, fx)}
                    </div>
                  )}
                  {otherCols.length > 0 && (
                    <div style={{display:"flex", flexWrap:"wrap", gap:8, marginTop:2}}>
                      {otherCols.map(col => (
                        <span key={col.key} style={{fontSize:"0.92rem", fontWeight:700, color:"var(--text)", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"6px 13px"}}>
                          <span style={{color:"var(--text3)", fontWeight:600}}>{colLabel(col, rtl)} </span>
                          {displayVal(row[col.key], col, currency, fx)}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <table style={{width:"100%", borderCollapse:"collapse", fontSize:"0.78rem"}}>
            <thead>
              <tr style={{background:"var(--surface3)", position:"sticky", top:0, zIndex:2}}>
                {visibleCols.map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)} style={{
                    padding:"10px 14px",
                    textAlign: col.type==="text"||col.type==="date" ? "left" : "right",
                    fontWeight:700, fontSize:"0.6rem",
                    color: sortKey===col.key ? "var(--action)" : "var(--text3)",
                    textTransform:"uppercase", letterSpacing:"0.06em",
                    cursor:"pointer", userSelect:"none", whiteSpace:"nowrap",
                    borderBottom:"1px solid var(--border)",
                  }}>
                    <span style={{display:"inline-flex", alignItems:"center", gap:4}}>
                      {col.label} <SortIcon col={col}/>
                    </span>
                  </th>
                ))}
                {/* drill arrow column header */}
                {sortedRows.some(r => isDrillable(r)) && (
                  <th style={{width:28, borderBottom:"1px solid var(--border)"}}></th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row,i) => {
                const drillable = isDrillable(row);
                return (
                  <tr key={i}
                    onClick={drillable ? ()=>handleRowClick(row) : undefined}
                    style={{
                      borderBottom:"1px solid var(--border)",
                      cursor: drillable ? "pointer" : "default",
                      transition:"background 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--surface3)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {visibleCols.map(col => (
                      <td key={col.key} style={{
                        padding:"10px 14px",
                        textAlign: col.type==="text"||col.type==="date" ? "left" : "right",
                        color: "var(--text)",
                        fontWeight: col.type==="currency" ? 700 : 400,
                        fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap",
                        maxWidth: col.type==="text" ? "220px" : "auto",
                        overflow: col.type==="text" ? "hidden" : "visible",
                        textOverflow: col.type==="text" ? "ellipsis" : "clip",
                      }}>
                        {col.type==="currency" ? (
                          <span>
                            {displayVal(row[col.key], col, currency, fx)}
                            <span style={{fontSize:"0.58rem", color:"var(--text3)", marginLeft:4}}>
                              {secondaryVal(row[col.key], col, currency, fx)}
                            </span>
                          </span>
                        ) : displayVal(row[col.key], col, currency, fx)}
                      </td>
                    ))}
                    {sortedRows.some(r=>isDrillable(r)) && (
                      <td style={{padding:"10px 8px", textAlign:"center"}}>
                        {drillable && <ChevronRight size={13} style={{color:"var(--action)", opacity:0.7}}/>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* CSV */}
      {data && data.rows.length > 0 && (
        <div dir={rtl ? "rtl" : undefined} style={{padding:"10px 20px", borderTop:"1px solid var(--border)"}}>
          <button onClick={() => exportCSV(visibleCols, data.rows, params.title)}
            style={{display:"flex", alignItems:"center", gap:5, padding:"7px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface3)", cursor:"pointer", fontSize:"0.7rem", color:"var(--text2)", fontWeight:600}}>
            <Download size={13}/> {rtl ? `تصدير (${data.rows.length})` : `Export CSV (${data.rows.length} rows)`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main DrillDownSheet — manages the navigation stack ───────────────────────
export function DrillDownSheet({ stack, onClose, onPush, variant = "table", rtl = false }: {
  stack: DrillParams[];
  onClose: () => void;
  onPush:  (p: DrillParams) => void;
  variant?: DrillVariant;
  rtl?: boolean;
}) {
  const onBack = useCallback(() => onPush({ title: "__back__", endpoint: "" }), [onPush]);

  // Lock the page behind the sheet so touch-scrolling the list scrolls the list,
  // not the background (mobile scroll-chaining). The real scroller in the dashboard
  // layout is <main class="main-content">, NOT document.body — lock both. Restored
  // on close (overflow:hidden preserves scrollTop, so no jump).
  useEffect(() => {
    const main = document.querySelector(".main-content") as HTMLElement | null;
    const prevBody = document.body.style.overflow;
    const prevMain = main?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (main) main.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      if (main) main.style.overflow = prevMain;
    };
  }, []);

  const current = stack[stack.length - 1];
  if (!current) return null;

  const canGoBack = stack.length > 1;

  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:200, backdropFilter:"blur(4px)" }} />

      <div className={`drill-sheet ${variant === "cards" ? "drill-sheet-cards" : ""}`} style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:201,
        background:"var(--surface)", borderRadius:"22px 22px 0 0",
        maxHeight: variant === "cards" ? "94vh" : "90vh", display:"flex", flexDirection:"column",
        boxShadow:"0 -12px 60px rgba(0,0,0,0.25)",
      }}>

        {/* Drag handle */}
        <div style={{display:"flex", justifyContent:"center", padding:"12px 0 4px"}}>
          <div style={{width:40, height:4, borderRadius:2, background:"var(--border2)"}}/>
        </div>

        {/* Header — breadcrumb + title + close */}
        <div dir={rtl ? "rtl" : undefined} style={{padding:"4px 20px 12px", borderBottom:"1px solid var(--border)"}}>

          {/* Breadcrumb trail */}
          {stack.length > 1 && (
            <div style={{display:"flex", alignItems:"center", gap:4, marginBottom:8, flexWrap:"wrap"}}>
              {stack.map((s,i) => (
                <span key={i} style={{display:"inline-flex", alignItems:"center", gap:4}}>
                  {i > 0 && <ChevronRight size={11} style={{color:"var(--text4)", flexShrink:0}}/>}
                  <span style={{
                    fontSize:"0.62rem", fontWeight: i===stack.length-1 ? 700 : 500,
                    color: i===stack.length-1 ? "var(--text)" : "var(--text3)",
                    maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>{s.title}</span>
                </span>
              ))}
            </div>
          )}

          <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between"}}>
            <div style={{display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0}}>
              {canGoBack && (
                <button onClick={onBack}
                  style={{padding:"6px 12px", borderRadius:8, border:"1px solid var(--border)", background:"var(--surface3)", cursor:"pointer", fontSize: variant === "cards" ? "0.8rem" : "0.68rem", color:"var(--text2)", fontWeight:600, flexShrink:0, whiteSpace:"nowrap"}}>
                  {rtl ? "رجوع ←" : "← Back"}
                </button>
              )}
              <p style={{fontWeight:800, fontSize: variant === "cards" ? "1.2rem" : "1rem", color:"var(--text)", letterSpacing:"-0.02em", lineHeight:1.25, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                {current.title}
              </p>
            </div>
            <button onClick={onClose}
              style={{width:32, height:32, borderRadius:9, border:"1px solid var(--border)", background:"var(--surface3)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginLeft:10}}>
              <X size={15} style={{color:"var(--text3)"}}/>
            </button>
          </div>

          {/* Layer depth indicator */}
          {stack.length > 1 && (
            <div style={{display:"flex", gap:4, marginTop:8}}>
              {stack.map((_,i) => (
                <div key={i} style={{height:3, flex:1, borderRadius:2, background: i===stack.length-1 ? "var(--action)" : "var(--border2)"}}/>
              ))}
            </div>
          )}
        </div>

        {/* Content for current level */}
        <div style={{flex:1, minHeight:0, display:"flex", flexDirection:"column", overflow:"hidden"}}>
          <DrillLevel key={current.endpoint} params={current} onDrill={onPush} isTop={true} variant={variant} rtl={rtl} />
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .drill-sheet {
            top: 0 !important;
            bottom: 0 !important;
            left: auto !important;
            right: 0 !important;
            width: min(62vw, 760px) !important;
            border-radius: 0 !important;
            max-height: 100vh !important;
          }
          .drill-sheet-cards { width: min(76vw, 920px) !important; }
        }
      `}</style>
    </>
  );
}

// ── useDrill — manages the stack, exposes open/push/pop/close ────────────────
export function useDrill() {
  const [stack, setStack] = useState<DrillParams[]>([]);

  const open  = (p: DrillParams) => setStack([p]);
  const close = () => setStack([]);

  // push handles both forward navigation AND back (special sentinel)
  const push = (p: DrillParams) => {
    if (p.title === "__back__") {
      setStack(s => s.slice(0, -1));
    } else {
      setStack(s => [...s, p]);
    }
  };

  const drill = stack.length > 0 ? stack[stack.length - 1] : null;

  return { drill, stack, open, push, close };
}
