import sql from "mssql";

// When NAV_PROXY_URL is set, forward queries to the local HTTP proxy
// (used while Railway can't reach the SQL Server directly).
// Remove NAV_PROXY_URL once static IPs are whitelisted — no other changes needed.
const PROXY_URL    = process.env.NAV_PROXY_URL;
const PROXY_SECRET = process.env.PROXY_SECRET || "nav-proxy-secret-2024";

/** Thrown when NAV cannot be reached (proxy down, ngrok tunnel offline, timeout).
 *  Callers can catch this specifically to degrade gracefully instead of crashing. */
export class NavUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavUnavailableError";
  }
}

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

// ── Last-good cache ─────────────────────────────────────────────────────────
// A momentary proxy blip should serve the last successful result for the same
// query rather than zeroing the whole dashboard. TTL keeps it fresh-ish.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const lastGood = new Map<string, { at: number; rows: unknown[] }>();

function cacheKey(query: string, params?: Record<string, unknown>): string {
  return query + "|" + JSON.stringify(params ?? {});
}

export async function navQuery<T = Record<string, unknown>>(
  query: string,
  params?: Record<string, string | number | Date>
): Promise<T[]> {
  const key = cacheKey(query, params);

  // ── Proxy mode (Railway → local machine) ──────────────────────────────
  if (PROXY_URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
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
    } catch (e) {
      // Network error or timeout — serve last-good if we have it, else throw typed.
      const cached = lastGood.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows as T[];
      const reason = e instanceof Error && e.name === "AbortError" ? "timeout after 12s" : (e instanceof Error ? e.message : "network error");
      throw new NavUnavailableError(`NAV proxy unreachable: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    // A dead ngrok tunnel returns its own HTML error page (ERR_NGROK_3200),
    // not JSON. Detect that and treat it as "NAV offline" instead of letting
    // res.json() throw a confusing SyntaxError.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const cached = lastGood.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows as T[];
      throw new NavUnavailableError(`NAV proxy returned non-JSON (status ${res.status}) — tunnel likely offline`);
    }

    if (!res.ok) {
      const cached = lastGood.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows as T[];
      const err = await res.text();
      throw new NavUnavailableError(`NAV proxy error ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json() as { rows: T[]; error?: string };
    if (data.error) throw new Error(`NAV proxy query error: ${data.error}`);

    lastGood.set(key, { at: Date.now(), rows: data.rows });
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
  lastGood.set(key, { at: Date.now(), rows: result.recordset });
  return result.recordset as T[];
}
