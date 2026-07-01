"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdPerf {
  id: string;
  name: string;
  format: "Video" | "Image" | "Carousel";
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  conversions: number;
  impressions: number;
  frequency: number;
  headline: string;
  body: string;
  thumbnailUrl: string | null;
}

interface FormatSummary {
  format: string;
  avgRoas: number;
  totalSpend: number;
  count: number;
}

interface CreativeBrief {
  campaign_concept: string;
  hero_format: string;
  format_breakdown: { format: string; allocation: number; reason: string }[];
  visual_direction: {
    scene: string;
    do: string[];
    avoid: string[];
    color_palette: { hex: string; role: string; why: string }[];
    reference: string;
  };
  copy_direction: {
    arabic_headlines: string[];
    english_headlines: string[];
    body_copy: string;
    cta: string;
    copy_rules: string[];
  };
  audience_targeting: {
    primary: string;
    secondary: string;
    avoid: string;
  };
  placement_specs: { placement: string; dimensions: string; safe_zone: string; notes: string }[];
  urgency_score: number;
  urgency_reason: string;
  confidence_score: number;
  data_basis: string;
}

interface ApiResponse {
  brief: CreativeBrief;
  generatedBy: "claude" | "rules";
  generatedAt: string;
  dateRange: { from: string; to: string };
  performanceData: {
    topAds: AdPerf[];
    bottomAds: AdPerf[];
    formatSummary: FormatSummary[];
    fatigueAds: AdPerf[];
    totalSpend: number;
    totalRevenue: number;
    blendedRoas: number;
  };
}

