"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, ChevronRight, X, ArrowLeft, Zap,
  Eye, MousePointer, DollarSign, Target, Users, BarChart2,
  Image as ImageIcon, Video, Layers, Sparkles, AlertCircle,
  RefreshCw, ExternalLink,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useCurrency } from "@/components/CurrencyToggle";

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "All" | "Meta" | "Google" | "TikTok";

interface KpiCard {
  key: string;
  label: string;
  value: string;
  raw: number;
  trend: number; // % change vs prev period
  icon: React.ReactNode;
}

interface Campaign {
  id: string;
  name: string;
  platform: Omit<Platform, "All">;
  status: "Active" | "Paused" | "Ended";
  objective: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  cpa: number;
  conversions: number;
  budgetUsed: number; // %
}

interface AdSet {
  id: string;
  name: string;
  audience: string;
  spend: number;
  revenue: number;
  roas: number;
  reach: number;
  frequency: number;
  ctr: number;
  conversions: number;
}

interface Ad {
  id: string;
  headline: string;
  body: string;
  format: "Image" | "Video" | "Carousel";
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  conversions: number;
  impressions: number;
  trend: number[];
}

interface Recommendation {
  doThis: { title: string; detail: string }[];
  avoidThis: { title: string; detail: string }[];
  creativeInsights: { title: string; detail: string }[];
  audienceInsights: { title: string; detail: string }[];
  brief: string;
  alerts: { type: "warning" | "danger" | "good"; text: string }[];
}

// ─── Mock data generators ─────────────────────────────────────────────────────

function mockOverview(from: string, to: string, platform: Platform) {
  const multiplier = platform === "All" ? 1 : platform === "Meta" ? 0.55 : platform === "Google" ? 0.3 : 0.15;
  return {
    totalSpend: 142800 * multiplier,
    totalRevenue: 487200 * multiplier,
    roas: 3.41,
    impressions: 4820000 * multiplier,
    clicks: 96400 * multiplier,
    ctr: 2.0,
    cpa: 18.6,
    conversions: 7680 * multiplier,
    trends: {
      totalSpend: 8.4,
      totalRevenue: 14.2,
      roas: 5.3,
      impressions: -2.1,
      clicks: 11.8,
      ctr: 0.9,
      cpa: -6.2,
      conversions: 19.4,
    },
    sparklines: Array.from({ length: 14 }, (_, i) => ({
      day: i + 1,
      spend: 8000 + Math.random() * 4000,
      revenue: 25000 + Math.random() * 15000,
      roas: 2.8 + Math.random() * 1.2,
    })),
  };
}

const PLATFORMS_CONFIG: Record<string, { color: string; bg: string }> = {
  Meta: { color: "#1877F2", bg: "rgba(24,119,242,0.15)" },
  Google: { color: "#4285F4", bg: "rgba(66,133,244,0.15)" },
  TikTok: { color: "#FF0050", bg: "rgba(255,0,80,0.15)" },
};

function mockCampaigns(platform: Platform): Campaign[] {
  const all: Campaign[] = [
    { id: "c1", name: "Summer Collection — Prospecting", platform: "Meta", status: "Active", objective: "Conversions", spend: 28400, revenue: 96000, roas: 3.38, ctr: 2.4, cpa: 17.2, conversions: 1651, budgetUsed: 71 },
    { id: "c2", name: "Retargeting — Cart Abandoners", platform: "Meta", status: "Active", objective: "Conversions", spend: 14200, revenue: 68400, roas: 4.82, ctr: 3.1, cpa: 11.4, conversions: 1245, budgetUsed: 88 },
    { id: "c3", name: "Brand Awareness — Reach", platform: "Meta", status: "Paused", objective: "Reach", spend: 9800, revenue: 18600, roas: 1.9, ctr: 1.2, cpa: 42.1, conversions: 233, budgetUsed: 100 },
    { id: "c4", name: "Google Search — Brand", platform: "Google", status: "Active", objective: "Conversions", spend: 18600, revenue: 82400, roas: 4.43, ctr: 5.8, cpa: 14.2, conversions: 1310, budgetUsed: 64 },
    { id: "c5", name: "Google PMax — All Products", platform: "Google", status: "Active", objective: "Sales", spend: 22100, revenue: 58700, roas: 2.66, ctr: 1.9, cpa: 22.8, conversions: 969, budgetUsed: 79 },
    { id: "c6", name: "TikTok — UGC Spark Ads", platform: "TikTok", status: "Active", objective: "Conversions", spend: 16400, revenue: 51200, roas: 3.12, ctr: 2.8, cpa: 19.4, conversions: 845, budgetUsed: 55 },
    { id: "c7", name: "TikTok — Creator Partnership", platform: "TikTok", status: "Ended", objective: "Awareness", spend: 8200, revenue: 6400, roas: 0.78, ctr: 4.1, cpa: 68.3, conversions: 120, budgetUsed: 100 },
  ];
  if (platform === "All") return all;
  return all.filter((c) => c.platform === platform);
}

