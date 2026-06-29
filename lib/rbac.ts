// Single source of truth for roles, sidebar nav, and page-level access.
// Imported by both the (edge) middleware and the (server) shell, so it must
// stay free of Node-only imports.

export type Role = "ADMIN" | "SALES" | "OPS" | "VIEWER";

export const ROLES: Role[] = ["ADMIN", "SALES", "OPS", "VIEWER"];

export type NavItem = {
  label: string;
  href: string;
  /** Roles that see this item in the sidebar. */
  roles: Role[];
};

// Sidebar nav (CLAUDE.md OE-P1 §3). Visibility mirrors canAccessPath below.
export const NAV_ITEMS: NavItem[] = [
  { label: "New order", href: "/orders/new", roles: ["ADMIN", "SALES"] },
  { label: "Orders", href: "/orders", roles: ["ADMIN", "SALES", "OPS", "VIEWER"] },
  { label: "Operations", href: "/tracking", roles: ["ADMIN", "OPS", "VIEWER"] },
  { label: "Settings", href: "/settings", roles: ["ADMIN"] },
];

export function visibleNav(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

// Page-level route access (OE-P1 §2):
//   ADMIN  = everything
//   SALES  = order entry/edit + dashboard (no tracking)
//   OPS    = tracking + dashboard (read orders), no order entry/edit
//   VIEWER = read-only (dashboard, order detail, tracking view)
export function canAccessPath(role: Role, pathname: string): boolean {
  if (role === "ADMIN") return true;

  // New order + edit order → SALES only (besides ADMIN). Check first (most specific).
  if (pathname === "/orders/new" || /^\/orders\/[^/]+\/edit$/.test(pathname)) {
    return role === "SALES";
  }

  // Orders dashboard / list / detail (read) → SALES, OPS, VIEWER.
  if (pathname === "/orders" || pathname.startsWith("/orders/")) {
    return role === "SALES" || role === "OPS" || role === "VIEWER";
  }

  // Operations tracking → OPS (update) + VIEWER (read). SALES has no tracking.
  if (pathname === "/tracking" || pathname.startsWith("/tracking/")) {
    return role === "OPS" || role === "VIEWER";
  }

  // Settings & master data → ADMIN only (handled by the early return above).
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return false;
  }

  // Home and any other authenticated page.
  return true;
}