export interface CreativeStudioProps {
  dateRange: { from: string; to: string };
  platform: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatIcon(format: string) {
  if (format === "Video") return "🎬";
  if (format === "Carousel") return "🎠";
  return "🖼️";
}

function roasBadgeColor(roas: number): string {
  if (roas >= 4) return "rgba(34,197,94,0.15)";
  if (roas >= 3) return "rgba(99,102,241,0.15)";
  if (roas >= 2) return "rgba(234,179,8,0.15)";
  return "rgba(239,68,68,0.15)";
}

function roasTextColor(roas: number): string {
  if (roas >= 4) return "#4ade80";
  if (roas >= 3) return "#a5b4fc";
  if (roas >= 2) return "#fde047";
  return "#f87171";
}

function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function fmtEGP(n: number) {
  return `EGP ${n.toLocaleString()}`;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function buildFullBriefText(data: ApiResponse): string {
  const { brief, generatedAt, dateRange } = data;
  const lines: string[] = [
    `LE SOUVERAIN — AI CREATIVE BRIEF`,
    `Generated: ${new Date(generatedAt).toLocaleDateString()} | Period: ${dateRange.from} → ${dateRange.to}`,
    ``,
    `CAMPAIGN CONCEPT`,
    brief.campaign_concept,
    ``,
    `HERO FORMAT`,
    brief.hero_format,
    ``,
    `FORMAT SPLIT`,
    ...brief.format_breakdown.map((f) => `  ${f.format} — ${f.allocation}% — ${f.reason}`),
    ``,
    `VISUAL DIRECTION`,
    `Scene: ${brief.visual_direction.scene}`,
    ``,
    `DO:`,
    ...brief.visual_direction.do.map((d) => `  ✓ ${d}`),
    ``,
    `AVOID:`,
    ...brief.visual_direction.avoid.map((d) => `  ✗ ${d}`),
    ``,
    `COLOR PALETTE:`,
    ...brief.visual_direction.color_palette.map((c) => `  ${c.hex} (${c.role}) — ${c.why}`),
    ``,
    `Reference: ${brief.visual_direction.reference}`,
    ``,
    `COPY DIRECTION`,
    `Arabic Headlines:`,
    ...brief.copy_direction.arabic_headlines.map((h) => `  • ${h}`),
    ``,
    `English Headlines:`,
    ...brief.copy_direction.english_headlines.map((h) => `  • ${h}`),
    ``,
    `Body Copy: ${brief.copy_direction.body_copy}`,
    `CTA: ${brief.copy_direction.cta}`,
    ``,
    `Copy Rules:`,
    ...brief.copy_direction.copy_rules.map((r) => `  • ${r}`),
    ``,
    `AUDIENCE TARGETING`,
    `Primary: ${brief.audience_targeting.primary}`,
    `Secondary: ${brief.audience_targeting.secondary}`,
    `Avoid: ${brief.audience_targeting.avoid}`,
    ``,
    `PLACEMENT SPECS`,
    ...brief.placement_specs.map((p) => `  ${p.placement} — ${p.dimensions} — ${p.notes}`),
    ``,
    `SCORES`,
    `Urgency: ${brief.urgency_score}/10 — ${brief.urgency_reason}`,
    `Confidence: ${brief.confidence_score}%`,
    ``,
    `DATA BASIS`,
    brief.data_basis,
  ];
  return lines.join("\n");
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: string }) {
  return (
    <div
      style={{
        height: h,
        width: w,
        borderRadius: 6,
        background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s infinite",
      }}
    />
  );
}

// ─── Left Column: Performance Analysis ───────────────────────────────────────

function PerformancePanel({ data }: { data: ApiResponse }) {
  const { performanceData, dateRange } = data;
  const { topAds, bottomAds, formatSummary, fatigueAds, blendedRoas } = performanceData;

  const maxRoas = Math.max(...formatSummary.map((f) => f.avgRoas), 0.1);
  const bestFormat = [...formatSummary].sort((a, b) => b.avgRoas - a.avgRoas)[0];

  // Pattern insights derived from data
  const patterns: string[] = [];
  const videoFmt = formatSummary.find((f) => f.format === "Video");
  const imageFmt = formatSummary.find((f) => f.format === "Image");
  const carouselFmt = formatSummary.find((f) => f.format === "Carousel");

  if (videoFmt && imageFmt && videoFmt.avgRoas > imageFmt.avgRoas) {
    const pct = Math.round(((videoFmt.avgRoas - imageFmt.avgRoas) / imageFmt.avgRoas) * 100);
    patterns.push(`Video → +${pct}% ROAS vs Static Image`);
  }
  if (carouselFmt && imageFmt && carouselFmt.avgRoas > imageFmt.avgRoas) {
    const pct = Math.round(((carouselFmt.avgRoas - imageFmt.avgRoas) / imageFmt.avgRoas) * 100);
    patterns.push(`Carousel → +${pct}% ROAS vs Static Image`);
  }

  const arabicTop = topAds.filter((a) => /[؀-ۿ]/.test(a.headline + a.body));
  const arabicBottom = bottomAds.filter((a) => /[؀-ۿ]/.test(a.headline + a.body));
  if (arabicTop.length > arabicBottom.length) {
    patterns.push(`Arabic copy → higher ROAS in top performers (${arabicTop.length}/${topAds.length} top ads)`);
  }

  const topAvgCtr = topAds.length ? topAds.reduce((s, a) => s + a.ctr, 0) / topAds.length : 0;
  const bottomAvgCtr = bottomAds.length ? bottomAds.reduce((s, a) => s + a.ctr, 0) / bottomAds.length : 0;
  if (topAvgCtr > 0 && bottomAvgCtr > 0) {
    const diff = Math.round(((topAvgCtr - bottomAvgCtr) / bottomAvgCtr) * 100);
    patterns.push(`Top ads avg CTR ${topAvgCtr.toFixed(1)}% vs bottom ${bottomAvgCtr.toFixed(1)}% (+${diff}%)`);
  }

  patterns.push(`Blended ROAS: ${blendedRoas.toFixed(1)}× across all active formats`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          What&apos;s Working
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
          {dateRange.from} → {dateRange.to}
        </div>
      </div>

      {/* Format Performance */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
          Format ROAS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...formatSummary]
            .sort((a, b) => b.avgRoas - a.avgRoas)
            .map((fmt) => {
              const isWinner = fmt.format === bestFormat?.format;
              return (
                <div
                  key={fmt.format}
                  style={{
                    background: isWinner ? "rgba(99,102,241,0.06)" : "transparent",
                    border: isWinner ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
                    borderRadius: 8,
                    padding: isWinner ? "10px 12px" : "2px 0",
                    boxShadow: isWinner ? "0 0 16px rgba(99,102,241,0.1)" : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{formatIcon(fmt.format)}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: isWinner ? "#c7d2fe" : "rgba(255,255,255,0.7)" }}>
                        {fmt.format}
                      </span>
                      {isWinner && (
                        <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(99,102,241,0.25)", color: "#a5b4fc", borderRadius: 4, padding: "1px 6px" }}>
                          WINNER
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: roasTextColor(fmt.avgRoas) }}>
                      {fmt.avgRoas.toFixed(2)}×
                    </span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 99, height: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(fmt.avgRoas / maxRoas) * 100}%`,
                        background: isWinner ? "linear-gradient(90deg,#6366f1,#818cf8)" : "rgba(255,255,255,0.2)",
                        borderRadius: 99,
                        transition: "width 0.8s ease",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    {fmt.count} ad{fmt.count !== 1 ? "s" : ""} · {fmtEGP(fmt.totalSpend)} spend
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Top 3 Performers */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Top Performers
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {topAds.slice(0, 3).map((ad, i) => (
            <div
              key={ad.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: "rgba(255,255,255,0.02)",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ fontSize: 16, flexShrink: 0 }}>{formatIcon(ad.format)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {truncate(ad.name, 38)}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                  {fmtEGP(ad.spend)} · {ad.ctr.toFixed(1)}% CTR
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: roasTextColor(ad.roas),
                  background: roasBadgeColor(ad.roas),
                  borderRadius: 6,
                  padding: "2px 7px",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {ad.roas.toFixed(2)}×
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom 3 Performers */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Learn What to Avoid
          </div>
          <div style={{ fontSize: 10, color: "rgba(239,68,68,0.6)" }}>bottom performers</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {bottomAds.slice(0, 3).map((ad) => (
            <div
              key={ad.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: "rgba(239,68,68,0.03)",
                borderRadius: 8,
                border: "1px solid rgba(239,68,68,0.1)",
              }}
            >
              <div style={{ fontSize: 16, flexShrink: 0 }}>{formatIcon(ad.format)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {truncate(ad.name, 38)}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                  {fmtEGP(ad.spend)} spent · {ad.ctr.toFixed(1)}% CTR
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#f87171",
                  background: "rgba(239,68,68,0.12)",
                  borderRadius: 6,
                  padding: "2px 7px",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {ad.roas.toFixed(2)}×
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pattern Intelligence */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Pattern Intelligence
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {patterns.map((p, i) => (
            <div
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                background: "rgba(99,102,241,0.08)",
                border: "1px solid rgba(99,102,241,0.15)",
                borderRadius: 99,
                fontSize: 12,
                color: "#c7d2fe",
              }}
            >
              <span style={{ color: "#6366f1", fontSize: 10 }}>●</span>
              {p}
            </div>
          ))}
        </div>
      </div>

      {/* Creative Fatigue Radar */}
      {fatigueAds.length > 0 && (
        <div style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>⚠️</span>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(234,179,8,0.8)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Creative Fatigue Radar
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {fatigueAds.map((ad) => (
              <div key={ad.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {truncate(ad.name, 32)}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: ad.frequency > 6 ? "#f87171" : "#fde047",
                    background: ad.frequency > 6 ? "rgba(239,68,68,0.12)" : "rgba(234,179,8,0.12)",
                    borderRadius: 5,
                    padding: "2px 7px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {ad.frequency.toFixed(1)}× freq
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Right Column: Creative Brief ─────────────────────────────────────────────

function BriefPanel({
  data,
  loading,
  onRegenerate,
}: {
  data: ApiResponse | null;
  loading: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopyFull() {
    if (!data) return;
    copyToClipboard(buildFullBriefText(data));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <Skeleton h={20} w="180px" />
            <div style={{ marginTop: 6 }}>
              <Skeleton h={13} w="140px" />
            </div>
          </div>
          <div style={{ width: 160, height: 38, borderRadius: 8, background: "rgba(255,255,255,0.04)" }} />
        </div>
        {[120, 80, 200, 160, 140, 100].map((h, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
            <Skeleton h={12} w="100px" />
            <div style={{ marginTop: 12 }}>
              <Skeleton h={h} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data) return null;

  const { brief, generatedBy, generatedAt } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>AI Creative Brief</div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 4,
                background: generatedBy === "claude" ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.08)",
                color: generatedBy === "claude" ? "#a5b4fc" : "rgba(255,255,255,0.4)",
              }}
            >
              {generatedBy === "claude" ? "Claude AI" : "Rules Engine"}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
            Generated {new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
        <button
          onClick={onRegenerate}
          style={{
            background: "linear-gradient(135deg,#6366f1,#818cf8)",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ↻ Generate New Brief
        </button>
      </div>

      {/* Campaign Concept */}
      <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(99,102,241,0.7)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          Campaign Concept
        </div>
        <div style={{ fontSize: 15, fontStyle: "italic", color: "rgba(255,255,255,0.85)", lineHeight: 1.6, fontWeight: 400 }}>
          &ldquo;{brief.campaign_concept}&rdquo;
        </div>
      </div>

      {/* Hero Format */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Hero Format
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{brief.hero_format}</div>
      </div>

      {/* Format Split */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
          Format Allocation
        </div>
        {/* Stacked bar */}
        <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", marginBottom: 16 }}>
          {brief.format_breakdown.map((f, i) => {
            const colors = ["#6366f1", "#818cf8", "rgba(255,255,255,0.2)"];
            return (
              <div
                key={i}
                title={`${f.format}: ${f.allocation}%`}
                style={{ width: `${f.allocation}%`, background: colors[i] ?? colors[2], transition: "width 0.6s ease" }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {brief.format_breakdown.map((f, i) => {
            const colors = ["#a5b4fc", "#c7d2fe", "rgba(255,255,255,0.4)"];
            return (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, width: 160 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: colors[i] ?? colors[2], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors[i] ?? colors[2] }}>
                    {f.allocation}% {f.format}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>{f.reason}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Direction */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Visual Direction
        </div>

        {/* Scene */}
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, borderLeft: "3px solid rgba(99,102,241,0.5)" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Scene
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>{brief.visual_direction.scene}</div>
        </div>

        {/* Do / Avoid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              ✓ DO
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {brief.visual_direction.do.map((d, i) => (
                <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, paddingLeft: 10, borderLeft: "2px solid rgba(74,222,128,0.3)" }}>
                  {d}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              ✗ AVOID
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {brief.visual_direction.avoid.map((d, i) => (
                <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, paddingLeft: 10, borderLeft: "2px solid rgba(248,113,113,0.3)" }}>
                  {d}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Color Palette */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Color Palette
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {brief.visual_direction.color_palette.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }} title={c.why}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: c.hex,
                    border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "help",
                  }}
                />
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{c.hex}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "capitalize" }}>{c.role}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Reference */}
        <div style={{ fontSize: 11, color: "rgba(99,102,241,0.7)", fontStyle: "italic", lineHeight: 1.5 }}>
          📌 {brief.visual_direction.reference}
        </div>
      </div>

      {/* Copy Direction */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
          Copy Direction
        </div>

        {/* Arabic Headlines */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Arabic Headlines
          </div>
          <div
            style={{
              background: "rgba(99,102,241,0.04)",
              border: "1px solid rgba(99,102,241,0.12)",
              borderRadius: 8,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {brief.copy_direction.arabic_headlines.map((h, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span
                  dir="rtl"
                  style={{
                    textAlign: "right",
                    display: "block",
                    fontFamily: "sans-serif",
                    fontSize: 14,
                    color: "rgba(255,255,255,0.85)",
                    lineHeight: 1.6,
                    flex: 1,
                  }}
                >
                  {h}
                </span>
                <button
                  onClick={() => copyToClipboard(h)}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 5,
                    color: "rgba(255,255,255,0.4)",
                    fontSize: 10,
                    cursor: "pointer",
                    padding: "3px 7px",
                    flexShrink: 0,
                  }}
                >
                  copy
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* English Headlines */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            English Headlines
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {brief.copy_direction.english_headlines.map((h, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{h}</span>
                <button
                  onClick={() => copyToClipboard(h)}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 5,
                    color: "rgba(255,255,255,0.4)",
                    fontSize: 10,
                    cursor: "pointer",
                    padding: "3px 7px",
                    flexShrink: 0,
                  }}
                >
                  copy
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Body Copy */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Body Copy Approach
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "8px 12px" }}>
            {brief.copy_direction.body_copy}
          </div>
        </div>

        {/* CTA */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            CTA
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#a5b4fc",
                background: "rgba(99,102,241,0.12)",
                borderRadius: 6,
                padding: "4px 12px",
                border: "1px solid rgba(99,102,241,0.25)",
              }}
            >
              {brief.copy_direction.cta}
            </span>
            <button
              onClick={() => copyToClipboard(brief.copy_direction.cta)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 5,
                color: "rgba(255,255,255,0.4)",
                fontSize: 10,
                cursor: "pointer",
                padding: "3px 7px",
              }}
            >
              copy
            </button>
          </div>
        </div>

        {/* Copy Rules */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Copy Rules
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {brief.copy_direction.copy_rules.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: "#6366f1", fontSize: 12, flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audience */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Audience Targeting
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "Primary", value: brief.audience_targeting.primary, color: "#4ade80" },
            { label: "Secondary", value: brief.audience_targeting.secondary, color: "#a5b4fc" },
            { label: "Avoid", value: brief.audience_targeting.avoid, color: "#f87171" },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Placement Specs */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Placement Specs
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {brief.placement_specs.map((p, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "130px 100px 1fr",
                gap: 12,
                padding: "10px 0",
                borderBottom: i < brief.placement_specs.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                alignItems: "start",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{p.placement}</div>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#a5b4fc", background: "rgba(99,102,241,0.1)", borderRadius: 4, padding: "2px 6px", display: "inline-block" }}>
                {p.dimensions}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{p.notes}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Urgency + Confidence */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div
          style={{
            background: `rgba(${brief.urgency_score >= 8 ? "239,68,68" : brief.urgency_score >= 6 ? "234,179,8" : "74,222,128"},0.05)`,
            border: `1px solid rgba(${brief.urgency_score >= 8 ? "239,68,68" : brief.urgency_score >= 6 ? "234,179,8" : "74,222,128"},0.2)`,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Urgency
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: brief.urgency_score >= 8 ? "#f87171" : brief.urgency_score >= 6 ? "#fde047" : "#4ade80", lineHeight: 1 }}>
            {brief.urgency_score}<span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>/10</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginTop: 6 }}>
            {brief.urgency_reason}
          </div>
        </div>
        <div
          style={{
            background: "rgba(99,102,241,0.05)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Confidence
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#a5b4fc", lineHeight: 1 }}>
            {brief.confidence_score}<span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>%</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginTop: 6 }}>
            {brief.data_basis}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
        <button
          onClick={handleCopyFull}
          style={{
            flex: 1,
            background: copied ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${copied ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 8,
            color: copied ? "#4ade80" : "rgba(255,255,255,0.7)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            padding: "10px 0",
            transition: "all 0.2s",
          }}
        >
          {copied ? "✓ Copied!" : "📋 Copy Full Brief"}
        </button>
        <button
          disabled
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.25)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "not-allowed",
            padding: "10px 0",
          }}
          title="Coming soon"
        >
          📄 Export PDF
        </button>
        <button
          disabled
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.25)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "not-allowed",
            padding: "10px 0",
          }}
          title="Coming soon"
        >
          🗂️ Save to Library
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CreativeStudio({ dateRange }: CreativeStudioProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const res = await fetch(`/api/marketing/creative-intelligence?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "45% 55%",
          gap: 24,
          padding: "24px 0",
          minHeight: 600,
        }}
      >
        {/* Left: Performance */}
        <div>
          {error && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: 14, marginBottom: 20, fontSize: 13, color: "#f87171" }}>
              Failed to load: {error}
            </div>
          )}
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {[60, 140, 120, 100].map((h, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
                  <Skeleton h={h} />
                </div>
              ))}
            </div>
          ) : data ? (
            <PerformancePanel data={data} />
          ) : null}
        </div>

        {/* Right: Brief */}
        <div>
          <BriefPanel
            data={data}
            loading={loading}
            onRegenerate={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </>
  );
}
