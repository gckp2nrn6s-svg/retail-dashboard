"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useCurrency, fmt } from "@/components/CurrencyToggle";
import { DrillDownSheet, useDrill } from "@/components/DrillDownSheet";
import { DateRangePickerAr, arRange, LiveRange } from "@/components/DateRangePickerAr";
import { todayCairo } from "@/lib/dates";
import { ChevronLeft, RotateCcw } from "lucide-react";

interface LiveStore { code: string; name: string; group: string; egp: number; units: number }
interface LiveData {
  asOf: string; today: string; from: string; to: string; rangeDays: number; stores: LiveStore[];
  total: { egp: number; usd: number; units: number };
  prevTotal: number; prevFrom: string; prevTo: string; fx: number;
  sources: Record<string, string>; degraded: boolean;
}

const STORE_COLOR: Record<string, string> = {
  "CF-HOS": "#0D9488", CSTARS: "#2563EB", ALMAZA: "#7C3AED", CCA: "#EC4899",
  P90: "#EA580C", MOA: "#F59E0B", MOE: "#06B6D4", HIS: "#84CC16", MC: "#F43F5E",
  ECOM: "#A855F7",
};
const colorOf = (c: string) => STORE_COLOR[c] ?? "#94A3B8";

// Arabic store names (display only — the API stays English).
const AR_STORE: Record<string, string> = {
  "CF-HOS": "كايرو فيستيفال", CSTARS: "سيتي ستارز", ALMAZA: "ألمازا", CCA: "الإسكندرية",
  P90: "بوينت 90", MOA: "مول العرب", MOE: "مول مصر", HIS: "هايس", MC: "معادي سيتي",
  ECOM: "أونلاين",
};
const nameAr = (s: LiveStore) => AR_STORE[s.code] ?? s.name;

