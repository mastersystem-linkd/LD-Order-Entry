"use client";

import * as React from "react";

import type { Role } from "@/lib/rbac";
import { Sidebar } from "@/components/app-shell/sidebar";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { Header } from "@/components/app-shell/header";
import { Footer } from "@/components/app-shell/footer";

// Client shell: owns the collapsible-sidebar state (persisted) so the content
// area can take the full screen when the sidebar is collapsed.
export function AppShell({
  role,
  user,
  signOutAction,
  children,
}: {
  role: Role;
  user: { name: string; role: Role };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (localStorage.getItem("sidebar-collapsed") === "1") setCollapsed(true);
    } catch {}
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  return (
    <div className="relative z-[1] flex min-h-svh">
      <Sidebar role={role} collapsed={collapsed} onToggle={toggle} />
      <MobileNav
        role={role}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <Header
          user={user}
          signOutAction={signOutAction}
          onToggleSidebar={toggle}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="w-full flex-1 px-4 py-4 sm:px-5 sm:py-5 lg:px-7">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
