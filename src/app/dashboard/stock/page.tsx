"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { AlertTriangle, Zap, TrendingDown, Package, RefreshCw } from "lucide-react";

type StockTab = "fast" | "low" | "slow" | "overview";

interface OverviewData {
  summary: { totalSkus: number; inStock: number; zeroStock: number; lowStock: number; totalUnits: number; stockValue: { egp: number; usd: number } };
  velocity30d: { units: number; revenue: { egp: number; usd: number } };
  byCategory: { category: string; skus: number; units: number }[];
  byBrand: { brand: string; skus: number; units: number }[];
  byColour: { colour_group: string; skus: number; units: number }[];
  bySize: { size: string; skus: number; units: number }[];
  fx: number;
}

interface MoverItem {
  item_no: string; description: string; brand: string; category: string;
  subcategory: string; colour_exact: string; size: string; line_name: string;
  units_sold?: number; revenue?: { egp: number; usd: number };
  in_stock: number; daysRemaining: number | null;
  units_sold_30d?: number; unit_price?: number;
  units_sold_item?: number;
}

const COLOUR_MAP: Record<string, string> = {
  Black: "#1a1a1a", Blue: "#2563EB", Navy: "#1e3a5f", Grey: "#6B7280",
  Red: "#EF4444", Green: "#10B981", Yellow: "#F59E0B", Pink: "#EC4899",
  Purple: "#8B5CF6", White: "#E5E7EB", Brown: "#92400E", Orange: "#F97316",
  Beige: "#D4B896", Silver: "#9CA3AF", Gold: "#D97706", Teal: "#0D9488",
};