function mockAdSets(campaignId: string): AdSet[] {
  return [
    { id: "as1", name: "Lookalike 1% — Purchasers", audience: "LAL 1% Buyers", spend: 9200, revenue: 34000, roas: 3.7, reach: 280000, frequency: 2.4, ctr: 2.8, conversions: 534 },
    { id: "as2", name: "Interest — Fashion & Style", audience: "Fashion Interest", spend: 7800, revenue: 24600, roas: 3.15, reach: 420000, frequency: 1.9, ctr: 2.1, conversions: 388 },
    { id: "as3", name: "Broad — 25-44 Female", audience: "Broad Demo", spend: 6100, revenue: 14800, roas: 2.43, reach: 680000, frequency: 1.4, ctr: 1.6, conversions: 218 },
    { id: "as4", name: "Retargeting — Viewers 50%+", audience: "Video Viewers", spend: 5300, revenue: 22600, roas: 4.26, reach: 94000, frequency: 3.8, ctr: 4.2, conversions: 311 },
  ];
}

function mockAds(adsetId: string): Ad[] {
  return [
    { id: "ad1", headline: "Elevate Your Summer Wardrobe", body: "Discover our new collection — curated styles for every occasion. Free shipping over $50.", format: "Video", spend: 4800, revenue: 18200, roas: 3.79, ctr: 3.4, conversions: 284, impressions: 141000, trend: [2.8, 3.1, 3.4, 3.6, 3.79, 4.1] },
    { id: "ad2", headline: "New Arrivals Just Dropped", body: "Shop the looks everyone is talking about. Limited stock available.", format: "Image", spend: 3200, revenue: 9800, roas: 3.06, ctr: 2.8, conversions: 156, impressions: 114000, trend: [2.4, 2.6, 2.9, 3.1, 3.0, 3.06] },
    { id: "ad3", headline: "Style Quiz → Find Your Look", body: "Take our 60-second style quiz and get personalized picks delivered to your door.", format: "Carousel", spend: 2900, revenue: 11400, roas: 3.93, ctr: 4.1, conversions: 178, impressions: 70000, trend: [3.2, 3.5, 3.7, 3.8, 3.93, 4.0] },
    { id: "ad4", headline: "Last Chance — Summer Sale", body: "Up to 40% off before the season ends. Don't miss out.", format: "Image", spend: 1900, revenue: 2200, roas: 1.16, ctr: 1.2, conversions: 34, impressions: 158000, trend: [1.8, 1.5, 1.3, 1.2, 1.1, 1.16] },
  ];
}

