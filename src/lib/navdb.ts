import sql from "mssql";

// When NAV_PROXY_URL is set, forward queries to the local HTTP proxy
// (used while Railway can't reach the SQL Server directly).
// Remove NAV_PROXY_URL once static IPs are whitelisted — no other changes needed.
const PROXY_URL    = process.env.NAV_PROXY_URL;
const PROXY_SECRET = process.env.PROXY_SECRET || "nav-proxy-secret-2024";

const config: sql.config = {
  server:   process.env.NAV_DB_SERVER!,
  port:     parseInt(process.env.NAV_DB_PORT || process.env.NAV_PORT || "1433"),
  database: process.env.NAV_DB_NAME!,
  user:     process.env.NAV_DB_USER!,
  password: process.env.NAV_DB_PASSWORD!,
  options:  { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout:    30000,
};

let pool: sql.ConnectionPool | null = null;

async function getNavPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

export async function navQuery<T = Record<string, unknown>>(
  query: string,
  params?: Record<string, string | number | Date>
): Promise<T[]> {
  // ── Proxy mode (Railway → local machine) ──────────────────────────────
  if (PROXY_URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let res: Response;
    try {
      res = await fetch(`${PROXY_URL}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": PROXY_SECRET,
        },
        body: JSON.stringify({ query, params }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res!.ok) {
      const err = await res!.text();
      throw new Error(`NAV proxy error ${res!.status}: ${err}`);
    }
    const data = await res!.json() as { rows: T[]; error?: string };
    if (data.error) throw new Error(`NAV proxy query error: ${data.error}`);
    return data.rows;
  }

  // ── Direct mode (local dev or Railway with whitelisted static IP) ──────
  const p = await getNavPool();
  const req = p.request();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      req.input(k, v);
    }
  }
  const result = await req.query(query);
  return result.recordset as T[];
}
