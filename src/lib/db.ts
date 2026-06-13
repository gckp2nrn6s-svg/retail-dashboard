import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: (string | number | boolean | null)[]
): Promise<T[]> {
  const p = getPool();
  const { rows } = await p.query(sql, params);
  return rows as T[];
}

// sales_amount is positive EGP; invoiced_qty is negative for actual sales
// So: units = -invoiced_qty, revenue = sales_amount for Sales Invoice rows
export const SALES_FILTER = `document_type = 'Sales Invoice' AND invoiced_qty < 0`;

export const STORE_GROUPS = {
  physical: ["ALMAZA", "CCA", "CF-HOS", "CSTARS", "P90"],
  online: ["ONLINE", "AMAZON BAN", "AMAZON KAM"],
  b2b: ["HO", "NOON", "AMAZON", "JUMIA", "DUTY FREE", "FOUR SEASO", "GO SPORT1", "MOA", "MOE", "SPINNEYS", "ATCFC", "ATMADI"],
};

export function storeGroup(code: string): string {
  if (STORE_GROUPS.physical.includes(code)) return "Retail";
  if (STORE_GROUPS.online.includes(code)) return "Online";
  return "B2B";
}
