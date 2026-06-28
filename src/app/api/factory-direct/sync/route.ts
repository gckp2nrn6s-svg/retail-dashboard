import { NextRequest, NextResponse } from "next/server";
import { syncFactoryDirect, lastFactorySync } from "@/lib/factory-direct";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/factory-direct/sync?key=…  — pull the live sheet into Postgres.
// Protected by FACTORY_SYNC_KEY when set (so an external scheduler can call it);
// if the env var is unset, it's open (local/dev).
export async function POST(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key");
  if (process.env.FACTORY_SYNC_KEY && key !== process.env.FACTORY_SYNC_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await syncFactoryDirect();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

// GET — last sync status (no trigger).
export async function GET() {
  return NextResponse.json((await lastFactorySync()) ?? { synced_at: null });
}
