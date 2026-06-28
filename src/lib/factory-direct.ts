import { query, getPool } from "@/lib/db";

// Live Google Sheet of factory-direct sales (Carrefour, Amazon, LULU, …) that do
// NOT flow through NAV. Synced into Postgres and folded into B2B. The sheet is the
// source of truth, so each sync replaces the table wholesale.
const SHEET_ID = "1XSotdIvVwX8OJdB25ZkNLHF5eswKQE_JvhJpgSzWDiY";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;
const FRESH_MS = 12 * 60 * 60 * 1000; // re-sync if older than 12h

// Column order in the sheet (0-based):
// 0 Invoice 1 Date 2 PO 3 Client 4 Branch 5 Model 6 Sku 7 No 8 Description
// 9 Qty 10 UnitPrice 11 TotalB.Tax 12 Tax 13 TotalSales(inclVAT)
function parseCSV(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const num = (s: string) => Number(String(s ?? "").replace(/[, ]/g, "")) || 0;
function toISODate(s: string): string | null {
  const d = new Date(String(s ?? "").trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
// Normalize for grouping + matching to NAV customer names (upper, single-spaced).
export function clientKey(s: string): string {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export interface SyncResult { ok: boolean; rows: number; total: number; note?: string }

/** Fetch the sheet and REPLACE factory_direct_sales. Logs to factory_direct_sync. */
export async function syncFactoryDirect(): Promise<SyncResult> {
  let text: string;
  try {
    const res = await fetch(SHEET_CSV_URL, { signal: AbortSignal.timeout(30000), redirect: "follow" });
    if (!res.ok) throw new Error(`sheet HTTP ${res.status}`);
    text = await res.text();
    if (text.length < 1000) throw new Error("sheet response too small — not shared / wrong gid?");
  } catch (e) {
    const note = e instanceof Error ? e.message : "fetch failed";
    await query(`UPDATE factory_direct_sync SET ok=false, note=$1, synced_at=now() WHERE id=1`, [note]).catch(() => {});
    console.error("[factory-direct] fetch failed:", note);
    return { ok: false, rows: 0, total: 0, note };
  }

  // Keep only real data rows: a parseable date AND a non-blank client.
  const data = parseCSV(text).filter(r => r.length > 13 && toISODate(r[1]) && String(r[3] ?? "").trim());
  const parsed = data.map(r => ({
    invoice_no: String(r[0] ?? "").trim() || null,
    sale_date: toISODate(r[1]),
    po: String(r[2] ?? "").trim() || null,
    client: String(r[3] ?? "").trim(),
    client_key: clientKey(r[3]),
    branch: String(r[4] ?? "").trim() || null,
    model: String(r[5] ?? "").trim() || null,
    sku: String(r[6] ?? "").trim() || null,
    description: String(r[8] ?? "").trim() || null,
    qty: num(r[9]), unit_price: num(r[10]), total_btax: num(r[11]), tax: num(r[12]), total_sales: num(r[13]),
  }));
  const total = Math.round(parsed.reduce((s, p) => s + p.total_sales, 0));
  if (!parsed.length) {
    await query(`UPDATE factory_direct_sync SET ok=false, note=$1, synced_at=now() WHERE id=1`, ["parsed 0 rows"]).catch(() => {});
    return { ok: false, rows: 0, total: 0, note: "parsed 0 rows" };
  }

  const cols = ["invoice_no", "sale_date", "po", "client", "client_key", "branch", "model", "sku", "description", "qty", "unit_price", "total_btax", "tax", "total_sales"];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE factory_direct_sales");
    const CHUNK = 400;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const slice = parsed.slice(i, i + CHUNK);
      const vals: unknown[] = [];
      const tuples = slice.map((p, j) => {
        const base = j * cols.length;
        vals.push(p.invoice_no, p.sale_date, p.po, p.client, p.client_key, p.branch, p.model, p.sku, p.description, p.qty, p.unit_price, p.total_btax, p.tax, p.total_sales);
        return `(${cols.map((_, k) => `$${base + k + 1}`).join(",")})`;
      }).join(",");
      await client.query(`INSERT INTO factory_direct_sales (${cols.join(",")}) VALUES ${tuples}`, vals);
    }
    await client.query(`UPDATE factory_direct_sync SET synced_at=now(), rows=$1, total_egp=$2, ok=true, note=null WHERE id=1`, [parsed.length, total]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const note = e instanceof Error ? e.message : "insert failed";
    console.error("[factory-direct] insert failed:", note);
    return { ok: false, rows: 0, total: 0, note };
  } finally {
    client.release();
  }
  console.log(`[factory-direct] synced ${parsed.length} rows, ${total.toLocaleString()} EGP`);
  return { ok: true, rows: parsed.length, total };
}

// ── Non-blocking lazy refresh: kick a background sync if the data is stale. ─────
// Throttled so the freshness check itself doesn't run on every request.
let _syncing = false;
let _lastCheck = 0;
export function maybeRefreshFactoryDirect(): void {
  if (_syncing || Date.now() - _lastCheck < 5 * 60_000) return;
  _lastCheck = Date.now();
  query<{ synced_at: string | null; rows: number | null }>(`SELECT synced_at, rows FROM factory_direct_sync WHERE id=1`)
    .then(r => {
      const last = r[0]?.synced_at ? new Date(r[0].synced_at).getTime() : 0;
      const empty = !r[0]?.rows;
      if (!empty && Date.now() - last < FRESH_MS) return;
      _syncing = true;
      syncFactoryDirect().catch(() => {}).finally(() => { _syncing = false; });
    })
    .catch(() => {});
}

// ── Aggregations for B2B ───────────────────────────────────────────────────────
export interface FdClient { client_key: string; client: string; egp: number; units: number; txns: number }

export async function getFactoryDirectByClient(from: string, to: string): Promise<FdClient[]> {
  const rows = await query<{ client_key: string; client: string; egp: string; units: string; txns: string }>(
    `SELECT client_key, MAX(client) AS client, COALESCE(SUM(total_sales),0) AS egp,
            COALESCE(SUM(qty),0) AS units, COUNT(DISTINCT invoice_no) AS txns
       FROM factory_direct_sales WHERE sale_date BETWEEN $1 AND $2
      GROUP BY client_key HAVING SUM(total_sales) <> 0 ORDER BY egp DESC`, [from, to]);
  return rows.map(r => ({ client_key: r.client_key, client: r.client, egp: Math.round(Number(r.egp)), units: Math.round(Number(r.units)), txns: Number(r.txns) }));
}

export async function getFactoryDirectTotal(from: string, to: string): Promise<{ egp: number; units: number }> {
  const r = await query<{ egp: string; units: string }>(
    `SELECT COALESCE(SUM(total_sales),0) AS egp, COALESCE(SUM(qty),0) AS units
       FROM factory_direct_sales WHERE sale_date BETWEEN $1 AND $2`, [from, to]);
  return { egp: Math.round(Number(r[0]?.egp || 0)), units: Math.round(Number(r[0]?.units || 0)) };
}

export async function getFactoryDirectSeries(from: string, to: string): Promise<{ date: string; egp: number; units: number }[]> {
  const rows = await query<{ date: string; egp: string; units: string }>(
    `SELECT to_char(sale_date,'YYYY-MM-DD') AS date, SUM(total_sales) AS egp, SUM(qty) AS units
       FROM factory_direct_sales WHERE sale_date BETWEEN $1 AND $2 GROUP BY sale_date ORDER BY sale_date`, [from, to]);
  return rows.map(r => ({ date: r.date, egp: Math.round(Number(r.egp)), units: Math.round(Number(r.units)) }));
}

export async function lastFactorySync(): Promise<{ synced_at: string | null; rows: number | null; total_egp: number | null; ok: boolean | null; note: string | null } | null> {
  const r = await query<{ synced_at: string | null; rows: number | null; total_egp: number | null; ok: boolean | null; note: string | null }>(
    `SELECT synced_at, rows, total_egp, ok, note FROM factory_direct_sync WHERE id=1`);
  return r[0] || null;
}
