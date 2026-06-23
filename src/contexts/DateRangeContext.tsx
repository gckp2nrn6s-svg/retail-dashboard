"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { todayCairo, cairoDaysAgo, cairoStartOfMonth, cairoStartOfYear, CAIRO_TZ } from "@/lib/dates";

export type DatePreset = "today" | "mtd" | "7d" | "30d" | "90d" | "ytd" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  preset: DatePreset;
  label: string;
}

// All dates are Cairo-local — the business runs on Egypt time. Using UTC here made
// "today" roll over 2–3h late (showing yesterday past Cairo-midnight). See src/lib/dates.ts.
const today = todayCairo;
const daysAgo = cairoDaysAgo;
const startOfYear = cairoStartOfYear;
const startOfMonth = cairoStartOfMonth;
function mtdLabel() {
  return new Date().toLocaleDateString("en-GB", { timeZone: CAIRO_TZ, month: "short", year: "numeric" });
}

export const PRESETS: { key: DatePreset; label: string; from: () => string; to: () => string }[] = [
  { key: "today",  label: "Today",                from: today,               to: today },
  { key: "mtd",    label: `MTD · ${mtdLabel()}`, from: startOfMonth,        to: today },
  { key: "7d",     label: "Last 7 days",          from: () => daysAgo(7),    to: today },
  { key: "30d",    label: "Last 30 days",          from: () => daysAgo(30),   to: today },
  { key: "90d",    label: "Last 90 days",          from: () => daysAgo(90),   to: today },
  { key: "ytd",    label: "Year to date",          from: startOfYear,         to: today },
  { key: "custom", label: "Custom range",          from: () => daysAgo(30),   to: today },
];

function makeRange(preset: DatePreset, customFrom?: string, customTo?: string): DateRange {
  const p = PRESETS.find(x => x.key === preset)!;
  return {
    from: preset === "custom" ? (customFrom || daysAgo(30)) : p.from(),
    to:   preset === "custom" ? (customTo   || today())     : p.to(),
    preset,
    label: p.label,
  };
}

interface DateRangeCtx {
  range: DateRange;
  setPreset: (p: DatePreset) => void;
  setCustom: (from: string, to: string) => void;
}

const Ctx = createContext<DateRangeCtx>({
  range: makeRange("mtd"),
  setPreset: () => {},
  setCustom: () => {},
});

export function DateRangeProvider({ children }: { children: ReactNode }) {
  // Always start with MTD so server and client render the same initial HTML.
  // Restore saved preference in useEffect (client-only, after hydration).
  const [range, setRange] = useState<DateRange>(() => makeRange("mtd"));

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ls_date_range");
      if (saved) {
        const p = JSON.parse(saved) as { preset: DatePreset; from: string; to: string };
        if (p.preset === "custom") {
          setRange({ ...p, label: `${p.from} → ${p.to}` });
        } else {
          const found = PRESETS.find(x => x.key === p.preset);
          if (found) setRange(makeRange(p.preset));
        }
      }
    } catch {}
  }, []);

  const setPreset = (p: DatePreset) => {
    if (p !== "custom") {
      const r = makeRange(p);
      setRange(r);
      try { localStorage.setItem("ls_date_range", JSON.stringify({ preset: p, from: r.from, to: r.to })); } catch {}
    }
  };

  const setCustom = (from: string, to: string) => {
    setRange({ from, to, preset: "custom", label: `${from} → ${to}` });
    try { localStorage.setItem("ls_date_range", JSON.stringify({ preset: "custom", from, to })); } catch {}
  };

  return <Ctx.Provider value={{ range, setPreset, setCustom }}>{children}</Ctx.Provider>;
}

export function useDateRange() { return useContext(Ctx); }
