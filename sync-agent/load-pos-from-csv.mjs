#!/usr/bin/env node
// Load POS sales CSV into Railway PostgreSQL
import pg from "pg";
import fs from "fs";
import { createInterface } from "readline";

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
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const CSV = process.argv[2] || "/tmp/pos_sales.csv";

const pool = new pg.Pool({ connectionString: DB_URL, max: 5 });

function parseCsv(line) {
  const fields = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { fields.push(cur); cur = ""; continue; }
    cur += c;
  }
  fields.push(cur);
  return fields;
}

async function main() {
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
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_store_idx ON pos_sales(store_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_date_idx  ON pos_sales(sale_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_item_idx  ON pos_sales(item_no)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pos_store_date_idx ON pos_sales(store_code, sale_date)`);

  console.log("Truncating pos_sales...");
  await pool.query("TRUNCATE pos_sales RESTART IDENTITY");

  const rl = createInterface({ input: fs.createReadStream(CSV), crlfDelay: Infinity });
  let headers = null;
  let buf = [];
  let total = 0;

  async function flush() {
    if (!buf.length) return;
    const placeholders = buf.map((_, i) => {
      const b = i * 14;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14})`;
    }).join(",");
    const params = buf.flat();
    await pool.query(
      `INSERT INTO pos_sales(transaction_no,receipt_no,item_no,item_desc,pos_terminal,store_code,sale_date,sale_time,quantity,price,net_amount,discount_amount,vat_amount,staff_id)
       VALUES ${placeholders}`,
      params
    );
    total += buf.length;
    if (total % 20000 === 0) process.stdout.write(`\r  ${total} rows inserted...`);
    buf = [];
  }

  for await (const line of rl) {
    if (!headers) { headers = parseCsv(line); continue; }
    const f = parseCsv(line);
    // Columns (0-indexed from Excel):
    // 0=Transaction No, 1=Transaction Code, 2=Receipt No, 3=Barcode No,
    // 4=Item No, 5=Item Description, ..., 9=Date, 10=Quantity, 11=Price,
    // 12=Net Amount, 13=Discount Amount, 14=VAT Amount, 15=POS Terminal,
    // 16=Staff ID, ..., 35=Item Desc
    const terminal = f[15] || "";
    const storeCode = TERMINAL_TO_STORE[terminal] || terminal;
    const n = (v) => (v === "" || v == null ? null : parseFloat(v));
    const s = (v) => (v === "" ? null : v) || null;

    buf.push([
      s(f[0]),   // transaction_no
      s(f[2]),   // receipt_no
      s(f[4]),   // item_no
      s(f[35]) || s(f[5]),  // item_desc (prefer Item Desc over Item Description)
      terminal,  // pos_terminal
      storeCode, // store_code
      s(f[9]),   // sale_date
      s(f[19]),  // sale_time
      n(f[10]),  // quantity
      n(f[11]),  // price
      n(f[12]),  // net_amount
      n(f[13]),  // discount_amount
      n(f[14]),  // vat_amount
      s(f[16]),  // staff_id
    ]);

    if (buf.length >= 500) await flush();
  }
  await flush();

  console.log(`\nTotal inserted: ${total}`);

  const { rows: stats } = await pool.query(`
    SELECT store_code,
           COUNT(*) as rows,
           MIN(sale_date) as first_sale,
           MAX(sale_date) as last_sale,
           ROUND(SUM(CASE WHEN quantity < 0 THEN -net_amount ELSE 0 END)) as revenue_egp
    FROM pos_sales
    WHERE quantity < 0
    GROUP BY store_code ORDER BY revenue_egp DESC
  `);
  console.log("\nStore breakdown:");
  console.table(stats);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
