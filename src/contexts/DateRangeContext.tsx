"use client";
import { createContext, useContext, useState, ReactNode } from "react";

export type DatePreset = "mtd" | "7d" | "30d" | "90d" | "ytd" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  preset: DatePreset;
  label: string;
}

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function startOfYear()  { return `${new Date().getFullYear()}-01-01`; }
function startOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function mtdLabel() {
  return new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export const PRESETS: { key: DatePreset; label: string; from: () => string; to: () => string }[] = [
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
  range: makeRange("30d"),
  setPreset: () => {},
  setCustom: () => {},
});

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<DateRange>(makeRange("30d"));

  const setPreset = (p: DatePreset) => {
    if (p !== "custom") setRange(makeRange(p));
  };

  const setCustom = (from: string, to: string) => {
    setRange({ from, to, preset: "custom", label: `${from} → ${to}` });
  };

  return <Ctx.Provider value={{ range, setPreset, setCustom }}>{children}</Ctx.Provider>;
}

export function useDateRange() { return useContext(Ctx); }
