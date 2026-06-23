// Load the CEO customer list (code → name) into Postgres b2b_customers.
// Re-runnable: upserts. Source JSON produced from the xlsx by the exploration step,
// or pass an xlsx path to (re)build it via pandas.
import pg from "pg";
import { readFileSync } from "fs";
import { execSync } from "child_process";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const xlsx = process.argv[2];
let map;
if (xlsx) {
  const py = `
import pandas as pd, json
df = pd.read_excel(${JSON.stringify(xlsx)}, sheet_name=0, header=0, dtype=str)
df = df[df['No.'].notna()]
print(json.dumps({str(r['No.']).strip(): str(r['Name']).strip() for _, r in df.iterrows()}, ensure_ascii=False))
`;
  map = JSON.parse(execSync(`python3 -c ${JSON.stringify(py)}`, { maxBuffer: 1 << 24 }).toString());
} else {
  map = JSON.parse(readFileSync("/tmp/customer_map.json", "utf8"));
}

const entries = Object.entries(map).filter(([code, name]) => code && code !== "nan" && name && name !== "nan");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`CREATE TABLE IF NOT EXISTS b2b_customers (code text PRIMARY KEY, name text NOT NULL)`);

let n = 0;
for (let i = 0; i < entries.length; i += 200) {
  const chunk = entries.slice(i, i + 200);
  const vals = [], tuples = []; let p = 1;
  for (const [code, name] of chunk) { tuples.push(`($${p++},$${p++})`); vals.push(code, name); }
  await c.query(`INSERT INTO b2b_customers (code, name) VALUES ${tuples.join(",")} ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`, vals);
  n += chunk.length;
}
const { rows } = await c.query(`SELECT COUNT(*) AS n FROM b2b_customers`);
console.log(`imported/updated ${n} customers; b2b_customers now has ${rows[0].n} rows`);
await c.end();
