"use client";
import { useState } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import { useDateRange, PRESETS, DatePreset } from "@/contexts/DateRangeContext";

export function DateRangePicker({ dark = false }: { dark?: boolean }) {
  const { range, setPreset, setCustom } = useDateRange();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  const textColor = dark ? "rgba(255,255,255,0.85)" : "var(--text)";
  const subColor  = dark ? "rgba(255,255,255,0.4)"  : "var(--text3)";
  const bg        = dark ? "rgba(255,255,255,0.1)"   : "var(--surface)";
  const border    = dark ? "rgba(255,255,255,0.15)"  : "var(--border)";

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 10,
        background: bg, border: `1px solid ${border}`,
        cursor: "pointer", color: textColor, fontSize: "0.72rem", fontWeight: 600,
      }}>
        <Calendar size={13} style={{ color: subColor }} />
        <span>{range.label}</span>
        <ChevronDown size={12} style={{ color: subColor, transform: open ? "rotate(180deg)" : "none", transition: "0.15s" }} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />

          {/* Dropdown */}
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 14, padding: 8, minWidth: 220,
            boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          }}>
            {PRESETS.filter(p => p.key !== "custom").map(p => (
              <button key={p.key} onClick={() => { setPreset(p.key as DatePreset); setOpen(false); }} style={{
                width: "100%", textAlign: "left", padding: "9px 12px",
                borderRadius: 8, border: "none", cursor: "pointer",
                background: range.preset === p.key ? "var(--accent-light)" : "transparent",
                color: range.preset === p.key ? "var(--accent)" : "var(--text2)",
                fontSize: "0.78rem", fontWeight: range.preset === p.key ? 700 : 500,
                transition: "all 0.1s",
              }}>
                {p.label}
              </button>
            ))}

            {/* Custom range */}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 8, padding: "8px 12px 4px" }}>
              <p style={{ fontSize: "0.62rem", color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Custom range
              </p>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.72rem", background: "var(--bg)", color: "var(--text)" }}
                />
                <span style={{ color: "var(--text3)", fontSize: "0.65rem" }}>→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.72rem", background: "var(--bg)", color: "var(--text)" }}
                />
              </div>
              <button onClick={() => { setCustom(customFrom, customTo); setOpen(false); }} style={{
                width: "100%", padding: "8px", borderRadius: 8, border: "none",
                background: "var(--navy)", color: "white", fontSize: "0.72rem",
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
