"use client";

import * as React from "react";

import { formatCount } from "@/lib/orders";

// The CRM charts that need NO charting library — plain SVG and CSS.
//
// They live apart from crm-charts.tsx deliberately. The analytics view imports
// these statically, and a static import of anything in the same module as
// Recharts pulls Recharts into the initial chunk, which is what the dynamic
// imports there exist to prevent (10.5 kB → 145 kB when they shared a file).

/** Coverage — one number against a target, so a gauge and not a bar. */
export function CoverageGauge({
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
  // A half-ring: 180° of sweep starting bottom-left.
  const r = 62;
  const cx = 80;
  const cy = 78;
  const arc = (from: number, to: number) => {
    const a = (x: number) => Math.PI * (1 - x / 100);
    const x1 = cx + r * Math.cos(a(from));
    const y1 = cy - r * Math.sin(a(from));
    const x2 = cx + r * Math.cos(a(to));
    const y2 = cy - r * Math.sin(a(to));
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 50 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const tone =
    clamped >= target ? "var(--success)" : clamped >= 50 ? "var(--warning)" : "var(--danger)";

  return (
    <div className="flex flex-col items-center px-4 pb-4">
      <svg viewBox="0 0 160 96" className="w-full max-w-[220px]" role="img"
        aria-label={`Coverage ${pct}% — ${contacted} of ${followups} delivered orders called`}>
        <path d={arc(0, 100)} fill="none" stroke="var(--inset)" strokeWidth={13} strokeLinecap="round" />
        {clamped > 0 ? (
          <path d={arc(0, clamped)} fill="none" stroke={tone} strokeWidth={13} strokeLinecap="round" />
        ) : null}
        {/* The target, marked on the dial rather than written underneath it. */}
        <circle
          cx={cx + r * Math.cos(Math.PI * (1 - target / 100))}
          cy={cy - r * Math.sin(Math.PI * (1 - target / 100))}
          r={3}
          fill="var(--ink-muted)"
        />
        <text x={cx} y={cy - 12} textAnchor="middle"
          className="num" fontSize={26} fontWeight={600} fill="var(--ink)">
          {pct}%
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={10} fill="var(--ink-muted)">
          target {target}%
        </text>
      </svg>
      <p className="mt-1 text-center text-[11.5px] text-ink-muted">
        <span className="num font-semibold text-ink">{formatCount(contacted)}</span> of{" "}
        <span className="num">{formatCount(followups)}</span> delivered orders called
      </p>
    </div>
  );
}

/** The queue — five parts of ONE whole, so one stacked bar, not five bars. */
export function QueueBar({
  parts,
}: {
  parts: { key: string; label: string; count: number; color: string }[];
}) {
  const total = parts.reduce((n, p) => n + p.count, 0) || 1;
  return (
    <div className="px-4 pb-4 sm:px-5">
      <div className="flex h-4 w-full overflow-hidden rounded-pill bg-inset">
        {parts.map((p) =>
          p.count > 0 ? (
            <span
              key={p.key}
              title={`${p.label}: ${p.count}`}
              className="h-full transition-all first:rounded-l-pill last:rounded-r-pill"
              style={{ width: `${(p.count / total) * 100}%`, background: p.color }}
            />
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 text-[11.5px]">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-ink-soft">{p.label}</span>
            <span className="num font-semibold text-ink">{formatCount(p.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The SLA 2×2. Bars could not show this: the finding is not "how many were
 * late", it is WHERE WE AND THE CUSTOMER DISAGREE, and that only reads as a
 * quadrant. The two diagonal cells are agreement; the off-diagonal ones are
 * the ones worth acting on.
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
    { k: "a", v: data.bothOnTime, us: "On time", them: "Happy", tone: "success", note: "agreed" },
    { k: "b", v: data.weOnTimeTheyNot, us: "On time", them: "Unhappy", tone: "danger", note: "transit is invisible to us" },
    { k: "c", v: data.weLateTheyFine, us: "Late", them: "Happy", tone: "warning", note: "our SLA is too tight" },
    { k: "d", v: data.bothLate, us: "Late", them: "Unhappy", tone: "danger", note: "agreed — genuinely late" },
  ];
  const max = Math.max(...cells.map((c) => c.v), 1);
  return (
    <div className="px-4 pb-4 sm:px-5">
      <div className="mb-1.5 grid grid-cols-[64px_1fr_1fr] items-end gap-1.5 text-[10px] text-ink-muted">
        <span />
        <span className="text-center">They were happy</span>
        <span className="text-center">They were not</span>
      </div>
      <div className="grid grid-cols-[64px_1fr_1fr] gap-1.5">
        <span className="flex items-center justify-end pr-1 text-[10px] text-ink-muted">
          We were on time
        </span>
        {[cells[0], cells[1]].map((c) => (
          <QuadCell key={c.k} c={c} max={max} />
        ))}
        <span className="flex items-center justify-end pr-1 text-[10px] text-ink-muted">
          We were late
        </span>
        {[cells[2], cells[3]].map((c) => (
          <QuadCell key={c.k} c={c} max={max} />
        ))}
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
  const strength = c.v === 0 ? 0 : 0.08 + (c.v / max) * 0.22;
  const colour =
    c.tone === "success" ? "var(--success)" : c.tone === "warning" ? "var(--warning)" : "var(--danger)";
  return (
    <div
      className="rounded-field border border-line px-3 py-3 text-center"
      style={{ background: `color-mix(in oklab, ${colour} ${strength * 100}%, var(--surface))` }}
    >
      <div className="num text-[20px] leading-none font-semibold text-ink">{c.v}</div>
      <div className="mt-1 text-[10px] leading-tight text-ink-muted">{c.note}</div>
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
