"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftIcon,
} from "lucide-react";

import { NAV_ITEMS, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";

function titleFor(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/orders/new") return "New order";
  if (/^\/orders\/[^/]+\/edit$/.test(pathname)) return "Edit order";

  const match = NAV_ITEMS.filter(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  if (match) {
    if (match.href === "/orders" && pathname !== "/orders") return "Order detail";
    return match.label;
  }
  return "Order Entry";
}

const iconBtn =
  "grid size-[38px] place-items-center rounded-[10px] border border-line bg-surface text-ink-soft transition-colors hover:border-line-strong hover:bg-inset hover:text-ink active:scale-[.98]";

export function Header({
  user,
  signOutAction,
  onToggleSidebar,
  onOpenMobileNav,
}: {
  user: { name: string; role: Role };
  signOutAction: () => Promise<void>;
  onToggleSidebar?: () => void;
  onOpenMobileNav?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="glass sticky top-0 z-20 flex items-center gap-2 border-b border-line px-4 py-3.5 sm:gap-3 sm:px-5 lg:px-7">
      {onOpenMobileNav ? (
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          title="Menu"
          className={cn(iconBtn, "md:hidden")}
        >
          <MenuIcon className="size-[18px]" />
        </button>
      ) : null}
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          className={cn(iconBtn, "hidden md:grid")}
        >
          <PanelLeftIcon className="size-[18px]" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className={iconBtn}
      >
        <ArrowLeftIcon className="size-[18px]" />
      </button>

      <h1 className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold tracking-[-0.02em] text-ink sm:text-[20px]">
        {titleFor(pathname)}
      </h1>

      <ThemeToggle />

      <form action={signOutAction}>
        <button type="submit" aria-label="Sign out" className={iconBtn}>
          <LogOutIcon className="size-[18px]" />
        </button>
      </form>

      <div className="flex shrink-0 items-center gap-2.5 rounded-pill border border-line bg-surface p-1.5 sm:py-1.5 sm:pr-1.5 sm:pl-3">
        <small className="hidden text-right text-[12px] leading-tight text-ink-muted sm:block">
          <b className="block text-[13px] font-medium text-ink">{user.name}</b>
          {user.role}
        </small>
        <span className="grid size-8 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white">
          {user.name.charAt(0).toUpperCase()}
        </span>
      </div>
    </header>
  );
}
