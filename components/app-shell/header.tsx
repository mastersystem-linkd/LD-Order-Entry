"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftIcon, LogOutIcon, PanelLeftIcon } from "lucide-react";

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
}: {
  user: { name: string; role: Role };
  signOutAction: () => Promise<void>;
  onToggleSidebar?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="glass sticky top-0 z-20 flex items-center gap-3 border-b border-line px-5 py-3.5 lg:px-7">
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

      <h1 className="flex-1 font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
        {titleFor(pathname)}
      </h1>

      <ThemeToggle />

      <form action={signOutAction}>
        <button type="submit" aria-label="Sign out" className={iconBtn}>
          <LogOutIcon className="size-[18px]" />
        </button>
      </form>

      <div className="flex items-center gap-2.5 rounded-pill border border-line bg-surface py-1.5 pr-1.5 pl-3">
        <small className="text-right text-[12px] leading-tight text-ink-muted">
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
