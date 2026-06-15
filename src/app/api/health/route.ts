import { NextResponse } from "next/server";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue } from "@/lib/shopify";
import { safeSource } from "@/lib/resilience";
import { navDateToISO, lagDaysFrom } from "@/lib/dates";

// One-curl answer to "is everything up?". Pings each data source independently.
// GET /api/health
export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const [nav, pg, shopify] = await Promise.all([
    safeSource("nav", async () => {
      const rows = await navQuery<{ max_date: string }>(
        "SELECT MAX(CAST([Date] AS DATE)) AS max_date FROM TransSalesEntry", {}
      );
      const maxDate = navDateToISO(rows[0]?.max_date);
      return { maxDate, lagDays: lagDaysFrom(maxDate) };
    }, { maxDate: null as string | null, lagDays: null as number | null }),

    safeSource("pg", async () => {
      const rows = await query<{ egp_per_usd: string }>(
        "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
      );
      return { fx: rows[0]?.egp_per_usd ?? null };
    }, { fx: null as string | null }),

    safeSource("shopify", async () => {
      const r = await getShopifyRevenue(today, today);
      return { todayEgp: Math.round(r.egp), todayUnits: Math.round(r.units) };
    }, { todayEgp: 0, todayUnits: 0 }),
  ]);

  const allOk = nav.status === "ok" && pg.status === "ok" && shopify.status === "ok";

  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    checkedAt: new Date().toISOString(),
    sources: {
      nav:     { status: nav.status, ...nav.value },
      postgres:{ status: pg.status, ...pg.value },
      shopify: { status: shopify.status, ...shopify.value },
    },
  }, { status: allOk ? 200 : 503 });
}
