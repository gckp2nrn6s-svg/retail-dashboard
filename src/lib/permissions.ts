// Canonical permission model — pure (client- and server-safe). The "User" table
// stores per-user `permissions` JSON; admins bypass every check.

export const TABS = [
  { key: "home",        label: "Home",        href: "/dashboard" },
  { key: "live",        label: "Live",        href: "/dashboard/live" },
  { key: "sales",       label: "Sales",       href: "/dashboard/sales" },
  { key: "marketplace", label: "Marketplace", href: "/dashboard/marketplace" },
  { key: "b2b",         label: "B2B",         href: "/dashboard/b2b" },
  { key: "warehouse",   label: "Warehousing", href: "/dashboard/warehouse" },
  { key: "stock",       label: "Stock",       href: "/dashboard/stock" },
  { key: "targets",     label: "Targets",     href: "/dashboard/targets" },
  { key: "catalogue",   label: "Products",    href: "/dashboard/catalogue" },
  { key: "egypt",       label: "Made in EG",  href: "/dashboard/egypt" },
  { key: "marketing",   label: "Marketing",   href: "/dashboard/marketing" },
  { key: "ask",         label: "Ask AI",      href: "/dashboard/ask" },
] as const;

// "users" (manage users) is admin-only and never grantable to a member.
export const ADMIN_ONLY_TABS = ["users"] as const;

// Fine-grained warehouse write actions, mapped to their API routes.
export const WH_ACTIONS = [
  { key: "submit",     label: "Submit POs (deduct stock)",     route: "submit" },
  { key: "adjust",     label: "Adjust stock",                  route: "adjust" },
  { key: "receive",    label: "Receive incoming",              route: "receive" },
  { key: "papercheck", label: "Paper-check transfers",         route: "paper-check" },
  { key: "ho",         label: "HO sales (deduct / add stock)", route: "ho-apply" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
export type WhAction = (typeof WH_ACTIONS)[number]["key"];

export interface Permissions {
  tabs: string[];                  // allowed tab keys (members)
  wh: Record<string, boolean>;     // warehouse action flags (members)
}

export const EMPTY_PERMISSIONS: Permissions = { tabs: [], wh: {} };

/** Parse whatever is stored (JSON string / object / null) into a safe Permissions. */
export function parsePermissions(raw: unknown): Permissions {
  let p: unknown = raw;
  if (typeof raw === "string") { try { p = JSON.parse(raw); } catch { p = null; } }
  const o = (p && typeof p === "object") ? p as Record<string, unknown> : {};
  return {
    tabs: Array.isArray(o.tabs) ? o.tabs.map(String) : [],
    wh: (o.wh && typeof o.wh === "object") ? o.wh as Record<string, boolean> : {},
  };
}

export const isAdmin = (role?: string | null) => role === "admin";

/** Can this user open a tab? Admins: everything. Members: only granted tabs. */
export function canSeeTab(role: string | null | undefined, perms: Permissions | null, tabKey: string): boolean {
  if (isAdmin(role)) return true;
  if ((ADMIN_ONLY_TABS as readonly string[]).includes(tabKey)) return false;
  return !!perms?.tabs?.includes(tabKey);
}

/** Can this user perform a warehouse write action? Admins: yes. */
export function canDoWh(role: string | null | undefined, perms: Permissions | null, action: string): boolean {
  if (isAdmin(role)) return true;
  return !!perms?.wh?.[action];
}
