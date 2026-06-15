import { NextRequest, NextResponse } from "next/server";
import { query, STORE_NAMES } from "@/lib/db";
import { navQuery } from "@/lib/navdb";

const RETAIL = ["CF-HOS", "CSTARS", "CCA", "ALMAZA", "P90", "MOA", "MOE", "HIS", "MC"];
const ECOM   = ["NOON", "JUMIA"]; // ONLINE excluded — use Shopify for own website

function sn(code: string) { return STORE_NAMES[code] ?? code; }

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const year  = parseInt(p.get("year")  || String(now.getFullYear()));
  const month = parseInt(p.get("month") || String(now.getMonth() + 1));

  const monthStart = `${year}-${String(month).padStart(2,"0")}-01`;
  const monthEnd   = `${year}-${String(month).padStart(2,"0")}-${String(daysInMonth(year, month)).padStart(2,"0")}`;
  const today      = now.toISOString().slice(0, 10);

  // Days elapsed in the month (up to today or end of month)
  const effectiveEnd = today < monthEnd ? today : monthEnd;
  const daysElapsed  = Math.max(1,
    Math.floor((new Date(effectiveEnd).getTime() - new Date(monthStart).getTime()) / 86400000) + 1
  );
  const totalDays = daysInMonth(year, month);

  const [fxRow, targetRows, actualRows] = await Promise.all([
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),

    query<{ store_code: string; target_egp: string }>(`
      SELECT store_code, target_egp
      FROM store_targets
      WHERE year=${year} AND month=${month}
    `),

    navQuery<{ store_code: string; actual_egp: number; txn_days: number }>(`
      SELECT
        [Store No_]                          AS store_code,
        -SUM([Net Amount] + [VAT Amount])    AS actual_egp,
        COUNT(DISTINCT CAST([Date] AS DATE)) AS txn_days
      FROM TransSalesEntry
      WHERE CAST([Date] AS DATE) BETWEEN @monthStart AND @effectiveEnd
      GROUP BY [Store No_]
    `, { monthStart, effectiveEnd }),
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "52");

  const targetMap = Object.fromEntries(targetRows.map(r => [r.store_code, parseFloat(r.target_egp)]));
  const actualMap = Object.fromEntries(actualRows.map(r => [r.store_code, {
    actual: Number(r.actual_egp),
    txnDays: Number(r.txn_days),
  }]));

  const allCodes = [...new Set([...RETAIL, ...ECOM, ...Object.keys(targetMap)])];

  const stores = allCodes.map(code => {
    const target  = targetMap[code] ?? 0;
    const actual  = actualMap[code]?.actual ?? 0;
    const dailyRate = daysElapsed > 0 ? actual / daysElapsed : 0;
    const projected = dailyRate * totalDays;
    const pctDone   = target > 0 ? (actual / target) * 100 : null;
    const pctProject= target > 0 ? (projected / target) * 100 : null;
    const gap       = target > 0 ? projected - target : null;
    const onTrack   = pctProject !== null ? pctProject >= 95 : null;
    const channel   = RETAIL.includes(code) ? "Retail" : ECOM.includes(code) ? "Ecom" : "B2B";

    return {
      code,
      name:      sn(code),
      channel,
      target,
      actual:    Math.round(actual),
      projected: Math.round(projected),
      dailyRate: Math.round(dailyRate),
      pctDone:   pctDone !== null   ? Math.round(pctDone * 10) / 10   : null,
      pctProject:pctProject !== null ? Math.round(pctProject * 10) / 10 : null,
      gap:       gap !== null ? Math.round(gap) : null,
      onTrack,
      daysElapsed,
      totalDays,
    };
  });

  // Channel rollups
  const retailStores = stores.filter(s => s.channel === "Retail");
  const onlineStores = stores.filter(s => s.channel === "Ecom");

  function rollup(list: typeof stores) {
    const target    = list.reduce((s,r) => s + r.target, 0);
    const actual    = list.reduce((s,r) => s + r.actual, 0);
    const projected = list.reduce((s,r) => s + r.projected, 0);
    const gap       = target > 0 ? projected - target : null;
    return {
      target, actual, projected,
      pctDone:    target > 0 ? Math.round(actual    / target * 1000) / 10 : null,
      pctProject: target > 0 ? Math.round(projected / target * 1000) / 10 : null,
      gap,
      onTrack: gap !== null ? gap >= 0 : null,
    };
  }

  return NextResponse.json({
    year, month, daysElapsed, totalDays, fx,
    stores: stores.filter(s => RETAIL.includes(s.code) || ECOM.includes(s.code)),
    retail: rollup(retailStores),
    online: rollup(onlineStores),
    overall: rollup([...retailStores, ...onlineStores]),
  });
}

// ── UPSERT target ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { store_code, year, month, target_egp } = await req.json();
  if (!store_code || !year || !month || target_egp === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  await query(`
    INSERT INTO store_targets (store_code, year, month, target_egp, updated_at)
    VALUES ('${store_code.replace(/'/g,"''")}', ${year}, ${month}, ${parseFloat(target_egp)}, NOW())
    ON CONFLICT (store_code, year, month) DO UPDATE
      SET target_egp=EXCLUDED.target_egp, updated_at=NOW()
  `);
  return NextResponse.json({ ok: true });
}
