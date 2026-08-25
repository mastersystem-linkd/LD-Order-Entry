"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// A wide table's horizontal scrollbar lives at the BOTTOM of the table, which
// on a long list means scrolling past every row to reach it. This adds a second
// scrollbar directly above the header row, kept in sync with the real one, so
// sideways scrolling is always available from the top.
//
// The bar only appears when the content actually overflows, so narrow tables
// are unaffected.
export function HScroll({
  children,
  bodyClassName,
  bodyStyle,
  className,
}: {
  children: React.ReactNode;
  /** Classes for the real scroll container (keep whatever it had: max-h, overflow-auto, …). */
  bodyClassName?: string;
  /** Inline styles for the scroll container — e.g. a measured max-height. */
  bodyStyle?: React.CSSProperties;
  className?: string;
}) {
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const topRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [overflows, setOverflows] = React.useState(false);

  // Track the table's real width. It changes with the data, the window, and
  // (in this app) expanding a row, so a one-off measurement is not enough.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.scrollWidth);
      setOverflows(el.scrollWidth - el.clientWidth > 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);

  // Mirror scrolling both ways. The guard stops the two handlers ping-ponging.
  const syncing = React.useRef(false);
  const mirror = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (syncing.current || !from || !to) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    // Released on the next frame: assigning scrollLeft fires the other handler.
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <div className={className}>
      <div
        ref={topRef}
        onScroll={() => mirror(topRef.current, bodyRef.current)}
        aria-hidden
        className={cn(
          "h-scrollbar overflow-x-auto overflow-y-hidden",
          overflows ? "block" : "hidden",
        )}
      >
        <div style={{ width, height: 1 }} />
      </div>
      <div
        ref={bodyRef}
        onScroll={() => mirror(bodyRef.current, topRef.current)}
        className={cn("h-scrollbar", bodyClassName)}
        style={bodyStyle}
      >
        {children}
      </div>
    </div>
  );
}
