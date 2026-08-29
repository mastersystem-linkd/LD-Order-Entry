"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// A small segmented control. The app had four hand-rolled copies of this shape
// (view-switch, settings tabs, the login theme toggle, the dashboard trend
// switch); this is the first shared one, and it is additive — none of those four
// were touched.
//
// `tone` exists because on the CRM call panel a Yes/No answer is not neutral:
// "Damaged" is a bad answer and should read as one the moment it is selected.

type Tone = "neutral" | "positive" | "negative";

const ACTIVE: Record<Tone, string> = {
  neutral: "bg-surface text-ink shadow-sm",
  positive: "bg-success text-white",
  negative: "bg-danger text-white",
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "neutral",
  size = "md",
  className,
  ariaLabel,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center rounded-field bg-inset p-[2px]",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "cursor-pointer rounded-[7px] font-medium whitespace-nowrap transition-colors duration-150",
              size === "sm"
                ? "px-2.5 py-1 text-[11.5px]"
                : "px-3 py-[5px] text-[12px]",
              on
                ? cn(ACTIVE[tone], "font-semibold")
                : "text-ink-soft hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
