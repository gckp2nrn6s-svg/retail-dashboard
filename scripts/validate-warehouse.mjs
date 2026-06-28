// End-to-end check of the Warehousing PO flow. Mutates real stock then REVERTS.
import { EncryptJWT } from "jose";
import hkdf from "@panva/hkdf";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import pg from "pg";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const key = await hkdf("sha256", process.env.NEXTAUTH_SECRET, "", "NextAuth.js Generated Encryption Key", 32);
const tok = await new EncryptJWT({ name: "v", role: "admin" }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setExpirationTime("1h").setJti(randomUUID()).encrypt(key);
const C = { cookie: `next-auth.session-token=${tok}`, "content-type": "application/json" };
const B = "http://localhost:3000";
const get = async p => (await fetch(B + p, { headers: C })).json();
const post = async (p, b) => (await fetch(B + p, { method: "POST", headers: C, body: JSON.stringify(b) })).json();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"}  ${m}${x ? "  — " + x : ""}`); c ? pass++ : fail++; };

console.log("── transfers ──");
const tr = await get("/api/warehouse/transfers");
const transfers = tr.transfers || [];
ok(transfers.length > 0, "GET transfers returns open transfers", `${transfers.length} docs${tr.sources?.mock ? " (mock)" : ""}`);
const docNos = transfers.slice(0, 2).map(t => t.doc_no);

console.log("\n── po (consolidate − HO on-hand) ──");
const po = await post("/api/warehouse/po", { docNos });
ok(Array.isArray(po.lines) && po.lines.length > 0, "POST po returns consolidated lines", `${po.lines?.length} items`);
const mathOk = (po.lines || []).every(l => l.po_qty === Math.max(0, Number(l.transfer_qty) - Number(l.ho_qty)));
ok(mathOk, "po_qty = max(0, transfer − HO) for every line");
ok(typeof po.copyText === "string" && !/\t0\b/.test(po.copyText.split("\n").map(r => r).join("\n")), "copyText present (item⇥qty, only po_qty>0)");

console.log("\n── submit (deduct stock + move on) ──");
const consol = new Map(); // item_no -> transfer_qty (what should be deducted)
for (const l of po.lines) consol.set(l.item_no, Number(l.transfer_qty));
const before = Object.fromEntries((await Promise.all([...consol.keys()].map(async i =>
  [i, Number((await db.query("SELECT in_stock FROM warehouse_stock WHERE item_no=$1", [i])).rows[0]?.in_stock || 0)]))));
const sub = await post("/api/warehouse/submit", { docNos });
ok(sub.runId > 0, "POST submit returns runId", `run #${sub.runId}, ${sub.transfers} transfers, ${sub.units} units`);
let decOk = true;
for (const [item, qty] of consol) {
  const after = Number((await db.query("SELECT in_stock FROM warehouse_stock WHERE item_no=$1", [item])).rows[0]?.in_stock || 0);
  if (Math.round(before[item] - after) !== Math.round(qty)) { decOk = false; console.log(`     stock ${item}: ${before[item]} → ${after} (expected −${qty})`); }
}
ok(decOk, "HO stock decremented by the transfer qty for every item");

console.log("\n── to-be-received + paper-check ──");
const tbr = await get("/api/warehouse/to-be-received");
const tbrRows = Array.isArray(tbr) ? tbr : (tbr.rows || []);
const mine = tbrRows.filter(r => docNos.includes(r.doc_no));
ok(mine.length === docNos.length, "submitted transfers appear in to-be-received", `${mine.length}/${docNos.length}`);
ok(mine.every(r => r.stock_deducted), "stock_deducted = true on all");
if (mine[0]) {
  const pc = await post("/api/warehouse/paper-check", { transferId: mine[0].id });
  ok(pc.ok, "paper-check sets the tick");
  const re = await get("/api/warehouse/to-be-received");
  const after = (Array.isArray(re) ? re : re.rows || []).find(r => r.id === mine[0].id);
  ok(after?.paper_checked === true, "paper_checked persists after re-read");
}

console.log("\n── revert (restore prod stock + delete test run) ──");
for (const [item, qty] of consol) await db.query("UPDATE warehouse_stock SET in_stock=in_stock+$2, out_qty=out_qty-$2 WHERE item_no=$1", [item, qty]);
await db.query("DELETE FROM wh_runs WHERE id=$1", [sub.runId]); // cascades transfers/lines/po_lines
const baseline = Number((await db.query("SELECT COALESCE(SUM(in_stock),0) u FROM warehouse_stock")).rows[0].u);
ok(Math.round(baseline) === 37006, "stock restored to 37,006 baseline", `${Math.round(baseline)}`);
const runs = Number((await db.query("SELECT COUNT(*) n FROM wh_runs")).rows[0].n);
ok(runs === 0, "test run deleted", `${runs} runs left`);

await db.end();
console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`);
process.exit(fail ? 1 : 0);
