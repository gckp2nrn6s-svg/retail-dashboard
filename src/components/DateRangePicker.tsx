"use client";
import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { useDateRange, PRESETS, DatePreset } from "@/contexts/DateRangeContext";

export function DateRangePicker({ dark = false }: { dark?: boolean }) {
  const { range, setPreset, setCustom } = useDateRange();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  // Position the fixed dropdown relative to the trigger button
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const dropW = 236;
    let left = r.right - dropW;
    if (left < 8) left = 8;
    if (left + dropW > window.innerWidth - 8) left = window.innerWidth - dropW - 8;
    setDropPos({ top: r.bottom + 6, left });
  }, [open]);

  const textColor = dark ? "rgba(255,255,255,0.85)" : "var(--text)";
  const subColor  = dark ? "rgba(255,255,255,0.4)"  : "var(--text3)";
  const bg        = dark ? "rgba(255,255,255,0.1)"  : "var(--surface)";
  const border    = dark ? "rgba(255,255,255,0.15)" : "var(--border)";

  return (
    <div style={{ position: "relative" }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 10,
        background: bg, border: `1px solid ${border}`,
        cursor: "pointer", color: textColor, fontSize: "0.72rem", fontWeight: 600,
        whiteSpace: "nowrap",
      }}>
        <Calendar size={13} style={{ color: subColor, flexShrink: 0 }} />
        <span>{range.label}</span>
        <ChevronDown size={12} style={{ color: subColor, transform: open ? "rotate(180deg)" : "none", transition: "0.15s", flexShrink: 0 }} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />

          {/* Dropdown — fixed positioning so it escapes any overflow:hidden container */}
          <div style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            zIndex: 9999,
            background: "var(--surface)",
            border: "1px solid var(--border2)",
            borderRadius: 16,
            padding: 8,
            width: 236,
            boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
          }}>
            {PRESETS.filter(p => p.key !== "custom").map(p => (
              <button key={p.key} onClick={() => { setPreset(p.key as DatePreset); setOpen(false); }} style={{
                width: "100%", textAlign: "left", padding: "9px 12px",
                borderRadius: 10, border: "none", cursor: "pointer",
                background: range.preset === p.key ? "var(--action-light)" : "transparent",
                color: range.preset === p.key ? "var(--action)" : "var(--text2)",
                fontSize: "0.78rem", fontWeight: range.preset === p.key ? 700 : 500,
                transition: "all 0.1s",
              }}>
                {p.label}
              </button>
            ))}

            {/* Custom range */}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, padding: "10px 12px 4px" }}>
              <p style={{ fontSize: "0.6rem", color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Custom range
              </p>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.7rem", background: "var(--bg)", color: "var(--text)", outline: "none" }}
                />
                <span style={{ color: "var(--text3)", fontSize: "0.65rem", flexShrink: 0 }}>→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.7rem", background: "var(--bg)", color: "var(--text)", outline: "none" }}
                />
              </div>
              <button onClick={() => { setCustom(customFrom, customTo); setOpen(false); }} style={{
                width: "100%", padding: "8px", borderRadius: 10, border: "none",
                background: "var(--navy)", color: "white", fontSize: "0.74rem",
                fontWeight: 700, cursor: "pointer",
              }}>
                Apply
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
