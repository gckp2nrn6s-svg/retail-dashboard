#!/usr/bin/env node
/**
 * Local NAV SQL Server proxy.
 * Run this on your machine: node nav-proxy.js
 * Then expose it: ngrok http 4001
 * Set NAV_PROXY_URL on Railway to the ngrok HTTPS URL.
 * Remove NAV_PROXY_URL when you have static IPs whitelisted.
 */

const http = require("http");
const sql  = require("mssql");

const PORT = 4001;
const SECRET = process.env.PROXY_SECRET || "nav-proxy-secret-2024";

const config = {
  server:   process.env.NAV_DB_SERVER,
  port:     parseInt(process.env.NAV_PORT || "1433"),
  database: process.env.NAV_DB_NAME,
  user:     process.env.NAV_DB_USER,
  password: process.env.NAV_DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout:    30000,
  pool: { max: 5, min: 1, idleTimeoutMillis: 30000 },
};

let pool = null;
async function getPool() {
  if (pool && pool.connected) return pool;
  console.log("Connecting to NAV SQL Server...");
  pool = await new sql.ConnectionPool(config).connect();
  console.log("Connected.");
  return pool;
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-proxy-secret");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST" || req.url !== "/query") {
    res.writeHead(404); res.end("Not found"); return;
  }

  // Auth
  if (req.headers["x-proxy-secret"] !== SECRET) {
    res.writeHead(401); res.end("Unauthorized"); return;
  }

  let body = "";
  req.on("data", c => (body += c));
  req.on("end", async () => {
    try {
      const { query, params } = JSON.parse(body);
      const p = await getPool();
      const request = p.request();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          request.input(k, v);
        }
      }
      const result = await request.query(query);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows: result.recordset }));
    } catch (e) {
      console.error("Query error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ NAV Proxy running on http://localhost:${PORT}`);
  console.log(`\nNext steps:`);
  console.log(`  1. ngrok http ${PORT}`);
  console.log(`  2. Copy the https://xxxx.ngrok-free.app URL`);
  console.log(`  3. railway variables set NAV_PROXY_URL=https://xxxx.ngrok-free.app PROXY_SECRET=${SECRET}`);
  console.log(`  4. railway up\n`);
});
