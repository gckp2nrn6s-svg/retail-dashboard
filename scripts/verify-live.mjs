import { EncryptJWT } from "jose";
import hkdf from "@panva/hkdf";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

// load .env.local
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

const live = await get("/api/live");
console.log("── /api/live ──");
console.log("sources:", JSON.stringify(live.sources), "degraded:", live.degraded);
console.log("today:", live.today, "| yesterday total:", live.yesterdayTotal?.toLocaleString());
for (const s of live.stores) console.log(`  ${s.code.padEnd(7)} ${s.name.padEnd(22)} EGP ${String(Math.round(s.egp).toLocaleString()).padStart(12)}  ${s.units} units`);
console.log("  TOTAL:".padEnd(32), "EGP", Math.round(live.total.egp).toLocaleString(), "|", live.total.units, "units |", live.stores.length, "bars");

// reconcile: bars sum to total?
const sum = live.stores.reduce((a, s) => a + s.egp, 0);
console.log("  reconcile bars==total:", sum === live.total.egp ? "✓" : `✗ (${sum} vs ${live.total.egp})`);

// drill the top retail store (skip ECOM) into brands
const retail = live.stores.find(s => s.code !== "ECOM");
if (retail) {
  const d = await get(`/api/drill?type=store-brand&store=${encodeURIComponent(retail.code)}&from=${live.today}&to=${live.today}`);
  console.log(`\n── store-brand drill: ${retail.code} ──`);
  if (d.rows) { for (const r of d.rows) console.log(`  ${String(r.brand).padEnd(22)} EGP ${String(r.egp.toLocaleString()).padStart(12)}  ${r.units}u  ${r.skus} SKUs  ${r.pct}%`); const ds = d.rows.reduce((a,r)=>a+r.egp,0); console.log("  brand sum:", ds.toLocaleString(), "vs store bar:", Math.round(retail.egp).toLocaleString(), ds===Math.round(retail.egp)?"✓":"(rounding)"); }
  else console.log("  drill error:", JSON.stringify(d).slice(0,200));
}

// ecom drill
const ecomDrill = await get(`/api/drill?type=channel&channel=Ecom&from=${live.today}&to=${live.today}`);
console.log("\n── ecom channel drill rows:", ecomDrill.rows?.length ?? "ERR", ecomDrill.rows ? "✓" : JSON.stringify(ecomDrill).slice(0,150));
