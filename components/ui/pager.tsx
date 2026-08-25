"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Previous / [page] of N / Next.
//
// The page number is typed, not clicked to: with 13 pages of results, walking
// from 1 to 11 with a Next button is ten clicks and ten refetches. Type the
// number, press Enter, done.
export function Pager({
  page,
  totalPages,
  onPage,
  busy,
  className,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  /** Disables the arrows while a fetch is in flight. */
  busy?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(String(page));

  // Follow the real page when it changes elsewhere (a filter reset, the arrows).
  React.useEffect(() => {
    setDraft(String(page));
  }, [page]);

  function commit() {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(page)); // gibberish → put the current page back
      return;
    }
    const clamped = Math.min(Math.max(n, 1), totalPages);
    setDraft(String(clamped));
    if (clamped !== page) onPage(clamped);
  }

  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1 || busy}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        Previous
      </Button>

      <span className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(String(page));
              e.currentTarget.blur();
            }
          }}
          inputMode="numeric"
          aria-label={`Page number, 1 to ${totalPages}`}
          title="Type a page number and press Enter"
          className="num h-8 w-12 rounded-field border border-line-strong bg-surface text-center text-sm font-semibold text-ink outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]"
        />
        <span className="num text-ink-soft">of {totalPages}</span>
      </span>

      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages || busy}
        onClick={() => onPage(Math.min(totalPages, page + 1))}
      >
        Next
      </Button>
    </div>
  );
}
