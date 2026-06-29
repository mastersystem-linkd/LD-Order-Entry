"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { visibleNav, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = visibleNav(role);

  // Active = the nav item whose href is the longest prefix of the current path,
  // so /orders/new highlights "New order" rather than "Orders".
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="sticky top-0 flex h-svh w-[260px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 px-5 text-base font-semibold text-white">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[linear-gradient(135deg,#4F46E5,#6366F1)] text-xs">
          LD
        </span>
        Order Entry
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2">
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-5 py-4 text-xs text-sidebar-foreground/50">
        Signed in as {role.toLowerCase()}
      </div>
    </aside>
  );
}
