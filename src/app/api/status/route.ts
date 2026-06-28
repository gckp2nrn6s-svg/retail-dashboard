import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { navQuery } from "@/lib/navdb";
import { query } from "@/lib/db";
import { getShopifyRevenue } from "@/lib/shopify";
import { safeSource } from "@/lib/resilience";
import { navDateToISO, lagDaysFrom } from "@/lib/dates";

export const dynamic = "force-dynamic";

type Health = "ok" | "degraded" | "down";
interface SystemRow { key: string; label: string; group: string; status: Health; detail: string; lastUpdated: string | null }

// GET /api/status — admin-only health board across every data source + sync.
export async function GET() {
  const s = await getServerSession(authOptions);
  if ((s?.user as { role?: string } | undefined)?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Run every check in PARALLEL — a status board must be snappy, and the NAV /
  // Shopify round-trips are slow individually.
  const [pg, nav, sh, fd, wh, fx] = await Promise.all([
    safeSource("pg", async () => (await query<{ t: string }>("SELECT now() AS t"))[0]?.t ?? null, null),
    safeSource("nav", async () => {
      const r = await navQuery<{ d: string }>("SELECT MAX(CAST([Date] AS DATE)) AS d FROM TransSalesEntry", {});
      const maxDate = navDateToISO(r[0]?.d);
      return { maxDate, lag: lagDaysFrom(maxDate) };
    }, { maxDate: null as string | null, lag: null as number | null }),
    safeSource("shopify", async () => {
      const r = await getShopifyRevenue(today, today);
      return { egp: Math.round(r.egp), units: Math.round(r.units) };
    }, { egp: 0, units: 0 }),
    safeSource("pg", async () => (await query<{ synced_at: string | null; rows: number | null; total_egp: string | null; ok: boolean | null }>(
      "SELECT synced_at, rows, total_egp, ok FROM factory_direct_sync WHERE id=1"))[0] ?? null, null),
    safeSource("nav", async () => (await navQuery<{ inv: number; tl: number }>(
      "SELECT (SELECT COUNT(*) FROM InventoryOnHand) AS inv, (SELECT COUNT(*) FROM TransferLines) AS tl", {}))[0] ?? null, null),
    safeSource("pg", async () => (await query<{ w: string; fx: string }>(
      "SELECT week_start AS w, egp_per_usd AS fx FROM fx_rates ORDER BY week_start DESC LIMIT 1"))[0] ?? null, null),
  ]);

  const systems: SystemRow[] = [];

  systems.push({ key: "db", label: "Dashboard database", group: "Core systems",
    status: pg.status === "ok" ? "ok" : "down",
    detail: pg.status === "ok" ? "Connected · Railway Postgres" : "Unreachable",
    lastUpdated: pg.value });

  systems.push({ key: "nav", label: "NAV / ERP (Microsoft Dynamics)", group: "Core systems",
    status: nav.status !== "ok" ? "down" : (nav.value.lag != null && nav.value.lag > 2 ? "degraded" : "ok"),
    detail: nav.status !== "ok" ? "Connection unreachable" : `Latest posted sale ${nav.value.maxDate} · ${nav.value.lag} day(s) behind`,
    lastUpdated: nav.value.maxDate });

  systems.push({ key: "shopify", label: "Shopify (online store)", group: "Integrations",
    status: sh.status === "ok" ? "ok" : "down",
    detail: sh.status === "ok" ? `Live API · today ${sh.value.egp.toLocaleString()} EGP, ${sh.value.units} units` : "API unreachable",
    lastUpdated: sh.status === "ok" ? new Date().toISOString() : null });

  if (fd.value) {
    const ageH = fd.value.synced_at ? (Date.now() - new Date(fd.value.synced_at).getTime()) / 3.6e6 : null;
    systems.push({ key: "factory", label: "Factory-direct sheet (Google Sheets → B2B)", group: "Integrations",
      status: fd.value.ok === false ? "down" : (ageH != null && ageH > 24 ? "degraded" : "ok"),
      detail: fd.value.ok === false ? "Last sync failed" : `${(fd.value.rows ?? 0).toLocaleString()} rows · ${Math.round(Number(fd.value.total_egp) || 0).toLocaleString()} EGP`,
      lastUpdated: fd.value.synced_at });
  }

  systems.push({ key: "warehouse", label: "Warehouse stock replica (NAV refresh)", group: "Sync jobs",
    status: wh.status !== "ok" || !wh.value ? "down" : (Number(wh.value.inv) > 0 ? "ok" : "degraded"),
    detail: wh.status !== "ok" ? "Unreachable" : `${Number(wh.value?.inv || 0).toLocaleString()} on-hand rows · ${Number(wh.value?.tl || 0).toLocaleString()} transfer lines · rebuilds every 15 min`,
    lastUpdated: null });

  if (fx.value) systems.push({ key: "fx", label: "FX rate (EGP / USD)", group: "Integrations",
    status: "ok", detail: `1 USD = ${fx.value.fx} EGP`, lastUpdated: fx.value.w });

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    summary: { ok: systems.filter(s => s.status === "ok").length, total: systems.length, allOk: systems.every(s => s.status === "ok") },
    systems,
  });
}
