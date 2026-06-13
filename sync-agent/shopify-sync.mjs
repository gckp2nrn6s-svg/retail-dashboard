#!/usr/bin/env node
/**
 * Shopify → Railway sync
 * Pulls all paid/fulfilled orders from both stores into shopify_sales table.
 * Run mode:
 *   --full   : truncate + reload all history
 *   (default): incremental — only fetch since last synced order
 */

import pg from "pg";

const STORES = [
  {
    name: "american-tourister-egypt",
    handle: "american-tourister-egypt",
    token: "process.env.SHOPIFY_AMT_TOKEN",
    store_code: "SHOPIFY-AMT",
  },
  {
    name: "samsonite-eg-globosoft",
    handle: "samsonite-eg-globosoft",
    token: "process.env.SHOPIFY_SAM_TOKEN",
    store_code: "SHOPIFY-SAM",
  },
];

const DB_URL = process.env.DATABASE_URL ||
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const FULL = process.argv.includes("--full");

const pool = new pg.Pool({ connectionString: DB_URL, max: 3 });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_sales (
      id              BIGSERIAL PRIMARY KEY,
      order_id        BIGINT NOT NULL,
      store_code      TEXT NOT NULL,
      shopify_store   TEXT NOT NULL,
      order_number    TEXT,
      created_at      TIMESTAMPTZ NOT NULL,
      sale_date       DATE NOT NULL,
      financial_status TEXT,
      fulfillment_status TEXT,
      line_item_id    BIGINT,
      product_id      BIGINT,
      variant_id      BIGINT,
      sku             TEXT,
      product_title   TEXT,
      variant_title   TEXT,
      quantity        INT,
      unit_price      NUMERIC,
      line_total      NUMERIC,
      discount        NUMERIC,
      currency        TEXT DEFAULT 'EGP',
      UNIQUE(order_id, line_item_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS shopify_date_idx  ON shopify_sales(sale_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS shopify_store_idx ON shopify_sales(store_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS shopify_sku_idx   ON shopify_sales(sku)`);
}

async function getLastSync(storeHandle) {
  const { rows } = await pool.query(
    `SELECT MAX(created_at) AS last FROM shopify_sales WHERE shopify_store = $1`,
    [storeHandle]
  );
  return rows[0]?.last || null;
}

async function fetchAndUpsertChunk(store, fromDate, toDate) {
  const base = `https://${store.handle}.myshopify.com/admin/api/2024-01`;
  const headers = { "X-Shopify-Access-Token": store.token };
  const fields = "id,order_number,created_at,financial_status,fulfillment_status,line_items,total_discounts";

  let url = `${base}/orders.json?status=any&limit=250&order=created_at+asc&fields=${fields}`
    + `&created_at_min=${fromDate.toISOString()}&created_at_max=${toDate.toISOString()}`;

  let total = 0;
  let pageUrl = url;

  while (pageUrl) {
    let res, data;
    // retry up to 3 times
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(pageUrl, { headers });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        data = await res.json();
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }

    const orders = data.orders || [];
    const rows = ordersToRows(orders, store);
    if (rows.length) await upsertRows(rows);
    total += orders.length;

    process.stdout.write(`\r  ${store.name}: ${total} orders...`);

    const link = res.headers.get("link") || "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }
  return total;
}

function ordersToRows(orders, store) {
  const rows = [];
  for (const order of orders) {
    // Only include paid or pending (exclude refunded/voided for revenue purposes)
    if (order.financial_status === "voided") continue;

    const createdAt = new Date(order.created_at);
    const saleDate = createdAt.toISOString().slice(0, 10);

    for (const item of order.line_items || []) {
      const unitPrice = parseFloat(item.price || "0");
      const qty = parseInt(item.quantity || "0");
      const lineTotal = unitPrice * qty;
      const discount = parseFloat(item.total_discount || "0");

      rows.push([
        order.id,
        store.store_code,
        store.handle,
        String(order.order_number || order.id),
        createdAt.toISOString(),
        saleDate,
        order.financial_status,
        order.fulfillment_status || "unfulfilled",
        item.id,
        item.product_id,
        item.variant_id,
        item.sku || null,
        item.title,
        item.variant_title || null,
        qty,
        unitPrice,
        lineTotal,
        discount,
        "EGP",
      ]);
    }
  }
  return rows;
}

async function upsertRows(rows) {
  if (!rows.length) return 0;
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vals = chunk.map((_, j) => {
      const b = j * 19;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19})`;
    }).join(",");
    await pool.query(`
      INSERT INTO shopify_sales
        (order_id,store_code,shopify_store,order_number,created_at,sale_date,
         financial_status,fulfillment_status,line_item_id,product_id,variant_id,
         sku,product_title,variant_title,quantity,unit_price,line_total,discount,currency)
      VALUES ${vals}
      ON CONFLICT (order_id, line_item_id) DO UPDATE SET
        financial_status   = EXCLUDED.financial_status,
        fulfillment_status = EXCLUDED.fulfillment_status,
        unit_price         = EXCLUDED.unit_price,
        line_total         = EXCLUDED.line_total,
        discount           = EXCLUDED.discount
    `, chunk.flat());
    inserted += chunk.length;
  }
  return inserted;
}

async function main() {
  console.log(`Shopify sync — ${FULL ? "FULL reload" : "incremental"}`);
  await ensureTable();

  if (FULL) {
    console.log("Truncating shopify_sales...");
    await pool.query("TRUNCATE shopify_sales RESTART IDENTITY");
  }

  for (const store of STORES) {
    console.log(`\n── ${store.name} (${store.store_code})`);

    const lastSync = FULL ? null : await getLastSync(store.handle);
    const startDate = lastSync
      ? new Date(new Date(lastSync).getTime() - 3600000)
      : new Date("2025-01-01T00:00:00Z");
    const endDate = new Date();

    console.log(`  From: ${startDate.toISOString().slice(0,10)} → ${endDate.toISOString().slice(0,10)}`);

    // Fetch in 30-day chunks to avoid timeouts
    let chunkStart = new Date(startDate);
    let totalOrders = 0;
    while (chunkStart < endDate) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + 30 * 86400000, endDate.getTime()));
      const n = await fetchAndUpsertChunk(store, chunkStart, chunkEnd);
      totalOrders += n;
      chunkStart = chunkEnd;
    }
    console.log(`\n  Total: ${totalOrders} orders`);
  }

  // Summary
  const { rows: summary } = await pool.query(`
    SELECT store_code,
           COUNT(DISTINCT order_id) AS orders,
           SUM(line_total - discount)::numeric AS revenue,
           MIN(sale_date) AS first_sale,
           MAX(sale_date) AS last_sale
    FROM shopify_sales
    GROUP BY store_code ORDER BY revenue DESC
  `);
  console.log("\nShopify summary:");
  console.table(summary);

  await pool.end();
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
