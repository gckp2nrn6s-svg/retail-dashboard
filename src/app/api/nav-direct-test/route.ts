import { NextResponse } from "next/server";
import sql from "mssql";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostic (unauthenticated): can THIS server reach the NAV SQL Server
// DIRECTLY (bypassing the proxy)? Used to confirm the firewall whitelist of Railway's
// static IPs BEFORE the cutover, so production never flips blind. Returns no secrets.
// Remove this route after the cutover is confirmed.
export async function GET() {
  const cfg: sql.config = {
    server: process.env.NAV_DB_SERVER || "",
    port: parseInt(process.env.NAV_DB_PORT || process.env.NAV_PORT || "1433"),
    database: process.env.NAV_DB_NAME || "",
    user: process.env.NAV_DB_USER || "",
    password: process.env.NAV_DB_PASSWORD || "",
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 12000,
    requestTimeout: 12000,
  };
  const haveCreds = !!(cfg.server && cfg.database && cfg.user && cfg.password);
  if (!haveCreds) {
    return NextResponse.json({ reachable: false, haveCreds, reason: "NAV_DB_* variables are not set on this service yet" }, { status: 200 });
  }
  const t0 = Date.now();
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await new sql.ConnectionPool(cfg).connect();
    const r = await pool.request().query("SELECT TOP 1 CAST(MAX([Date]) AS DATE) AS maxDate FROM TransSalesEntry");
    return NextResponse.json({ reachable: true, ms: Date.now() - t0, server: cfg.server, port: cfg.port, db: cfg.database, sample: r.recordset[0] }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ reachable: false, ms: Date.now() - t0, server: cfg.server, port: cfg.port, reason: e instanceof Error ? e.message : String(e) }, { status: 200 });
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}
