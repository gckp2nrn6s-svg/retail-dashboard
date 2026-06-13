import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const rows = await query<{ week_start: string; egp_per_usd: string }>(
    "SELECT week_start::date as week_start, egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 8"
  );
  const current = rows[0];
  return NextResponse.json({
    rate: parseFloat(current?.egp_per_usd || "50"),
    weekStart: current?.week_start,
    history: rows.map((r) => ({ date: r.week_start, rate: parseFloat(r.egp_per_usd) })),
  });
}
