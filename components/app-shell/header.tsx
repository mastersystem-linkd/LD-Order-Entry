"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftIcon, LogOutIcon } from "lucide-react";

import { NAV_ITEMS, type Role } from "@/lib/rbac";
import { Button } from "@/components/ui/button";

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

export function Header({
  user,
  signOutAction,
}: {
  user: { name: string; role: Role };
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 bg-[linear-gradient(90deg,#4F46E5,#6366F1)] px-[30px] text-white">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/15"
      >
        <ArrowLeftIcon className="size-4" />
      </button>

      <h1 className="text-base font-semibold">{titleFor(pathname)}</h1>

      <div className="ml-auto flex items-center gap-4">
        <div className="text-right leading-tight">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-white/70">{user.role}</div>
        </div>
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/15 hover:text-white"
          >
            <LogOutIcon className="size-4" /> Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
