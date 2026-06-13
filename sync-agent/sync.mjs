import sql from "mssql";
import pg from "pg";

const NAV = {
  server: "164.160.104.73",
  port: 1433,
  database: "ReplitReports",
  user: "replit_user",
  password: "Re$%User12",
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

const PG_URL =
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const INTERVAL_MIN = 5;
const FX_EVERY_N_RUNS = 144;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function ensureTables(pgc) {
  await pgc.query(`
    CREATE TABLE IF NOT EXISTS nav_sales (
      id SERIAL PRIMARY KEY,
      posting_date DATE NOT NULL,
      document_type TEXT NOT NULL,
      sales_amount NUMERIC NOT NULL,
      invoiced_qty NUMERIC NOT NULL,
      item_no TEXT NOT NULL,
      store_code TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nav_sales_date ON nav_sales (posting_date);
    CREATE INDEX IF NOT EXISTS idx_nav_sales_item ON nav_sales (item_no);
    CREATE INDEX IF NOT EXISTS idx_nav_sales_store ON nav_sales (store_code);

    CREATE TABLE IF NOT EXISTS nav_items (
      item_no TEXT PRIMARY KEY,
      description TEXT,
      search_description TEXT,
      category_code TEXT,
      product_group TEXT,
      unit_price NUMERIC,
      unit_cost NUMERIC,
      blocked BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS fx_rates (
      week_start DATE PRIMARY KEY,
      egp_per_usd NUMERIC NOT NULL,
      source TEXT DEFAULT 'yahoo',
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

async function syncSales(navPool, pgc) {
  const { recordset } = await navPool.request().query(
    `SELECT PostingDate, DocumentType, SalesAmount, InvoicedQty, ItemNo, StoreCode FROM ValueEntries`
  );
  await pgc.query("BEGIN");
  try {
    await pgc.query("TRUNCATE nav_sales");
    const batchSize = 500;
    for (let i = 0; i < recordset.length; i += batchSize) {
      const batch = recordset.slice(i, i + batchSize);
      const values = [];
      const params = [];
      batch.forEach((r, j) => {
        const base = j * 6;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
        params.push(r.PostingDate, r.DocumentType, r.SalesAmount, r.InvoicedQty, r.ItemNo, r.StoreCode);
      });
      await pgc.query(
        `INSERT INTO nav_sales (posting_date, document_type, sales_amount, invoiced_qty, item_no, store_code)
         VALUES ${values.join(",")}`,
        params
      );
    }
    await pgc.query("COMMIT");
    log(`sales: full refresh, ${recordset.length} rows`);
  } catch (e) {
    await pgc.query("ROLLBACK");
    throw e;
  }
}

async function syncItemsFromSql(navPool, pgc) {
  try {
    const { recordset } = await navPool.request().query(
      `SELECT * FROM Items`
    );
    if (!recordset.length) return;
    const cols = Object.keys(recordset[0]);
    const pick = (row, names) => {
      for (const n of names) {
        const c = cols.find((c) => c.toLowerCase().replace(/[^a-z]/g, "") === n);
        if (c && row[c] != null) return row[c];
      }
      return null;
    };
    for (const row of recordset) {
      const itemNo = pick(row, ["itemno", "no"]);
      if (!itemNo) continue;
      await pgc.query(
        `INSERT INTO nav_items (item_no, description, search_description, category_code, product_group, unit_price, unit_cost, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (item_no) DO UPDATE SET
           description=EXCLUDED.description, search_description=EXCLUDED.search_description,
           category_code=EXCLUDED.category_code, product_group=EXCLUDED.product_group,
           unit_price=EXCLUDED.unit_price, unit_cost=EXCLUDED.unit_cost, updated_at=now()`,
        [
          String(itemNo),
          pick(row, ["description"]),
          pick(row, ["searchdescription", "description2"]),
          pick(row, ["itemcategorycode", "categorycode", "category"]),
          pick(row, ["productgroupcode", "productgroup"]),
          pick(row, ["unitprice"]),
          pick(row, ["unitcost"]),
        ]
      );
    }
    log(`items: ${recordset.length} synced from Items view`);
  } catch (e) {
    if (/Invalid object name/i.test(e.message)) {
      log("items: Items view not yet available in ReplitReports (waiting on IT)");
    } else {
      throw e;
    }
  }
}

async function syncFxRates(pgc) {
  const { rows } = await pgc.query("SELECT COUNT(*) n, MAX(week_start) latest FROM fx_rates");
  const haveRows = parseInt(rows[0].n) > 0;
  const upToDate =
    haveRows && rows[0].latest && Date.now() - new Date(rows[0].latest).getTime() < 6 * 86400000;
  if (upToDate) return;

  const period1 = Math.floor(new Date("2019-08-01").getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/EGP=X?period1=${period1}&period2=${period2}&interval=1wk`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error("FX: unexpected Yahoo response");
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  let upserted = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const weekStart = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    await pgc.query(
      `INSERT INTO fx_rates (week_start, egp_per_usd, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (week_start) DO UPDATE SET egp_per_usd=$2, updated_at=now()`,
      [weekStart, closes[i]]
    );
    upserted++;
  }
  log(`fx: ${upserted} weekly EGP/USD rates loaded`);
}

async function runOnce(runCount) {
  const navPool = await new sql.ConnectionPool(NAV).connect();
  const pgc = new pg.Client({ connectionString: PG_URL });
  await pgc.connect();
  try {
    await ensureTables(pgc);
    await syncSales(navPool, pgc);
    await syncItemsFromSql(navPool, pgc);
    if (runCount % FX_EVERY_N_RUNS === 0) {
      await syncFxRates(pgc).catch((e) => log(`fx error (non-fatal): ${e.message}`));
    }
    await pgc.query(
      `INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync', $1, now())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
      [new Date().toISOString()]
    );
    log("sync complete");
  } finally {
    await navPool.close();
    await pgc.end();
  }
}

const once = process.argv.includes("--once");
let runCount = 0;

if (once) {
  runOnce(0).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  log(`starting sync loop, every ${INTERVAL_MIN} min`);
  const tick = async () => {
    try {
      await runOnce(runCount++);
    } catch (e) {
      log(`SYNC ERROR: ${e.message}`);
    }
  };
  tick();
  setInterval(tick, INTERVAL_MIN * 60 * 1000);
}
