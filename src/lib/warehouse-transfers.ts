// PO / transfer-flow helpers for the Warehousing module.
//
// NAV holds Head-Office → store transfer orders. The real NAV source tables
// (TransferLines / InventoryOnHand) DO NOT EXIST YET — the DBA will add them to
// the ReplitReports replica later. So every NAV read here is DEFENSIVE: it tries
// navQuery, and on ANY error falls back to the local Postgres MOCK tables
// (nav_transfers_mock / nav_inventory_mock) so the flow is testable now.
//
// Expected NAV shapes (when the tables land, only the SQL strings change):
//   TransferLines:  DocumentNo, Status, TransferFrom, TransferTo, ItemNo, Quantity,
//                   QtyShipped, QtyReceived, ShipmentDate, ReceiptDate  (row per doc×item)
//   InventoryOnHand: ItemNo, LocationCode, Qty
// HO transfers have TransferFrom='HO'; HO on-hand has LocationCode='HO'.
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";

export type TransferSource = "nav" | "mock";

export interface TransferLineRaw {
  doc_no: string;
  status: string;
  transfer_to: string;
  item_no: string;
  qty: number;
  qty_shipped: number;
  qty_received: number;
  retail_status: string | null;
  shipment_date: string | null;
}

export interface TransferLine {
  item_no: string;
  description: string | null;
  qty: number;
}

export interface OpenTransfer {
  doc_no: string;
  store: string;
  status: string;
  shipment_date: string | null;
  lines: TransferLine[];
  total_qty: number;
}

export interface TransferFilters {
  store?: string | null;
  status?: string | null;
  from?: string | null; // shipment_date >=
  to?: string | null;   // shipment_date <=
}

// ── Raw transfer-line reads (NAV → mock fallback) ───────────────────────────

// NAV: HO transfer lines. QtyShipped/QtyReceived drive the "to be received" tick
// (a transfer is shipped once QtyShipped > 0; fully-received transfers are DELETED
// from NAV's transfer table, so absence = received). RetailStatus is the custom
// "Sent / Received" workflow field shown for visibility — swap `NULL AS
// retail_status` for `RetailStatus AS retail_status` once that column is synced.
const NAV_TRANSFER_LINES = `
  SELECT DocumentNo AS doc_no, Status AS status, TransferTo AS transfer_to,
         ItemNo AS item_no, Quantity AS qty,
         QtyShipped AS qty_shipped, QtyReceived AS qty_received,
         NULL AS retail_status,
         CONVERT(varchar(10), CAST(ShipmentDate AS DATE), 23) AS shipment_date
    FROM TransferLines
   WHERE TransferFrom = 'HO'`;

// Mock mirror — same shape, from local Postgres (mock has no posting progress).
const MOCK_TRANSFER_LINES = `
  SELECT doc_no, status, transfer_to,
         item_no, qty,
         0 AS qty_shipped, 0 AS qty_received, NULL AS retail_status,
         to_char(shipment_date, 'YYYY-MM-DD') AS shipment_date
    FROM nav_transfers_mock
   WHERE transfer_from = 'HO'`;

/** All HO transfer lines + which source answered. Tries NAV, falls back to mock. */
async function readTransferLines(): Promise<{ rows: TransferLineRaw[]; source: TransferSource }> {
  try {
    const rows = await navQuery<TransferLineRaw>(NAV_TRANSFER_LINES);
    return { rows: normalizeLines(rows), source: "nav" };
  } catch (e) {
    console.error("[warehouse-transfers] NAV transfer read failed, using mock:", e instanceof Error ? e.message : e);
    const rows = await query<TransferLineRaw>(MOCK_TRANSFER_LINES);
    return { rows: normalizeLines(rows), source: "mock" };
  }
}

function normalizeLines(rows: TransferLineRaw[]): TransferLineRaw[] {
  return rows.map(r => ({
    doc_no: String(r.doc_no),
    status: String(r.status ?? ""),
    transfer_to: String(r.transfer_to ?? ""),
    item_no: String(r.item_no),
    qty: Number(r.qty) || 0,
    qty_shipped: Number(r.qty_shipped) || 0,
    qty_received: Number(r.qty_received) || 0,
    retail_status: r.retail_status != null && String(r.retail_status).trim() !== "" ? String(r.retail_status).trim() : null,
    shipment_date: r.shipment_date ? String(r.shipment_date).slice(0, 10) : null,
  }));
}

