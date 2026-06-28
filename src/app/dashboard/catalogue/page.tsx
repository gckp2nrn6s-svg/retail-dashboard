"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { Search, X, SlidersHorizontal, Download } from "lucide-react";

interface Product {
  item_no: string; description: string; brand: string; category: string;
  subcategory: string; colour_exact: string; colour_group: string;
  size: string; size_detail: string; line_name: string; usage: string;
  in_stock: number; unit_price: { egp: number; usd: number };
  units_sold_30d: number; revenue_30d: { egp: number; usd: number };
  on_shopify: boolean;
}

const COLOUR_MAP: Record<string, string> = {
  Black: "#1a1a1a", Blue: "#2563EB", Navy: "#1e3a5f", Grey: "#6B7280",
  Red: "#EF4444", Green: "#10B981", Yellow: "#F59E0B", Pink: "#EC4899",
  Purple: "#8B5CF6", White: "#D1D5DB", Brown: "#92400E", Orange: "#F97316",
  Beige: "#D4B896", Silver: "#9CA3AF", Gold: "#D97706", Teal: "#0D9488",
  Turquoise: "#0891B2", Maroon: "#9B1C1C", Burgundy: "#7C2D12", Coral: "#FB7185",
  Olive: "#4D7C0F", Mint: "#6EE7B7", Lime: "#84CC16",
};

const CATEGORIES = ["Luggage", "Backpacks", "Bags", "Kids & School", "Accessories", "Bank"];
const BRANDS = ["Samsonite", "American Tourister", "Kamiliant", "Lipault", "High Sierra", "Samsonite Black Label", "Bank"];
const COLOURS = ["Black", "Blue", "Grey", "Red", "Green", "Yellow", "Pink", "White", "Brown", "Purple", "Orange", "Beige", "Navy", "Silver", "Gold", "Teal"];
const SIZES = ["Cabin", "Medium", "Large", "Extra Large"];
const STOCK_OPTS = [
  { value: "", label: "All" },
  { value: "in", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "zero", label: "Sold out" },
];
const SORT_OPTS = [
  { value: "stock_desc", label: "Most stock" },
  { value: "sales_desc", label: "Best sellers" },
  { value: "price_desc", label: "Highest price" },
  { value: "name_asc", label: "A–Z" },
];

