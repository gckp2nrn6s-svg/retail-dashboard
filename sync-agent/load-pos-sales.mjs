#!/usr/bin/env node
// One-time (and re-runnable) loader for store POS sales from Excel export
// Usage: node load-pos-sales.mjs <path-to-xlsx>

import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from "xlsx";

const FILE = process.argv[2] || "/Users/sherif/Downloads/Transaction Sales Entries CEO 2026-06-13T08_48_20.xlsx";

// Map POS terminal code → store code used in the rest of the dashboard
const TERMINAL_TO_STORE = {
  CCA1: "CCA",
  ALM:  "ALMAZA",
  P901: "P90",
  HS01: "CF-HOS",
  CS01: "CSTARS",
  ONL:  "ONLINE",
  MOE1: "MOE",
  MOA1: "MOA",
  ATM1: "ATMADI",
  ATC1: "ATCFC",
  HIS1: "HIS",
  EVE:  "EVE",
};

const DB_URL = process.env.DATABASE_URL ||
  "postgresql://postgres:lSOomhHJCIAdInRRhqyMiMKzuYxJLWXF@66.33.22.226:5432/railway";

const pool = new pg.Pool({ connectionString: DB_URL, max: 5 });

async function main() {
  console.log("Reading:", FILE);
  const wb = xlsx.readFile(FILE, { cellDates: true, dense: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { raw: false, defval: null });
  console.log(`Parsed ${rows.length} rows`);

  // Create table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_sales (
      id              BIGSERIAL PRIMARY KEY,
      transaction_no  BIGINT,
      receipt_no      TEXT,
      item_no         TEXT,
      item_desc       TEXT,
      pos_terminal    TEXT,
      store_code      TEXT,
      sale_date       DATE,
      sale_time       TEXT,
      quantity        NUMERIC,
      price           NUMERIC,
      net_amount      NUMERIC,
      discount_amount NUMERIC,
      vat_amount      NUMERIC,
      staff_id        TEXT
    )
  `);

  // Add index helpers
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_sales_store ON pos_sales(store_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_sales_date  ON pos_sales(sale_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_sales_item  ON pos_sales(item_no)`);

  // Truncate and reload for idempotency
  console.log("Truncating pos_sales...");
  await pool.query("TRUNCATE pos_sales RESTART IDENTITY");

  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 1;

    for (const r of chunk) {
      const terminal = r["POS Terminal No."] || "";
      const storeCode = TERMINAL_TO_STORE[terminal] || terminal;

      // Parse date — xlsx returns string like "2019-06-03" when cellDates:true
      let saleDate = null;
      if (r["Date"]) {
        const d = new Date(r["Date"]);
        if (!isNaN(d)) saleDate = d.toISOString().slice(0, 10);
      }

      values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13})`);
      params.push(
        r["Transaction No."] || null,
        r["Receipt No."] || null,
        r["Item No."] || null,
        r["Item Desc"] || r["Item Description"] || null,
        terminal,
        storeCode,
        saleDate,
        r["Time"] || null,
        r["Quantity"] !== null && r["Quantity"] !== undefined ? parseFloat(r["Quantity"]) : null,
        r["Price"] !== null ? parseFloat(r["Price"]) : null,
        r["Net Amount"] !== null ? parseFloat(r["Net Amount"]) : null,
        r["Discount Amount"] !== null ? parseFloat(r["Discount Amount"]) : null,
        r["VAT Amount"] !== null ? parseFloat(r["VAT Amount"]) : null,
        r["Staff ID"] || null,
      );
      p += 14;
    }

    await pool.query(
      `INSERT INTO pos_sales (transaction_no,receipt_no,item_no,item_desc,pos_terminal,store_code,sale_date,sale_time,quantity,price,net_amount,discount_amount,vat_amount,staff_id)
       VALUES ${values.join(",")}`,
      params
    );
    inserted += chunk.length;
    if (inserted % 10000 === 0) process.stdout.write(`  ${inserted}/${rows.length}\r`);
  }

  console.log(`\nInserted ${inserted} rows into pos_sales`);

  // Quick sanity check
  const { rows: stats } = await pool.query(`
    SELECT
      store_code,
      COUNT(*) as rows,
      MIN(sale_date) as first_date,
      MAX(sale_date) as last_date,
      ROUND(SUM(CASE WHEN quantity < 0 THEN -net_amount ELSE 0 END)) as revenue_egp
    FROM pos_sales
    WHERE quantity < 0
    GROUP BY store_code
    ORDER BY revenue_egp DESC
  `);
  console.log("\nStore summary (sales rows):");
  console.table(stats);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