// ── Descriptions ────────────────────────────────────────────────────────────
// item_categorisation is the curated catalogue (wins); warehouse_stock backfills.
async function descriptionsFor(itemNos: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(itemNos.map(String))];
  if (!uniq.length) return map;
  // Scalar IN(...) placeholders — keeps the shared db.query (scalar-params) signature.
  const ph = uniq.map((_, i) => `$${i + 1}`).join(",");
  try {
    const [wh, cat] = await Promise.all([
      query<{ item_no: string; description: string }>(
        `SELECT item_no, description FROM warehouse_stock WHERE description IS NOT NULL AND item_no IN (${ph})`, uniq),
      query<{ item_no: string; description: string }>(
        `SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL AND item_no IN (${ph})`, uniq),
    ]);
    for (const r of wh)  map.set(String(r.item_no), r.description);   // warehouse first…
    for (const r of cat) map.set(String(r.item_no), r.description);   // …catalogue wins (curated)
  } catch (e) {
    console.error("[warehouse-transfers] description lookup failed:", e instanceof Error ? e.message : e);
  }
  return map;
}

// ── Already-submitted docs (exclude from picking) ───────────────────────────
async function submittedDocs(): Promise<Set<string>> {
  try {
    const rows = await query<{ nav_doc_no: string }>(
      `SELECT DISTINCT nav_doc_no FROM wh_transfers WHERE nav_doc_no IS NOT NULL`);
    return new Set(rows.map(r => String(r.nav_doc_no)));
  } catch (e) {
    console.error("[warehouse-transfers] submittedDocs lookup failed:", e instanceof Error ? e.message : e);
    return new Set();
  }
}

/**
 * Open HO transfers grouped by doc, with item descriptions, EXCLUDING docs that
 * have already been submitted (present in wh_transfers.nav_doc_no). Optional
 * filters narrow by store / status (case-insensitive) and shipment_date range.
 */
export async function getOpenTransfers(
  filters: TransferFilters = {}
): Promise<{ transfers: OpenTransfer[]; source: TransferSource }> {
  const { rows, source } = await readTransferLines();
  const done = await submittedDocs();

  const store  = filters.store?.trim().toUpperCase() || null;
  const status = filters.status?.trim().toLowerCase() || null;
  const from   = filters.from?.trim() || null;
  const to     = filters.to?.trim() || null;

  const kept = rows.filter(r => {
    if (done.has(r.doc_no)) return false;
    if (store  && r.transfer_to.toUpperCase() !== store) return false;
    if (status && r.status.toLowerCase() !== status) return false;
    if (from && r.shipment_date && r.shipment_date < from) return false;
    if (to   && r.shipment_date && r.shipment_date > to)   return false;
    return true;
  });

  const descs = await descriptionsFor(kept.map(r => r.item_no));

  // Group by doc → consolidate duplicate item rows within the same doc.
  const byDoc = new Map<string, OpenTransfer & { _items: Map<string, number> }>();
  for (const r of kept) {
    let g = byDoc.get(r.doc_no);
    if (!g) {
      g = { doc_no: r.doc_no, store: r.transfer_to, status: r.status, shipment_date: r.shipment_date, lines: [], total_qty: 0, _items: new Map() };
      byDoc.set(r.doc_no, g);
    }
    g._items.set(r.item_no, (g._items.get(r.item_no) || 0) + r.qty);
    g.total_qty += r.qty;
  }

  const transfers: OpenTransfer[] = [...byDoc.values()].map(g => ({
    doc_no: g.doc_no,
    store: g.store,
    status: g.status,
    shipment_date: g.shipment_date,
    total_qty: g.total_qty,
    lines: [...g._items.entries()].map(([item_no, qty]) => ({
      item_no, qty, description: descs.get(item_no) ?? null,
    })),
  })).sort((a, b) => a.doc_no.localeCompare(b.doc_no));

  return { transfers, source };
}

/** Raw HO transfer lines for the given docs (for consolidation / submit). */
export async function getTransfersByDocs(
  docNos: string[]
): Promise<{ rows: TransferLineRaw[]; source: TransferSource }> {
  const want = new Set(docNos.map(String));
  if (!want.size) return { rows: [], source: "mock" };
  const { rows, source } = await readTransferLines();
  return { rows: rows.filter(r => want.has(r.doc_no)), source };
}

// ── HO on-hand (NAV → mock fallback) ─────────────────────────────────────────
const NAV_HO_ONHAND      = `SELECT ItemNo AS item_no, Qty AS qty FROM InventoryOnHand WHERE LocationCode = 'HO'`;
const MOCK_HO_ONHAND     = `SELECT item_no, qty FROM nav_inventory_mock WHERE location_code = 'HO'`;

/**
 * Map item_no → HO on-hand qty (LocationCode='HO'). If itemNos is given the
 * result is restricted to those (the NAV/mock read is filtered in memory so the
 * SQL stays stable for when the real table lands).
 */
