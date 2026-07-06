"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

// Segmented Light / Dark switch for the login form panel. Writes data-theme on
// <html> via next-themes (same mechanism as the in-app header toggle). Renders a
// stable "light" state until mounted to avoid a hydration mismatch.
export function LoginThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const active = mounted ? resolvedTheme : "light";

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex rounded-full border border-line bg-surface p-[3px] shadow-sm"
    >
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
          aria-pressed={active === t}
          className={cn(
            "rounded-full px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors",
            active === t
              ? "bg-ink text-surface"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
