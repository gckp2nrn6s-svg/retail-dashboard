import Link from "next/link";
import { AlertTriangle, TrendingUp, Package, ArrowRight } from "lucide-react";

export default function DashboardHome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="p-4 space-y-4">
      <div className="pt-2 pb-1 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Hi, Sherif</h1>
          <p className="text-xs text-gray-400">{greeting} · all stores live</p>
        </div>
        <Link href="/schema-review" className="text-xs text-blue-600 border border-blue-200 rounded-full px-3 py-1">
          Schema setup
        </Link>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-900">3 stock alerts</p>
          <p className="text-xs text-amber-700 mt-0.5">Spinner 28&quot; navy critically low across 2 stores</p>
        </div>
        <ArrowRight size={14} className="text-amber-500 ml-auto mt-1 shrink-0" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Today&apos;s sales</p>
          <p className="text-xl font-semibold mt-1">—</p>
          <p className="text-xs text-gray-400 mt-0.5">connecting...</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Units sold</p>
          <p className="text-xl font-semibold mt-1">—</p>
          <p className="text-xs text-gray-400 mt-0.5">connecting...</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Online orders</p>
          <p className="text-xl font-semibold mt-1">—</p>
          <p className="text-xs text-gray-400 mt-0.5">Shopify live</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Low stock SKUs</p>
          <p className="text-xl font-semibold mt-1">—</p>
          <p className="text-xs text-gray-400 mt-0.5">schema needed</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Quick actions</p>
        <Link href="/dashboard/ask" className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
            <TrendingUp size={16} className="text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">Ask the AI</p>
            <p className="text-xs text-blue-600">What&apos;s moving fastest this week?</p>
          </div>
          <ArrowRight size={14} className="text-blue-400" />
        </Link>
        <Link href="/schema-review" className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center">
            <Package size={16} className="text-gray-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Set up item schema</p>
            <p className="text-xs text-gray-400">Required before stock intelligence works</p>
          </div>
          <ArrowRight size={14} className="text-gray-400" />
        </Link>
      </div>
    </div>
  );
}
