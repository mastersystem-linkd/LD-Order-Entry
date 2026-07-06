// Single source of truth for roles, capabilities, sidebar nav, and page-level
// access. Imported by both the (edge) middleware and the (server) shell, so it
// must stay free of Node-only imports (no DB here — capabilities are resolved
// from the DB into the session JWT at login; see lib/auth.ts).

export type Role = "ADMIN" | "MANAGER" | "SALES" | "OPS" | "VIEWER";

export const ROLES: Role[] = ["ADMIN", "MANAGER", "SALES", "OPS", "VIEWER"];

// ---- Capabilities (the admin-editable access matrix, Settings → Access) ----
export type Capability =
  | "orders.view"
  | "orders.edit"
  | "operations.view"
  | "operations.edit";

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
];

export const CAPABILITY_KEYS: Capability[] = CAPABILITIES.map((c) => c.key);

// Roles configurable in the Access matrix. ADMIN is ALWAYS full access and is
// never stored or edited (so an admin can't lock everyone out of Settings).
export const EDITABLE_ROLES: Role[] = ["MANAGER", "SALES", "OPS", "VIEWER"];

// Default grants — mirror the role_permissions seed; used as a safety fallback
// when a role has no stored rows yet.
export const DEFAULT_ROLE_CAPS: Record<Role, Capability[]> = {
  ADMIN: ["orders.view", "orders.edit", "operations.view", "operations.edit"],
  MANAGER: ["orders.view", "orders.edit", "operations.view", "operations.edit"],
  SALES: ["orders.view", "orders.edit"],
  OPS: ["orders.view", "operations.view", "operations.edit"],
  VIEWER: ["orders.view", "operations.view"],
};

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
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "New order", href: "/orders/new", cap: "orders.edit" },
  { label: "Orders", href: "/orders", cap: "orders.view" },
  { label: "Order status", href: "/order-status", cap: "orders.view" },
  { label: "Operations", href: "/tracking", cap: "operations.view" },
  // Trash lives inside Settings (a tab), not as its own sidebar item.
  { label: "Settings", href: "/settings", adminOnly: true },
];

export function visibleNav(role: Role, caps: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return role === "ADMIN";
    if (item.cap) return role === "ADMIN" || hasCap(caps, item.cap);
    return true;
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

  return true;
}
