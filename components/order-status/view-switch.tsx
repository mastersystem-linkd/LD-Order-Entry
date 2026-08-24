"use client";

import * as React from "react";
import { LayoutListIcon, TableIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type TrackView = "track" | "table";

// Remembers the choice per user, per screen, so someone who lives in the
// tracking view is not put back on the table every morning. Wrapped because a
// private window (or a browser that blocks site data) throws on access.
export function useTrackView(storageKey: string, initial: TrackView = "track") {
  const [view, setView] = React.useState<TrackView>(initial);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "track" || saved === "table") setView(saved);
    } catch {
      /* storage unavailable — the default stands */
    }
  }, [storageKey]);

  const choose = React.useCallback(
    (next: TrackView) => {
      setView(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* nothing to do — the choice just won't persist */
      }
    },
    [storageKey],
  );

  return { view, setView: choose };
}

export function ViewSwitch({
  view,
  onChange,
  tableLabel = "Table",
}: {
  view: TrackView;
  onChange: (v: TrackView) => void;
  tableLabel?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors [&_svg]:size-3.5";
  return (
    <div className="inline-flex shrink-0 gap-1 rounded-pill border border-line-strong bg-surface-2 p-0.5">
      <button
        type="button"
        aria-pressed={view === "track"}
        onClick={() => onChange("track")}
        className={cn(
          base,
          view === "track"
            ? "bg-accent text-white"
            : "text-ink-soft hover:text-ink",
        )}
      >
        <LayoutListIcon /> Tracking
      </button>
      <button
        type="button"
        aria-pressed={view === "table"}
        onClick={() => onChange("table")}
        className={cn(
          base,
          view === "table"
            ? "bg-accent text-white"
            : "text-ink-soft hover:text-ink",
        )}
      >
        <TableIcon /> {tableLabel}
      </button>
    </div>
  );
}
