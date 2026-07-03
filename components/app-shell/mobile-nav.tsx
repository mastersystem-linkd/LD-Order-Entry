"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  LayoutGridIcon,
  ListChecksIcon,
  PlusIcon,
  SettingsIcon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { visibleNav, type Capability, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";

// Visual-only icon mapping per nav href (mirrors sidebar.tsx).
const NAV_ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboardIcon,
  "/orders/new": PlusIcon,
  "/orders": LayoutGridIcon,
  "/order-status": ListChecksIcon,
  "/tracking": WorkflowIcon,
  "/settings": SettingsIcon,
};

// Mobile-only slide-in nav drawer (below md). Mirrors the desktop sidebar's
// visual language. Closes on backdrop click, Escape, and link tap.
export function MobileNav({
  role,
  caps,
  open,
  onClose,
}: {
  role: Role;
  caps: Capability[];
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const items = visibleNav(role, caps);

  // Active = the nav item whose href is the longest prefix of the current path.
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/40"
      />

      {/* Panel */}
      <aside className="glass absolute inset-y-0 left-0 flex h-full w-[272px] max-w-[85vw] flex-col gap-5 border-r border-line p-3 pt-4 shadow-lg">
        {/* Brand + close */}
        <div className="flex items-center gap-2.5 px-1 py-1">
          <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-accent font-display text-[15px] font-semibold text-white shadow-sm">
            LD
          </span>
          <b className="flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
            Order Entry
          </b>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-inset hover:text-ink"
          >
            <XIcon className="size-[18px]" />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            Menu
          </p>
          {items.map((item) => {
            const active = item.href === activeHref;
            const Icon = NAV_ICONS[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] px-3 py-[11px] text-[14px] font-medium transition-colors duration-150",
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
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 rounded-[12px] border border-line bg-surface-2 p-2.5">
          <span className="grid size-[32px] shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">
            {role.charAt(0)}
          </span>
          <small className="text-[12px] leading-tight text-ink-muted">
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
