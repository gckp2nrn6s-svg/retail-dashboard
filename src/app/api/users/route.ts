import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { parsePermissions } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

async function isAdminSession(): Promise<boolean> {
  const s = await getServerSession(authOptions);
  return (s?.user as { role?: string } | undefined)?.role === "admin";
}

interface UserRow { id: string; email: string; name: string; role: string; permissions: unknown; active: boolean; createdAt: string }

// GET /api/users — list (admin only)
export async function GET() {
  if (!(await isAdminSession())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await query<UserRow>(`SELECT id, email, name, role, permissions, active, "createdAt" FROM "User" ORDER BY (role='admin') DESC, LOWER(email)`);
  return NextResponse.json({ users: rows.map(u => ({ ...u, permissions: parsePermissions(u.permissions) })) });
}

// POST /api/users — create (admin only)
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let b: { email?: string; name?: string; password?: string; role?: string; permissions?: { tabs?: unknown; wh?: unknown } };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const login = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim() || login;
  const password = String(b.password || "");
  const role = b.role === "admin" ? "admin" : "member";
  const permissions = {
    tabs: Array.isArray(b.permissions?.tabs) ? b.permissions!.tabs!.map(String) : [],
    wh: (b.permissions?.wh && typeof b.permissions.wh === "object") ? b.permissions.wh : {},
  };
  if (!login) return NextResponse.json({ error: "username / email is required" }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });

  const exists = await query(`SELECT 1 FROM "User" WHERE LOWER(email) = LOWER($1)`, [login]);
  if (exists.length) return NextResponse.json({ error: "that username / email is already taken" }, { status: 409 });

  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  await query(
    `INSERT INTO "User" (id, email, name, password, role, permissions, active, "createdAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,now())`,
    [id, login, name, hash, role, JSON.stringify(permissions)]
  );
  return NextResponse.json({ ok: true, id });
}