function StockBadge({ n, max }: { n: number; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min((n / max) * 100, 100)}%`, background: "var(--accent)", borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: "0.7rem", fontWeight: 700, minWidth: 28, textAlign: "right" }}>{n}</span>
    </div>
  );
}

function StockContent() {
  const { currency } = useCurrency();
  const sp = useSearchParams();

  const [tab, setTab] = useState<StockTab>((sp.get("tab") as StockTab) || "overview");
  const [range, setRange] = useState("30d");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [movers, setMovers] = useState<MoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState("");

  const loadOverview = useCallback(async () => {
    const r = await fetch("/api/stock/overview").then((x) => x.json());
    setOverview(r);
  }, []);

  const loadMovers = useCallback(async () => {
    setLoading(true);
    try {
      const type = tab === "low" ? "low" : tab === "slow" ? "slow" : "fast";
      const url = `/api/stock/movers?type=${type}&range=${range}${catFilter ? `&category=${encodeURIComponent(catFilter)}` : ""}`;
      const r = await fetch(url).then((x) => x.json());
      setMovers(r.items || []);
    } finally {
      setLoading(false);
    }
  }, [tab, range, catFilter]);

  useEffect(() => {
    if (tab === "overview") { setLoading(true); loadOverview().finally(() => setLoading(false)); }
    else loadMovers();
  }, [tab, loadOverview, loadMovers]);

  const val = (v: { egp: number; usd: number }) => fmt(v.egp, v.usd, currency);

  const TABS: { key: StockTab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <Package size={13} /> },
    { key: "fast", label: "Fast movers", icon: <Zap size={13} /> },
    { key: "low", label: "Low stock", icon: <AlertTriangle size={13} /> },
    { key: "slow", label: "Slow movers", icon: <TrendingDown size={13} /> },
  ];

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, #0D1B2A 0%, #1a3a5c 100%)" }}>
        <div className="px-4 pt-12 pb-2">
          <h1 style={{ color: "white", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Stock Intelligence</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: 2 }}>
            {overview ? `${overview.summary.totalUnits.toLocaleString()} units across ${overview.summary.inStock.toLocaleString()} SKUs` : "Warehouse snapshot"}
          </p>
        </div>

        <div className="scroll-x px-4 pb-3 pt-1 gap-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 20, fontSize: "0.7rem", fontWeight: 600,
              border: "none", cursor: "pointer", flexShrink: 0,
              background: tab === t.key ? "white" : "rgba(255,255,255,0.1)",
              color: tab === t.key ? "#0D1B2A" : "rgba(255,255,255,0.6)",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3 pt-3">
        {/* Range filter for non-overview tabs */}
        {tab !== "overview" && (
          <div className="flex gap-2">
            {["7d", "30d", "90d"].map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`filter-chip ${range === r ? "filter-chip-active" : ""}`}>{r}</button>
            ))}
            {overview?.byCategory.map((c) => (
              <button key={c.category} onClick={() => setCatFilter(catFilter === c.category ? "" : c.category)}
                className={`filter-chip ${catFilter === c.category ? "filter-chip-active" : ""}`}>
                {c.category}
              </button>
            ))}
          </div>
        )}

        {/* Overview tab */}
        {tab === "overview" && overview && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Total SKUs", value: overview.summary.totalSkus.toLocaleString(), sub: "in catalogue", color: "var(--accent)" },
                { label: "In Stock", value: overview.summary.inStock.toLocaleString(), sub: "have inventory", color: "var(--green)" },
                { label: "Low Stock", value: overview.summary.lowStock.toLocaleString(), sub: "≤5 units", color: "#D97706" },
                { label: "Zero Stock", value: overview.summary.zeroStock.toLocaleString(), sub: "sold out", color: "var(--red)" },
              ].map((kpi) => (
                <div key={kpi.label} className="card p-3">
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{kpi.label}</p>
                  <p style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.04em", color: kpi.color, lineHeight: 1, marginTop: 4 }}>{kpi.value}</p>
                  <p style={{ fontSize: "0.65rem", color: "var(--text3)", marginTop: 2 }}>{kpi.sub}</p>
                </div>
              ))}
            </div>

            <div className="card p-3">
              <p style={{ fontSize: "0.65rem", color: "var(--text3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Stock value</p>
              <p style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em" }}>{val(overview.summary.stockValue)}</p>
              <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>
                {overview.summary.totalUnits.toLocaleString()} total units · {overview.velocity30d.units.toLocaleString()} sold last 30d
              </p>
            </div>

            <div className="card p-3">
              <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)", marginBottom: 10 }}>Units by category</p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={overview.byCategory} layout="vertical" margin={{ top: 0, right: 30, left: 60, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={55} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return <div className="card p-2" style={{ fontSize: "0.65rem" }}><p style={{ fontWeight: 700 }}>{d.category}</p><p>{d.units} units · {d.skus} SKUs</p></div>;
                  }} />
                  <Bar dataKey="units" fill="#2563EB" radius={[0, 3, 3, 0]}>
                    {overview.byCategory.map((_, i) => <Cell key={i} fill={["#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#06B6D4"][i % 6]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-3">
              <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)", marginBottom: 10 }}>By colour</p>
              <div className="flex flex-wrap gap-2">
                {overview.byColour.map((c) => (
                  <div key={c.colour_group} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "var(--surface2)", borderRadius: 8, padding: "4px 8px",
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: COLOUR_MAP[c.colour_group] || "#ccc",
                      border: "1.5px solid var(--border)",
                    }} />
                    <span style={{ fontSize: "0.68rem", fontWeight: 600 }}>{c.colour_group}</span>
                    <span style={{ fontSize: "0.65rem", color: "var(--text3)" }}>{c.units}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-3">
              <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)", marginBottom: 10 }}>By size</p>
              {overview.bySize.map((s) => {
                const max = Math.max(...overview.bySize.map((x) => x.units));
                return (
                  <div key={s.size} className="mb-2">
                    <div className="flex justify-between mb-1">
                      <span style={{ fontSize: "0.7rem", fontWeight: 500 }}>{s.size}</span>
                      <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>{s.skus} SKUs</span>
                    </div>
                    <StockBadge n={s.units} max={max} />
                  </div>
                );
              })}
            </div>

            <div className="card p-3">
              <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>By brand</p>
              {overview.byBrand.slice(0, 8).map((b) => {
                const max = Math.max(...overview.byBrand.map((x) => x.units));
                return (
                  <div key={b.brand} className="mb-2">
                    <div className="flex justify-between mb-1">
                      <span style={{ fontSize: "0.7rem", fontWeight: 500 }}>{b.brand}</span>
                      <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>{b.skus} SKUs</span>
                    </div>
                    <StockBadge n={b.units} max={max} />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Movers tabs */}
        {tab !== "overview" && (
          <div className="card overflow-hidden">
            {loading ? (
              <div className="p-3 space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
            ) : movers.length === 0 ? (
              <p className="p-4 text-center" style={{ fontSize: "0.8rem", color: "var(--text3)" }}>No data for this filter</p>
            ) : (
              movers.map((item, i) => {
                const urgency = item.daysRemaining !== null
                  ? item.daysRemaining <= 3 ? "var(--red)" : item.daysRemaining <= 7 ? "#D97706" : "var(--text2)"
                  : "var(--text3)";

                return (
                  <div key={item.item_no} className="list-row px-3">
                    {tab === "fast" && (
                      <div style={{
                        width: 22, height: 22, borderRadius: 7, marginRight: 10, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: "0.68rem",
                        background: i === 0 ? "#FEF3C7" : i === 1 ? "#F3F4F6" : "var(--surface2)",
                        color: i === 0 ? "#D97706" : "var(--text3)",
                      }}>{i + 1}</div>
                    )}
                    {tab === "low" && (
                      <AlertTriangle size={14} style={{ color: urgency, marginRight: 10, flexShrink: 0 }} />
                    )}
                    {tab === "slow" && (
                      <TrendingDown size={14} style={{ color: "var(--text3)", marginRight: 10, flexShrink: 0 }} />
                    )}

                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: "0.73rem", fontWeight: 600 }} className="truncate">
                        {item.description || item.item_no}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {item.brand && <span style={{ fontSize: "0.6rem", color: "var(--accent)", fontWeight: 600 }}>{item.brand}</span>}
                        {item.category && <span style={{ fontSize: "0.6rem", color: "var(--text3)" }}>{item.category}</span>}
                        {item.colour_exact && (
                          <span style={{ fontSize: "0.6rem", display: "flex", alignItems: "center", gap: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLOUR_MAP[item.colour_exact] || "#ccc", display: "inline-block", border: "1px solid var(--border)" }} />
                            {item.colour_exact}
                          </span>
                        )}
                        {item.size && <span style={{ fontSize: "0.6rem", color: "var(--text3)" }}>{item.size}</span>}
                      </div>
                    </div>

                    <div className="ml-2 text-right shrink-0">
                      {tab === "fast" && (
                        <>
                          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--green)" }}>{item.units_sold} sold</p>
                          <p style={{ fontSize: "0.62rem", color: "var(--text3)" }}>{item.in_stock} left</p>
                        </>
                      )}
                      {tab === "low" && (
                        <>
                          <p style={{ fontSize: "0.85rem", fontWeight: 700, color: urgency }}>{item.in_stock} left</p>
                          {item.daysRemaining !== null && (
                            <p style={{ fontSize: "0.62rem", color: urgency }}>{item.daysRemaining}d stock</p>
                          )}
                        </>
                      )}
                      {tab === "slow" && (
                        <>
                          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--red)" }}>{item.units_sold || item.units_sold_30d || 0} sold</p>
                          <p style={{ fontSize: "0.62rem", color: "var(--text3)" }}>{item.in_stock} in stock</p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center" style={{ color: "var(--text3)" }}>Loading…</div>}>
      <StockContent />
    </Suspense>
  );
}
