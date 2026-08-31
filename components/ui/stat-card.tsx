import * as React from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

// Compact KPI tile (FlowMail / SOS dashboards): a tinted icon square beside a
// label + figure, an optional trend pill, and a faint tone glow. Visual only.
type Tone = "indigo" | "green" | "amber" | "red" | "slate";

const TONE: Record<Tone, { tile: string; glow: string }> = {
  indigo: { tile: "bg-accent/10 text-accent", glow: "var(--accent)" },
  green: { tile: "bg-success/10 text-success", glow: "var(--success)" },
  amber: { tile: "bg-warning/10 text-warning", glow: "var(--warning)" },
  red: { tile: "bg-danger/10 text-danger", glow: "var(--danger)" },
  slate: { tile: "bg-inset text-ink-soft", glow: "var(--ink-muted)" },
};

export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "indigo",
  trend,
  className,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
  trend?: { dir: "up" | "down"; text: string };
  className?: string;
  /**
   * Makes the tile a filter, the way the Orders KPIs already work: clicking it
   * narrows the list below to what it counts. A figure you can act on beats a
   * figure you can only read.
   */
  onClick?: () => void;
  /** Whether the filter this tile applies is the one currently in force. */
  active?: boolean;
}) {
  const t = TONE[tone];
  return (
    <Card
      data-size="sm"
      // A real button when it filters, so it is keyboard-reachable and
      // announces its pressed state — not a div with a click handler.
      {...(onClick
        ? {
            role: "button" as const,
            tabIndex: 0,
            "aria-pressed": !!active,
            onClick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
      className={cn(
        "relative overflow-hidden py-2 transition-shadow duration-200 hover:shadow-lg sm:py-4",
        onClick &&
          "cursor-pointer outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]",
        active && "border-accent ring-2 ring-accent/25",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-8 -right-8 size-20 rounded-full opacity-[0.12]"
        style={{
          background: `radial-gradient(circle, ${t.glow}, transparent 70%)`,
        }}
      />
      <CardContent className="relative flex items-center gap-2.5 px-2.5 sm:gap-3 sm:px-4">
        <span
          className={cn(
            "hidden shrink-0 place-items-center rounded-[11px] sm:grid sm:size-10 sm:[&_svg]:size-[18px]",
            t.tile,
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] leading-tight font-semibold text-ink-soft sm:text-[12.5px]">
            {label}
          </div>
          <div className="num font-display text-[17px] font-semibold leading-tight tracking-[-0.02em] break-words text-ink sm:text-[22px]">
            {value}
          </div>
          {sub ? (
            <div className="hidden text-[11.5px] font-medium text-ink-soft sm:block">{sub}</div>
          ) : null}
        </div>
        {trend ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 self-start rounded-pill px-1.5 py-0.5 text-[11px] font-semibold",
              trend.dir === "up"
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger",
            )}
          >
            {trend.dir === "up" ? (
              <ArrowUpRightIcon className="size-3" />
            ) : (
              <ArrowDownRightIcon className="size-3" />
            )}
            {trend.text}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
