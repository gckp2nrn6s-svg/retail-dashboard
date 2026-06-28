// Warehousing module schema. Idempotent — safe to re-run.
import pg from "pg";
import { readFileSync } from "fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// warehouse_stock becomes the live HO balance the module maintains
// (in_stock = on hand, quantity = cumulative in, out_qty = cumulative out).
// Need a unique item_no for upserts.
const dupes = (await c.query(`SELECT item_no, COUNT(*) n FROM warehouse_stock GROUP BY item_no HAVING COUNT(*) > 1`)).rows;
if (dupes.length) {
  console.log(`⚠ warehouse_stock has ${dupes.length} duplicate item_no values — collapsing (sum qty, keep first description)…`);
  await c.query(`
    WITH agg AS (
      SELECT item_no,
             SUM(quantity) quantity, SUM(out_qty) out_qty, SUM(in_stock) in_stock,
             MAX(unit_price) unit_price,
             (ARRAY_AGG(description ORDER BY (description IS NULL), description))[1] description,
             (ARRAY_AGG(brand ORDER BY (brand IS NULL)))[1] brand,
             (ARRAY_AGG(item_group ORDER BY (item_group IS NULL)))[1] item_group
      FROM warehouse_stock GROUP BY item_no
    )
    DELETE FROM warehouse_stock; INSERT INTO warehouse_stock (item_no,quantity,out_qty,in_stock,unit_price,description,brand,item_group)
    SELECT item_no,quantity,out_qty,in_stock,unit_price,description,brand,item_group FROM agg;
  `).catch(async e => { console.log("dedupe via single stmt failed, doing two-step:", e.message);
    const agg = (await c.query(`SELECT item_no, SUM(quantity) quantity, SUM(out_qty) out_qty, SUM(in_stock) in_stock, MAX(unit_price) unit_price, (ARRAY_AGG(description ORDER BY (description IS NULL)))[1] description, (ARRAY_AGG(brand ORDER BY (brand IS NULL)))[1] brand, (ARRAY_AGG(item_group ORDER BY (item_group IS NULL)))[1] item_group FROM warehouse_stock GROUP BY item_no`)).rows;
    await c.query("DELETE FROM warehouse_stock");
    for (const r of agg) await c.query(`INSERT INTO warehouse_stock (item_no,quantity,out_qty,in_stock,unit_price,description,brand,item_group) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [r.item_no, r.quantity, r.out_qty, r.in_stock, r.unit_price, r.description, r.brand, r.item_group]);
  });
}
await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS warehouse_stock_item_no_uq ON warehouse_stock(item_no)`);
console.log("✓ warehouse_stock.item_no unique");

// Incoming receipts (factory / outside)
await c.query(`CREATE TABLE IF NOT EXISTS wh_receipts (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,            -- 'factory' | 'outside'
  reference  text,
  note       text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
)`);
await c.query(`CREATE TABLE IF NOT EXISTS wh_receipt_lines (
  id         serial PRIMARY KEY,
  receipt_id int NOT NULL REFERENCES wh_receipts(id) ON DELETE CASCADE,
  item_no    text NOT NULL,
  qty        numeric NOT NULL
)`);
console.log("✓ wh_receipts / wh_receipt_lines ready");

const n = (await c.query(`SELECT COUNT(*) n, COALESCE(SUM(in_stock),0) units FROM warehouse_stock`)).rows[0];
console.log(`warehouse_stock: ${n.n} items, ${Math.round(n.units)} units on hand`);
await c.end();
