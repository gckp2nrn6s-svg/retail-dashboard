"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, ChevronRight, X, ArrowLeft, Zap,
  Eye, MousePointer, DollarSign, Target, Users, BarChart2,
  Image as ImageIcon, Video, Layers, Sparkles, AlertCircle,
  RefreshCw, ExternalLink, Activity, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts";
import { useDateRange } from "@/contexts/DateRangeContext";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useCurrency } from "@/components/CurrencyToggle";
import CreativeStudio from "@/components/marketing/CreativeStudio";
import AttributionStudio from "@/components/marketing/AttributionStudio";

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "All" | "Meta" | "Google" | "TikTok";

interface KpiCard {
  key: string;
  label: string;
  value: string;
  raw: number;
  trend: number;
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
  budgetUsed: number;
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

const PLATFORMS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  Meta:   { color: "#1877F2", bg: "rgba(24,119,242,0.15)",  label: "f" },
  Google: { color: "#4285F4", bg: "rgba(66,133,244,0.15)",  label: "G" },
  TikTok: { color: "#FF0050", bg: "rgba(255,0,80,0.15)",    label: "T" },
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
  if (roas >= 3.5) return "#10B981";
  if (roas >= 2) return "#F59E0B";
  return "#EF4444";
}

function roasBorder(roas: number) {
  if (roas >= 3.5) return "rgba(16,185,129,0.35)";
  if (roas >= 2) return "rgba(245,158,11,0.35)";
  return "rgba(239,68,68,0.35)";
}

function roasLabel(roas: number) {
  if (roas >= 3.5) return "Strong";
  if (roas >= 2) return "OK";
  return "Weak";
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const BG       = "#080810";
const SURFACE  = "rgba(255,255,255,0.03)";
const BORDER   = "1px solid rgba(255,255,255,0.07)";
const TEXT      = "#F9FAFB";
const MUTED     = "rgba(255,255,255,0.45)";
const ACCENT    = "#6366F1";

// ─── Sub-components ───────────────────────────────────────────────────────────

function Skeleton({ h = "16px", w = "100%", rounded = "8px" }: { h?: string; w?: string; rounded?: string }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: rounded, background: "rgba(255,255,255,0.06)" }}
    />
  );
}

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const normalized = (status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()) as Campaign["status"];
  const cfg = ({
    Active: { bg: "rgba(16,185,129,0.12)", color: "#10B981", dot: "#10B981" },
    Paused: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B", dot: "#F59E0B" },
    Ended:  { bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", dot: "rgba(255,255,255,0.25)" },
  } as Record<string, { bg: string; color: string; dot: string }>)[normalized]
    ?? { bg: "rgba(255,255,255,0.06)", color: MUTED, dot: "rgba(255,255,255,0.25)" };
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: cfg.bg, color: cfg.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {normalized}
    </span>
  );
}

function PlatformDot({ platform }: { platform: string }) {
  const cfg = PLATFORMS_CONFIG[platform] || { color: "#888", bg: "rgba(255,255,255,0.06)" };
  return <span className="w-2 h-2 rounded-full shrink-0 inline-block" style={{ background: cfg.color }} />;
}

function FormatBadge({ format }: { format: Ad["format"] }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
    Video:    { icon: <Video size={10} />,    color: "#818CF8", bg: "rgba(99,102,241,0.15)" },
    Image:    { icon: <ImageIcon size={10} />, color: "#60A5FA", bg: "rgba(59,130,246,0.15)" },
    Carousel: { icon: <Layers size={10} />,   color: "#A78BFA", bg: "rgba(139,92,246,0.15)" },
  };
  const c = cfg[format] || cfg.Image;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: c.bg, color: c.color }}>
      {c.icon} {format}
    </span>
  );
}

