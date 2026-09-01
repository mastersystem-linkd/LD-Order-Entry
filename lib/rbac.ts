// Single source of truth for roles, capabilities, sidebar nav, and page-level
// access. Imported by both the (edge) middleware and the (server) shell, so it
// must stay free of Node-only imports (no DB here — capabilities are resolved
// from the DB into the session JWT at login; see lib/auth.ts).

// MANAGER was removed (migration 0006) — it was indistinguishable from ADMIN in
// the Access matrix, so it only duplicated a role that already exists.
// CRM was added in migration 0004 for the post-delivery follow-up module
// (§12). Unlike MANAGER it is NOT a duplicate access level: a coordinator
// needs to read orders and write follow-ups, and must not reach operations.
export type Role = "ADMIN" | "SALES" | "OPS" | "VIEWER" | "CRM";

export const ROLES: Role[] = ["ADMIN", "SALES", "OPS", "VIEWER", "CRM"];

// ---- Capabilities (the admin-editable access matrix, Settings → Access) ----
export type Capability =
  | "orders.view"
  | "orders.edit"
  | "operations.view"
  | "operations.edit"
  | "crm.view"
  | "crm.edit";

export const CAPABILITIES: {
  key: Capability;
  label: string;
  hint: string;
}[] = [
  {
    key: "orders.view",
    label: "View orders",
    hint: "Dashboard, orders list & detail, order status",
  },
  {
    key: "orders.edit",
    label: "Create / edit orders",
    hint: "New order, edit, delete",
  },
  {
    key: "operations.view",
    label: "View operations",
    hint: "See the 7-stage tracking board",
  },
  {
    key: "operations.edit",
    label: "Update operations",
    hint: "Mark stages done, set stock status",
  },
  {
    key: "crm.view",
    label: "View CRM",
    hint: "Follow-up queue, issues, customer history",
  },
  {
    key: "crm.edit",
    label: "Work the CRM queue",
    hint: "Log calls, rate orders, raise and resolve issues",
  },
];

export const CAPABILITY_KEYS: Capability[] = CAPABILITIES.map((c) => c.key);

// Roles configurable in the Access matrix. ADMIN is ALWAYS full access and is
// never stored or edited (so an admin can't lock everyone out of Settings).
export const EDITABLE_ROLES: Role[] = ["SALES", "OPS", "VIEWER", "CRM"];

// Default grants — mirror the role_permissions seed; used as a safety fallback
// when a role has no stored rows yet.
export const DEFAULT_ROLE_CAPS: Record<Role, Capability[]> = {
  ADMIN: [
    "orders.view",
    "orders.edit",
    "operations.view",
    "operations.edit",
    "crm.view",
    "crm.edit",
  ],
  SALES: ["orders.view", "orders.edit"],
  OPS: ["orders.view", "operations.view", "operations.edit"],
  VIEWER: ["orders.view", "operations.view"],
  // A coordinator reads the order to have context on the call, and writes only
  // CRM. Deliberately NOT given operations.* — complaint resolution must not
  // become a back door to ticking stages.
  CRM: ["orders.view", "crm.view", "crm.edit"],
};

// ⚠️ A NEW capability on an EXISTING role is not granted by these defaults.
// lib/auth.ts falls back to DEFAULT_ROLE_CAPS only when a role has ZERO stored
// rows in role_permissions; SALES/OPS/VIEWER already have rows, so crm.* is
// simply absent from their JWT unless migration 0004 inserted it. Meanwhile
// /api/access merges per-CELL with these defaults, so the Access screen would
// show a tick the session does not actually have. Seed, do not assume.

export function hasCap(
  caps: readonly string[] | undefined | null,
  cap: Capability,
): boolean {
  return !!caps && caps.includes(cap);
}

// ---- Sidebar nav ----
export type NavItem = {
  label: string;
  href: string;
  /** Capability required to see this item (omit = any authenticated user). */
  cap?: Capability;
  /** ADMIN-only (Settings & user/access management). */
  adminOnly?: boolean;
  /**
   * Nested items, rendered as an indented rail under the parent (CRM, §12).
   * A parent with children is still a real link — clicking it opens the first
   * child — so the group is never a dead label.
   */
  children?: NavItem[];
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "New order", href: "/orders/new", cap: "orders.edit" },
  { label: "Orders", href: "/orders", cap: "orders.view" },
  { label: "Order status", href: "/order-status", cap: "orders.view" },
  { label: "Operations", href: "/tracking", cap: "operations.view" },
  {
    label: "CRM",
    href: "/crm",
    cap: "crm.view",
    children: [
      { label: "Follow-ups", href: "/crm", cap: "crm.view" },
      { label: "Issues", href: "/crm/issues", cap: "crm.view" },
      // The record of what customers SAID — feedback, scores and reorder
      // requests were written by the call panel and readable nowhere else.
      { label: "Call log", href: "/crm/calls", cap: "crm.view" },
      { label: "Customers", href: "/crm/customers", cap: "crm.view" },
      { label: "CRM analytics", href: "/crm/analytics", cap: "crm.view" },
    ],
  },
  // Trash lives inside Settings (a tab), not as its own sidebar item.
  { label: "Settings", href: "/settings", adminOnly: true },
];

export function visibleNav(role: Role, caps: readonly string[]): NavItem[] {
  const allowed = (item: NavItem): boolean => {
    if (item.adminOnly) return role === "ADMIN";
    if (item.cap) return role === "ADMIN" || hasCap(caps, item.cap);
    return true;
  };
  // Children are filtered too — without this a nested item would bypass the
  // capability gate its parent enforces. A group whose children are all hidden
  // is dropped entirely rather than left as a link to nothing.
  return NAV_ITEMS.filter(allowed).flatMap((item) => {
    if (!item.children) return [item];
    const children = item.children.filter(allowed);
    return children.length ? [{ ...item, children }] : [];
  });
}

// ---- Page-level route access ----
// ADMIN sees everything. Otherwise access is by CAPABILITY (resolved into the
// session at login). Settings is ADMIN-only; the dashboard "/" is the always-
// available landing so a role can never be redirect-looped out of the app.
export function canAccessPath(
  role: Role,
  caps: readonly string[],
  pathname: string,
): boolean {
  if (role === "ADMIN") return true;

  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return false;
  }
  if (pathname === "/") return true;

  // Trash (soft-deleted orders/designs — restore & permanent delete) → orders.edit.
  if (pathname === "/trash" || pathname.startsWith("/trash/")) {
    return hasCap(caps, "orders.edit");
  }
  // New order + edit order → orders.edit (most specific, check first).
  if (pathname === "/orders/new" || /^\/orders\/[^/]+\/edit$/.test(pathname)) {
    return hasCap(caps, "orders.edit");
  }
  // Orders list / detail + order status → orders.view.
  if (
    pathname === "/orders" ||
    pathname.startsWith("/orders/") ||
    pathname === "/order-status" ||
    pathname.startsWith("/order-status/")
  ) {
    return hasCap(caps, "orders.view");
  }
  // Operations tracking → operations.view.
  if (pathname === "/tracking" || pathname.startsWith("/tracking/")) {
    return hasCap(caps, "operations.view");
  }
  // CRM (§12) → crm.view. This branch MUST exist: the fallthrough below is
  // `return true`, so without it every authenticated user — VIEWER included —
  // could load the follow-up queue.
  if (pathname === "/crm" || pathname.startsWith("/crm/")) {
    return hasCap(caps, "crm.view");
  }

  return true;
}
