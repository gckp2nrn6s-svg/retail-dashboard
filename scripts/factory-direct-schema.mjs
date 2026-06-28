// Factory-direct sales (live Google Sheet) — storage + sync metadata. Idempotent.
import pg from "pg";
import { readFileSync } from "fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// One row per invoice LINE (item) from the sheet. Replaced wholesale on each sync
// (the sheet is the source of truth), so no upsert key is needed.
await c.query(`CREATE TABLE IF NOT EXISTS factory_direct_sales (
  id          serial PRIMARY KEY,
  invoice_no  text,
  sale_date   date,
  po          text,
  client      text,            -- raw client name from the sheet
  client_key  text,            -- normalized (upper, trimmed) for grouping
  branch      text,
  model       text,
  sku         text,
  description text,
  qty         numeric,
  unit_price  numeric,
  total_btax  numeric,         -- ex-VAT
  tax         numeric,
  total_sales numeric          -- incl. VAT  (the figure that feeds B2B)
)`);
await c.query(`CREATE INDEX IF NOT EXISTS factory_direct_sales_date ON factory_direct_sales(sale_date)`);
await c.query(`CREATE INDEX IF NOT EXISTS factory_direct_sales_clientkey ON factory_direct_sales(client_key)`);

// Single-row sync log (id=1).
await c.query(`CREATE TABLE IF NOT EXISTS factory_direct_sync (
  id         int PRIMARY KEY DEFAULT 1,
  synced_at  timestamptz,
  rows       int,
  total_egp  numeric,
  ok         boolean,
  note       text
)`);
await c.query(`INSERT INTO factory_direct_sync (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

console.log("✓ factory_direct_sales / factory_direct_sync ready");
await c.end();
