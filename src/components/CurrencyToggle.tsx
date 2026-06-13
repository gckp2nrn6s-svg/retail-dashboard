"use client";
import { createContext, useContext, useState } from "react";

type Currency = "EGP" | "USD";
const CurrencyCtx = createContext<{ currency: Currency; toggle: () => void }>({
  currency: "EGP",
  toggle: () => {},
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("EGP");
  return (
    <CurrencyCtx.Provider value={{ currency, toggle: () => setCurrency((c) => (c === "EGP" ? "USD" : "EGP")) }}>
      {children}
    </CurrencyCtx.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyCtx);
}

export function fmt(egp: number, usd: number, currency: Currency): string {
  if (currency === "USD") return `$${usd.toLocaleString()}`;
  if (egp >= 1_000_000) return `EGP ${(egp / 1_000_000).toFixed(1)}M`;
  if (egp >= 1_000) return `EGP ${(egp / 1_000).toFixed(0)}K`;
  return `EGP ${egp.toLocaleString()}`;
}

export function CurrencyToggle() {
  const { currency, toggle } = useCurrency();
  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border border-white/20 text-white/80"
      style={{ background: "rgba(255,255,255,0.1)" }}
    >
      <span style={{ opacity: currency === "EGP" ? 1 : 0.5 }}>EGP</span>
      <span className="text-white/40">·</span>
      <span style={{ opacity: currency === "USD" ? 1 : 0.5 }}>USD</span>
    </button>
  );
}