export async function getHOOnHand(
  itemNos?: string[]
): Promise<{ map: Map<string, number>; source: TransferSource }> {
  let rows: { item_no: string; qty: number }[];
  let source: TransferSource;
  try {
    rows = await navQuery<{ item_no: string; qty: number }>(NAV_HO_ONHAND);
    source = "nav";
  } catch (e) {
    console.error("[warehouse-transfers] NAV on-hand read failed, using mock:", e instanceof Error ? e.message : e);
    rows = await query<{ item_no: string; qty: number }>(MOCK_HO_ONHAND);
    source = "mock";
  }
  const want = itemNos && itemNos.length ? new Set(itemNos.map(String)) : null;
  const map = new Map<string, number>();
  for (const r of rows) {
    const item = String(r.item_no);
    if (want && !want.has(item)) continue;
    map.set(item, (map.get(item) || 0) + (Number(r.qty) || 0));
  }
  return { map, source };
}

export interface PoLine {
  item_no: string;
  description: string | null;
  transfer_qty: number;
  ho_qty: number;
  po_qty: number;
}

export interface Consolidation {
  lines: PoLine[];
  totals: { transfer_qty: number; po_qty: number; items: number };
  copyText: string;
  source: TransferSource;
}

/**
 * Consolidate the picked docs' lines by item_no (sum), subtract HO on-hand, and
 * compute po_qty = max(0, transfer_qty − ho_qty). Shared by /po (preview) and
 * /submit (snapshot) so the maths can never drift between them.
 * copyText = `item_no\tqty\n` rows for po_qty > 0 only (paste into the ERP).
 */
export async function consolidatePo(docNos: string[]): Promise<Consolidation> {
  const { rows, source } = await getTransfersByDocs(docNos);

  // Sum transfer qty per item across all picked docs.
  const transferByItem = new Map<string, number>();
  for (const r of rows) transferByItem.set(r.item_no, (transferByItem.get(r.item_no) || 0) + r.qty);

  const items = [...transferByItem.keys()];
  const [{ map: hoMap }, descs] = await Promise.all([
    getHOOnHand(items),
    descriptionsFor(items),
  ]);

  const lines: PoLine[] = items.map(item_no => {
    const transfer_qty = transferByItem.get(item_no) || 0;
    const ho_qty = hoMap.get(item_no) || 0;
    const po_qty = Math.max(0, transfer_qty - ho_qty);
    return { item_no, description: descs.get(item_no) ?? null, transfer_qty, ho_qty, po_qty };
  }).sort((a, b) => b.po_qty - a.po_qty || a.item_no.localeCompare(b.item_no));

  const totals = {
    transfer_qty: lines.reduce((s, l) => s + l.transfer_qty, 0),
    po_qty:       lines.reduce((s, l) => s + l.po_qty, 0),
    items:        lines.filter(l => l.po_qty > 0).length,
  };
  const copyText = lines.filter(l => l.po_qty > 0).map(l => `${l.item_no}\t${l.po_qty}`).join("\n");

  return { lines, totals, copyText, source };
}

/** Live per-doc state for the to-be-received tab. */
export interface DocState {
  present: boolean;          // still an open transfer in NAV (received ones get deleted)
  status: string;            // standard NAV status ("0" Open / "1" Released)
  retail_status: string | null; // custom "Sent / Received" workflow field (display only)
  qty: number;               // total ordered qty across the doc's lines
  qty_shipped: number;       // posted-shipped qty (>0 ⇒ shipped ⇒ "to be received")
  qty_received: number;      // posted-received qty
}

/**
 * Live posting state per doc (NAV → mock). Sums QtyShipped/QtyReceived across the
 * doc's lines and carries the custom RetailStatus. Docs NOT in the result are gone
 * from NAV's open-transfer table — i.e. fully received (the caller treats absence
 * as received).
 */
export async function liveStateByDoc(
  docNos: string[]
): Promise<{ map: Map<string, DocState>; source: TransferSource }> {
  const want = new Set(docNos.map(String));
  const map = new Map<string, DocState>();
  if (!want.size) return { map, source: "mock" };
  const { rows, source } = await readTransferLines();
  for (const r of rows) {
    if (!want.has(r.doc_no)) continue;
    let s = map.get(r.doc_no);
    if (!s) { s = { present: true, status: r.status, retail_status: r.retail_status, qty: 0, qty_shipped: 0, qty_received: 0 }; map.set(r.doc_no, s); }
    s.qty += r.qty;
    s.qty_shipped += r.qty_shipped;
    s.qty_received += r.qty_received;
    if (!s.retail_status && r.retail_status) s.retail_status = r.retail_status;
  }
  return { map, source };
}
