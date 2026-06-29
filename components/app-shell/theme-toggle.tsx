"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";

// Header dark-mode toggle (UI spec §2). Writes data-theme on <html> via
// next-themes. Renders a stable placeholder until mounted to avoid hydration
// mismatch on the icon.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="grid size-[38px] place-items-center rounded-[11px] border border-line-strong bg-surface-2 text-ink-soft transition-[color,box-shadow,transform] hover:text-ink hover:shadow-[0_0_18px_var(--glow)] hover:-translate-y-px active:scale-[.98]"
    >
      {mounted && isDark ? (
        <SunIcon className="size-[18px]" />
      ) : (
        <MoonIcon className="size-[18px]" />
      )}
    </button>
  );
}