function TrendPill({ value }: { value: number }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums" style={{ color: up ? "#10B981" : "#EF4444" }}>
      <Icon size={11} strokeWidth={2.5} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function RoasBadge({ roas }: { roas: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold tabular-nums"
      style={{ background: `${roasColor(roas)}18`, color: roasColor(roas) }}
    >
      {roas.toFixed(1)}×
    </span>
  );
}

const SORT_KEYS = ["name", "spend", "revenue", "roas", "ctr", "cpa", "conversions", "budgetUsed"] as const;
type SortKey = (typeof SORT_KEYS)[number];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MarketingPage() {
  const { range } = useDateRange();
  const { currency } = useCurrency();

  const [activeTab, setActiveTab] = useState<"performance" | "attribution" | "creative">("performance");
  const [platform, setPlatform] = useState<Platform>("All");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [selectedAdSet, setSelectedAdSet] = useState<AdSet | null>(null);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const [creativeOpen, setCreativeOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);

  const [briefTime, setBriefTime] = useState<string>("");
  useEffect(() => {
    setBriefTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }, []);

  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingAdSets, setLoadingAdSets] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);

  const [overview, setOverview] = useState<ReturnType<typeof mockOverview> | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation | null>(null);

  useEffect(() => {
    setLoadingOverview(true);
    setOverview(mockOverview(range.from, range.to, platform));
    setLoadingOverview(false);
  }, [range.from, range.to, platform]);

  useEffect(() => {
    setLoadingCampaigns(true);
    const params = new URLSearchParams({ from: range.from, to: range.to, ...(platform !== "All" ? { platform } : {}) });
    fetch(`/api/marketing/campaigns?${params}`)
      .then(r => r.json())
      .then(d => {
        const raw: any[] = Array.isArray(d) ? d : d.campaigns ?? [];
        const normalised: Campaign[] = raw.map(c => ({
          ...c,
          budgetUsed: c.budgetUsed ?? c.budgetUsedPct ?? 0,
          status: c.status
            ? ((c.status.charAt(0).toUpperCase() + c.status.slice(1).toLowerCase()) as Campaign["status"])
            : "Ended",
        }));
        setCampaigns(normalised);
        setLoadingCampaigns(false);
      })
      .catch(() => setLoadingCampaigns(false));
  }, [range.from, range.to, platform]);

  useEffect(() => {
    fetch(`/api/marketing/recommendations?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d && Array.isArray(d.alerts) && Array.isArray(d.doThis)) {
          setRecommendations(d);
        } else {
          setRecommendations(mockRecommendations());
        }
      })
      .catch(() => setRecommendations(mockRecommendations()));
  }, [range.from, range.to]);

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

  const closeAll = () => { setSelectedCampaign(null); setSelectedAdSet(null); setSelectedAd(null); };

  // Derived platform spend shares
  const platformShares = useMemo(() => {
    if (!campaigns.length) return [];
    const totals: Record<string, number> = {};
    campaigns.forEach(c => { totals[c.platform as string] = (totals[c.platform as string] || 0) + c.spend; });
    const total = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(totals).map(([name, spend]) => ({ name, spend, pct: (spend / total) * 100 }));
  }, [campaigns]);

  const panelOpen = !!selectedCampaign;

  // ─── Main render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ background: BG, color: TEXT, minHeight: "100vh", fontFamily: "inherit" }}>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0);     }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0);    }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .mktg-row-hover:hover td { background: rgba(255,255,255,0.025) !important; }
        .mktg-row-active td      { background: rgba(99,102,241,0.07)  !important; }
        .metric-card:hover { border-color: rgba(255,255,255,0.12) !important; background: rgba(255,255,255,0.045) !important; }
        .panel-adset:hover { border-color: rgba(255,255,255,0.13) !important; background: rgba(255,255,255,0.05) !important; }
        .ad-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
        .rec-item:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* ═══════════════════════════════ TOP BAR ═══════════════════════════════ */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(8,8,16,0.92)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center gap-3 px-6" style={{ height: 56 }}>
          {/* Platform pills */}
          <div className="flex items-center gap-1.5">
            {(["All", "Meta", "Google", "TikTok"] as Platform[]).map((p) => {
              const cfg = p !== "All" ? PLATFORMS_CONFIG[p] : null;
              const active = platform === p;
              return (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  style={{
                    padding: "4px 14px",
                    borderRadius: 999,
                    border: `1px solid ${active ? (cfg ? cfg.color : ACCENT) : "rgba(255,255,255,0.09)"}`,
                    background: active ? (cfg ? cfg.bg : `${ACCENT}22`) : "transparent",
                    color: active ? (cfg ? cfg.color : "#A5B4FC") : MUTED,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    letterSpacing: "0.01em",
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* ROAS live badge */}
          {overview && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 999,
                background: `${roasColor(overview.roas)}15`,
                border: `1px solid ${roasColor(overview.roas)}30`,
              }}
            >
              <Activity size={12} style={{ color: roasColor(overview.roas) }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: roasColor(overview.roas), fontVariantNumeric: "tabular-nums" }}>
                {overview.roas.toFixed(1)}× ROAS
              </span>
            </div>
          )}

          {/* Date range */}
          <DateRangePicker />
        </div>
      </header>

      {/* ══════════════════════════════ TAB BAR ════════════════════════════════ */}
      <div style={{ display: "flex", gap: 2, padding: "0 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(8,8,16,0.6)" }}>
        {([["performance", "Performance"], ["attribution", "Attribution Truth ✦"], ["creative", "Creative Studio ✦"]] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: activeTab === tab ? "#A5B4FC" : "rgba(255,255,255,0.35)",
              borderBottom: activeTab === tab ? "2px solid #6366F1" : "2px solid transparent",
              marginBottom: -1,
              transition: "all 0.15s ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════ BODY ══════════════════════════════════ */}
      {activeTab === "attribution" ? (
        <div style={{ overflowY: "auto", height: "calc(100vh - 100px)" }}>
          <AttributionStudio dateRange={{ from: range.from, to: range.to }} platform={platform} />
        </div>
      ) : null}
      {activeTab === "creative" ? (
        <div style={{ overflowY: "auto", height: "calc(100vh - 100px)" }}>
          <CreativeStudio dateRange={{ from: range.from, to: range.to }} platform={platform} />
        </div>
      ) : null}
      <div style={{ display: activeTab === "performance" ? "flex" : "none", height: "calc(100vh - 100px)", overflow: "hidden" }}>

        {/* ────────────── LEFT MAIN (70%) ────────────── */}
        <main
          style={{
            flex: "1 1 0",
            overflowY: "auto",
            padding: "24px",
            paddingRight: "20px",
          }}
        >
          {/* ─── HERO METRICS ─────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
            {loadingOverview
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ background: SURFACE, border: BORDER, borderRadius: 14, padding: "20px 20px 16px" }}>
                    <Skeleton h="10px" w="50%" rounded="4px" />
                    <div style={{ marginTop: 14 }}><Skeleton h="34px" w="70%" rounded="6px" /></div>
                    <div style={{ marginTop: 10 }}><Skeleton h="10px" w="40%" rounded="4px" /></div>
                    <div style={{ marginTop: 14 }}><Skeleton h="36px" rounded="6px" /></div>
                  </div>
                ))
              : overview && [
                  { key: "totalSpend",    label: "TOTAL SPEND",   value: fmt(overview.totalSpend, currency),       trend: overview.trends.totalSpend,   accent: "#6366F1" },
                  { key: "totalRevenue",  label: "REVENUE",        value: fmt(overview.totalRevenue, currency),     trend: overview.trends.totalRevenue,  accent: "#10B981" },
                  { key: "roas",          label: "ROAS",           value: `${overview.roas.toFixed(1)}×`,           trend: overview.trends.roas,          accent: roasColor(overview.roas) },
                  { key: "conversions",   label: "CONVERSIONS",    value: fmtNum(overview.conversions),             trend: overview.trends.conversions,   accent: "#F59E0B" },
                ].map((card) => (
                  <div
                    key={card.key}
                    className="metric-card"
                    style={{
                      background: SURFACE,
                      border: BORDER,
                      borderRadius: 14,
                      padding: "20px 20px 16px",
                      transition: "all 0.15s ease",
                      cursor: "default",
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase", marginBottom: 12 }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.02em", color: TEXT, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                      {card.value}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <TrendPill value={card.trend} />
                    </div>
                    {/* Sparkline */}
                    {overview.sparklines.length > 0 && (
                      <div style={{ marginTop: 14, height: 36 }}>
                        <ResponsiveContainer width="100%" height={36}>
                          <AreaChart data={overview.sparklines} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id={`sg-${card.key}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%"   stopColor={card.accent} stopOpacity={0.25} />
                                <stop offset="100%" stopColor={card.accent} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Area
                              type="monotone"
                              dataKey={card.key === "totalSpend" ? "spend" : card.key === "totalRevenue" ? "revenue" : card.key === "roas" ? "roas" : "revenue"}
                              stroke={card.accent}
                              strokeWidth={1.5}
                              fill={`url(#sg-${card.key})`}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                ))}
          </div>

          {/* ─── SECONDARY METRICS ────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
            {loadingOverview
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ background: SURFACE, border: BORDER, borderRadius: 10, padding: "12px 16px" }}>
                    <Skeleton h="9px" w="45%" rounded="3px" />
                    <div style={{ marginTop: 8 }}><Skeleton h="20px" w="65%" rounded="4px" /></div>
                  </div>
                ))
              : overview && [
                  { label: "IMPRESSIONS", value: fmtNum(overview.impressions), trend: overview.trends.impressions },
                  { label: "CLICKS",      value: fmtNum(overview.clicks),      trend: overview.trends.clicks },
                  { label: "CTR",         value: `${overview.ctr.toFixed(1)}%`, trend: overview.trends.ctr },
                  { label: "CPA",         value: fmt(overview.cpa, currency),   trend: overview.trends.cpa },
                ].map((card) => (
                  <div
                    key={card.label}
                    style={{
                      background: SURFACE,
                      border: BORDER,
                      borderRadius: 10,
                      padding: "12px 16px",
                    }}
                  >
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
                      {card.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", color: TEXT }}>
                        {card.value}
                      </span>
                      <TrendPill value={card.trend} />
                    </div>
                  </div>
                ))}
          </div>

          {/* ─── PLATFORM SPEND SHARE ─────────────────── */}
          {platformShares.length > 0 && (
            <div
              style={{
                background: SURFACE,
                border: BORDER,
                borderRadius: 12,
                padding: "16px 20px",
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase", marginBottom: 14 }}>
                Platform Spend Share
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {platformShares.map(({ name, spend, pct }) => {
                  const cfg = PLATFORMS_CONFIG[name] || { color: "#888", bg: "rgba(255,255,255,0.06)" };
                  return (
                    <div
                      key={name}
                      style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                      onClick={() => setPlatform(name as Platform)}
                    >
                      <div style={{ width: 52, fontSize: 12, fontWeight: 700, color: cfg.color }}>{name}</div>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            borderRadius: 3,
                            background: cfg.color,
                            transition: "width 0.6s ease",
                          }}
                        />
                      </div>
                      <div style={{ width: 80, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums", color: MUTED }}>
                        {fmt(spend, currency)} <span style={{ color: "rgba(255,255,255,0.25)" }}>· {pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── SPEND vs REVENUE CHART ───────────────── */}
          {overview && (
            <div
              style={{
                background: SURFACE,
                border: BORDER,
                borderRadius: 12,
                padding: "18px 20px",
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Spend vs Revenue — 14 Day Trend</div>
                <div style={{ display: "flex", gap: 16 }}>
                  {[{ c: "#6366F1", l: "Spend" }, { c: "#10B981", l: "Revenue" }].map(({ c, l }) => (
                    <span key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: MUTED }}>
                      <span style={{ width: 14, height: 2, borderRadius: 1, background: c, display: "inline-block" }} />
                      {l}
                    </span>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={overview.sparklines} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#6366F1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#10B981" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} width={36} />
                  <Tooltip
                    contentStyle={{ background: "#10101c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", fontSize: 12 }}
                    formatter={(v: any, name: any) => [fmt(v as number, currency), name === "spend" ? "Spend" : "Revenue"]}
                  />
                  <Area type="monotone" dataKey="spend"   stroke="#6366F1" strokeWidth={2} fill="url(#gSpend)"   dot={false} />
                  <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#gRevenue)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ─── CAMPAIGNS TABLE ──────────────────────── */}
          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Campaigns</span>
                {!loadingCampaigns && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: MUTED }}>
                    {campaigns.length}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Click row to drill down</span>
            </div>

            <div style={{ borderRadius: 12, overflow: "hidden", border: BORDER }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {([
                        { key: "name",        label: "Campaign",  w: 200 },
                        { key: null,          label: "Status",    w: 90  },
                        { key: "spend",       label: "Spend",     w: 90  },
                        { key: "revenue",     label: "Revenue",   w: 90  },
                        { key: "roas",        label: "ROAS",      w: 110 },
                        { key: "ctr",         label: "CTR",       w: 70  },
                        { key: "cpa",         label: "CPA",       w: 80  },
                        { key: "conversions", label: "Conv.",      w: 70  },
                        { key: "budgetUsed",  label: "Budget",    w: 100 },
                      ] as { key: SortKey | null; label: string; w: number }[]).map(({ key, label, w }) => (
                        <th
                          key={label}
                          style={{
                            padding: "10px 14px",
                            textAlign: "left",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: key && sortKey === key ? "#A5B4FC" : "rgba(255,255,255,0.3)",
                            cursor: key ? "pointer" : "default",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                            width: w,
                          }}
                          onClick={() => key && handleSort(key)}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            {label}
                            {key && sortKey === key && (
                              sortDir === "desc"
                                ? <ChevronDown size={11} style={{ color: "#A5B4FC" }} />
                                : <ChevronUp   size={11} style={{ color: "#A5B4FC" }} />
                            )}
                          </span>
                        </th>
                      ))}
                      <th style={{ width: 28 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {loadingCampaigns
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            {Array.from({ length: 9 }).map((__, j) => (
                              <td key={j} style={{ padding: "12px 14px" }}><Skeleton h="12px" rounded="4px" /></td>
                            ))}
                            <td style={{ padding: "12px 14px" }} />
                          </tr>
                        ))
                      : sortedCampaigns.map((c) => {
                          const active = selectedCampaign?.id === c.id;
                          return (
                            <tr
                              key={c.id}
                              className={`mktg-row-hover${active ? " mktg-row-active" : ""}`}
                              onClick={() => setSelectedCampaign(c)}
                              style={{
                                borderBottom: "1px solid rgba(255,255,255,0.04)",
                                cursor: "pointer",
                                transition: "background 0.12s ease",
                              }}
                            >
                              {/* Campaign name */}
                              <td style={{ padding: "12px 14px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 200 }}>
                                  <PlatformDot platform={c.platform as string} />
                                  <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.88)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 13 }}>
                                    {c.name}
                                  </span>
                                </div>
                                <div style={{ fontSize: 10, color: MUTED, marginTop: 2, paddingLeft: 16 }}>
                                  {c.platform as string} · {c.objective}
                                </div>
                              </td>

                              {/* Status */}
                              <td style={{ padding: "12px 14px" }}><StatusBadge status={c.status} /></td>

                              {/* Spend */}
                              <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 13 }}>
                                {fmt(c.spend, currency)}
                              </td>

                              {/* Revenue */}
                              <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 13 }}>
                                {fmt(c.revenue, currency)}
                              </td>

                              {/* ROAS with mini bar */}
                              <td style={{ padding: "12px 14px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums", color: roasColor(c.roas) }}>
                                    {c.roas.toFixed(1)}×
                                  </span>
                                  <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden", maxWidth: 40 }}>
                                    <div style={{ height: "100%", width: `${Math.min((c.roas / 6) * 100, 100)}%`, borderRadius: 2, background: roasColor(c.roas) }} />
                                  </div>
                                </div>
                              </td>

                              {/* CTR */}
                              <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                                {c.ctr.toFixed(1)}%
                              </td>

                              {/* CPA */}
                              <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                                {fmt(c.cpa, currency)}
                              </td>

                              {/* Conversions */}
                              <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                                {fmtNum(c.conversions)}
                              </td>

                              {/* Budget used */}
                              <td style={{ padding: "12px 14px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 52, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                                    <div
                                      style={{
                                        height: "100%",
                                        width: `${Math.min(c.budgetUsed, 100)}%`,
                                        borderRadius: 2,
                                        background: c.budgetUsed >= 90 ? "#EF4444" : c.budgetUsed >= 70 ? "#F59E0B" : "#10B981",
                                        transition: "width 0.5s ease",
                                      }}
                                    />
                                  </div>
                                  <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: MUTED }}>{c.budgetUsed}%</span>
                                </div>
                              </td>

                              {/* Arrow */}
                              <td style={{ padding: "12px 10px" }}>
                                <ChevronRight size={13} style={{ color: active ? ACCENT : "rgba(255,255,255,0.2)", transition: "color 0.15s" }} />
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>

        {/* ────────────── RIGHT AI PANEL (30%) ────────── */}
        <aside
          style={{
            width: panelOpen ? 0 : 360,
            minWidth: panelOpen ? 0 : 360,
            borderLeft: "1px solid rgba(255,255,255,0.07)",
            overflowY: "auto",
            overflowX: "hidden",
            background: "rgba(255,255,255,0.015)",
            transition: "width 0.3s ease, min-width 0.3s ease",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {!panelOpen && (
            <div style={{ padding: "20px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* ── DAILY BRIEF ── */}
              <div
                style={{
                  background: "rgba(99,102,241,0.07)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: 12,
                  padding: "14px 16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <Sparkles size={14} style={{ color: ACCENT }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: "0.04em", textTransform: "uppercase" }}>Daily Brief</span>
                  {briefTime && (
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginLeft: "auto" }}>{briefTime}</span>
                  )}
                </div>
                {recommendations
                  ? <p style={{ fontSize: 12, lineHeight: 1.65, color: "rgba(255,255,255,0.68)" }}>{recommendations.brief}</p>
                  : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[100, 90, 80].map((w, i) => <Skeleton key={i} h="11px" w={`${w}%`} rounded="3px" />)}
                    </div>
                }
              </div>

              {/* ── ALERTS ── */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, marginBottom: 8 }}>Alerts</div>
                {recommendations
                  ? <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {recommendations.alerts.map((a, i) => {
                        const cfg = ({
                          danger:  { bg: "rgba(239,68,68,0.1)",   color: "#EF4444", icon: <XCircle       size={12} /> },
                          warning: { bg: "rgba(245,158,11,0.1)",  color: "#F59E0B", icon: <AlertTriangle size={12} /> },
                          good:    { bg: "rgba(16,185,129,0.1)",  color: "#10B981", icon: <CheckCircle   size={12} /> },
                        } as Record<string, { bg: string; color: string; icon: React.ReactNode }>)[a.type]
                          ?? { bg: "rgba(255,255,255,0.04)", color: MUTED, icon: <AlertCircle size={12} /> };
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, background: cfg.bg }}>
                            <span style={{ color: cfg.color, marginTop: 1, flexShrink: 0 }}>{cfg.icon}</span>
                            <span style={{ fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.75)" }}>{a.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[...Array(3)].map((_, i) => <Skeleton key={i} h="38px" rounded="8px" />)}
                    </div>
                }
              </div>

              {/* ── DO THIS ── */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <CheckCircle size={13} style={{ color: "#10B981" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#10B981" }}>Do This</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {(recommendations?.doThis || Array.from({ length: 3 })).map((item: any, i) => (
                    <div
                      key={i}
                      className="rec-item"
                      onClick={() => setExpandedRec(expandedRec === `do-${i}` ? null : `do-${i}`)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid rgba(16,185,129,0.12)",
                        background: expandedRec === `do-${i}` ? "rgba(16,185,129,0.06)" : "rgba(16,185,129,0.03)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {item ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{item.title}</span>
                            {expandedRec === `do-${i}` ? <ChevronUp size={12} style={{ color: MUTED }} /> : <ChevronDown size={12} style={{ color: MUTED }} />}
                          </div>
                          {expandedRec === `do-${i}` && (
                            <p style={{ marginTop: 7, fontSize: 11, lineHeight: 1.6, color: "rgba(255,255,255,0.5)" }}>{item.detail}</p>
                          )}
                        </>
                      ) : <Skeleton h="12px" rounded="3px" />}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── AVOID THIS ── */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <XCircle size={13} style={{ color: "#EF4444" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#EF4444" }}>Avoid</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {(recommendations?.avoidThis || Array.from({ length: 3 })).map((item: any, i) => (
                    <div
                      key={i}
                      className="rec-item"
                      onClick={() => setExpandedRec(expandedRec === `avoid-${i}` ? null : `avoid-${i}`)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid rgba(239,68,68,0.12)",
                        background: expandedRec === `avoid-${i}` ? "rgba(239,68,68,0.07)" : "rgba(239,68,68,0.03)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {item ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{item.title}</span>
                            {expandedRec === `avoid-${i}` ? <ChevronUp size={12} style={{ color: MUTED }} /> : <ChevronDown size={12} style={{ color: MUTED }} />}
                          </div>
                          {expandedRec === `avoid-${i}` && (
                            <p style={{ marginTop: 7, fontSize: 11, lineHeight: 1.6, color: "rgba(255,255,255,0.5)" }}>{item.detail}</p>
                          )}
                        </>
                      ) : <Skeleton h="12px" rounded="3px" />}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── CREATIVE INSIGHTS (collapsible) ── */}
              {recommendations && (
                <div>
                  <button
                    onClick={() => setCreativeOpen(v => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}
                  >
                    <Layers size={13} style={{ color: "#A78BFA" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A78BFA" }}>Creative Insights</span>
                    <span style={{ marginLeft: "auto" }}>{creativeOpen ? <ChevronUp size={12} style={{ color: MUTED }} /> : <ChevronDown size={12} style={{ color: MUTED }} />}</span>
                  </button>
                  {creativeOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {recommendations.creativeInsights.map((ins, i) => (
                        <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.12)" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>{ins.title}</div>
                          <p style={{ fontSize: 11, lineHeight: 1.55, color: MUTED }}>{ins.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── AUDIENCE INSIGHTS (collapsible) ── */}
              {recommendations && (
                <div>
                  <button
                    onClick={() => setAudienceOpen(v => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}
                  >
                    <Users size={13} style={{ color: "#60A5FA" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#60A5FA" }}>Audience Insights</span>
                    <span style={{ marginLeft: "auto" }}>{audienceOpen ? <ChevronUp size={12} style={{ color: MUTED }} /> : <ChevronDown size={12} style={{ color: MUTED }} />}</span>
                  </button>
                  {audienceOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {recommendations.audienceInsights.map((ins, i) => (
                        <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.12)" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>{ins.title}</div>
                          <p style={{ fontSize: 11, lineHeight: 1.55, color: MUTED }}>{ins.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ════════════ CAMPAIGN DETAIL SLIDE-IN PANEL ════════════ */}
        {/* Backdrop */}
        <div
          onClick={closeAll}
          style={{
            position: "fixed", inset: 0, zIndex: 40,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(6px)",
            opacity: panelOpen ? 1 : 0,
            pointerEvents: panelOpen ? "auto" : "none",
            transition: "opacity 0.25s ease",
          }}
        />

        {/* Panel */}
        <div
          style={{
            position: "fixed",
            top: 56,
            right: 0,
            bottom: 0,
            width: "min(520px, 100vw)",
            zIndex: 50,
            background: "#0C0C18",
            borderLeft: "1px solid rgba(255,255,255,0.09)",
            transform: panelOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.3s cubic-bezier(0.22,1,0.36,1)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {selectedCampaign && (
            <>
              {/* Panel header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 18px",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(255,255,255,0.02)",
                  flexShrink: 0,
                }}
              >
                {selectedAdSet && (
                  <button
                    onClick={() => { setSelectedAdSet(null); setSelectedAd(null); }}
                    style={{ padding: 6, borderRadius: 7, background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
                  >
                    <ArrowLeft size={14} style={{ color: "rgba(255,255,255,0.6)" }} />
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {selectedAdSet ? (
                    <>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{selectedCampaign.name}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedAdSet.name}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedCampaign.name}</div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: (PLATFORMS_CONFIG[selectedCampaign.platform as string] || { bg: "" }).bg, color: (PLATFORMS_CONFIG[selectedCampaign.platform as string] || { color: "#888" }).color }}>
                    {selectedCampaign.platform as string}
                  </span>
                  <StatusBadge status={selectedCampaign.status} />
                </div>
                <button
                  onClick={closeAll}
                  style={{ padding: 6, borderRadius: 7, background: "rgba(255,255,255,0.05)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", marginLeft: 4 }}
                >
                  <X size={14} style={{ color: MUTED }} />
                </button>
              </div>

              {/* Panel KPIs */}
              {!selectedAdSet && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                  {[
                    { label: "Spend",   value: fmt(selectedCampaign.spend, currency) },
                    { label: "Revenue", value: fmt(selectedCampaign.revenue, currency) },
                    { label: "ROAS",    value: `${selectedCampaign.roas.toFixed(1)}×`, color: roasColor(selectedCampaign.roas) },
                    { label: "CTR",     value: `${selectedCampaign.ctr.toFixed(1)}%` },
                    { label: "CPA",     value: fmt(selectedCampaign.cpa, currency) },
                    { label: "Conv.",   value: fmtNum(selectedCampaign.conversions) },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: "14px 16px", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 5 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: color || TEXT }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Panel body */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
                {!selectedAdSet ? (
                  /* ── Ad Sets ── */
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 12 }}>
                      Ad Sets · {adSets.length || "…"}
                    </div>
                    {loadingAdSets ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[...Array(4)].map((_, i) => <Skeleton key={i} h="96px" rounded="10px" />)}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {adSets.map((as) => (
                          <div
                            key={as.id}
                            className="panel-adset"
                            onClick={() => setSelectedAdSet(as)}
                            style={{
                              borderRadius: 10,
                              border: `1px solid ${roasBorder(as.roas)}`,
                              background: "rgba(255,255,255,0.025)",
                              padding: "14px 16px",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 3 }}>{as.name}</div>
                                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "rgba(99,102,241,0.12)", color: "#A5B4FC" }}>
                                  {as.audience}
                                </span>
                              </div>
                              <RoasBadge roas={as.roas} />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                              {[
                                { label: "Spend",  value: fmt(as.spend, currency) },
                                { label: "CTR",    value: `${as.ctr.toFixed(1)}%` },
                                { label: "Reach",  value: fmtNum(as.reach) },
                                { label: "Conv.",  value: fmtNum(as.conversions) },
                              ].map(({ label, value }) => (
                                <div key={label}>
                                  <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{label}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                                </div>
                              ))}
                            </div>
                            {as.frequency > 5 && (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", borderRadius: 6, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
                                <AlertTriangle size={11} style={{ color: "#F59E0B" }} />
                                <span style={{ fontSize: 10, color: "#F59E0B" }}>Frequency {as.frequency.toFixed(1)} — ad fatigue risk</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  /* ── Ads Grid ── */
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 12 }}>
                      Ads · {ads.length || "…"}
                    </div>
                    {loadingAds ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[...Array(4)].map((_, i) => <Skeleton key={i} h="220px" rounded="10px" />)}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {ads.map((ad) => (
                          <div
                            key={ad.id}
                            className="ad-card"
                            onClick={() => setSelectedAd(ad)}
                            style={{
                              borderRadius: 10,
                              border: `1px solid ${roasBorder(ad.roas)}`,
                              background: "rgba(255,255,255,0.025)",
                              padding: "12px",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {/* Creative preview */}
                            <div
                              style={{
                                width: "100%",
                                aspectRatio: "16/9",
                                borderRadius: 7,
                                background: "rgba(255,255,255,0.04)",
                                border: "1px dashed rgba(255,255,255,0.08)",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                marginBottom: 10,
                              }}
                            >
                              <span style={{ color: "rgba(255,255,255,0.15)", transform: "scale(1.5)", display: "inline-block" }}>
                                {ad.format === "Video" ? <Video size={16} /> : ad.format === "Carousel" ? <Layers size={16} /> : <ImageIcon size={16} />}
                              </span>
                              <FormatBadge format={ad.format} />
                            </div>

                            {/* Headline */}
                            <p style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.4, marginBottom: 6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                              {ad.headline}
                            </p>

                            {/* Stats grid */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                              {[
                                { label: "ROAS",  value: `${ad.roas.toFixed(1)}×`, color: roasColor(ad.roas) },
                                { label: "CTR",   value: `${ad.ctr.toFixed(1)}%`,  color: undefined },
                                { label: "Spend", value: fmt(ad.spend, currency),   color: undefined },
                                { label: "Conv.", value: fmtNum(ad.conversions),     color: undefined },
                              ].map(({ label, value, color }) => (
                                <div key={label} style={{ padding: "6px 8px", borderRadius: 5, background: "rgba(255,255,255,0.04)" }}>
                                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
                                  <div style={{ fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: color || "rgba(255,255,255,0.8)" }}>{value}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══════════════════ AD DETAIL MODAL ═══════════════════════ */}
      {selectedAd && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(16px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "fadeIn 0.2s ease",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedAd(null); }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 860,
              borderRadius: 16,
              overflow: "hidden",
              background: "#0d0d1a",
              border: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              animation: "fadeUp 0.25s ease",
            }}
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 10, color: MUTED, marginBottom: 3 }}>
                  {selectedCampaign?.name} › {selectedAdSet?.name}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{selectedAd.headline}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FormatBadge format={selectedAd.format} />
                <RoasBadge roas={selectedAd.roas} />
                <button
                  onClick={() => setSelectedAd(null)}
                  style={{ padding: 7, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer", display: "flex" }}
                >
                  <X size={15} style={{ color: MUTED }} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              {/* Left: creative */}
              <div style={{ padding: "20px", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  style={{
                    aspectRatio: "16/9",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.03)",
                    border: `2px solid ${roasBorder(selectedAd.roas)}`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                  }}
                >
                  <span style={{ color: "rgba(255,255,255,0.12)", transform: "scale(3.5)", display: "inline-block" }}>
                    {selectedAd.format === "Video" ? <Video size={16} /> : selectedAd.format === "Carousel" ? <Layers size={16} /> : <ImageIcon size={16} />}
                  </span>
                  <FormatBadge format={selectedAd.format} />
                </div>

                <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{selectedAd.headline}</div>
                  <p style={{ fontSize: 12, lineHeight: 1.6, color: MUTED }}>{selectedAd.body}</p>
                </div>

                <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                    <Zap size={13} style={{ color: "#A78BFA" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A78BFA" }}>Designer Directions</span>
                  </div>
                  <ul style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {[
                      "Lead with product in first 3 seconds",
                      "Add captions — 85% watch without sound",
                      "Include price anchor / discount callout",
                      "Test darker background for higher contrast",
                    ].map((d, i) => (
                      <li key={i} style={{ display: "flex", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                        <span style={{ color: "#A78BFA", flexShrink: 0 }}>›</span> {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Right: metrics */}
              <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Score */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: `conic-gradient(${roasColor(selectedAd.roas)} ${Math.min(selectedAd.roas / 5 * 100, 100)}%, rgba(255,255,255,0.05) 0)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: roasColor(selectedAd.roas), fontVariantNumeric: "tabular-nums" }}>
                        {Math.round(Math.min(selectedAd.roas / 5 * 100, 100))}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Performance Score</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: roasColor(selectedAd.roas) }}>{roasLabel(selectedAd.roas)}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                      {selectedAd.roas.toFixed(1)}× ROAS · {fmtNum(selectedAd.impressions)} impressions
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Spend",        value: fmt(selectedAd.spend, currency),    color: undefined },
                    { label: "Revenue",      value: fmt(selectedAd.revenue, currency),  color: undefined },
                    { label: "ROAS",         value: `${selectedAd.roas.toFixed(1)}×`,  color: roasColor(selectedAd.roas) },
                    { label: "CTR",          value: `${selectedAd.ctr.toFixed(1)}%`,   color: undefined },
                    { label: "Conversions",  value: fmtNum(selectedAd.conversions),     color: undefined },
                    { label: "Impressions",  value: fmtNum(selectedAd.impressions),     color: undefined },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: "12px 14px", borderRadius: 9, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: color || TEXT }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* ROAS trend */}
                <div style={{ padding: "12px 14px", borderRadius: 9, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>ROAS Trend — 6 periods</div>
                  <ResponsiveContainer width="100%" height={60}>
                    <LineChart data={selectedAd.trend.map((v, i) => ({ i: i + 1, roas: v }))}>
                      <Line type="monotone" dataKey="roas" stroke={roasColor(selectedAd.roas)} strokeWidth={2} dot={{ r: 3, fill: roasColor(selectedAd.roas), strokeWidth: 0 }} isAnimationActive={false} />
                      <YAxis hide domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "#0d0d1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, color: "#fff", fontSize: 11 }}
                        formatter={(v: any) => [`${(v as number).toFixed(2)}×`, "ROAS"]}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Spend recs */}
                {(() => {
                  const recs = selectedAd.roas >= 3.5
                    ? ["Scale budget by 20% — ROAS above target", "Duplicate to new audiences for more reach", "Use as template for upcoming campaigns"]
                    : selectedAd.roas >= 2
                    ? ["Hold budget — monitor 7 more days", "A/B test headline to improve CTR", "Refresh creative before next period"]
                    : ["Pause now — negative efficiency", "Analyse audience mismatch before relaunch", "Do not scale until creative reworked"];
                  return (
                    <div style={{ padding: "12px 14px", borderRadius: 9, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                        <ExternalLink size={12} style={{ color: "#818CF8" }} />
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#818CF8" }}>Spend Recs</span>
                      </div>
                      <ul style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {recs.map((r, i) => (
                          <li key={i} style={{ display: "flex", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                            <span style={{ color: "#818CF8", flexShrink: 0 }}>›</span> {r}
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
      )}
    </div>
  );
}