function mockRecommendations(): Recommendation {
  return {
    brief: "Performance is trending positively this period. Meta retargeting campaigns are outperforming benchmarks with a 4.82x ROAS. Google PMax needs budget reallocation — shift 20% to Search campaigns. TikTok Creator Partnership has ended with negative ROI; pause all similar formats until creative refresh. Overall spend efficiency is up 8.4% vs prior period.",
    alerts: [
      { type: "danger", text: "TikTok Creator Campaign ROAS below 1x — immediate review needed" },
      { type: "warning", text: "Google PMax CPA $22.8 above target ($18)" },
      { type: "good", text: "Meta Retargeting ROAS 4.82x — scale budget by 15%" },
      { type: "good", text: "Summer Prospecting CTR up 0.4pp vs last week" },
    ],
    doThis: [
      { title: "Scale Meta Retargeting", detail: "Increase daily budget by 15-20%. ROAS at 4.82x well above 3x threshold. Expand lookalike from 1% to 2% to increase scale without sacrificing efficiency." },
      { title: "Shift Google Budget to Search", detail: "Move $4-5K/mo from PMax to Brand Search. CPA on Brand Search ($14.2) is 38% lower than PMax ($22.8)." },
      { title: "Test UGC Video Creative", detail: "TikTok UGC Spark Ads showing 3.12x ROAS with strong CTR. Commission 3-5 new creator briefs focusing on product unboxing." },
      { title: "Launch Reengagement Flow", detail: "Deploy a 3-touch retargeting sequence for 50%+ video viewers. Current retargeting is under-serving this high-intent segment." },
    ],
    avoidThis: [
      { title: "Creator Partnership Format", detail: "TikTok creator deals with flat fees showed 0.78x ROAS. Avoid fixed-fee structures — shift to performance-based or CPA-commission models only." },
      { title: "Broad Demo Targeting on Meta", detail: "Broad 25-44 Female ad set has 2.43x ROAS — 29% below LAL audiences. Reduce budget allocation until creative specifically for broad cold audiences is ready." },
      { title: "Static Image for Awareness", detail: "Brand awareness campaign with static images consistently underdelivers. Switch to short-form video (6-15s) for upper-funnel placements." },
      { title: "Increasing PMax Budget", detail: "PMax campaigns are auto-optimizing to low-quality traffic. Do not increase budget — instead define product feed exclusions and add audience signals." },
    ],
    creativeInsights: [
      { title: "Video outperforms image 2.1x on CTR", detail: "Across all platforms, video creatives average 3.4% CTR vs 1.6% for static images. Prioritize video production for Q3." },
      { title: "Carousel drives 18% more conversions", detail: "Carousel ads on Meta show 18% higher conversion rate vs single image, particularly for multi-product showcases." },
    ],
    audienceInsights: [
      { title: "LAL 1% Purchasers is your best audience", detail: "1% lookalike of purchasers delivers 3.7x ROAS consistently. Expand to 2% and test LAL of high-LTV customers (top 20%) separately." },
      { title: "Video viewers retargeting is underutilised", detail: "Only 12% of budget goes to video viewer retargeting, yet it delivers 4.26x ROAS. Reallocate budget from broad prospecting." },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, currency: string) {
  if (n >= 1_000_000) return `${currency === "USD" ? "$" : "EGP "}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${currency === "USD" ? "$" : "EGP "}${(n / 1_000).toFixed(1)}K`;
  return `${currency === "USD" ? "$" : "EGP "}${n.toFixed(0)}`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function roasColor(roas: number) {
  if (roas >= 3) return "#10B981";
  if (roas >= 1) return "#F59E0B";
  return "#EF4444";
}

function roasBorder(roas: number) {
  if (roas >= 3) return "rgba(16,185,129,0.4)";
  if (roas >= 1) return "rgba(245,158,11,0.4)";
  return "rgba(239,68,68,0.4)";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlatformPill({ p, active, onClick }: { p: Platform; active: boolean; onClick: () => void }) {
  const cfg = p !== "All" ? PLATFORMS_CONFIG[p] : null;
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? (cfg ? cfg.bg : "rgba(37,99,235,0.2)") : "rgba(255,255,255,0.04)",
        borderColor: active ? (cfg ? cfg.color : "#2563EB") : "rgba(255,255,255,0.1)",
        color: active ? (cfg ? cfg.color : "#60A5FA") : "rgba(255,255,255,0.5)",
        transition: "all 0.2s",
      }}
      className="px-4 py-1.5 rounded-full border text-sm font-semibold cursor-pointer hover:opacity-90"
    >
      {p}
    </button>
  );
}

function TrendBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className="flex items-center gap-0.5 text-xs font-semibold"
      style={{ color: up ? "#10B981" : "#EF4444" }}
    >
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Skeleton({ h, w }: { h?: string; w?: string }) {
  return (
    <div
      className="animate-pulse rounded-lg"
      style={{ height: h || "20px", width: w || "100%", background: "rgba(255,255,255,0.06)" }}
    />
  );
}

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const cfg = {
    Active: { bg: "rgba(16,185,129,0.15)", color: "#10B981", dot: "#10B981" },
    Paused: { bg: "rgba(245,158,11,0.15)", color: "#F59E0B", dot: "#F59E0B" },
    Ended: { bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", dot: "rgba(255,255,255,0.3)" },
  }[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {status}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORMS_CONFIG[platform] || { color: "#888", bg: "rgba(255,255,255,0.06)" };
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {platform}
    </span>
  );
}

function FormatIcon({ format }: { format: Ad["format"] }) {
  if (format === "Video") return <Video size={14} />;
  if (format === "Carousel") return <Layers size={14} />;
  return <ImageIcon size={14} />;
}

const SORT_KEYS = ["name", "spend", "revenue", "roas", "ctr", "cpa", "conversions", "budgetUsed"] as const;
type SortKey = (typeof SORT_KEYS)[number];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MarketingPage() {
  const { range } = useDateRange();
  const { currency } = useCurrency();

  // Filters
  const [platform, setPlatform] = useState<Platform>("All");

  // Layer 2 state
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  // Layer 3 state
  const [selectedAdSet, setSelectedAdSet] = useState<AdSet | null>(null);

  // Layer 4 state
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  // Expanded recommendation cards
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  // Loading states
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingAdSets, setLoadingAdSets] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);

  // Data
  const [overview, setOverview] = useState<ReturnType<typeof mockOverview>>(mockOverview());
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation | null>(null);

  // ── Fetch overview ──
  useEffect(() => {
    setLoadingOverview(true);
    const params = new URLSearchParams({ from: range.from, to: range.to, ...(platform !== "All" ? { platform } : {}) });
    fetch(`/api/marketing/overview?${params}`)
      .then(r => r.json())
      .then(d => { setOverview(d); setLoadingOverview(false); })
      .catch(() => setLoadingOverview(false));
  }, [range.from, range.to, platform]);

  // ── Fetch campaigns ──
  useEffect(() => {
    setLoadingCampaigns(true);
    const params = new URLSearchParams({ from: range.from, to: range.to, ...(platform !== "All" ? { platform } : {}) });
    fetch(`/api/marketing/campaigns?${params}`)
      .then(r => r.json())
      .then(d => { setCampaigns(Array.isArray(d) ? d : d.campaigns ?? []); setLoadingCampaigns(false); })
      .catch(() => setLoadingCampaigns(false));
  }, [range.from, range.to, platform]);

  // ── Fetch recommendations ──
  useEffect(() => {
    fetch(`/api/marketing/recommendations?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => setRecommendations(d))
      .catch(() => {});
  }, [range.from, range.to]);

  // ── Fetch ad sets when campaign selected ──
  useEffect(() => {
    if (!selectedCampaign) return;
    setLoadingAdSets(true);
    setAdSets([]);
    setSelectedAdSet(null);
    setSelectedAd(null);
    fetch(`/api/marketing/adsets?campaignId=${selectedCampaign.id}`)
      .then(r => r.json())
      .then(d => { setAdSets(Array.isArray(d) ? d : d.adsets ?? []); setLoadingAdSets(false); })
      .catch(() => setLoadingAdSets(false));
  }, [selectedCampaign]);

  // ── Fetch ads when ad set selected ──
  useEffect(() => {
    if (!selectedAdSet) return;
    setLoadingAds(true);
    setAds([]);
    setSelectedAd(null);
    fetch(`/api/marketing/ads?adsetId=${selectedAdSet.id}`)
      .then(r => r.json())
      .then(d => { setAds(Array.isArray(d) ? d : d.ads ?? []); setLoadingAds(false); })
      .catch(() => setLoadingAds(false));
  }, [selectedAdSet]);

  // ── Auto-refresh every 60s ──
  const rangeFromRef = useRef(range.from);
  const rangeToRef   = useRef(range.to);
  const platformRef  = useRef(platform);
  rangeFromRef.current = range.from;
  rangeToRef.current   = range.to;
  platformRef.current  = platform;
  useEffect(() => {
    const interval = setInterval(() => {
      const from = rangeFromRef.current, to = rangeToRef.current, plat = platformRef.current;
      const params = new URLSearchParams({ from, to, ...(plat !== "All" ? { platform: plat } : {}) });
      fetch(`/api/marketing/overview?${params}`).then(r => r.json()).then(setOverview).catch(() => {});
      fetch(`/api/marketing/campaigns?${params}`).then(r => r.json()).then(d => setCampaigns(Array.isArray(d) ? d : d.campaigns ?? [])).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // ── Sorted campaigns ──
  const sortedCampaigns = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      const va = a[sortKey as keyof Campaign] as number;
      const vb = b[sortKey as keyof Campaign] as number;
      if (typeof va === "string") return sortDir === "asc" ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [campaigns, sortKey, sortDir]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortKey(key); setSortDir("desc"); }
    },
    [sortKey]
  );

  // ── KPI cards ──
  const kpiCards: KpiCard[] = overview
    ? [
        { key: "totalSpend", label: "Total Spend", value: fmt(overview.totalSpend, currency), raw: overview.totalSpend, trend: overview.trends.totalSpend, icon: <DollarSign size={16} /> },
        { key: "totalRevenue", label: "Revenue", value: fmt(overview.totalRevenue, currency), raw: overview.totalRevenue, trend: overview.trends.totalRevenue, icon: <TrendingUp size={16} /> },
        { key: "roas", label: "ROAS", value: `${overview.roas.toFixed(2)}x`, raw: overview.roas, trend: overview.trends.roas, icon: <BarChart2 size={16} /> },
        { key: "impressions", label: "Impressions", value: fmtNum(overview.impressions), raw: overview.impressions, trend: overview.trends.impressions, icon: <Eye size={16} /> },
        { key: "clicks", label: "Clicks", value: fmtNum(overview.clicks), raw: overview.clicks, trend: overview.trends.clicks, icon: <MousePointer size={16} /> },
        { key: "ctr", label: "CTR", value: `${overview.ctr.toFixed(1)}%`, raw: overview.ctr, trend: overview.trends.ctr, icon: <Target size={16} /> },
        { key: "cpa", label: "CPA", value: fmt(overview.cpa, currency), raw: overview.cpa, trend: overview.trends.cpa, icon: <Users size={16} /> },
        { key: "conversions", label: "Conversions", value: fmtNum(overview.conversions), raw: overview.conversions, trend: overview.trends.conversions, icon: <CheckCircle size={16} /> },
      ]
    : [];

  const drawerOpen = !!selectedCampaign;

  return (
    <div
      className="min-h-screen"
      style={{ background: "#050D1A", color: "#fff", fontFamily: "inherit" }}
    >
      {/* ── Page Header ── */}
      <div
        className="sticky top-0 z-20 px-6 py-4 flex items-center justify-between gap-4 flex-wrap"
        style={{
          background: "rgba(5,13,26,0.95)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">Performance Marketing</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
            Cross-platform ad intelligence — {range.label}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangePicker />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* ── LAYER 1: Overview ── */}
        <section>
          {/* Platform pills */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {(["All", "Meta", "Google", "TikTok"] as Platform[]).map((p) => (
              <PlatformPill key={p} p={p} active={platform === p} onClick={() => setPlatform(p)} />
            ))}
            <span className="ml-auto text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
              {range.from} → {range.to}
            </span>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-5">
            {loadingOverview
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <Skeleton h="12px" w="60%" />
                    <div className="mt-3"><Skeleton h="24px" w="80%" /></div>
                    <div className="mt-2"><Skeleton h="12px" w="50%" /></div>
                  </div>
                ))
              : kpiCards.map((card) => (
                  <div
                    key={card.key}
                    className="rounded-xl p-4 transition-all duration-200 hover:scale-[1.02]"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {card.icon}
                      <span className="text-xs font-medium uppercase tracking-wider">{card.label}</span>
                    </div>
                    <div className="text-2xl font-bold tracking-tight">{card.value}</div>
                    <div className="mt-1.5">
                      <TrendBadge value={card.trend} />
                    </div>
                  </div>
                ))}
          </div>

          {/* Daily Brief + Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Brief */}
            <div
              className="lg:col-span-2 rounded-xl p-5"
              style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} style={{ color: "#60A5FA" }} />
                <span className="text-sm font-semibold" style={{ color: "#60A5FA" }}>AI Daily Brief</span>
                <span className="ml-auto text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Generated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {recommendations ? (
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {recommendations.brief}
                </p>
              ) : (
                <div className="space-y-2">
                  <Skeleton h="14px" />
                  <Skeleton h="14px" w="90%" />
                  <Skeleton h="14px" w="80%" />
                </div>
              )}
            </div>

            {/* Alerts */}
            <div
              className="rounded-xl p-5"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={16} style={{ color: "#F59E0B" }} />
                <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>Alerts</span>
              </div>
              {recommendations ? (
                <div className="space-y-2">
                  {recommendations.alerts.map((a, i) => {
                    const cfg = {
                      danger: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", icon: <XCircle size={13} /> },
                      warning: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B", icon: <AlertTriangle size={13} /> },
                      good: { bg: "rgba(16,185,129,0.12)", color: "#10B981", icon: <CheckCircle size={13} /> },
                    }[a.type];
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        <span className="mt-0.5 shrink-0">{cfg.icon}</span>
                        <span style={{ color: "rgba(255,255,255,0.8)" }}>{a.text}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} h="32px" />)}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Revenue sparkline ── */}
        {overview && (
          <div
            className="rounded-xl p-5"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Spend vs Revenue — 14 Day Trend</span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={overview.sparklines} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={{ background: "#0F1B2D", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", fontSize: 12 }}
                  formatter={(v: any, name: any) => [fmt(v as number, currency), name === "spend" ? "Spend" : "Revenue"]}
                />
                <Area type="monotone" dataKey="spend" stroke="#2563EB" strokeWidth={2} fill="url(#spendGrad)" dot={false} />
                <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#revGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-6 mt-2 justify-end">
              <span className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                <span className="w-3 h-0.5 rounded" style={{ background: "#2563EB", display: "inline-block" }} /> Spend
              </span>
              <span className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                <span className="w-3 h-0.5 rounded" style={{ background: "#10B981", display: "inline-block" }} /> Revenue
              </span>
            </div>
          </div>
        )}

        {/* ── LAYER 2: Campaign Table ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
              Campaigns
              {!loadingCampaigns && (
                <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
                  {campaigns.length}
                </span>
              )}
            </h2>
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Click a row to drill down</span>
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {[
                      { key: "name", label: "Campaign" },
                      { key: null, label: "Platform" },
                      { key: null, label: "Status" },
                      { key: null, label: "Objective" },
                      { key: "spend", label: "Spend" },
                      { key: "revenue", label: "Revenue" },
                      { key: "roas", label: "ROAS" },
                      { key: "ctr", label: "CTR" },
                      { key: "cpa", label: "CPA" },
                      { key: "conversions", label: "Conv." },
                      { key: "budgetUsed", label: "Budget" },
                    ].map(({ key, label }) => (
                      <th
                        key={label}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "rgba(255,255,255,0.35)", cursor: key ? "pointer" : "default", whiteSpace: "nowrap", userSelect: "none" }}
                        onClick={() => key && handleSort(key as SortKey)}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          {key && sortKey === key && (
                            sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loadingCampaigns
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          {Array.from({ length: 11 }).map((__, j) => (
                            <td key={j} className="px-4 py-3"><Skeleton h="14px" /></td>
                          ))}
                          <td className="px-4 py-3" />
                        </tr>
                      ))
                    : sortedCampaigns.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCampaign(c)}
                          style={{
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            cursor: "pointer",
                            transition: "background 0.15s",
                            background: selectedCampaign?.id === c.id ? "rgba(37,99,235,0.08)" : "transparent",
                          }}
                          onMouseEnter={(e) => { if (selectedCampaign?.id !== c.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                          onMouseLeave={(e) => { if (selectedCampaign?.id !== c.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <td className="px-4 py-3 font-medium" style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "rgba(255,255,255,0.9)" }}>
                            {c.name}
                          </td>
                          <td className="px-4 py-3"><PlatformBadge platform={c.platform as string} /></td>
                          <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                          <td className="px-4 py-3 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{c.objective}</td>
                          <td className="px-4 py-3 font-medium">{fmt(c.spend, currency)}</td>
                          <td className="px-4 py-3 font-medium">{fmt(c.revenue, currency)}</td>
                          <td className="px-4 py-3">
                            <span className="font-bold" style={{ color: roasColor(c.roas) }}>{c.roas.toFixed(2)}x</span>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{c.ctr.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{fmt(c.cpa, currency)}</td>
                          <td className="px-4 py-3 text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{fmtNum(c.conversions)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(c.budgetUsed, 100)}%`,
                                    background: c.budgetUsed >= 90 ? "#EF4444" : c.budgetUsed >= 70 ? "#F59E0B" : "#10B981",
                                    transition: "width 0.5s ease",
                                  }}
                                />
                              </div>
                              <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{c.budgetUsed}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.3)", transition: "transform 0.2s" }} />
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Bottom: Recommendations ── */}
        <section>
          <h2 className="text-base font-semibold mb-4" style={{ color: "rgba(255,255,255,0.85)" }}>
            Strategic Recommendations
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* DO THIS */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(16,185,129,0.2)" }}>
              <div className="px-5 py-3 flex items-center gap-2" style={{ background: "rgba(16,185,129,0.1)" }}>
                <CheckCircle size={15} style={{ color: "#10B981" }} />
                <span className="text-sm font-bold" style={{ color: "#10B981" }}>DO THIS</span>
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                {(recommendations?.doThis || Array.from({ length: 3 })).map((item: any, i) => (
                  <div
                    key={i}
                    className="px-5 py-3 cursor-pointer transition-colors"
                    style={{ background: expandedRec === `do-${i}` ? "rgba(16,185,129,0.05)" : "rgba(255,255,255,0.02)" }}
                    onClick={() => setExpandedRec(expandedRec === `do-${i}` ? null : `do-${i}`)}
                    onMouseEnter={(e) => { if (expandedRec !== `do-${i}`) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={(e) => { if (expandedRec !== `do-${i}`) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}
                  >
                    {item ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>{item.title}</span>
                          {expandedRec === `do-${i}` ? <ChevronUp size={14} style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown size={14} style={{ color: "rgba(255,255,255,0.3)" }} />}
                        </div>
                        {expandedRec === `do-${i}` && (
                          <p className="mt-2 text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{item.detail}</p>
                        )}
                      </>
                    ) : <Skeleton h="14px" />}
                  </div>
                ))}
              </div>
            </div>

            {/* AVOID THIS */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(239,68,68,0.2)" }}>
              <div className="px-5 py-3 flex items-center gap-2" style={{ background: "rgba(239,68,68,0.1)" }}>
                <XCircle size={15} style={{ color: "#EF4444" }} />
                <span className="text-sm font-bold" style={{ color: "#EF4444" }}>AVOID THIS</span>
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                {(recommendations?.avoidThis || Array.from({ length: 3 })).map((item: any, i) => (
                  <div
                    key={i}
                    className="px-5 py-3 cursor-pointer transition-colors"
                    style={{ background: expandedRec === `avoid-${i}` ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.02)" }}
                    onClick={() => setExpandedRec(expandedRec === `avoid-${i}` ? null : `avoid-${i}`)}
                    onMouseEnter={(e) => { if (expandedRec !== `avoid-${i}`) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={(e) => { if (expandedRec !== `avoid-${i}`) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}
                  >
                    {item ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>{item.title}</span>
                          {expandedRec === `avoid-${i}` ? <ChevronUp size={14} style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown size={14} style={{ color: "rgba(255,255,255,0.3)" }} />}
                        </div>
                        {expandedRec === `avoid-${i}` && (
                          <p className="mt-2 text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{item.detail}</p>
                        )}
                      </>
                    ) : <Skeleton h="14px" />}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Insights grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ...(recommendations?.creativeInsights || []).map((x: any) => ({ ...x, type: "Creative" })),
              ...(recommendations?.audienceInsights || []).map((x: any) => ({ ...x, type: "Audience" })),
            ].map((ins: any, i) => (
              <div
                key={i}
                className="rounded-xl p-4 cursor-pointer"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  transition: "all 0.2s",
                }}
                onClick={() => setExpandedRec(expandedRec === `ins-${i}` ? null : `ins-${i}`)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
              >
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded mb-2 inline-block"
                  style={{
                    background: ins.type === "Creative" ? "rgba(124,58,237,0.15)" : "rgba(37,99,235,0.15)",
                    color: ins.type === "Creative" ? "#A78BFA" : "#60A5FA",
                  }}
                >
                  {ins.type}
                </span>
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>{ins.title}</p>
                {expandedRec === `ins-${i}` && (
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{ins.detail}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── LAYER 3 & 4: Slide-in Drawer ── */}
      {/* Backdrop */}
      <div
        onClick={() => { setSelectedCampaign(null); setSelectedAdSet(null); setSelectedAd(null); }}
        style={{
          position: "fixed", inset: 0, zIndex: 30,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(560px, 100vw)",
          zIndex: 40,
          background: "#060E1C",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {selectedCampaign && (
          <>
            {/* Drawer header */}
            <div
              className="flex items-center gap-3 px-5 py-4 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
            >
              {selectedAdSet ? (
                <button
                  onClick={() => { setSelectedAdSet(null); setSelectedAd(null); }}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <ArrowLeft size={16} style={{ color: "rgba(255,255,255,0.6)" }} />
                </button>
              ) : null}
              <div className="flex-1 min-w-0">
                {selectedAdSet ? (
                  <div>
                    <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {selectedCampaign.name}
                    </div>
                    <div className="text-sm font-semibold truncate">{selectedAdSet.name}</div>
                  </div>
                ) : (
                  <div className="text-sm font-semibold truncate">{selectedCampaign.name}</div>
                )}
              </div>
              <PlatformBadge platform={selectedCampaign.platform as string} />
              <button
                onClick={() => { setSelectedCampaign(null); setSelectedAdSet(null); setSelectedAd(null); }}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={16} style={{ color: "rgba(255,255,255,0.5)" }} />
              </button>
            </div>

            {/* Drawer content */}
            <div className="flex-1 overflow-y-auto">
              {!selectedAdSet ? (
                // ── LAYER 3: Ad sets ──
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Ad Sets</h3>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Click to view ads</span>
                  </div>
                  {loadingAdSets ? (
                    <div className="space-y-3">
                      {[...Array(4)].map((_, i) => <Skeleton key={i} h="80px" />)}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {adSets.map((as) => (
                        <div
                          key={as.id}
                          onClick={() => setSelectedAdSet(as)}
                          className="rounded-xl p-4 cursor-pointer"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            transition: "all 0.2s",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                          }}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>{as.name}</div>
                              <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>{as.audience}</div>
                            </div>
                            <span className="font-bold text-sm" style={{ color: roasColor(as.roas) }}>{as.roas.toFixed(2)}x</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: "Spend", value: fmt(as.spend, currency) },
                              { label: "CTR", value: `${as.ctr.toFixed(1)}%` },
                              { label: "Reach", value: fmtNum(as.reach) },
                              { label: "Conv.", value: fmtNum(as.conversions) },
                            ].map(({ label, value }) => (
                              <div key={label}>
                                <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</div>
                                <div className="text-sm font-medium">{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                // ── LAYER 4: Ads grid ──
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Ads</h3>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Click to preview</span>
                  </div>
                  {loadingAds ? (
                    <div className="grid grid-cols-2 gap-3">
                      {[...Array(4)].map((_, i) => <Skeleton key={i} h="200px" />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {ads.map((ad) => (
                        <div
                          key={ad.id}
                          onClick={() => setSelectedAd(ad)}
                          className="rounded-xl p-4 cursor-pointer"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: `1px solid ${roasBorder(ad.roas)}`,
                            transition: "all 0.2s",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                            (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 24px rgba(0,0,0,0.3)`;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                            (e.currentTarget as HTMLElement).style.boxShadow = "none";
                          }}
                        >
                          {/* Format badge + creative preview */}
                          <div
                            className="w-full aspect-video rounded-lg mb-3 flex items-center justify-center"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.08)" }}
                          >
                            <div className="flex flex-col items-center gap-1.5">
                              <span style={{ color: "rgba(255,255,255,0.2)" }}>
                                <FormatIcon format={ad.format} />
                              </span>
                              <span
                                className="text-xs px-2 py-0.5 rounded"
                                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}
                              >
                                {ad.format}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs font-semibold mb-1 leading-snug" style={{ color: "rgba(255,255,255,0.85)" }}>
                            {ad.headline}
                          </p>
                          <p className="text-xs mb-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
                            {ad.body.length > 60 ? ad.body.slice(0, 60) + "…" : ad.body}
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { label: "ROAS", value: `${ad.roas.toFixed(2)}x`, color: roasColor(ad.roas) },
                              { label: "CTR", value: `${ad.ctr.toFixed(1)}%`, color: "rgba(255,255,255,0.7)" },
                              { label: "Spend", value: fmt(ad.spend, currency), color: "rgba(255,255,255,0.7)" },
                              { label: "Conv.", value: fmtNum(ad.conversions), color: "rgba(255,255,255,0.7)" },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
                                <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
                                <div className="text-xs font-bold" style={{ color }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── LAYER 5: Creative Detail Modal ── */}
      {selectedAd && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "fadeIn 0.2s ease",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedAd(null); }}
        >
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          `}</style>
          <div
            className="w-full max-w-4xl rounded-2xl overflow-hidden"
            style={{
              background: "#0A1628",
              border: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              animation: "slideUp 0.25s ease",
            }}
          >
            {/* Modal header */}
            <div
              className="flex items-center justify-between px-6 py-4 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div>
                <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {selectedCampaign?.name} › {selectedAdSet?.name}
                </div>
                <div className="font-semibold">{selectedAd.headline}</div>
              </div>
              <button
                onClick={() => setSelectedAd(null)}
                className="p-2 rounded-xl hover:bg-white/10 transition-colors"
              >
                <X size={18} style={{ color: "rgba(255,255,255,0.6)" }} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                {/* Left: Creative preview */}
                <div
                  className="p-6 flex flex-col gap-4"
                  style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="w-full aspect-video rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.03)", border: `2px solid ${roasBorder(selectedAd.roas)}` }}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <span style={{ color: "rgba(255,255,255,0.15)", transform: "scale(3)", display: "inline-block" }}>
                        <FormatIcon format={selectedAd.format} />
                      </span>
                      <span
                        className="text-sm px-3 py-1 rounded-full font-medium"
                        style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}
                      >
                        {selectedAd.format} Creative
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="font-semibold text-sm mb-1">{selectedAd.headline}</div>
                    <div className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{selectedAd.body}</div>
                  </div>

                  {/* Designer Directions */}
                  <div className="rounded-xl p-4" style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.2)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Zap size={14} style={{ color: "#A78BFA" }} />
                      <span className="text-xs font-bold" style={{ color: "#A78BFA" }}>Designer Directions</span>
                    </div>
                    <ul className="space-y-1.5">
                      {[
                        "Lead with product in first 3 seconds",
                        "Add captions — 85% watch without sound",
                        "Include price anchor / discount callout",
                        "Test darker background for higher contrast",
                      ].map((d, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>
                          <span style={{ color: "#A78BFA" }}>›</span> {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Right: Metrics */}
                <div className="p-6 space-y-4">
                  {/* Performance score */}
                  <div
                    className="rounded-xl p-4 flex items-center gap-4"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: `conic-gradient(${roasColor(selectedAd.roas)} ${Math.min(selectedAd.roas / 5 * 100, 100)}%, rgba(255,255,255,0.05) 0)`,
                      }}
                    >
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center"
                        style={{ background: "#0A1628" }}
                      >
                        <span className="text-lg font-bold" style={{ color: roasColor(selectedAd.roas) }}>
                          {Math.round(Math.min(selectedAd.roas / 5 * 100, 100))}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Performance Score</div>
                      <div className="font-bold text-lg" style={{ color: roasColor(selectedAd.roas) }}>
                        {selectedAd.roas >= 3 ? "Strong" : selectedAd.roas >= 1 ? "Moderate" : "Underperforming"}
                      </div>
                      <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                        ROAS {selectedAd.roas.toFixed(2)}x · {fmtNum(selectedAd.impressions)} impressions
                      </div>
                    </div>
                  </div>

                  {/* Full metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Spend", value: fmt(selectedAd.spend, currency) },
                      { label: "Revenue", value: fmt(selectedAd.revenue, currency) },
                      { label: "ROAS", value: `${selectedAd.roas.toFixed(2)}x`, color: roasColor(selectedAd.roas) },
                      { label: "CTR", value: `${selectedAd.ctr.toFixed(1)}%` },
                      { label: "Conversions", value: fmtNum(selectedAd.conversions) },
                      { label: "Impressions", value: fmtNum(selectedAd.impressions) },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</div>
                        <div className="text-xl font-bold" style={{ color: color || "#fff" }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* ROAS trend sparkline */}
                  <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>ROAS Trend (6 periods)</div>
                    <ResponsiveContainer width="100%" height={60}>
                      <LineChart data={selectedAd.trend.map((v, i) => ({ i: i + 1, roas: v }))}>
                        <Line type="monotone" dataKey="roas" stroke={roasColor(selectedAd.roas)} strokeWidth={2} dot={{ r: 3, fill: roasColor(selectedAd.roas) }} />
                        <YAxis hide domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ background: "#0F1B2D", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", fontSize: 11 }}
                          formatter={(v: any) => [`${(v as number).toFixed(2)}x`, "ROAS"]}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Spend Recommendations */}
                  {(() => {
                    const spendRecs = selectedAd.roas >= 3
                      ? [
                          "Increase daily budget by 20% — ROAS above threshold",
                          "Duplicate to new audience segments to expand reach",
                          "Use as creative template for upcoming campaigns",
                        ]
                      : selectedAd.roas >= 1
                      ? [
                          "Hold budget steady — monitor for 7 more days",
                          "A/B test headline copy to improve CTR",
                          "Refresh creative before next period",
                        ]
                      : [
                          "Pause immediately — negative ROI",
                          "Analyse audience mismatch before relaunching",
                          "Do not scale until creative is reworked",
                        ];
                    return (
                      <div className="rounded-xl p-4" style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.2)" }}>
                        <div className="flex items-center gap-2 mb-3">
                          <ExternalLink size={13} style={{ color: "#60A5FA" }} />
                          <span className="text-xs font-bold" style={{ color: "#60A5FA" }}>Spend Recommendations</span>
                        </div>
                        <ul className="space-y-1.5">
                          {spendRecs.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>
                              <span style={{ color: "#60A5FA" }}>›</span> {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
