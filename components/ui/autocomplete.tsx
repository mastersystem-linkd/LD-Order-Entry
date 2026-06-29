"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Free-text input with a suggestion dropdown (CLAUDE.md §4): suggestions help,
// but any value is allowed — an unknown fabric/party/design is never blocked.
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

  const matches = React.useMemo(() => {
    const v = value.trim().toLowerCase();
    const list = v
      ? suggestions.filter(
          (s) => s.toLowerCase().includes(v) && s.toLowerCase() !== v,
        )
      : suggestions;
    return list.slice(0, 8);
  }, [value, suggestions]);

  const showList = open && matches.length > 0;

  function select(v: string) {
    onValueChange(v);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
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
      {showList ? (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover py-1 text-sm shadow-md"
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
                    ? "bg-muted text-foreground"
                    : "text-foreground/90 hover:bg-muted",
                )}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
