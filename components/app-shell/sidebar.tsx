"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGridIcon,
  PlusIcon,
  SettingsIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

import { visibleNav, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";

// Visual-only icon mapping per nav href (UI spec §5).
const NAV_ICONS: Record<string, LucideIcon> = {
  "/orders/new": PlusIcon,
  "/orders": LayoutGridIcon,
  "/tracking": WorkflowIcon,
  "/settings": SettingsIcon,
};

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = visibleNav(role);

  // Active = the nav item whose href is the longest prefix of the current path,
  // so /orders/new highlights "New order" rather than "Orders".
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="glass sticky top-0 hidden h-svh w-[256px] shrink-0 flex-col gap-6 border-r border-line-strong p-3.5 pt-5 md:flex">
      <div className="flex items-center gap-3 px-1.5 py-1">
        <span className="grid size-[42px] place-items-center rounded-[13px] bg-[linear-gradient(140deg,var(--a1),var(--a2))] font-display text-base font-semibold text-white shadow-[0_8px_22px_var(--glow),inset_0_1px_0_rgba(255,255,255,.4)] motion-safe:animate-[floaty_5s_ease-in-out_infinite]">
          LD
        </span>
        <b className="font-display text-base font-semibold tracking-[-0.02em] text-ink">
          Order Entry
        </b>
      </div>

      <nav className="flex flex-col gap-1.5">
        {items.map((item) => {
          const active = item.href === activeHref;
          const Icon = NAV_ICONS[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-[12px] border border-transparent px-3 py-[11px] text-sm font-medium transition-[background,color,transform,box-shadow] duration-200",
                active
                  ? "bg-[linear-gradient(120deg,var(--a1),var(--a2))] text-white shadow-[0_8px_22px_var(--glow)]"
                  : "text-ink-soft hover:translate-x-[3px] hover:bg-surface-2 hover:text-ink",
              )}
            >
              {Icon ? <Icon className="size-[18px]" /> : null}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 rounded-[13px] border border-line-strong bg-surface-2 p-2.5">
        <span className="grid size-[30px] place-items-center rounded-full bg-[linear-gradient(140deg,var(--a2),var(--a1))] text-[12px] font-semibold text-white">
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
  );
}
