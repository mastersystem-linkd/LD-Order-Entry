"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// How many suggestions to render at once. Beyond this the user narrows by typing
// (filtering is instant); a footer notes how many more match.
const MAX_SUGGESTIONS = 50;

// Free-text input with a suggestion dropdown (CLAUDE.md §4): suggestions help,
// but any value is allowed — an unknown fabric/party/design is never blocked.
// The suggestion list is rendered in a portal (document.body) so it can never be
// clipped by an ancestor's `overflow-hidden`/`overflow-x-auto` (e.g. the fabric
// block card or the line-item horizontal-scroll container).
export function Autocomplete({
  value,
  onValueChange,
  suggestions,
  className,
  onBlur,
  ...inputProps
}: {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: string[];
} & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [rect, setRect] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const { matches, more } = React.useMemo(() => {
    const v = value.trim().toLowerCase();
    if (!v) {
      // Nothing typed → browse the whole list (scrollable), first page of it.
      return {
        matches: suggestions.slice(0, MAX_SUGGESTIONS),
        more: Math.max(0, suggestions.length - MAX_SUGGESTIONS),
      };
    }
    // Rank: values that START with the typed text first, then ones that merely
    // contain it — so typing "mil" surfaces "Milano" at the top.
    const starts: string[] = [];
    const contains: string[] = [];
    for (const s of suggestions) {
      const l = s.toLowerCase();
      if (l === v) continue; // already fully typed — nothing to suggest
      if (l.startsWith(v)) starts.push(s);
      else if (l.includes(v)) contains.push(s);
    }
    const list = [...starts, ...contains];
    return {
      matches: list.slice(0, MAX_SUGGESTIONS),
      more: Math.max(0, list.length - MAX_SUGGESTIONS),
    };
  }, [value, suggestions]);

  const showList = open && matches.length > 0;

  // Position the portal list under the input. Measured from the wrapper (which
  // tightly wraps the input), so no ref-forwarding into Input is required.
  const updateRect = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  React.useLayoutEffect(() => {
    if (!showList) return;
    updateRect();
    // Reposition while the list is open (capture: true catches scrolls in any
    // scroll container between the input and the viewport).
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [showList, updateRect]);

  function select(v: string) {
    onValueChange(v);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        {...inputProps}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        className={className}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Delay so a click on a suggestion (mousedown) registers first.
          window.setTimeout(() => setOpen(false), 120);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            select(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && rect
        ? createPortal(
            <ul
              role="listbox"
              style={{
                position: "fixed",
                top: rect.top,
                left: rect.left,
                width: rect.width,
              }}
              className="z-50 max-h-72 max-w-[calc(100vw-1rem)] overflow-auto rounded-[10px] border border-line bg-surface py-1 text-sm shadow-lg"
            >
              {matches.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    // mousedown fires before the input's blur, so selection sticks.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(s);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "block w-full px-3 py-1.5 text-left",
                      i === active
                        ? "bg-inset text-ink"
                        : "text-ink/90 hover:bg-inset",
                    )}
                  >
                    {s}
                  </button>
                </li>
              ))}
              {more > 0 ? (
                <li
                  aria-hidden
                  className="border-t border-line px-3 py-1.5 text-[12px] text-ink-muted"
                >
                  +{more} more — keep typing to filter
                </li>
              ) : null}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
