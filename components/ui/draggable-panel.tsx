"use client";

import * as React from "react";
import { GripHorizontalIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The floating detail window, extracted from the order tracker so a second
// screen can have one without a second implementation of the drag.
//
// It is a COPY of the behaviour in components/order-status/order-tracker.tsx
// (the wrapper at ~:512 and startDrag/onDragMove/endDrag at ~:218), not a move:
// that screen is working and shipped, and rewiring it to import this would mean
// re-testing it for no functional gain. If a third caller ever appears, that is
// the moment to collapse the two.
//
// Behaviour, matched deliberately: anchored top-right until first dragged, then
// switched to explicit coordinates; clamped so a grabbable strip always stays on
// screen; double-click the bar to snap back; Esc closes.
export function DraggablePanel({
  title,
  subtitle,
  headerAside,
  onClose,
  footer,
  children,
  className,
  tinted = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Sits right of the title, left of the close button — status, a value, a count. */
  headerAside?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Tint the title bar with the accent wash (the CRM call panel does). */
  tinted?: boolean;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const dragOffset = React.useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function startDrag(e: React.PointerEvent) {
    const el = panelRef.current;
    if (!el || e.button !== 0) return;
    // Never start a drag from a control inside the bar. setPointerCapture below
    // redirects every subsequent pointer event to the header, so without this
    // the close button never receives its click and the panel cannot be shut.
    if ((e.target as HTMLElement).closest("button")) return;
    const r = el.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPos({ x: r.left, y: r.top });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragMove(e: React.PointerEvent) {
    const off = dragOffset.current;
    const el = panelRef.current;
    if (!off || !el) return;
    const r = el.getBoundingClientRect();
    // Keep a grabbable strip on screen whichever way it is dragged.
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 48;
    setPos({
      x: Math.min(Math.max(e.clientX - off.dx, 80 - r.width), maxX),
      y: Math.min(Math.max(e.clientY - off.dy, 8), maxY),
    });
  }
  function endDrag() {
    dragOffset.current = null;
  }

  return (
    <div
      ref={panelRef}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // Centred until dragged. It used to be pinned top-right at 560px, which
      // on a wide screen put a tall form in the corner with the two-column
      // sections wrapping and the ratings below the fold. Centred and wider,
      // the whole call fits with far less scrolling, and it can still be
      // dragged aside to read the queue underneath.
      style={
        pos
          ? { left: pos.x, top: pos.y }
          : { left: "50%", top: "6rem", transform: "translateX(-50%)" }
      }
      className={cn(
        "fixed z-30 flex max-h-[calc(100vh-9rem)] w-[min(96vw,1080px)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-[0_24px_64px_-16px_rgba(16,20,40,0.35),0_2px_8px_rgba(16,20,40,0.10)] ring-1 ring-black/[0.03]",
        className,
      )}
    >
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => setPos(null)}
        title="Drag to move · double-click to snap back"
        className={cn(
          "flex cursor-grab touch-none items-center gap-3 border-b border-line px-5 py-3.5 select-none active:cursor-grabbing",
          // A soft vertical wash rather than a flat fill — the header reads as
          // the top of a sheet instead of a coloured strip.
          tinted &&
            "bg-gradient-to-b from-accent-soft to-[color-mix(in_oklab,var(--accent-soft)_55%,var(--surface))]",
        )}
      >
        <GripHorizontalIcon
          className={cn(
            "size-4 shrink-0 opacity-60",
            tinted ? "text-accent-deep" : "text-ink-muted",
          )}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-[15px] leading-tight font-semibold tracking-[-0.01em]",
              tinted ? "text-accent-deep" : "text-ink",
            )}
          >
            {title}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">{subtitle}</div>
          ) : null}
        </div>
        {headerAside ? (
          <div className="flex shrink-0 items-center gap-2">{headerAside}</div>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {footer ? (
        <div className="flex items-center gap-2 border-t border-line bg-surface-2/80 px-5 py-3 backdrop-blur-sm">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
