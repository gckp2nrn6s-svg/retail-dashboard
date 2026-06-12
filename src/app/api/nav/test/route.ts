import { NextResponse } from "next/server";
import { testNavConnection } from "@/lib/nav";

export async function GET() {
  const result = await testNavConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
