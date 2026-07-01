"use client";

import { useEffect, useMemo, useState } from "react";

// ── Theme (matches marketing/page.tsx) ──────────────────────────────────────────
const SURFACE = "rgba(255,255,255,0.03)";
const SURFACE2 = "rgba(255,255,255,0.05)";
const BORDER = "1px solid rgba(255,255,255,0.07)";
const BORDER_STRONG = "1px solid rgba(255,255,255,0.12)";
const TEXT = "#F9FAFB";
const MUTED = "rgba(255,255,255,0.45)";
const DIM = "rgba(255,255,255,0.30)";
const ACCENT = "#6366F1";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#EF4444";

// ── Types (mirror the API responses) ────────────────────────────────────────────
interface MER {
  totalRevenue: number;
  totalSpend: number;
  mer: number;
  breakEven: number | null;
  healthy: boolean | null;
}
interface Coverage {
  totalOrders: number;
  totalRevenue: number;
  adRevenue: number;
  campaignRevenue: number;
  channelRevenue: number;
  untrackedRevenue: number;
  metaTouchedRevenue: number;
  metaJoinableRevenue: number;
  trackedPct: number;
  campaignPct: number;
  metaCaptureRate: number;
}
interface Agg { revenue: number; units: number; orders: number; }
interface ReconciledCampaign {
  id: string; name: string; objective: string; spend: number;
  metaRevenue: number; metaRoas: number; metaConversions: number;
  shopifyRevenue: number; shopifyOrders: number; shopifyRoas: number;
  trueRoas: number; inflationFactor: number | null;
  trust: "verified" | "partial" | "meta-only"; checkTagging: boolean;
}
interface AttrResp {
  ok: boolean; generatedBy: string; dateRange: { from: string; to: string };
  mer: MER | null; coverage: Coverage; channels: Record<string, Agg>;
  campaigns: ReconciledCampaign[]; taggingIssues: ReconciledCampaign[]; note?: string;
}
interface Allocation {
  stage: "sales" | "traffic" | "awareness"; label: string;
  currentPct: number; recommendedPct: number; currentSpend: number; recommendedSpend: number;
  deltaPct: number; action: "scale" | "hold" | "cut"; reason: string;
  formats: string[]; design: string;
}
interface BucketStat {
  stage: string; label: string; spend: number; sharePct: number;
  trueRoas: number; avgFrequency: number; conversions: number; campaigns: number;
}
interface BudgetPlan {
  headline: string; breakEvenRoas: number; totalBudget: number;
  buckets: BucketStat[]; allocations: Allocation[]; warnings: string[];
}
interface BudgetResp {
  ok: boolean; available: boolean; dateRange: { from: string; to: string };
  mer: MER | null; marginKnown?: boolean; plan?: BudgetPlan; note?: string;
}

export interface AttributionStudioProps {
  dateRange: { from: string; to: string };
  platform?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const fmtEGP = (n: number) => "EGP " + Math.round(n).toLocaleString();
const fmtK = (n: number) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(Math.round(n)));
function roasColor(r: number) { return r >= 4 ? GREEN : r >= 3 ? ACCENT : r >= 2 ? AMBER : RED; }
const STAGE_COLOR: Record<string, string> = { sales: GREEN, traffic: ACCENT, awareness: "#A855F7" };

// ── Skeleton ─────────────────────────────────────────────────────────────────────
function Sk({ h = 16, w = "100%", r = 8 }: { h?: number; w?: string | number; r?: number }) {
  return <div style={{ height: h, width: w, borderRadius: r, background: "linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.6s infinite" }} />;
}

