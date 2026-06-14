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

export const SALES_FILTER = `document_type = 'Sales Invoice' AND invoiced_qty < 0`;

export const STORE_GROUPS = {
  physical: ["ALMAZA", "CCA", "CF-HOS", "CSTARS", "P90"],
  // ONLINE removed — Shopify is the single ecom source of truth
  online:   ["SHOPIFY-AMT", "SHOPIFY-SAM", "AMAZON BAN", "AMAZON KAM"],
  b2b:      ["HO","NOON","AMAZON","JUMIA","DUTY FREE","FOUR SEASO","GO SPORT1","MOA","MOE","SPINNEYS","ATCFC","ATMADI","HIS","EVE"],
};

// Human-readable store names shown everywhere in the UI
export const STORE_NAMES: Record<string, string> = {
  "CSTARS":       "City Stars",
  "CF-HOS":       "Cairo Festival City",
  "ALMAZA":       "Almaza City Center",
  "P90":          "Point 90",
  "CCA":          "Alexandria",
  "ONLINE":       "Online Store",
  "AMAZON BAN":   "Amazon Banha",
  "AMAZON KAM":   "Amazon Kamal",
  "SHOPIFY-AMT":  "AT Online",
  "SHOPIFY-SAM":  "Samsonite Online",
  "HO":           "Head Office",
  "NOON":         "Noon",
  "AMAZON":       "Amazon Egypt",
  "JUMIA":        "Jumia",
  "DUTY FREE":    "Duty Free",
  "FOUR SEASO":   "Four Seasons",
  "GO SPORT1":    "Go Sport",
  "MOA":          "Mall of Arabia",
  "MOE":          "Mall of Egypt",
  "SPINNEYS":     "Spinneys",
  "ATCFC":        "AT Cairo Festival",
  "ATMADI":       "AT Madinaty",
};

// Consistent color per store — used across charts, tables, insight cards
export const STORE_COLORS: Record<string, string> = {
  "CSTARS":       "#2563EB",
  "CF-HOS":       "#0D9488",
  "ALMAZA":       "#7C3AED",
  "P90":          "#EA580C",
  "CCA":          "#EC4899",
  "ONLINE":       "#0891B2",
  "AMAZON BAN":   "#F59E0B",
  "AMAZON KAM":   "#D97706",
  "SHOPIFY-AMT":  "#10B981",
  "SHOPIFY-SAM":  "#059669",
  "HO":           "#64748B",
  "NOON":         "#FBBF24",
  "AMAZON":       "#F97316",
  "JUMIA":        "#EF4444",
  "DUTY FREE":    "#8B5CF6",
};

export function storeName(code: string): string {
  return STORE_NAMES[code] ?? code;
}

export function storeColor(code: string): string {
  return STORE_COLORS[code] ?? "#94A3B8";
}

export function storeGroup(code: string): string {
  if (STORE_GROUPS.physical.includes(code)) return "Retail";
  if (STORE_GROUPS.online.includes(code))   return "Online";
  return "B2B";
}
