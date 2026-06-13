"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Package, Grid3X3, MessageCircle } from "lucide-react";
import { CurrencyProvider } from "@/components/CurrencyToggle";

const tabs = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/dashboard/sales", label: "Sales", icon: TrendingUp },
  { href: "/dashboard/stock", label: "Stock", icon: Package },
  { href: "/dashboard/catalogue", label: "Products", icon: Grid3X3 },
  { href: "/dashboard/ask", label: "Ask AI", icon: MessageCircle },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <CurrencyProvider>
      <div className="flex flex-col h-screen max-w-md mx-auto" style={{ background: "var(--bg)" }}>
        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 72 }}>
          {children}
        </div>
        <nav
          className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50"
          style={{
            background: "var(--navy)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="flex">
            {tabs.map(({ href, label, icon: Icon }) => {
              const active =
                pathname === href ||
                (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all"
                  style={{ color: active ? "#60A5FA" : "rgba(255,255,255,0.35)" }}
                >
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  <span style={{ fontSize: "0.6rem", fontWeight: active ? 700 : 500 }}>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </CurrencyProvider>
  );
}
