// User-management columns on the existing "User" table. Idempotent — safe to re-run.
// permissions: per-user JSON { tabs: string[], wh: {submit,adjust,receive,papercheck} }.
// active: false disables login without deleting the account.
import pg from "pg";
import { readFileSync } from "fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS permissions jsonb`);
await c.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`);
const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='User' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
console.log("✓ User columns:", cols.join(", "));
await c.end();
