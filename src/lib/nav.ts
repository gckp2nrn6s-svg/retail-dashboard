import sql from "mssql";

const config: sql.config = {
  server: process.env.NAV_SERVER!,
  port: parseInt(process.env.NAV_PORT || "1433"),
  database: process.env.NAV_DATABASE!,
  user: process.env.NAV_USER!,
  password: process.env.NAV_PASSWORD!,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

let pool: sql.ConnectionPool | null = null;

export async function getNavPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

export async function navQuery<T = Record<string, unknown>>(
  query: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const conn = await getNavPool();
  const request = conn.request();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }
  const result = await request.query(query);
  return result.recordset as T[];
}

export async function testNavConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await navQuery("SELECT TOP 1 1 as test");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
