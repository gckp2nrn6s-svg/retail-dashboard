import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canDoWh, type Permissions } from "@/lib/permissions";

/** The signed-in user (id/role/permissions) from the session, or null. */
export async function sessionUser(): Promise<{ id?: string; role?: string; permissions: Permissions | null } | null> {
  const s = await getServerSession(authOptions);
  const u = s?.user as { id?: string; role?: string; permissions?: Permissions } | undefined;
  return u ? { id: u.id, role: u.role, permissions: u.permissions ?? null } : null;
}

/** True if the current user may perform a warehouse write action (admins always). */
export async function canWh(action: string): Promise<boolean> {
  const u = await sessionUser();
  if (!u) return false;
  return canDoWh(u.role, u.permissions, action);
}
