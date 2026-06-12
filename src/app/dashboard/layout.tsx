"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Package, BarChart2, Megaphone } from "lucide-react";

const tabs = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/ask", label: "Ask AI", icon: MessageCircle },
  { href: "/dashboard/stock", label: "Stock", icon: Package },
  { href: "/dashboard/sales", label: "Sales", icon: BarChart2 },
  { href: "/dashboard/ads", label: "Ads", icon: Megaphone },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto bg-white">
      <div className="flex-1 overflow-y-auto pb-16">
        {children}
      </div>
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-100 z-50">
        <div className="flex">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                  active ? "text-blue-600" : "text-gray-400"
                }`}
              >
                <Icon size={22} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
