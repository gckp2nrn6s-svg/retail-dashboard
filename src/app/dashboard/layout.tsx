"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Package, Grid3X3, MessageCircle, Zap, Target, Flag, MoreHorizontal, X, Megaphone, ShoppingBag, Activity } from "lucide-react";
import { CurrencyProvider } from "@/components/CurrencyToggle";
import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { useState } from "react";

const tabs = [
  { href: "/dashboard",           label: "Home",       icon: LayoutDashboard },
  { href: "/dashboard/live",      label: "Live",       icon: Activity },
  { href: "/dashboard/sales",     label: "Sales",      icon: TrendingUp },
  { href: "/dashboard/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/dashboard/stock",     label: "Stock",      icon: Package },
  { href: "/dashboard/targets",   label: "Targets",    icon: Target },
  { href: "/dashboard/catalogue", label: "Products",   icon: Grid3X3 },
  { href: "/dashboard/egypt",     label: "Made in EG", icon: Flag },
  { href: "/dashboard/marketing",  label: "Marketing",  icon: Megaphone },
  { href: "/dashboard/ask",        label: "Ask AI",     icon: MessageCircle },
];

const mobilePrimary = tabs.slice(0, 4);
const mobileMore = tabs.slice(4);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);

  return (
    <DateRangeProvider><CurrencyProvider>
      <div style={{ display: "flex", height: "100vh", background: "var(--bg)" }}>

        {/* ── Desktop sidebar ── */}
        <aside style={{ width: 232, flexShrink: 0, background: "#040C18", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)" }} className="desktop-sidebar">

          {/* Logo */}
          <div style={{ padding: "28px 20px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: "linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(37,99,235,0.5), inset 0 1px 0 rgba(255,255,255,0.15)" }}>
                <Zap size={18} style={{ color: "white" }} fill="white" />
              </div>
              <div>
                <p style={{ color: "white", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "-0.025em", lineHeight: 1.15 }}>Le Souverain</p>
                <p style={{ color: "rgba(255,255,255,0.28)", fontSize: "0.55rem", marginTop: 2, letterSpacing: "0.1em", fontWeight: 700 }}>INTELLIGENCE</p>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)", margin: "0 0 12px" }} />

          {/* Nav */}
          <nav style={{ flex: 1, padding: "4px 10px" }}>
            {tabs.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 12, marginBottom: 1,
                  color: active ? "white" : "rgba(255,255,255,0.35)",
                  background: active ? "linear-gradient(135deg, rgba(37,99,235,0.2) 0%, rgba(124,58,237,0.12) 100%)" : "transparent",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.82rem",
                  textDecoration: "none",
                  transition: "all 0.15s",
                  position: "relative",
                  boxShadow: active ? "inset 0 0 0 1px rgba(96,165,250,0.18)" : "none",
                }}>
                  {active && (
                    <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, borderRadius: "0 2px 2px 0", background: "linear-gradient(180deg, #60A5FA, #A78BFA)", boxShadow: "0 0 8px rgba(96,165,250,0.5)" }} />
                  )}
                  <Icon size={16} strokeWidth={active ? 2.2 : 1.7} style={{ flexShrink: 0, color: active ? "#93C5FD" : undefined }} />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div style={{ padding: "14px 20px 24px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 6px #10B981", animation: "livePulse 2s ease-in-out infinite" }} />
              <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.6rem", fontWeight: 500 }}>Live · syncs every 5 min</p>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main style={{ flex: 1, overflowY: "auto" }} className="main-content">
          {children}
        </main>

        {/* ── Mobile bottom tab bar ── */}
        <nav className="mobile-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#050D1A", borderTop: "1px solid rgba(255,255,255,0.07)", paddingBottom: "env(safe-area-inset-bottom)", zIndex: 50 }}>
          <div style={{ display: "flex" }}>
            {mobilePrimary.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  padding: "10px 0 8px", color: active ? "#60A5FA" : "rgba(255,255,255,0.3)",
                  textDecoration: "none", transition: "all 0.15s", position: "relative",
                }}>
                  {active && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 24, height: 2, borderRadius: 1, background: "#60A5FA" }} />}
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.6} />
                  <span style={{ fontSize: "0.58rem", fontWeight: active ? 700 : 500, letterSpacing: "0.02em" }}>{label}</span>
                </Link>
              );
            })}
            {/* More button */}
            <button onClick={() => setShowMore(v => !v)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "10px 0 8px", background: "none", border: "none", cursor: "pointer",
              color: mobileMore.some(t => pathname.startsWith(t.href)) ? "#60A5FA" : "rgba(255,255,255,0.3)",
            }}>
              <MoreHorizontal size={20} strokeWidth={1.6} />
              <span style={{ fontSize: "0.58rem", fontWeight: 500, letterSpacing: "0.02em" }}>More</span>
            </button>
          </div>
        </nav>

        {/* ── More drawer ── */}
        {showMore && (
          <>
            <div onClick={() => setShowMore(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} />
            <div className="mobile-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0D1B2A", borderTop: "1px solid rgba(255,255,255,0.1)", zIndex: 70, paddingBottom: "env(safe-area-inset-bottom)", borderRadius: "16px 16px 0 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px 8px" }}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>More</span>
                <button onClick={() => setShowMore(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)" }}><X size={16} /></button>
              </div>
              <div style={{ display: "flex", padding: "4px 12px 16px" }}>
                {mobileMore.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} onClick={() => setShowMore(false)} style={{
                      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      padding: "10px 0 8px", color: active ? "#60A5FA" : "rgba(255,255,255,0.5)",
                      textDecoration: "none",
                    }}>
                      <div style={{ width: 44, height: 44, borderRadius: 14, background: active ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon size={20} strokeWidth={active ? 2.2 : 1.6} />
                      </div>
                      <span style={{ fontSize: "0.6rem", fontWeight: active ? 700 : 500 }}>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}

      </div>

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @media (min-width: 768px) {
          .desktop-sidebar { display: flex !important; }
          .mobile-nav { display: none !important; }
          .main-content { padding-bottom: 0 !important; }
        }
        @media (max-width: 767px) {
          .desktop-sidebar { display: none !important; }
          .mobile-nav { display: block !important; }
          .main-content { padding-bottom: 72px; }
        }
      `}</style>
    </CurrencyProvider></DateRangeProvider>
  );
}