export default function CataloguePage() {
  const { currency } = useCurrency();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [colour, setColour] = useState("");
  const [size, setSize] = useState("");
  const [stock, setStock] = useState("");
  const [sort, setSort] = useState("stock_desc");
  const [showFilters, setShowFilters] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [appending, setAppending] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const buildUrl = useCallback((p = 1) => {
    const params = new URLSearchParams({ sort, page: String(p), limit: "25" });
    if (search) params.set("q", search);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    if (colour) params.set("colour", colour);
    if (size) params.set("size", size);
    if (stock) params.set("stock", stock);
    return `/api/catalogue?${params}`;
  }, [search, category, brand, colour, size, stock, sort]);

  const reqIdRef = useRef(0); // discard out-of-order responses (fast typing / filter changes)

  const load = useCallback(async (p = 1, append = false) => {
    const myReq = ++reqIdRef.current;
    if (append) setAppending(true);
    else setLoading(true);
    try {
      const res = await fetch(buildUrl(p)).then((x) => x.json());
      if (myReq !== reqIdRef.current) return; // a newer search/filter superseded this
      setProducts(append ? (prev) => [...prev, ...res.items] : res.items);
      setTotal(res.total);
      setPage(p);
      setPages(res.pages);
    } finally {
      if (myReq === reqIdRef.current) { setLoading(false); setAppending(false); }
    }
  }, [buildUrl]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(1), search ? 350 : 0);
  }, [search, category, brand, colour, size, stock, sort, load]);

  const clearFilters = () => {
    setCategory(""); setBrand(""); setColour(""); setSize(""); setStock(""); setSearch("");
  };
  const hasFilters = !!(category || brand || colour || size || stock || search);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ sort, page: "1", limit: "9999" });
      if (search) params.set("q", search);
      if (category) params.set("category", category);
      if (brand) params.set("brand", brand);
      if (colour) params.set("colour", colour);
      if (size) params.set("size", size);
      if (stock) params.set("stock", stock);
      const res = await fetch(`/api/catalogue?${params}`).then(x => x.json());
      const all: Product[] = res.items || [];
      const rows = [
        ["Item No", "Description", "Brand", "Category", "Colour", "Size", "In Stock", "Price EGP", "Sold 30d"],
        ...all.map((p) => [p.item_no, `"${p.description}"`, p.brand, p.category, p.colour_exact, p.size, p.in_stock, p.unit_price.egp, p.units_sold_30d]),
      ];
      const csv = rows.map((r) => r.join(",")).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = "catalogue.csv";
      a.click();
    } finally {
      setExporting(false);
    }
  };

  const val = (v: { egp: number; usd: number }) => fmt(v.egp, v.usd, currency);

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, #0D1B2A 0%, #1a3a5c 100%)" }}>
        <div className="px-4 pb-2" style={{ paddingTop: "clamp(24px, 5vw, 32px)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 style={{ color: "white", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Products</h1>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: 2 }}>
                {loading ? "Loading…" : `${total.toLocaleString()} items`}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={exportCsv} disabled={exporting} style={{ color: "rgba(255,255,255,0.6)", padding: 6, background: "rgba(255,255,255,0.08)", borderRadius: 8, border: "none", cursor: "pointer", opacity: exporting ? 0.5 : 1 }}>
                <Download size={16} />
              </button>
              <button onClick={() => setShowFilters((v) => !v)} style={{
                color: showFilters ? "#60A5FA" : "rgba(255,255,255,0.6)",
                padding: 6, background: showFilters ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.08)",
                borderRadius: 8, border: "none", cursor: "pointer",
              }}>
                <SlidersHorizontal size={16} />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative mt-2 mb-1">
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.4)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, line, item code…"
              style={{
                width: "100%", paddingLeft: 32, paddingRight: search ? 32 : 12,
                paddingTop: 8, paddingBottom: 8, borderRadius: 10, border: "none",
                background: "rgba(255,255,255,0.1)", color: "white",
                fontSize: "0.8rem", outline: "none",
              }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.4)", background: "none", border: "none", cursor: "pointer" }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Sort strip */}
        <div className="scroll-x px-4 pb-3 gap-2">
          {SORT_OPTS.map((o) => (
            <button key={o.value} onClick={() => setSort(o.value)} style={{
              padding: "4px 12px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 600,
              border: "none", cursor: "pointer", flexShrink: 0,
              background: sort === o.value ? "white" : "rgba(255,255,255,0.1)",
              color: sort === o.value ? "#0D1B2A" : "rgba(255,255,255,0.6)",
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-4 py-3 space-y-3" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text2)" }}>Filters</p>
            {hasFilters && (
              <button onClick={clearFilters} style={{ fontSize: "0.68rem", color: "var(--accent)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                Clear all
              </button>
            )}
          </div>

          <div>
            <p style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Category</p>
            <div className="scroll-x">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(category === c ? "" : c)} className={`filter-chip ${category === c ? "filter-chip-active" : ""}`}>{c}</button>
              ))}
            </div>
          </div>

          <div>
            <p style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Brand</p>
            <div className="scroll-x">
              {BRANDS.map((b) => (
                <button key={b} onClick={() => setBrand(brand === b ? "" : b)} className={`filter-chip ${brand === b ? "filter-chip-active" : ""}`}>{b}</button>
              ))}
            </div>
          </div>

          <div>
            <p style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Colour</p>
            <div className="scroll-x">
              {COLOURS.map((c) => (
                <button key={c} onClick={() => setColour(colour === c ? "" : c)} className={`filter-chip ${colour === c ? "filter-chip-active" : ""}`} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLOUR_MAP[c] || "#ccc", border: "1px solid var(--border)", flexShrink: 0 }} />
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <p style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Size</p>
              <div className="flex flex-wrap gap-1">
                {SIZES.map((s) => (
                  <button key={s} onClick={() => setSize(size === s ? "" : s)} className={`filter-chip ${size === s ? "filter-chip-active" : ""}`}>{s}</button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Stock</p>
              <div className="flex flex-wrap gap-1">
                {STOCK_OPTS.map((o) => (
                  <button key={o.value} onClick={() => setStock(stock === o.value ? "" : o.value)} className={`filter-chip ${stock === o.value ? "filter-chip-active" : ""}`}>{o.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {hasFilters && !showFilters && (
        <div className="scroll-x px-4 py-2 gap-2" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          {[
            category && { label: category, clear: () => setCategory("") },
            brand && { label: brand, clear: () => setBrand("") },
            colour && { label: colour, clear: () => setColour("") },
            size && { label: size, clear: () => setSize("") },
            stock && { label: STOCK_OPTS.find((o) => o.value === stock)?.label || stock, clear: () => setStock("") },
          ].filter(Boolean).map((f) => f && (
            <button key={f.label} onClick={f.clear} className="filter-chip filter-chip-active" style={{ flexShrink: 0 }}>
              {f.label} <X size={10} />
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pt-3 space-y-2">
        {loading ? (
          [...Array(8)].map((_, i) => <div key={i} className="skeleton h-16 w-full" style={{ borderRadius: 12 }} />)
        ) : products.length === 0 ? (
          <div className="card p-6 text-center">
            <p style={{ fontSize: "0.8rem", color: "var(--text3)" }}>No products match your filters</p>
            <button onClick={clearFilters} style={{ marginTop: 8, fontSize: "0.75rem", color: "var(--accent)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {products.map((p) => (
              <div key={p.item_no} className="card p-3">
                <div className="flex items-start gap-2">
                  {/* Colour dot */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0, marginTop: 1,
                    background: p.colour_group ? (COLOUR_MAP[p.colour_group] || "#E5E7EB") : "#E5E7EB",
                    border: "2px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {!p.colour_group && <span style={{ fontSize: "0.5rem", color: "var(--text3)" }}>?</span>}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "0.75rem", fontWeight: 700, lineHeight: 1.3 }} className="truncate">
                      {p.description || p.item_no}
                    </p>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {p.brand && <span style={{ fontSize: "0.58rem", fontWeight: 700, color: "var(--accent)", background: "var(--accent-light)", borderRadius: 4, padding: "1px 5px" }}>{p.brand}</span>}
                      {p.category && <span style={{ fontSize: "0.58rem", color: "var(--text3)", background: "var(--surface2)", borderRadius: 4, padding: "1px 5px" }}>{p.category}{p.subcategory ? ` / ${p.subcategory}` : ""}</span>}
                      {p.size && <span style={{ fontSize: "0.58rem", color: "var(--text3)", background: "var(--surface2)", borderRadius: 4, padding: "1px 5px" }}>{p.size}</span>}
                      {p.colour_exact && (
                        <span style={{ fontSize: "0.58rem", color: "var(--text3)", background: "var(--surface2)", borderRadius: 4, padding: "1px 5px", display: "flex", alignItems: "center", gap: 3 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLOUR_MAP[p.colour_exact] || COLOUR_MAP[p.colour_group] || "#ccc" }} />
                          {p.colour_exact}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span style={{ fontSize: "0.7rem", color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        #{p.item_no}
                        {p.on_shopify && <span style={{ fontSize: "0.52rem", fontWeight: 800, color: "#5E8E3E", background: "rgba(149,191,71,0.18)", borderRadius: 4, padding: "1px 5px" }} title="Mapped to a Shopify product">Shopify</span>}
                      </span>
                      <div className="flex items-center gap-3">
                        <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>
                          {p.units_sold_30d > 0 ? <span style={{ color: "var(--green)", fontWeight: 600 }}>{p.units_sold_30d} sold/30d</span> : "no recent sales"}
                        </span>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700 }}>
                          {p.unit_price.egp > 0 ? val(p.unit_price) : "—"}
                        </span>
                        <span style={{
                          fontSize: "0.72rem", fontWeight: 700,
                          color: p.in_stock === 0 ? "var(--red)" : p.in_stock <= 5 ? "#D97706" : "var(--text)",
                          background: p.in_stock === 0 ? "var(--red-light)" : p.in_stock <= 5 ? "var(--gold-light)" : "var(--green-light)",
                          borderRadius: 6, padding: "1px 6px",
                        }}>
                          {p.in_stock === 0 ? "Out" : `${p.in_stock}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {page < pages && (
              <button
                onClick={() => load(page + 1, true)}
                disabled={appending}
                style={{
                  width: "100%", padding: "10px", borderRadius: 12, border: "none",
                  background: "var(--surface)", cursor: "pointer",
                  fontSize: "0.75rem", fontWeight: 600, color: "var(--accent)",
                  opacity: appending ? 0.6 : 1,
                }}
              >
                {appending ? "Loading…" : `Load more (${total - products.length} remaining)`}
              </button>
            )}
          </>
        )}
        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}
