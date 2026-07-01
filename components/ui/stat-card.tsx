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
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
  trend?: { dir: "up" | "down"; text: string };
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <Card
      data-size="sm"
      className={cn(
        "relative overflow-hidden py-3 transition-shadow duration-200 hover:shadow-lg sm:py-4",
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
      <CardContent className="relative flex items-center gap-2.5 sm:gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-[11px] [&_svg]:size-4 sm:size-10 sm:[&_svg]:size-[18px]",
            t.tile,
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-ink-soft">{label}</div>
          <div className="num font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] break-words text-ink sm:text-[22px]">
            {value}
          </div>
          {sub ? (
            <div className="hidden text-[11px] text-ink-muted sm:block">{sub}</div>
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
