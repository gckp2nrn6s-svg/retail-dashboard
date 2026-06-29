import { navQuery } from "./navdb";
import { query } from "./db";
import { getShopifyItemVelocity, maybeRefreshShopifyItems } from "./shopify";

export interface ItemVelocity {
  units: number;
  revenue: number;
}

/** Fetch per-item sold units + revenue from NAV for the last N days */
export async function fetchNavVelocity(days: number): Promise<Map<string, ItemVelocity>> {
  const rows = await navQuery<{ item_no: string; units: number; revenue: number }>(`
    SELECT
      [Item No_]                      AS item_no,
      -SUM([Quantity])                AS units,
      -SUM([Net Amount]+[VAT Amount]) AS revenue
    FROM TransSalesEntry
    WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-${days},GETDATE()) AS DATE)
      AND [Store No_] != 'ONLINE'
    GROUP BY [Item No_]
  `);
  const map = new Map<string, ItemVelocity>();
  for (const r of rows) {
    map.set(r.item_no, { units: Number(r.units), revenue: Number(r.revenue) });
  }
  return map;
}

/**
 * Per-item sold units + revenue across ALL channels for the last N days:
 * NAV POS + Shopify own-website + factory-direct (only the SKUs that map to a
 * warehouse item). Used by the stock alerts so an item selling well online or via
 * factory isn't wrongly flagged slow/dead. Non-overlapping by channel.
 */
export async function getCombinedVelocity(days: number): Promise<Map<string, ItemVelocity>> {
  maybeRefreshShopifyItems(); // keep the per-item Shopify rollup current (non-blocking)
  const [nav, shop, factory] = await Promise.all([
    fetchNavVelocity(days).catch(() => new Map<string, ItemVelocity>()),
    getShopifyItemVelocity(days).catch(() => new Map<string, ItemVelocity>()),
    query<{ item_no: string; units: string; revenue: string }>(
      `SELECT m.item_no, SUM(f.qty)::numeric AS units, SUM(f.total_sales)::numeric AS revenue
         FROM factory_direct_sales f JOIN shopify_item_map m ON m.sku = f.sku
        WHERE f.sale_date >= CURRENT_DATE - ($1::int) GROUP BY m.item_no`,
      [days]).catch(() => []),
  ]);
  const map = new Map<string, ItemVelocity>();
  for (const [k, v] of nav) map.set(k, { units: v.units, revenue: v.revenue });
  const add = (item_no: string, units: number, revenue: number) => {
    const e = map.get(item_no) || { units: 0, revenue: 0 };
    e.units += units; e.revenue += revenue; map.set(item_no, e);
  };
  for (const [k, v] of shop) add(k, v.units, v.revenue);
  for (const r of factory) add(String(r.item_no), Number(r.units) || 0, Number(r.revenue) || 0);
  return map;
}
