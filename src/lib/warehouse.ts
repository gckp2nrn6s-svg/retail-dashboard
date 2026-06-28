import { query } from "@/lib/db";

// Canonicalize a SKU / item code so messy variants all match:
// "gm3 09 004", "GM3-09-004", "gm3*09,004", "GM3 09 004 " → "GM309004".
export function normCode(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface ResolvedItem {
  input: string;
  item_no: string | null;
  description: string | null;
  matched: boolean;
}

let cache: { at: number; byItemNo: Map<string, string>; skuIndex: Map<string, string> } | null = null;
const TTL = 5 * 60 * 1000;

async function lookups() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const [items, wh, skus] = await Promise.all([
    query<{ item_no: string; description: string }>("SELECT item_no, description FROM item_categorisation WHERE description IS NOT NULL"),
    query<{ item_no: string; description: string }>("SELECT item_no, description FROM warehouse_stock WHERE description IS NOT NULL"),
    query<{ sku: string; item_no: string }>("SELECT sku, item_no FROM shopify_item_map"),
  ]);
  const byItemNo = new Map<string, string>();
  for (const r of wh) byItemNo.set(String(r.item_no), r.description);          // warehouse first…
  for (const r of items) byItemNo.set(String(r.item_no), r.description);       // …catalogue wins (curated)
  const skuIndex = new Map<string, string>(); // normalized SKU → item_no
  for (const r of skus) { const k = normCode(r.sku); if (k && !skuIndex.has(k)) skuIndex.set(k, String(r.item_no)); }
  cache = { at: Date.now(), byItemNo, skuIndex };
  return cache;
}

/** Resolve a batch of inputs (item numbers OR SKUs, in any messy format) to item_no + description. */
export async function resolveCodes(inputs: string[]): Promise<ResolvedItem[]> {
  const { byItemNo, skuIndex } = await lookups();
  return inputs.map(raw => {
    const input = (raw || "").trim();
    if (!input) return { input, item_no: null, description: null, matched: false };
    // 1) exact item number
    if (byItemNo.has(input)) return { input, item_no: input, description: byItemNo.get(input)!, matched: true };
    // 2) SKU (normalized)
    const k = normCode(input);
    const viaSku = skuIndex.get(k);
    if (viaSku) return { input, item_no: viaSku, description: byItemNo.get(viaSku) ?? null, matched: true };
    // 3) item number that survived normalization (e.g. " 20942 ")
    if (byItemNo.has(k)) return { input, item_no: k, description: byItemNo.get(k)!, matched: true };
    return { input, item_no: null, description: null, matched: false };
  });
}
