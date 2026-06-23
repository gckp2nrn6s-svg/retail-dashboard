"use client";
import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { PRESETS, DatePreset } from "@/contexts/DateRangeContext";

export interface LiveRange { preset: DatePreset; from: string; to: string; label: string }

// Arabic labels for the same presets used everywhere else in the dashboard.
const AR_LABEL: Record<DatePreset, string> = {
  today:     "اليوم",
  yesterday: "أمس",
  mtd:    "هذا الشهر",
  "7d":   "آخر 7 أيام",
  "30d":  "آخر 30 يوم",
  "90d":  "آخر 90 يوم",
  ytd:    "من بداية السنة",
  custom: "فترة مخصصة",
};

export function arRange(preset: DatePreset): LiveRange {
  const p = PRESETS.find(x => x.key === preset)!;
  return { preset, from: p.from(), to: p.to(), label: AR_LABEL[preset] };
}

export function DateRangePickerAr({ value, onChange, dark = false }: {
  value: LiveRange; onChange: (r: LiveRange) => void; dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cFrom, setCFrom] = useState(value.from);
  const [cTo, setCTo] = useState(value.to);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = 240;
    let left = r.left; // RTL: anchor to the left edge of the trigger
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    setPos({ top: r.bottom + 6, left });
  }, [open]);

  const textColor = dark ? "rgba(255,255,255,0.9)" : "var(--text)";
  const subColor  = dark ? "rgba(255,255,255,0.45)" : "var(--text3)";
  const bg        = dark ? "rgba(255,255,255,0.12)" : "var(--surface)";
  const border    = dark ? "rgba(255,255,255,0.18)" : "var(--border)";

  return (
    <div style={{ position: "relative" }} dir="rtl">
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10,
        background: bg, border: `1px solid ${border}`, cursor: "pointer",
        color: textColor, fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap",
      }}>
        <Calendar size={13} style={{ color: subColor, flexShrink: 0 }} />
        <span>{value.label}</span>
        <ChevronDown size={12} style={{ color: subColor, transform: open ? "rotate(180deg)" : "none", transition: "0.15s", flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div dir="rtl" style={{
            position: "fixed", top: pos.top, left: pos.left, zIndex: 9999,
            background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 16,
            padding: 8, width: 240, boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
            fontFamily: "inherit",
          }}>
            {PRESETS.filter(p => p.key !== "custom").map(p => {
              const sel = value.preset === p.key;
              return (
                <button key={p.key} onClick={() => { onChange(arRange(p.key)); setOpen(false); }} style={{
                  width: "100%", textAlign: "right", padding: "9px 12px", borderRadius: 10,
                  border: "none", cursor: "pointer",
                  background: sel ? "var(--action-light)" : "transparent",
                  color: sel ? "var(--action)" : "var(--text2)",
                  fontSize: "0.82rem", fontWeight: sel ? 800 : 600, transition: "all 0.1s",
                }}>
                  {AR_LABEL[p.key]}
                </button>
              );
            })}

            <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, padding: "10px 12px 4px" }}>
              <p style={{ fontSize: "0.62rem", color: "var(--text3)", fontWeight: 800, marginBottom: 8 }}>فترة مخصصة</p>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                <input type="date" value={cFrom} onChange={e => setCFrom(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.7rem", background: "var(--bg)", color: "var(--text)", outline: "none" }} />
                <span style={{ color: "var(--text3)", fontSize: "0.65rem", flexShrink: 0 }}>←</span>
                <input type="date" value={cTo} onChange={e => setCTo(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.7rem", background: "var(--bg)", color: "var(--text)", outline: "none" }} />
              </div>
              <button onClick={() => { onChange({ preset: "custom", from: cFrom, to: cTo, label: `${cFrom} ← ${cTo}` }); setOpen(false); }} style={{
                width: "100%", padding: "8px", borderRadius: 10, border: "none",
                background: "var(--navy)", color: "white", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer",
              }}>
                تطبيق
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
