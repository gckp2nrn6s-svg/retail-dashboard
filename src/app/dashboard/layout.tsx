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
        <aside style={{
          width: 220,
          flexShrink: 0,
          background: "var(--navy)",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }} className="desktop-sidebar">
          {/* Logo */}
          <div style={{ padding: "28px 24px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: "linear-gradient(135deg, #2563EB, #7C3AED)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Zap size={16} style={{ color: "white" }} />
              </div>
              <div>
                <p style={{ color: "white", fontWeight: 800, fontSize: "0.85rem", letterSpacing: "-0.02em" }}>Le Souverain</p>
                <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.6rem", marginTop: 1 }}>Intelligence</p>
              </div>
            </div>
          </div>

          {/* Nav links */}
          <nav style={{ flex: 1, padding: "0 12px" }}>
            {tabs.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 10, marginBottom: 2,
                  color: active ? "white" : "rgba(255,255,255,0.4)",
                  background: active ? "rgba(255,255,255,0.08)" : "transparent",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.82rem",
                  textDecoration: "none",
                  transition: "all 0.15s",
                }}>
                  <Icon size={18} strokeWidth={active ? 2.2 : 1.8} style={{ flexShrink: 0 }} />
                  {label}
                  {active && (
                    <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#60A5FA" }} />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.58rem" }}>Live · syncs every 5 min</p>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main style={{ flex: 1, overflowY: "auto", paddingBottom: 0 }} className="main-content">
          {children}
        </main>

        {/* ── Mobile bottom tab bar ── */}
        <nav className="mobile-nav" style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "var(--navy)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 50,
        }}>
          <div style={{ display: "flex" }}>
            {tabs.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link key={href} href={href} style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 2, padding: "10px 0",
                  color: active ? "#60A5FA" : "rgba(255,255,255,0.35)",
                  textDecoration: "none", transition: "all 0.15s",
                }}>
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  <span style={{ fontSize: "0.6rem", fontWeight: active ? 700 : 500 }}>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <style>{`
        /* Desktop: show sidebar, hide bottom nav, no mobile padding */
        @media (min-width: 768px) {
          .desktop-sidebar { display: flex !important; }
          .mobile-nav { display: none !important; }
          .main-content { padding-bottom: 0 !important; }
        }
        /* Mobile: hide sidebar, show bottom nav */
        @media (max-width: 767px) {
          .desktop-sidebar { display: none !important; }
          .mobile-nav { display: block !important; }
          .main-content { padding-bottom: 72px; }
        }
      `}</style>
    </CurrencyProvider></DateRangeProvider>
  );
}
