"use client";

import * as React from "react";

import { formatCount } from "@/lib/orders";
import { cn } from "@/lib/utils";

// The CRM charts that need NO charting library — plain CSS and SVG.
//
// They live apart from crm-charts.tsx deliberately: the analytics view imports
// these statically, and a static import of anything sharing a module with
// Recharts pulls the whole library into the initial chunk (10.5 kB → 145 kB).
//
// The bar is that a chart must be readable by someone who has never seen it
// before. A radial gauge and a four-point radar were both tried here and both
// failed that: the gauge rendered a 1.4% arc as an unexplained blob, and the
// radar turned four scores into a diamond nobody could read a number off.
// Where a shape adds nothing over a labelled bar, it is a labelled bar.

/**
 * Coverage — one number against a target. A big figure and a track, not a
 * dial: at 1.4% a dial shows nothing a reader can interpret, while a track
 * with the target marked shows exactly how far off it is.
 */
export function CoverageMeter({
  pct,
  contacted,
  followups,
  target = 85,
}: {
  pct: number;
  contacted: number;
  followups: number;
  target?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone =
    clamped >= target ? "bg-success" : clamped >= 50 ? "bg-warning" : "bg-danger";
  const toneText =
    clamped >= target ? "text-success" : clamped >= 50 ? "text-warning" : "text-danger";

  return (
    <div className="px-4 pb-5 sm:px-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div
            className={cn(
              "num font-display text-[46px] leading-[0.95] font-semibold tracking-[-0.03em]",
              toneText,
            )}
          >
            {pct}%
          </div>
          <div className="mt-1 text-[12.5px] font-medium text-ink-soft">
            of delivered orders called
          </div>
        </div>
        <div className="text-right">
          <div className="num font-display text-[22px] leading-none font-semibold text-ink">
            {formatCount(contacted)}
            <span className="text-[15px] font-medium text-ink-soft">
              /{formatCount(followups)}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-ink-soft">called</div>
        </div>
      </div>

      <div className="relative mt-5 h-3.5 w-full overflow-hidden rounded-pill bg-inset">
        <span
          className={cn("block h-full rounded-pill transition-all duration-500", tone)}
          style={{ width: `${Math.max(clamped, 1.5)}%` }}
        />
      </div>
      {/* The target sits on its own line under the track, with the gap named —
          "how far off are we" is the question, and a bare marker made the
          reader measure it by eye. */}
      <div className="relative mt-1.5 h-4">
        <span
          className="absolute -top-[22px] h-5 w-[2px] rounded-pill bg-ink"
          style={{ left: `${target}%` }}
        />
        <span
          className="absolute -translate-x-1/2 text-[11px] font-medium text-ink-soft"
          style={{ left: `${target}%` }}
        >
          target {target}%
        </span>
      </div>

      <p className="mt-3 border-t border-line pt-2.5 text-[12px] leading-relaxed text-ink-soft">
        {clamped >= target ? (
          <>On target — keep it there.</>
        ) : (
          <>
            <b className="text-ink num">
              {formatCount(Math.max(0, Math.ceil((target / 100) * followups) - contacted))}
            </b>{" "}
            more calls would reach the {target}% target.
          </>
        )}
      </p>
    </div>
  );
}

/** The queue — five parts of ONE whole, so one stacked bar and a legend. */
export function QueueBar({
  parts,
}: {
  parts: { key: string; label: string; count: number; color: string }[];
}) {
  const total = parts.reduce((n, p) => n + p.count, 0) || 1;
  return (
    <div className={"flex flex-col justify-center px-4 pb-5 sm:px-5"}>
      <div className="flex h-6 w-full overflow-hidden rounded-pill bg-inset ring-1 ring-line/60 ring-inset">
        {parts.map((p) =>
          p.count > 0 ? (
            <span
              key={p.key}
              title={`${p.label}: ${p.count}`}
              className="h-full transition-all"
              style={{ width: `${(p.count / total) * 100}%`, background: p.color }}
            />
          ) : null,
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 text-[12.5px]">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="truncate font-medium text-ink-soft">{p.label}</span>
            <span className="num ml-auto font-semibold text-ink">{formatCount(p.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The SLA 2×2 — kept, because it is the one shape here that a bar cannot
 * replace. The finding is not "how many were late"; it is WHERE WE AND THE
 * CUSTOMER DISAGREE, and only a quadrant shows agreement and disagreement at
 * once. Each cell states the conclusion to draw from it, so it needs no key.
 */
export function OnTimeQuadrant({
  data,
}: {
  data: {
    bothOnTime: number;
    bothLate: number;
    weLateTheyFine: number;
    weOnTimeTheyNot: number;
  };
}) {
  const cells = [
    { k: "a", v: data.bothOnTime, tone: "success", note: "all good" },
    { k: "b", v: data.weOnTimeTheyNot, tone: "danger", note: "transit is invisible to us" },
    { k: "c", v: data.weLateTheyFine, tone: "warning", note: "our deadline is too tight" },
    { k: "d", v: data.bothLate, tone: "danger", note: "genuinely late" },
  ];
  const max = Math.max(...cells.map((c) => c.v), 1);
  return (
    <div className={"px-4 pb-5 sm:px-5"}>
      <div className="mb-2 grid grid-cols-[76px_1fr_1fr] gap-2 text-[11.5px] font-medium text-ink-soft">
        <span />
        <span className="text-center">Customer happy</span>
        <span className="text-center">Customer not</span>
      </div>
      <div className="grid grid-cols-[76px_1fr_1fr] gap-2">
        <span className="flex items-center justify-end text-right text-[11.5px] font-medium text-ink-soft">
          We hit our deadline
        </span>
        <QuadCell c={cells[0]} max={max} />
        <QuadCell c={cells[1]} max={max} />
        <span className="flex items-center justify-end text-right text-[11.5px] font-medium text-ink-soft">
          We missed it
        </span>
        <QuadCell c={cells[2]} max={max} />
        <QuadCell c={cells[3]} max={max} />
      </div>
    </div>
  );
}

function QuadCell({
  c,
  max,
}: {
  c: { v: number; note: string; tone: string };
  max: number;
}) {
  const strength = c.v === 0 ? 0 : 0.1 + (c.v / max) * 0.24;
  const colour =
    c.tone === "success"
      ? "var(--success)"
      : c.tone === "warning"
        ? "var(--warning)"
        : "var(--danger)";
  return (
    <div
      className={cn(
        "rounded-card border px-2 py-3.5 text-center transition-all",
        c.v > 0 && c.v === max ? "border-transparent shadow-sm" : "border-line",
      )}
      style={{
        background: `color-mix(in oklab, ${colour} ${strength * 100}%, var(--surface))`,
        ...(c.v > 0 && c.v === max
          ? { boxShadow: `0 0 0 2px color-mix(in oklab, ${colour} 35%, transparent)` }
          : {}),
      }}
    >
      <div className="num font-display text-[26px] leading-none font-semibold text-ink">
        {c.v}
      </div>
      <div className="mt-1.5 text-[11px] leading-tight text-ink-soft">{c.note}</div>
    </div>
  );
}

/**
 * Ranked horizontal bars with the number on the end. Deliberately the default
 * for anything that is "how many of each" — it is the one chart shape nobody
 * has to be taught, and every alternative tried here (radar, Pareto with a
 * cumulative axis) hid the number behind a shape.
 */
export function CountBars({
  rows,
  tone = "danger",
  outOf,
  suffix,
}: {
  rows: { key: string; label: string; value: number }[];
  tone?: "accent" | "danger" | "warning" | "success";
  /** Fixed scale, e.g. 5 for a rating — otherwise bars scale to the largest. */
  outOf?: number;
  suffix?: string;
}) {
  const max = outOf ?? Math.max(...rows.map((r) => r.value), 1);
  const bar = {
    accent: "bg-gradient-to-r from-accent/70 to-accent",
    danger: "bg-gradient-to-r from-danger/70 to-danger",
    warning: "bg-gradient-to-r from-warning/70 to-warning",
    success: "bg-gradient-to-r from-success/70 to-success",
  }[tone];
  return (
    <div className={"flex flex-col justify-center gap-2.5 px-4 pb-5 sm:px-5"}>
      {rows.map((r) => (
        <div
          key={r.key}
          className="-mx-2 flex items-center gap-3 rounded-field px-2 py-1 transition-colors hover:bg-surface-2"
        >
          <span
            className="w-[116px] shrink-0 truncate text-[12.5px] font-medium text-ink"
            title={r.label}
          >
            {r.label}
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-pill bg-inset">
            <span
              className={cn("block h-full rounded-pill transition-all duration-500", bar)}
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </span>
          <span className="num w-11 shrink-0 text-right text-[13px] font-semibold text-ink">
            {outOf ? r.value.toFixed(1) : formatCount(r.value)}
            {suffix ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export const CHART_COLOURS = {
  due: "var(--ink-muted)",
  progress: "var(--accent)",
  done: "var(--success)",
  unreachable: "var(--warning)",
  notRequired: "var(--line-strong)",
} as const;
