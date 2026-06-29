import * as React from "react";

import { cn } from "@/lib/utils";

// Signature effect #1 (UI spec §4): orchestrated page-load reveal. Pure CSS
// (see .reveal / @keyframes rise in globals.css) — no JS animation library on
// the route, and it honours prefers-reduced-motion. `index` staggers siblings.
export function Reveal({
  children,
  delay,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  index?: number;
  className?: string;
}) {
  const d = delay ?? 0.04 + index * 0.06;
  return (
    <div className={cn("reveal", className)} style={{ animationDelay: `${d}s` }}>
      {children}
    </div>
  );
}
