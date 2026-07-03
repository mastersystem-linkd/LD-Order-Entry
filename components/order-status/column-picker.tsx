"use client";

import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import { CheckIcon, Columns3Icon, RotateCcwIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// A single choosable column. `locked` columns are always shown (e.g. the row's
// identity column) — they render disabled in the picker so users can see them
// but can't hide them.
export interface ColumnOption {
  id: string;
  label: string;
  locked?: boolean;
}

// Per-user column visibility, persisted to localStorage. We store the *hidden*
// ids (not the visible ones) so that any column added in a future release
// defaults to visible for existing users instead of silently disappearing.
export function useColumnPrefs(storageKey: string, columns: ColumnOption[]) {
  const toggleable = React.useMemo(
    () => columns.filter((c) => !c.locked).map((c) => c.id),
    [columns],
  );
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  // Gate persistence until after the first client read so SSR (no localStorage)
  // doesn't clobber the saved prefs with an empty set on hydration.
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let restored = new Set<string>();
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          restored = new Set(
            arr.filter(
              (id): id is string =>
                typeof id === "string" && toggleable.includes(id),
            ),
          );
        }
      }
    } catch {
      // Corrupt/unavailable storage → fall back to all-visible.
    }
    setHidden(restored);
    setLoaded(true);
  }, [storageKey, toggleable]);

  React.useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...hidden]));
    } catch {
      // Ignore quota / privacy-mode failures — the choice just won't persist.
    }
  }, [hidden, loaded, storageKey]);

  const isVisible = React.useCallback(
    (id: string) => !hidden.has(id),
    [hidden],
  );

  const toggle = React.useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reset = React.useCallback(() => setHidden(new Set()), []);

  return { hidden, isVisible, toggle, reset };
}

export function ColumnPicker({
  columns,
  hidden,
  onToggle,
  onReset,
}: {
  columns: ColumnOption[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const hiddenCount = columns.filter(
    (c) => !c.locked && hidden.has(c.id),
  ).length;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label="Choose columns"
            title="Choose columns"
            className="relative shrink-0"
          />
        }
      >
        <Columns3Icon />
        {hiddenCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-white ring-2 ring-surface">
            {hiddenCount}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup className="w-60 origin-[var(--transform-origin)] rounded-card bg-surface p-1.5 text-sm text-ink shadow-lg ring-1 ring-line outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] font-bold tracking-[0.04em] text-ink-muted uppercase">
                Show columns
              </span>
              <button
                type="button"
                onClick={onReset}
                disabled={hiddenCount === 0}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-ink-soft transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              >
                <RotateCcwIcon className="size-3" /> Reset
              </button>
            </div>
            <div className="my-1 h-px bg-line" />
            <ul className="flex flex-col">
              {columns.map((c) => {
                const checked = !hidden.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      disabled={c.locked}
                      onClick={() => onToggle(c.id)}
                      className="flex w-full items-center gap-2.5 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked
                            ? "border-accent bg-accent text-white"
                            : "border-line-strong bg-surface",
                        )}
                      >
                        {checked ? (
                          <CheckIcon className="size-3" strokeWidth={3} />
                        ) : null}
                      </span>
                      <span className="flex-1 text-ink">{c.label}</span>
                      {c.locked ? (
                        <span className="text-[10px] text-ink-muted">
                          Always
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
