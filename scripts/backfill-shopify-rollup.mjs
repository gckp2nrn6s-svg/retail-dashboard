#!/usr/bin/env node
/**
 * One-time seed for the shopify_daily rollup (the perf fix for long date ranges).
 * Fetches all Shopify history once and writes per-day, per-brand NET revenue so the
 * dashboard reads aggregates from Postgres instead of paginating thousands of live
 * orders on every load. Safe to re-run (UPSERT). Run against the shared Neon DB:
 *   node scripts/backfill-shopify-rollup.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// brand key must match the app (ShopifyStore): "samsonite" | "american-tourister"
const STORES = [
  { brand: "samsonite",          handle: "samsonite-eg-globosoft",   token: process.env.SHOPIFY_SAM_TOKEN || process.env.SHOPIFY_SAMSONITE_TOKEN },
  { brand: "american-tourister", handle: "american-tourister-egypt", token: process.env.SHOPIFY_AMT_TOKEN || process.env.SHOPIFY_AT_TOKEN },
];

const DAY = 86400000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const egDay  = (iso) => isoDay(new Date(new Date(iso).getTime() + 3 * 3600 * 1000));
const addDays = (day, n) => isoDay(new Date(Date.parse(day + "T00:00:00Z") + n * DAY));
const netTotal = (o) => parseFloat(o.current_total_price ?? o.total_price);

async function fetchRange(handle, token, from, to) {
  let url = `https://${handle}.myshopify.com/admin/api/2024-01/orders.json?status=any&created_at_min=${from}T00:00:00%2B03:00&created_at_max=${to}T23:59:59%2B03:00&limit=250&fields=created_at,financial_status,total_price,current_total_price,line_items`;
  const all = [];
  while (url) {
    const r = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!r.ok) throw new Error(`${handle} HTTP ${r.status}`);
    const j = await r.json();
    all.push(...(j.orders ?? []).filter(o => o.financial_status !== "voided" && o.financial_status !== "refunded"));
    const m = (r.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return all;
}

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_daily (
    sale_date date NOT NULL, brand text NOT NULL,
    egp numeric(14,2) NOT NULL DEFAULT 0, units integer NOT NULL DEFAULT 0,
    built_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (sale_date, brand))`);

  const today = isoDay(new Date());
  // backfill from the first Shopify order month through yesterday (today stays live)
  let monthStart = "2025-06-01";
  const stopBefore = today; // we'll clamp the last month's end to yesterday
  let totalRows = 0;
  while (monthStart < stopBefore) {
    const d = new Date(monthStart + "T00:00:00Z");
    const next = isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    const monthEnd = next > stopBefore ? addDays(today, -1) : addDays(next, -1);
    if (monthEnd < monthStart) break;

    const agg = {}; // `${day}|${brand}` -> {egp,units}
    for (const s of STORES) {
      const orders = await fetchRange(s.handle, s.token, monthStart, monthEnd);
      for (const o of orders) {
        const k = `${egDay(o.created_at)}|${s.brand}`;
        (agg[k] ??= { egp: 0, units: 0 });
        agg[k].egp += netTotal(o);
        agg[k].units += (o.line_items || []).reduce((t, i) => t + i.quantity, 0);
      }
    }
    // complete grid for the month
    const tuples = [], vals = []; let i = 1;
    for (let day = monthStart; day <= monthEnd; day = addDays(day, 1)) {
      for (const s of STORES) {
        const a = agg[`${day}|${s.brand}`] ?? { egp: 0, units: 0 };
        tuples.push(`($${i++},$${i++},$${i++},$${i++},now())`);
        vals.push(day, s.brand, Math.round(a.egp * 100) / 100, Math.round(a.units));
      }
    }
    if (tuples.length) {
      await pool.query(
        `INSERT INTO shopify_daily (sale_date,brand,egp,units,built_at) VALUES ${tuples.join(",")}
         ON CONFLICT (sale_date,brand) DO UPDATE SET egp=EXCLUDED.egp, units=EXCLUDED.units, built_at=now()`,
        vals,
      );
      totalRows += tuples.length;
    }
    const monthEgp = Object.values(agg).reduce((t, v) => t + v.egp, 0);
    console.log(`  ${monthStart}..${monthEnd}: ${Math.round(monthEgp).toLocaleString()} EGP across ${tuples.length} rows`);
    monthStart = next;
  }
  console.log(`✓ rollup seeded: ${totalRows} day×brand rows.`);
  await pool.end();
}
main().catch(e => { console.error("backfill error:", e.message); pool.end(); process.exit(1); });
