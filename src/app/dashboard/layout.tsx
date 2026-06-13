"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Package, Grid3X3, MessageCircle, Zap } from "lucide-react";
import { CurrencyProvider } from "@/components/CurrencyToggle";
import { DateRangeProvider } from "@/contexts/DateRangeContext";

const tabs = [
  { href: "/dashboard",           label: "Home",     icon: LayoutDashboard },
  { href: "/dashboard/sales",     label: "Sales",    icon: TrendingUp },
  { href: "/dashboard/stock",     label: "Stock",    icon: Package },
  { href: "/dashboard/catalogue", label: "Products", icon: Grid3X3 },
  { href: "/dashboard/ask",       label: "Ask AI",   icon: MessageCircle },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <DateRangeProvider><CurrencyProvider>
      <div style={{ display: "flex", height: "100vh", background: "var(--bg)" }}>

        {/* ── Desktop sidebar ── */}
        <aside style={{ width: 220, flexShrink: 0, background: "#050D1A", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)" }} className="desktop-sidebar">

          {/* Logo */}
          <div style={{ padding: "26px 22px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, background: "linear-gradient(135deg, #2563EB, #7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(37,99,235,0.4)" }}>
                <Zap size={17} style={{ color: "white" }} />
              </div>
              <div>
                <p style={{ color: "white", fontWeight: 800, fontSize: "0.88rem", letterSpacing: "-0.02em" }}>Le Souverain</p>
                <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.58rem", marginTop: 1, letterSpacing: "0.04em" }}>INTELLIGENCE</p>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 22px 14px" }} />

          {/* Nav */}
          <nav style={{ flex: 1, padding: "0 12px" }}>
            {tabs.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 11, marginBottom: 2,
                  color: active ? "white" : "rgba(255,255,255,0.38)",
                  background: active ? "rgba(255,255,255,0.07)" : "transparent",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.82rem",
                  textDecoration: "none",
                  transition: "all 0.15s",
                  position: "relative",
                }}>
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.8} style={{ flexShrink: 0 }} />
                  {label}
                  {active && (
                    <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#60A5FA", boxShadow: "0 0 6px #60A5FA" }} />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div style={{ padding: "14px 22px 22px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 6px #10B981", animation: "livePulse 2s ease-in-out infinite" }} />
              <p style={{ color: "rgba(255,255,255,0.22)", fontSize: "0.6rem", fontWeight: 500 }}>Live · syncs every 5 min</p>
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
            {tabs.map(({ href, label, icon: Icon }) => {
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
          </div>
        </nav>

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
