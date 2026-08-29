"use client";

import * as React from "react";
import { StarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Star ratings, read-only and interactive. Amber for a set star, line-strong for
// an unset one — the same two tokens the rest of the app uses for "on" and
// "inert", rather than a new colour that only exists here.

export function Stars({
  value,
  size = 13,
  className,
}: {
  value: number | null;
  size?: number;
  className?: string;
}) {
  const v = value ?? 0;
  return (
    <span
      className={cn("inline-flex items-center gap-px align-middle", className)}
      aria-label={value ? `${value} out of 5` : "Not rated"}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon
          key={i}
          style={{ width: size, height: size }}
          className={cn(
            "shrink-0",
            i <= v ? "fill-warning text-warning" : "fill-line-strong text-line-strong",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The picker. Keyboard-first: focus it and press 1–5, because a coordinator
 * doing 40 calls a day should never need the mouse. Clicking the star that is
 * already set clears the rating — otherwise a mis-click is unfixable.
 */
export function StarPicker({
  value,
  onChange,
  size = 19,
  label,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  size?: number;
  label?: string;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <span
      role="radiogroup"
      aria-label={label ?? "Rating"}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key >= "1" && e.key <= "5") {
          e.preventDefault();
          onChange(Number(e.key));
        } else if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          onChange(null);
        }
      }}
      onMouseLeave={() => setHover(null)}
      className={cn(
        "inline-flex items-center gap-[3px] rounded-md outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]",
        className,
      )}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
          tabIndex={-1}
          onMouseEnter={() => setHover(i)}
          onClick={() => onChange(value === i ? null : i)}
          className="cursor-pointer transition-transform hover:scale-110"
        >
          <StarIcon
            style={{ width: size, height: size }}
            className={cn(
              "transition-colors",
              i <= shown
                ? "fill-warning text-warning"
                : "fill-line-strong text-line-strong",
            )}
          />
        </button>
      ))}
    </span>
  );
}
