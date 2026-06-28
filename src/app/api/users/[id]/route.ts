import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

async function session() {
  const s = await getServerSession(authOptions);
  return s?.user as { id?: string; role?: string } | undefined;
}
async function activeAdminCount(): Promise<number> {
  const r = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "User" WHERE role='admin' AND active`);
  return r[0]?.n ?? 0;
}

// PATCH /api/users/:id — update name / role / permissions / active / password (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await session();
  if (me?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  let b: { name?: string; role?: string; active?: boolean; password?: string; permissions?: { tabs?: unknown; wh?: unknown } };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const target = (await query<{ role: string; active: boolean }>(`SELECT role, active FROM "User" WHERE id=$1`, [id]))[0];
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Guard: never strip the last active admin (demote or deactivate).
  const demoting = b.role !== undefined && b.role !== "admin" && target.role === "admin";
  const deactivating = b.active === false && target.active && target.role === "admin";
  if ((demoting || deactivating) && (await activeAdminCount()) <= 1) {
    return NextResponse.json({ error: "can't remove the last active admin" }, { status: 400 });
  }

  const sets: string[] = []; const vals: (string | number | boolean | null)[] = [];
  const add = (frag: string, v: string | number | boolean | null) => { vals.push(v); sets.push(`${frag} $${vals.length}`); };
  if (typeof b.name === "string")   add(`name =`, b.name.trim());
  if (b.role !== undefined)         add(`role =`, b.role === "admin" ? "admin" : "member");
  if (typeof b.active === "boolean") add(`active =`, b.active);
  if (b.permissions !== undefined) {
    const perms = { tabs: Array.isArray(b.permissions.tabs) ? b.permissions.tabs.map(String) : [], wh: (b.permissions.wh && typeof b.permissions.wh === "object") ? b.permissions.wh : {} };
    add(`permissions =`, JSON.stringify(perms)); sets[sets.length - 1] += "::jsonb";
  }
  if (b.password) {
    if (String(b.password).length < 6) return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
    add(`password =`, await bcrypt.hash(String(b.password), 10));
  }
  if (!sets.length) return NextResponse.json({ ok: true });

  vals.push(id);
  await query(`UPDATE "User" SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  return NextResponse.json({ ok: true });
}

// DELETE /api/users/:id (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await session();
  if (me?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (id === me.id) return NextResponse.json({ error: "you can't delete your own account" }, { status: 400 });

  const target = (await query<{ role: string }>(`SELECT role FROM "User" WHERE id=$1`, [id]))[0];
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (target.role === "admin" && (await activeAdminCount()) <= 1) {
    return NextResponse.json({ error: "can't delete the last active admin" }, { status: 400 });
  }
  await query(`DELETE FROM "User" WHERE id=$1`, [id]);
  return NextResponse.json({ ok: true });
}
