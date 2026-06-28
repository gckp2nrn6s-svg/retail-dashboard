// Manual stock-adjustment audit tables. Idempotent — safe to re-run.
import pg from "pg";
import { readFileSync } from "fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

await c.query(`CREATE TABLE IF NOT EXISTS wh_adjustments (
  id         serial PRIMARY KEY,
  direction  text NOT NULL,            -- 'add' | 'deduct'
  reason     text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
)`);
await c.query(`CREATE TABLE IF NOT EXISTS wh_adjustment_lines (
  id            serial PRIMARY KEY,
  adjustment_id int NOT NULL REFERENCES wh_adjustments(id) ON DELETE CASCADE,
  item_no       text NOT NULL,
  qty           numeric NOT NULL,      -- always positive; direction carries the sign
  before_qty    numeric,              -- in_stock before the change
  after_qty     numeric               -- in_stock after the change
)`);
console.log("✓ wh_adjustments / wh_adjustment_lines ready");
await c.end();