// ════════════════════════════════════════════════════════════════════════════════
export default function AttributionStudio({ dateRange }: AttributionStudioProps) {
  const [attr, setAttr] = useState<AttrResp | null>(null);
  const [budget, setBudget] = useState<BudgetResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [marginPct, setMarginPct] = useState(50);

  // Load saved margin once (client only).
  useEffect(() => {
    const saved = typeof window !== "undefined" ? Number(window.localStorage.getItem("lsGrossMargin")) : 0;
    if (saved > 0) setMarginPct(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = `from=${dateRange.from}&to=${dateRange.to}&margin=${marginPct}`;
    Promise.all([
      fetch(`/api/marketing/attribution?${qs}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/marketing/budget?${qs}`).then((r) => r.json()).catch(() => null),
    ]).then(([a, b]) => {
      if (cancelled) return;
      setAttr(a); setBudget(b); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [dateRange.from, dateRange.to, marginPct]);

  function saveMargin(v: number) {
    const clamped = Math.max(5, Math.min(95, v));
    setMarginPct(clamped);
    if (typeof window !== "undefined") window.localStorage.setItem("lsGrossMargin", String(clamped));
  }

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* Header + margin control */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: "-0.02em" }}>
            Attribution Truth <span style={{ color: ACCENT }}>✦</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
            First-party revenue reconciled against Meta — {dateRange.from} → {dateRange.to}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: SURFACE, border: BORDER, borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 11, color: MUTED }}>Gross margin</span>
          <input
            type="number" min={5} max={95} value={marginPct}
            onChange={(e) => saveMargin(Number(e.target.value))}
            style={{ width: 46, background: SURFACE2, border: BORDER_STRONG, borderRadius: 6, color: TEXT, fontSize: 13, fontWeight: 700, textAlign: "center", padding: "4px 2px" }}
          />
          <span style={{ fontSize: 11, color: MUTED }}>% → break-even {marginPct > 0 ? (100 / marginPct).toFixed(1) : "—"}×</span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Sk h={150} r={16} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><Sk h={220} r={16} /><Sk h={220} r={16} /></div>
          <Sk h={280} r={16} />
        </div>
      ) : (
        <>
          <MERHero mer={attr?.mer ?? null} coverage={attr?.coverage} generatedBy={attr?.generatedBy} note={attr?.note} />
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
            {attr?.coverage && <CoverageCard coverage={attr.coverage} />}
            {attr?.channels && <ChannelCard channels={attr.channels} />}
          </div>
          {budget?.available && budget.plan && (
            <BudgetCard plan={budget.plan} marginKnown={budget.marginKnown} />
          )}
          {attr?.taggingIssues && attr.taggingIssues.length > 0 && <TaggingFix issues={attr.taggingIssues} />}
          {attr?.campaigns && attr.campaigns.length > 0 && <ReconciliationTable campaigns={attr.campaigns} />}
          {(!attr?.campaigns || attr.campaigns.length === 0) && (
            <div style={{ background: SURFACE, border: BORDER, borderRadius: 14, padding: 20, fontSize: 13, color: MUTED }}>
              {attr?.note ?? "No Meta campaign data for this period. First-party channel attribution is shown above."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── MER hero: the north star ─────────────────────────────────────────────────────
function MERHero({ mer, coverage, generatedBy, note }: { mer: MER | null; coverage?: Coverage; generatedBy?: string; note?: string }) {
  if (!mer) {
    return (
      <div style={{ background: SURFACE, border: BORDER, borderRadius: 16, padding: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>Blended MER</div>
        <div style={{ fontSize: 15, color: MUTED, marginTop: 10 }}>{note ?? "Connect Meta to compute MER (revenue ÷ ad spend)."}</div>
        {coverage && <div style={{ fontSize: 13, color: DIM, marginTop: 8 }}>First-party revenue tracked: {fmtEGP(coverage.totalRevenue)} across {coverage.totalOrders} orders.</div>}
      </div>
    );
  }
  const healthy = mer.healthy;
  const barColor = healthy === null ? ACCENT : healthy ? GREEN : RED;
  const merColor = healthy === false ? RED : mer.mer >= 3 ? GREEN : ACCENT;
  // gauge: where MER sits relative to break-even (0..2x breakeven)
  const be = mer.breakEven ?? mer.mer;
  const gaugePct = Math.max(3, Math.min(100, (mer.mer / (be * 2)) * 100));
  const bePct = Math.max(0, Math.min(100, (be / (be * 2)) * 100));
  return (
    <div style={{ background: `linear-gradient(135deg, rgba(99,102,241,0.10), ${SURFACE})`, border: BORDER_STRONG, borderRadius: 16, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div style={{ minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>Blended MER · the north star</span>
            <span title="Total first-party revenue ÷ total ad spend. 100% first-party — immune to the pixel problem." style={{ fontSize: 10, color: DIM, cursor: "help", border: BORDER, borderRadius: 99, width: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>?</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-0.03em", color: merColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{mer.mer.toFixed(2)}×</span>
            {healthy !== null && (
              <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 99, background: healthy ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: healthy ? GREEN : RED }}>
                {healthy ? "PROFITABLE" : "BELOW BREAK-EVEN"}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>
            {fmtEGP(mer.totalRevenue)} revenue ÷ {fmtEGP(mer.totalSpend)} spend
            {mer.breakEven != null && <> · break-even {mer.breakEven.toFixed(1)}×</>}
          </div>
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          {/* gauge */}
          <div style={{ position: "relative", height: 12, background: "rgba(255,255,255,0.06)", borderRadius: 99, marginTop: 28, overflow: "visible" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${gaugePct}%`, background: barColor, borderRadius: 99, transition: "width 0.8s ease" }} />
            {mer.breakEven != null && (
              <div style={{ position: "absolute", left: `${bePct}%`, top: -6, bottom: -6, width: 2, background: TEXT, opacity: 0.8 }}>
                <div style={{ position: "absolute", top: -18, left: -18, fontSize: 9, color: MUTED, whiteSpace: "nowrap" }}>break-even</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: DIM }}>
            <span>0×</span><span>{(be * 2).toFixed(1)}×</span>
          </div>
          {coverage && (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 10, lineHeight: 1.5 }}>
              {generatedBy === "first-party-degraded" ? "Meta offline — first-party only. " : ""}
              Every EGP of revenue counts here, tracked or not — that's why MER can't lie. Per-campaign detail below relies on tagging coverage.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Coverage card ────────────────────────────────────────────────────────────────
function CoverageCard({ coverage }: { coverage: Coverage }) {
  const c = coverage;
  const segs = [
    { label: "Ad-verified", val: c.adRevenue, color: GREEN },
    { label: "Campaign", val: Math.max(0, c.campaignRevenue - c.adRevenue), color: ACCENT },
    { label: "Channel-only", val: c.channelRevenue, color: AMBER },
    { label: "Untracked", val: c.untrackedRevenue, color: "rgba(255,255,255,0.15)" },
  ];
  const total = c.totalRevenue || 1;
  return (
    <div style={{ background: SURFACE, border: BORDER, borderRadius: 16, padding: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>Attribution coverage</div>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 16 }}>How much revenue we can trace to a specific ad/campaign</div>
      <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", gap: 2 }}>
        {segs.map((s) => s.val > 0 && (
          <div key={s.label} title={`${s.label}: ${fmtEGP(s.val)}`} style={{ width: `${(s.val / total) * 100}%`, background: s.color, minWidth: 3 }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 14 }}>
        {segs.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: MUTED }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, display: "inline-block" }} />
            {s.label} <span style={{ color: TEXT, fontWeight: 600 }}>{fmtEGP(s.val)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: BORDER, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Stat label="Tracked" value={`${c.trackedPct}%`} sub="has any click signal" />
        <Stat label="Meta capture" value={`${(c.metaCaptureRate * 100).toFixed(0)}%`} sub="of Meta rev joined to a campaign" />
      </div>
    </div>
  );
}

// ── Channel split card ───────────────────────────────────────────────────────────
function ChannelCard({ channels }: { channels: Record<string, Agg> }) {
  const rows = Object.entries(channels)
    .map(([k, v]) => ({ k, ...v }))
    .filter((r) => r.orders > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  const label: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok", direct: "Direct / Organic", other: "Other" };
  const color: Record<string, string> = { meta: "#0866FF", google: "#EA4335", tiktok: "#25F4EE", direct: "rgba(255,255,255,0.4)", other: AMBER };
  return (
    <div style={{ background: SURFACE, border: BORDER, borderRadius: 16, padding: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 16 }}>Revenue by source (first-party)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((r) => (
          <div key={r.k}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: TEXT }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color[r.k] ?? MUTED }} />
                {label[r.k] ?? r.k}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{fmtEGP(r.revenue)}</span>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(r.revenue / total) * 100}%`, background: color[r.k] ?? MUTED, borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 3 }}>{r.orders} orders · {((r.revenue / total) * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Budget allocation card ───────────────────────────────────────────────────────
function BudgetCard({ plan, marginKnown }: { plan: BudgetPlan; marginKnown?: boolean }) {
  const [open, setOpen] = useState<string | null>(plan.allocations[0]?.stage ?? null);
  return (
    <div style={{ background: SURFACE, border: BORDER, borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>Budget allocation</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "rgba(99,102,241,0.15)", color: ACCENT }}>FULL-FUNNEL</span>
      </div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.55, marginBottom: 16 }}>{plan.headline}</div>

      {plan.warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {plan.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: AMBER, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "8px 12px" }}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {plan.allocations.map((a) => {
          const col = STAGE_COLOR[a.stage] ?? ACCENT;
          const isOpen = open === a.stage;
          const bucket = plan.buckets.find((b) => b.stage === a.stage);
          return (
            <div key={a.stage} style={{ border: isOpen ? BORDER_STRONG : BORDER, borderRadius: 12, overflow: "hidden", transition: "border 0.15s" }}>
              <button onClick={() => setOpen(isOpen ? null : a.stage)} style={{ width: "100%", background: isOpen ? SURFACE2 : "transparent", border: "none", cursor: "pointer", padding: "12px 14px", textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: TEXT }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: col }} />
                    {a.label}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ActionBadge action={a.action} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, fontVariantNumeric: "tabular-nums", minWidth: 96, textAlign: "right" }}>
                      {a.currentPct}% <span style={{ color: DIM }}>→</span> <span style={{ color: col }}>{a.recommendedPct}%</span>
                    </span>
                  </span>
                </div>
                {/* dual bar: current (dim) vs recommended (color) */}
                <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 99, marginTop: 10 }}>
                  <div style={{ position: "absolute", inset: 0, width: `${a.currentPct}%`, background: "rgba(255,255,255,0.18)", borderRadius: 99 }} />
                  <div style={{ position: "absolute", top: -1, height: 10, width: 2, left: `${a.recommendedPct}%`, background: col }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: DIM }}>
                  <span>now {fmtEGP(a.currentSpend)}</span>
                  <span style={{ color: col }}>target {fmtEGP(a.recommendedSpend)}</span>
                </div>
              </button>
              {isOpen && (
                <div style={{ padding: "4px 14px 14px", borderTop: BORDER }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.5, margin: "10px 0" }}>{a.reason}</div>
                  {bucket && bucket.spend > 0 && (
                    <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: MUTED }}>
                      <span>True ROAS <b style={{ color: roasColor(bucket.trueRoas) }}>{bucket.trueRoas.toFixed(1)}×</b></span>
                      <span>Frequency <b style={{ color: bucket.avgFrequency >= 4.5 ? RED : TEXT }}>{bucket.avgFrequency.toFixed(1)}×</b></span>
                      <span>{bucket.campaigns} campaigns</span>
                    </div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 700, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Formats</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {a.formats.map((f, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 7, background: SURFACE2, border: BORDER, color: "rgba(255,255,255,0.75)" }}>{f}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Design direction</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>{a.design}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!marginKnown && (
        <div style={{ fontSize: 11, color: DIM, marginTop: 12 }}>Break-even assumes {plan.breakEvenRoas.toFixed(1)}× (set your gross margin above to tune it).</div>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: "scale" | "hold" | "cut" }) {
  const cfg = { scale: { t: "SCALE", c: GREEN }, hold: { t: "HOLD", c: MUTED }, cut: { t: "CUT", c: RED } }[action];
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, background: `${cfg.c}22`, color: cfg.c }}>{cfg.t}</span>;
}

// ── Tagging fix list (actionable ops) ────────────────────────────────────────────
function TaggingFix({ issues }: { issues: ReconciledCampaign[] }) {
  return (
    <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.22)", borderRadius: 14, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: AMBER }}>⚠ Fix these campaign URL tags</span>
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 14, lineHeight: 1.5 }}>
        These campaigns spent real money but produced <b>zero</b> orders we could match — their URL parameters aren&apos;t passing the Meta campaign/ad ID. Add <code style={{ color: AMBER }}>utm_campaign=&#123;&#123;campaign.id&#125;&#125;</code> &amp; <code style={{ color: AMBER }}>utm_content=&#123;&#123;ad.id&#125;&#125;</code> to recover their attribution.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {issues.slice(0, 8).map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, background: SURFACE, borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{c.name}</span>
            <span style={{ color: MUTED, fontVariantNumeric: "tabular-nums" }}>{fmtEGP(c.spend)} spent · 0 matched</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reconciliation table: Meta's claim vs the truth ──────────────────────────────
function ReconciliationTable({ campaigns }: { campaigns: ReconciledCampaign[] }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => campaigns.filter((c) => c.spend > 0), [campaigns]);
  const shown = showAll ? rows : rows.slice(0, 10);
  const trustCfg: Record<string, { t: string; c: string }> = {
    verified: { t: "Verified", c: GREEN }, partial: { t: "Partial", c: AMBER }, "meta-only": { t: "Meta only", c: DIM },
  };
  return (
    <div style={{ background: SURFACE, border: BORDER, borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>Meta&apos;s claim vs the truth</span>
        <span style={{ fontSize: 11, color: DIM }}>{rows.length} campaigns</span>
      </div>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 14 }}>Verified ROAS = real Shopify orders matched to the campaign. True est. lifts that floor by your capture rate, capped at Meta&apos;s claim.</div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 640 }}>
          <thead>
            <tr style={{ color: DIM, textAlign: "right", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Campaign</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Spend</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Meta ROAS</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Verified</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>True est.</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Meta gap</th>
              <th style={{ padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>Trust</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const over = c.inflationFactor != null && c.inflationFactor > 1.15;
              return (
                <tr key={c.id} style={{ borderTop: BORDER, color: TEXT }}>
                  <td style={{ textAlign: "left", padding: "9px 8px", maxWidth: 220 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: DIM }}>{c.objective || "—"}{c.checkTagging ? " · ⚠ tag gap" : ""}</div>
                  </td>
                  <td style={{ textAlign: "right", padding: "9px 8px", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{fmtK(c.spend)}</td>
                  <td style={{ textAlign: "right", padding: "9px 8px", color: DIM, fontVariantNumeric: "tabular-nums" }}>{c.metaRoas.toFixed(1)}×</td>
                  <td style={{ textAlign: "right", padding: "9px 8px", fontWeight: 700, color: c.shopifyOrders > 0 ? roasColor(c.shopifyRoas) : DIM, fontVariantNumeric: "tabular-nums" }}>
                    {c.shopifyOrders > 0 ? `${c.shopifyRoas.toFixed(1)}×` : "—"}
                    {c.shopifyOrders > 0 && <div style={{ fontSize: 9, color: DIM, fontWeight: 400 }}>{c.shopifyOrders} ord</div>}
                  </td>
                  <td style={{ textAlign: "right", padding: "9px 8px", fontWeight: 800, color: roasColor(c.trueRoas), fontVariantNumeric: "tabular-nums" }}>{c.trueRoas.toFixed(1)}×</td>
                  <td style={{ textAlign: "right", padding: "9px 8px", fontVariantNumeric: "tabular-nums" }}>
                    {c.inflationFactor != null ? (
                      <span style={{ color: over ? RED : MUTED, fontSize: 11 }}>{over ? `+${Math.round((c.inflationFactor - 1) * 100)}%` : "≈"}</span>
                    ) : <span style={{ color: DIM }}>—</span>}
                  </td>
                  <td style={{ textAlign: "center", padding: "9px 8px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: `${trustCfg[c.trust].c}20`, color: trustCfg[c.trust].c }}>{trustCfg[c.trust].t}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <button onClick={() => setShowAll(!showAll)} style={{ marginTop: 12, background: "transparent", border: BORDER, borderRadius: 8, color: MUTED, fontSize: 12, padding: "8px 14px", cursor: "pointer" }}>
          {showAll ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// ── small stat ───────────────────────────────────────────────────────────────────
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 10, color: DIM, marginTop: 1 }}>{sub}</div>
    </div>
  );
}
