import pg from "pg";
import { execSync } from "child_process";
import { existsSync } from "fs";

const PG_URL =
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("Usage: node import-warehouse.mjs <path-to-stock.xlsx>");
  process.exit(1);
}

const py = `
import pandas as pd, json, sys
df = pd.read_excel(sys.argv[1], sheet_name='Report')
df = df[df['Item'].notna()].copy()
df['Item'] = df['Item'].astype(str).str.replace(r'\\.0$', '', regex=True).str.strip()
df = df.rename(columns={'in Stock':'in_stock','U.Price':'unit_price'})
cols = ['Item','Quantity','Out','in_stock','unit_price','Description','Category','Group']
df = df[cols]
df = df.where(pd.notna(df), None)
print(df.to_json(orient='records'))
`;

const json = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}' '${file}'`, {
  maxBuffer: 50 * 1024 * 1024,
}).toString();
const rows = JSON.parse(json);
console.log(`parsed ${rows.length} rows from ${file}`);

const pgc = new pg.Client({ connectionString: PG_URL });
await pgc.connect();

await pgc.query(`
  CREATE TABLE IF NOT EXISTS warehouse_stock (
    item_no TEXT PRIMARY KEY,
    quantity NUMERIC,
    out_qty NUMERIC,
    in_stock NUMERIC,
    unit_price NUMERIC,
    description TEXT,
    brand TEXT,
    item_group TEXT,
    snapshot_date DATE,
    updated_at TIMESTAMPTZ DEFAULT now()
  );
`);

const snapshotDate = (file.match(/(\d{2})-(\d{2})-(\d{4})/) || []).slice(1);
const snapDate = snapshotDate.length === 3 ? `${snapshotDate[2]}-${snapshotDate[1]}-${snapshotDate[0]}` : new Date().toISOString().slice(0, 10);

const clean = [];
const seen = new Set();
for (const r of rows) {
  if (!r.Item || seen.has(r.Item)) continue;
  seen.add(r.Item);
  const price = typeof r.unit_price === "number" ? r.unit_price : parseFloat(String(r.unit_price).replace(/[^0-9.]/g, "")) || null;
  clean.push([r.Item, r.Quantity, r.Out, r.in_stock, price, r.Description, r.Category, r.Group, snapDate]);
}

await pgc.query("BEGIN");
try {
  await pgc.query("TRUNCATE warehouse_stock");
  const batchSize = 200;
  for (let i = 0; i < clean.length; i += batchSize) {
    const batch = clean.slice(i, i + batchSize);
    const values = batch.map((_, j) => {
      const b = j * 9;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });
    await pgc.query(
      `INSERT INTO warehouse_stock (item_no, quantity, out_qty, in_stock, unit_price, description, brand, item_group, snapshot_date)
       VALUES ${values.join(",")}`,
      batch.flat()
    );
  }
  const withDesc = clean.filter((r) => r[5]);
  for (let i = 0; i < withDesc.length; i += batchSize) {
    const batch = withDesc.slice(i, i + batchSize);
    const values = batch.map((_, j) => {
      const b = j * 5;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},now())`;
    });
    await pgc.query(
      `INSERT INTO nav_items (item_no, description, category_code, product_group, unit_price, updated_at)
       VALUES ${values.join(",")}
       ON CONFLICT (item_no) DO UPDATE SET description=EXCLUDED.description, category_code=EXCLUDED.category_code,
         product_group=EXCLUDED.product_group, unit_price=EXCLUDED.unit_price, updated_at=now()`,
      batch.map((r) => [r[0], r[5], r[6], r[7], r[4]]).flat()
    );
  }
  await pgc.query("COMMIT");
  console.log(`imported ${clean.length} items, snapshot date ${snapDate}`);
} catch (e) {
  await pgc.query("ROLLBACK");
  throw e;
} finally {
  await pgc.end();
}
