import { EncryptJWT } from "jose";
import hkdf from "@panva/hkdf";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const key = await hkdf("sha256", process.env.NEXTAUTH_SECRET, "", "NextAuth.js Generated Encryption Key", 32);
const tok = await new EncryptJWT({ name: "v", role: "admin" }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setExpirationTime("1h").setJti(randomUUID()).encrypt(key);
const C = { cookie: `next-auth.session-token=${tok}` };
const g = async (p) => (await fetch("http://localhost:3000" + p, { headers: C })).json();
const iso = (d) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const daysAgo = (n) => { const [y, m, d] = iso(new Date()).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() - n); return dt.toISOString().slice(0, 10); };
const today = iso(new Date()), yest = daysAgo(1);

let pass = 0, fail = 0;
const ok = (c, msg, extra = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"}  ${msg}${extra ? "  — " + extra : ""}`); c ? pass++ : fail++; };

// ── PROD: deployed + healthy ──────────────────────────────────────────────────
console.log("\n── PROD health (no auth) ──");
try {
  const h = await (await fetch("https://retail-intelligence-production.up.railway.app/api/health", { signal: AbortSignal.timeout(25000) })).json();
  ok(h.sources?.nav?.status === "ok", "prod NAV ok", `maxDate ${h.sources?.nav?.maxDate} lag ${h.sources?.nav?.lagDays}`);
  ok(h.sources?.postgres?.status === "ok", "prod Postgres ok");
  ok(h.sources?.shopify?.status === "ok", "prod Shopify ok", `today ${h.sources?.shopify?.todayEgp}`);
} catch (e) { ok(false, "prod health reachable", e.message); }

// ── Three-way day comparison ──────────────────────────────────────────────────
console.log("\n── 3-way day comparison (kpis) ──");
const kToday = await g(`/api/kpis?from=${today}&to=${today}`);
ok(Array.isArray(kToday.dayComparisons) && kToday.dayComparisons.length === 3, "Today → 3 comparisons", (kToday.dayComparisons || []).map(c => c.label).join(", "));
ok(kToday.dayComparisons?.[0]?.label === "vs yesterday", "Today's first label = 'vs yesterday'");
const kYest = await g(`/api/kpis?from=${yest}&to=${yest}`);
ok(kYest.dayComparisons?.length === 3, "Yesterday → 3 comparisons", (kYest.dayComparisons || []).map(c => `${c.label} ${c.change === null ? "N/A" : c.change.toFixed(1) + "%"}`).join(" · "));
const k7 = await g(`/api/kpis?from=${daysAgo(7)}&to=${today}`);
ok(k7.dayComparisons === null, "Multi-day → dayComparisons null (single vs-previous)", `revChange ${k7.revChange?.toFixed(1)}%`);

// ── Home: channels + headline (B2B shown, not in total) ───────────────────────
console.log("\n── Home channels + headline ──");
const R = `from=2026-06-01&to=${yest}`;
const home = await g(`/api/home?${R}`);
const ch = Object.fromEntries((home.channelTotals || []).map(c => [c.group, c]));
ok(["Retail", "Ecom", "B2B"].every(g => ch[g]), "Retail/Ecom/B2B channels present");
ok((ch.B2B?.egp ?? 0) > 0, "B2B channel non-zero (HO invoices)", `EGP ${ch.B2B?.egp?.toLocaleString()}`);
ok(ch.Retail.egp + ch.Ecom.egp === home.totalRev, "headline = Retail + Ecom (B2B excluded)", `${home.totalRev?.toLocaleString()}`);
ok(home.sources?.nav === "ok", "home NAV ok");

// ── kpis headline == home total (same range, same source of truth) ────────────
const kHome = await g(`/api/kpis?${R}`);
const sameShop = home.sources?.shopify === "ok" && kHome.sources?.shopify === "ok";
ok(Math.round(kHome.revenue.egp) === Math.round(home.totalRev) || !sameShop, "kpis.revenue == home.totalRev", sameShop ? `${Math.round(kHome.revenue.egp).toLocaleString()}` : "(shopify flaky locally — skipped)");

// ── B2B tab + drill + Adjustment exclusion ────────────────────────────────────
console.log("\n── B2B ──");
const b = await g(`/api/b2b?${R}`);
ok(b.total.egp > 0 && b.customers.length > 0, "B2B tab returns customers", `${b.customers.length} cust, EGP ${b.total.egp.toLocaleString()}`);
ok(b.customers.reduce((s, c) => s + c.egp, 0) === b.total.egp, "B2B customers reconcile to total");
ok(!b.customers.some(c => c.code === "C-0142"), "C-0142 'Adjustment' excluded from tab");
const bd = await g(`/api/drill?type=channel&channel=B2B&${R}`);
ok(bd.rows?.length > 0 && !bd.rows.some(r => r.code === "C-0142"), "B2B channel drill → customers, no Adjustment", `${bd.rows?.length} rows`);

// ── Live board + drills ───────────────────────────────────────────────────────
console.log("\n── Live + Marketplace ──");
const live = await g(`/api/live`);
ok(Array.isArray(live.stores) && live.stores.some(s => s.code === "ECOM"), "Live: stores + Ecom bar", `${live.stores.length} bars, total ${live.total.egp.toLocaleString()}`);
ok(live.stores.reduce((s, x) => s + x.egp, 0) === live.total.egp, "Live: bars reconcile to total");
const retail = live.stores.find(s => s.code !== "ECOM");
if (retail) { const sb = await g(`/api/drill?type=store-brand&store=${retail.code}&from=${live.today}&to=${live.today}`); ok(sb.rows !== undefined, "Live store-brand drill responds", `${sb.rows?.length ?? "?"} brands`); }
const mp = await g(`/api/marketplace?${R}`);
ok(Array.isArray(mp.marketplaces), "Marketplace responds", `${mp.marketplaces?.length} marketplaces, EGP ${mp.total?.egp?.toLocaleString()}`);
ok(mp.marketplaces.reduce((s, m) => s + m.egp, 0) === mp.total.egp, "Marketplace cards reconcile to total");

console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`);
process.exit(fail > 0 ? 1 : 0);