export default function LiveSalesPage() {
  const { currency } = useCurrency();
  const { stack, open: openDrill, push: pushDrill, close: closeDrill } = useDrill();

  const [range, setRange] = useState<LiveRange>(() => arRange("today"));
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const reqIdRef = useRef(0);

  const todayStr = todayCairo();
  const isLive = range.to >= todayStr; // range includes today → keep auto-refreshing

  const load = useCallback(async (silent = false) => {
    const myReq = ++reqIdRef.current;
    if (!silent) setLoading(true);
    try {
      const r: LiveData = await fetch(`/api/live?from=${range.from}&to=${range.to}`).then(x => x.json());
      if (myReq !== reqIdRef.current) return;
      setData(r);
      setUpdatedAt(new Date().toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" }));
    } finally { if (myReq === reqIdRef.current) setLoading(false); }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
    if (!isLive) return;
    const t = setInterval(() => load(true), 60_000); // live: refresh every minute
    return () => clearInterval(t);
  }, [load, isLive]);

  const val = (egp: number) => fmt(egp, Math.round(egp / (data?.fx ?? 50)), currency);

  const drillStore = (s: LiveStore) => {
    const q = `from=${range.from}&to=${range.to}`;
    if (s.code === "ECOM") {
      openDrill({ title: `أونلاين · المنتجات`, endpoint: `/api/drill?type=channel&channel=Ecom&${q}` });
    } else {
      openDrill({ title: `${nameAr(s)} · العلامات`, endpoint: `/api/drill?type=store-brand&store=${encodeURIComponent(s.code)}&${q}` });
    }
  };

  const maxEgp = data && data.stores.length > 0 ? Math.max(...data.stores.map(s => s.egp), 1) : 1;
  const navOffline = data?.sources?.nav === "offline";
  const totalLabel = range.preset === "today" ? "إجمالي اليوم" : "إجمالي الفترة";
  const prevLabel  = (data?.rangeDays ?? 1) === 1 ? "أمس" : "الفترة السابقة";

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: "var(--bg)", display: "flex", flexDirection: "column", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(160deg, #030B16 0%, #0B1A2E 60%, #0D2440 100%)", padding: "20px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isLive && <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#10B981", animation: "livePulse 2s ease-in-out infinite" }} />}
            <span style={{ color: "white", fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.02em" }}>مبيعات المتاجر</span>
            {isLive && <span style={{ fontSize: "0.56rem", fontWeight: 800, color: "#34D399", background: "rgba(16,185,129,0.14)", padding: "2px 7px", borderRadius: 6 }}>مباشر</span>}
          </div>
          <button onClick={() => load()} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 9, padding: "5px 10px", color: "rgba(255,255,255,0.8)", fontSize: "0.64rem", fontWeight: 600, cursor: "pointer" }}>
            <RotateCcw size={12} /> {updatedAt ? `آخر تحديث ${updatedAt}` : "—"}
          </button>
        </div>

        <p style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.66rem", margin: "7px 0 12px" }}>
          {isLive
            ? `اليوم · ${new Date(todayStr).toLocaleDateString("ar-EG-u-nu-latn", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })} · يُحدّث كل دقيقة`
            : `${range.from} ← ${range.to}`}
        </p>

        <DateRangePickerAr value={range} onChange={setRange} dark />
      </div>

      {navOffline && !loading && (
        <div style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "9px 14px" }}>
          <span style={{ fontSize: "0.7rem", color: "#F59E0B", fontWeight: 700 }}>⚠ النظام غير متصل</span>
          <span style={{ fontSize: "0.64rem", color: "var(--text3)" }}>عرض المبيعات أونلاين فقط — أرقام المتاجر غير متاحة.</span>
        </div>
      )}

      {/* Bars */}
      <div style={{ flex: 1, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          [1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton" style={{ height: 64, borderRadius: 16 }} />)
        ) : !data || data.stores.length === 0 ? (
          <div style={{ padding: 50, textAlign: "center", color: "var(--text4)" }}>
            <p style={{ fontSize: "1.8rem", marginBottom: 10 }}>🌙</p>
            <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text2)" }}>لا توجد مبيعات في هذه الفترة</p>
          </div>
        ) : (
          data.stores.map(s => (
            <button key={s.code} onClick={() => drillStore(s)} style={{
              position: "relative", width: "100%", textAlign: "right", border: "1px solid var(--border)",
              background: "var(--surface)", borderRadius: 16, padding: "13px 15px", cursor: "pointer", overflow: "hidden",
            }}>
              {/* bar fill — grows from the right edge (RTL) */}
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${Math.max(4, (s.egp / maxEgp) * 100)}%`, background: `${colorOf(s.code)}1f`, borderLeft: `2px solid ${colorOf(s.code)}` }} />
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorOf(s.code), flexShrink: 0 }} />
                    {nameAr(s)}{s.code === "ECOM" && isLive && <span style={{ fontSize: "0.56rem", fontWeight: 700, color: "#A855F7", background: "rgba(168,85,247,0.12)", padding: "1px 6px", borderRadius: 6 }}>مباشر</span>}
                  </p>
                  <p style={{ fontSize: "0.64rem", color: "var(--text3)", marginTop: 2 }}>{s.units.toLocaleString()} قطعة</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{val(s.egp)}</span>
                  <ChevronLeft size={15} style={{ color: "var(--text4)" }} />
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Total pinned at bottom */}
      {!loading && data && (
        <div style={{ position: "sticky", bottom: 0, background: "linear-gradient(180deg, transparent, var(--bg) 30%)", padding: "12px 16px 16px" }}>
          <div style={{ background: "linear-gradient(135deg, #0D1B2A, #122844)", borderRadius: 18, padding: "16px 20px", boxShadow: "0 8px 28px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
              <div>
                <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.62rem", fontWeight: 700 }}>{totalLabel}</p>
                <p style={{ color: "white", fontSize: "1.7rem", fontWeight: 900, letterSpacing: "-0.03em", marginTop: 2 }}>{val(data.total.egp)}</p>
                <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.66rem", marginTop: 2 }}>{data.total.units.toLocaleString()} قطعة · {data.stores.length} قنوات</p>
              </div>
              {data.prevTotal > 0 && (
                <div style={{ textAlign: "left" }}>
                  <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.58rem" }}>{prevLabel}</p>
                  <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", fontWeight: 700 }}>{val(data.prevTotal)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {stack.length > 0 && <DrillDownSheet stack={stack} onClose={closeDrill} onPush={pushDrill} variant="cards" rtl />}
      <style>{`@keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }`}</style>
    </div>
  );
}
