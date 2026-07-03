"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  LayoutGridIcon,
  ListChecksIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SettingsIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

import { visibleNav, type Capability, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";

// Visual-only icon mapping per nav href.
const NAV_ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboardIcon,
  "/orders/new": PlusIcon,
  "/orders": LayoutGridIcon,
  "/order-status": ListChecksIcon,
  "/tracking": WorkflowIcon,
  "/settings": SettingsIcon,
};

export function Sidebar({
  role,
  caps,
  collapsed,
  onToggle,
}: {
  role: Role;
  caps: Capability[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const items = visibleNav(role, caps);

  // Active = the nav item whose href is the longest prefix of the current path.
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // When collapsed, the in-flow rail stays 64px and the aside expands OVER the
  // content on hover (peek) without shifting the page. `group/sb` drives it.
  const peek = "hidden group-hover/sb:block";
  const peekInline = "hidden group-hover/sb:inline";

  return (
    <div
      className={cn(
        "hidden shrink-0 transition-[width] duration-200 md:block",
        collapsed ? "w-16" : "w-[252px]",
      )}
    >
      <aside
        className={cn(
          "group/sb glass sticky top-0 flex h-svh flex-col gap-5 border-r border-line p-3 pt-4 transition-[width] duration-200",
          collapsed
            ? "w-16 hover:z-30 hover:w-[252px] hover:shadow-lg"
            : "w-[252px]",
        )}
      >
        {/* Brand + collapse/pin toggle */}
        <div className="flex items-center gap-2.5 px-1 py-1">
          <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-accent font-display text-[15px] font-semibold text-white shadow-sm">
            LD
          </span>
          <b
            className={cn(
              "flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.02em] text-ink",
              collapsed && peek,
            )}
          >
            Order Entry
          </b>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Pin sidebar open" : "Collapse sidebar"}
            title={collapsed ? "Pin open" : "Collapse"}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-inset hover:text-ink",
              collapsed && "hidden group-hover/sb:grid",
            )}
          >
            {collapsed ? (
              <PanelLeftOpenIcon className="size-[18px]" />
            ) : (
              <PanelLeftCloseIcon className="size-[18px]" />
            )}
          </button>
        </div>

        <nav className="flex flex-col gap-0.5">
          <p
            className={cn(
              "px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted",
              collapsed && peek,
            )}
          >
            Menu
          </p>
          {items.map((item) => {
            const active = item.href === activeHref;
            const Icon = NAV_ICONS[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] px-3 py-[9px] text-[13.5px] font-medium transition-colors duration-150",
                  collapsed && "justify-center group-hover/sb:justify-start",
                  active
                    ? "bg-accent text-white shadow-sm"
                    : "text-ink-soft hover:bg-inset hover:text-ink",
                )}
              >
                {Icon ? (
                  <Icon
                    className={cn(
                      "size-[18px] shrink-0",
                      active ? "text-white" : "text-ink-muted",
                    )}
                  />
                ) : null}
                <span className={cn("truncate", collapsed && peekInline)}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            "mt-auto flex items-center gap-2.5 rounded-[12px] border border-line bg-surface-2 p-2.5",
            collapsed && "justify-center group-hover/sb:justify-start",
          )}
        >
          <span className="grid size-[32px] shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">
            {role.charAt(0)}
          </span>
          <small
            className={cn(
              "text-[12px] leading-tight text-ink-muted",
              collapsed && peek,
            )}
          >
            <b className="block text-[12.5px] font-medium text-ink">
              {role.charAt(0) + role.slice(1).toLowerCase()}
            </b>
            Signed in as {role.toLowerCase()}
          </small>
        </div>
      </aside>
    </div>
  );
}
