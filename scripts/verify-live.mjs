import { EncryptJWT } from "jose";
import hkdf from "@panva/hkdf";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const secret = process.env.NEXTAUTH_SECRET;
if (!secret) { console.error("no NEXTAUTH_SECRET"); process.exit(2); }
const key = await hkdf("sha256", secret, "", "NextAuth.js Generated Encryption Key", 32);
const token = await new EncryptJWT({ name: "v", email: "v@local", role: "admin" })
  .setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setExpirationTime("1h").setJti(randomUUID()).encrypt(key);
const COOKIE = `next-auth.session-token=${token}`;
const BASE = "http://localhost:3000";
const get = async (p) => (await fetch(BASE + p, { headers: { cookie: COOKIE } })).json();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

async function check(label, qs) {
  const d = await get(`/api/live${qs}`);
  const sum = d.stores.reduce((a, s) => a + s.egp, 0);
  console.log(`\n── ${label}  (${d.from} → ${d.to}, ${d.rangeDays}d) ──`);
  console.log("   sources:", JSON.stringify(d.sources), "| prev:", d.prevFrom, "→", d.prevTo, "=", d.prevTotal.toLocaleString());
  for (const s of d.stores) console.log(`   ${s.code.padEnd(7)} EGP ${String(Math.round(s.egp).toLocaleString()).padStart(12)}  ${s.units}u`);
  console.log(`   TOTAL EGP ${Math.round(d.total.egp).toLocaleString()} | ${d.total.units}u | ${d.stores.length} bars | reconcile bars==total: ${sum === d.total.egp ? "✓" : "✗ " + sum}`);
  return d;
}

const today = await check("TODAY (default, no params)", "");
await check("LAST 7 DAYS", `?from=${daysAgo(6)}&to=${iso(new Date())}`);
const past = await check("SINGLE PAST DAY (yesterday)", `?from=${daysAgo(1)}&to=${daysAgo(1)}`);

// prev-period sanity: yesterday's prev should be the day before (1 day)
console.log("\n   prev-period check (yesterday):", past.prevFrom === daysAgo(2) && past.prevTo === daysAgo(2) ? "✓ day-before" : `✗ ${past.prevFrom}..${past.prevTo}`);

// drill with range param
const retail = today.stores.find(s => s.code !== "ECOM");
if (retail) {
  const dr = await get(`/api/drill?type=store-brand&store=${retail.code}&from=${daysAgo(6)}&to=${iso(new Date())}`);
  console.log(`\n── store-brand drill ${retail.code} over 7d: ${dr.rows ? dr.rows.length + " brands ✓" : "ERR " + JSON.stringify(dr).slice(0,120)}`);
  if (dr.rows) for (const r of dr.rows) console.log(`   ${String(r.brand).padEnd(20)} EGP ${r.egp.toLocaleString()}  ${r.pct}%`);
}
