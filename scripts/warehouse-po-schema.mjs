// Warehousing PO / transfer-flow schema. Idempotent — safe to re-run.
// Mirrors the env-loading + pg.Client pattern in scripts/warehouse-schema.mjs.
import pg from "pg";
import { readFileSync } from "fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// ── Submit / run bookkeeping ────────────────────────────────────────────────
// A "run" is one consolidation+submit action: the picked NAV transfers get
// snapshotted, the consolidated PO is recorded, and HO stock is decremented.
await c.query(`CREATE TABLE IF NOT EXISTS wh_runs (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  note       text
)`);

await c.query(`CREATE TABLE IF NOT EXISTS wh_transfers (
  id                serial PRIMARY KEY,
  run_id            int NOT NULL REFERENCES wh_runs(id) ON DELETE CASCADE,
  nav_doc_no        text,
  transfer_to       text,
  status_at_submit  text,
  stock_deducted_at timestamptz,
  paper_checked_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
)`);

await c.query(`CREATE TABLE IF NOT EXISTS wh_transfer_lines (
  id          serial PRIMARY KEY,
  transfer_id int NOT NULL REFERENCES wh_transfers(id) ON DELETE CASCADE,
  item_no     text,
  qty         numeric
)`);

await c.query(`CREATE TABLE IF NOT EXISTS wh_po_lines (
  id           serial PRIMARY KEY,
  run_id       int NOT NULL REFERENCES wh_runs(id) ON DELETE CASCADE,
  item_no      text,
  transfer_qty numeric,
  ho_qty       numeric,
  po_qty       numeric
)`);

// A submitted doc must never be offered for picking again — index the lookup.
await c.query(`CREATE INDEX IF NOT EXISTS wh_transfers_nav_doc_no_idx ON wh_transfers(nav_doc_no)`);
console.log("✓ wh_runs / wh_transfers / wh_transfer_lines / wh_po_lines ready");

// ── NAV mock tables ─────────────────────────────────────────────────────────
// The real NAV source tables (TransferLines / InventoryOnHand) do not exist yet.
// These local mirrors let the whole flow be exercised now; the lib falls back to
// them whenever navQuery throws. Shapes mirror the expected NAV columns.
await c.query(`CREATE TABLE IF NOT EXISTS nav_transfers_mock (
  doc_no        text,
  status        text,
  transfer_from text,
  transfer_to   text,
  item_no       text,
  qty           numeric,
  qty_shipped   numeric,
  qty_received  numeric,
  shipment_date date
)`);
await c.query(`CREATE TABLE IF NOT EXISTS nav_inventory_mock (
  item_no       text,
  location_code text,
  qty           numeric
)`);
console.log("✓ nav_transfers_mock / nav_inventory_mock ready");

// ── Seed mock data (only when empty, so re-runs don't pile up rows) ──────────
const seeded = Number((await c.query(`SELECT COUNT(*) n FROM nav_transfers_mock`)).rows[0].n);
if (seeded > 0) {
  console.log(`nav_transfers_mock already has ${seeded} rows — skipping seed.`);
} else {
  // Pick REAL item numbers that actually exist in warehouse_stock so PO maths is realistic.
  let items = (await c.query(`SELECT item_no FROM warehouse_stock WHERE in_stock > 0 ORDER BY in_stock DESC LIMIT 6`)).rows.map(r => r.item_no);
  if (items.length < 6) {
    const extra = (await c.query(`SELECT item_no FROM warehouse_stock ORDER BY item_no LIMIT 6`)).rows.map(r => r.item_no);
    for (const it of extra) if (!items.includes(it)) items.push(it);
  }
  if (items.length < 6) throw new Error("warehouse_stock has too few item_no values to seed mocks");
  const [A, B, C, D, E, F] = items;

  // 3 transfer docs → 3 stores, varied statuses, multiple items each.
  // TR-1001 → CF-HOS (Shipped), TR-1002 → CSTARS (Shipped), TR-1003 → ALMAZA (Open).
  const rows = [
    ["TR-1001", "Shipped", "HO", "CF-HOS", A, 50, 50, 0, "2026-06-20"],
    ["TR-1001", "Shipped", "HO", "CF-HOS", B, 30, 30, 0, "2026-06-20"],
    ["TR-1001", "Shipped", "HO", "CF-HOS", C, 20, 20, 0, "2026-06-20"],
    ["TR-1002", "Shipped", "HO", "CSTARS", B, 40, 40, 0, "2026-06-22"],
    ["TR-1002", "Shipped", "HO", "CSTARS", D, 25, 25, 0, "2026-06-22"],
    ["TR-1003", "Open",    "HO", "ALMAZA", A, 15, 0,  0, "2026-06-25"],
    ["TR-1003", "Open",    "HO", "ALMAZA", E, 60, 0,  0, "2026-06-25"],
    ["TR-1003", "Open",    "HO", "ALMAZA", F, 10, 0,  0, "2026-06-25"],
  ];
  for (const r of rows) {
    await c.query(
      `INSERT INTO nav_transfers_mock (doc_no,status,transfer_from,transfer_to,item_no,qty,qty_shipped,qty_received,shipment_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, r);
  }

  // HO on-hand for SOME of the items, so po_qty = transfer − ho is partially > 0.
  // A & B get partial HO cover; C/D/E/F have none (their full transfer qty becomes PO).
  const inv = [
    [A, "HO", 40],   // transfer 50+15=65, HO 40 → PO 25
    [B, "HO", 100],  // transfer 30+40=70, HO 100 → PO 0 (fully covered)
    [C, "HO", 5],    // transfer 20, HO 5 → PO 15
  ];
  for (const r of inv) {
    await c.query(`INSERT INTO nav_inventory_mock (item_no,location_code,qty) VALUES ($1,$2,$3)`, r);
  }
  console.log(`✓ seeded 3 docs / ${rows.length} transfer lines using real item_nos [${items.join(", ")}] + ${inv.length} HO on-hand rows`);
}

const summary = (await c.query(`
  SELECT (SELECT COUNT(DISTINCT doc_no) FROM nav_transfers_mock) docs,
         (SELECT COUNT(*) FROM nav_transfers_mock)               lines,
         (SELECT COUNT(*) FROM nav_inventory_mock)               inv
`)).rows[0];
console.log(`nav mocks: ${summary.docs} docs, ${summary.lines} transfer lines, ${summary.inv} HO on-hand rows`);
await c.end();
console.log("✓ warehouse-po-schema complete");
