import { navQuery } from "./navdb";

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
