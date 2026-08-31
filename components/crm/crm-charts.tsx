"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCount } from "@/lib/orders";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// Charts for CRM analytics (§12.5.5). Each shape is chosen for the QUESTION it
// answers, not for variety's sake — eight identical bar panels made every
// metric look like the same metric:
//
//   coverage      → radial gauge, because it is one number against a target
//   queue         → one stacked bar, because the parts are one whole
//   SLA vs them   → a 2×2 grid, because the DISAGREEMENT is the finding and
//                   only a quadrant shows agreement and disagreement at once
//   sub-scores    → radar, the standard shape for multi-criteria scoring
//   trend         → area over months
//   categories    → Pareto: bars plus a cumulative line, so "the 20% causing
//                   80%" is visible rather than inferred
//   departments   → donut, because it is a share of one total
//   transport     → bars, ranked — here a ranking IS the question
//
// Loaded through next/dynamic by the view, so Recharts stays out of the
// initial chunk exactly as the dashboard does it.

function Tip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: { value: number; name?: string; payload?: Record<string, unknown> }[];
  label?: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label != null ? <div className="mb-0.5 font-medium text-ink">{label}</div> : null}
      {payload.map((p, i) => (
        <div key={i} className="num text-ink-soft">
          {p.name ? `${p.name}: ` : ""}
          {typeof p.value === "number" ? formatCount(p.value) : p.value}
          {suffix ?? ""}
        </div>
      ))}
    </div>
  );
}

const AXIS = {
  stroke: "var(--line-strong)",
  tick: { fill: "var(--ink-muted)", fontSize: 11 },
  tickLine: false,
} as const;

// ---------------------------------------------------------------------------

/** Sub-scores — radar is the standard shape for multi-criteria scoring. */
export function RatingRadar({
  subs,
}: {
  subs: { key: string; label: string; avg: number; n: number }[];
}) {
  const reduce = useReducedMotion();
  // A radar needs three axes to be a shape rather than a line.
  if (subs.length < 3) {
    return (
      <div className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
        {subs.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="w-[120px] shrink-0 truncate text-[12px] text-ink-soft">{s.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-pill bg-inset">
              <span className="block h-full rounded-pill bg-warning" style={{ width: `${(s.avg / 5) * 100}%` }} />
            </span>
            <span className="num w-8 text-right text-[12px] font-semibold">{s.avg.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="px-2 pb-3" role="img" aria-label="Average score by rating criterion">
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={subs} outerRadius="72%">
          <PolarGrid stroke="var(--line)" />
          <PolarAngleAxis dataKey="label" tick={{ fill: "var(--ink-muted)", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ fill: "var(--ink-muted)", fontSize: 9 }} axisLine={false} />
          <Radar
            dataKey="avg"
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.28}
            isAnimationActive={!reduce}
          />
          <Tooltip content={<Tip />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Rating over time — an area, the same shape the dashboard uses for trend. */
export function RatingTrend({ data }: { data: { month: string; avg: number; n: number }[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="px-1 pb-3" role="img" aria-label="Average overall rating by month">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ left: -18, right: 12, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="crmTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis dataKey="month" {...AXIS} />
          <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} {...AXIS} />
          <Tooltip content={<Tip />} />
          <Area
            type="monotone"
            dataKey="avg"
            stroke="var(--accent)"
            strokeWidth={2.4}
            fill="url(#crmTrend)"
            dot={{ r: 3, fill: "var(--surface)", stroke: "var(--accent)", strokeWidth: 2 }}
            isAnimationActive={!reduce}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A real Pareto: bars descending plus the cumulative percentage, so "the few
 * causes behind most complaints" is something you SEE rather than work out.
 */
export function ComplaintPareto({
  data,
}: {
  data: { key: string; label: string; count: number }[];
}) {
  const reduce = useReducedMotion();
  const total = data.reduce((n, d) => n + d.count, 0) || 1;
  let run = 0;
  const rows = data.map((d) => {
    run += d.count;
    return { ...d, cum: Math.round((run / total) * 100) };
  });
  return (
    <div className="px-1 pb-3" role="img" aria-label="Complaints by category, with cumulative share">
      <ResponsiveContainer width="100%" height={232}>
        <ComposedChart data={rows} margin={{ left: -20, right: 4, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" interval={0} height={52} angle={-30} textAnchor="end" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} unit="%" {...AXIS} />
          <Tooltip content={<Tip />} />
          <Bar dataKey="count" name="complaints" fill="var(--danger)" radius={[4, 4, 0, 0]} maxBarSize={38} isAnimationActive={!reduce} />
          <Line yAxisId="pct" type="monotone" dataKey="cum" name="cumulative %" stroke="var(--ink-soft)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={!reduce} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A share of one total → donut. */
export function ShareDonut({
  data,
  centreLabel,
}: {
  data: { key: string; label: string; count: number }[];
  centreLabel: string;
}) {
  const reduce = useReducedMotion();
  const total = data.reduce((n, d) => n + d.count, 0);
  const COLOURS = [
    "var(--danger)",
    "var(--warning)",
    "var(--accent)",
    "var(--success)",
    "var(--ink-muted)",
    "var(--line-strong)",
  ];
  return (
    <div className="flex flex-col items-center px-4 pb-4">
      <div className="relative w-full" role="img" aria-label={centreLabel}>
        <ResponsiveContainer width="100%" height={188}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius={54}
              outerRadius={80}
              paddingAngle={2}
              cornerRadius={4}
              strokeWidth={0}
              isAnimationActive={!reduce}
            >
              {data.map((d, i) => (
                <Cell key={d.key} fill={COLOURS[i % COLOURS.length]} />
              ))}
            </Pie>
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-display text-2xl leading-none font-semibold text-ink">
            {formatCount(total)}
          </span>
          <span className="mt-0.5 text-[11px] text-ink-muted">{centreLabel}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3.5 gap-y-1.5 text-[11.5px]">
        {data.map((d, i) => (
          <span key={d.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: COLOURS[i % COLOURS.length] }} />
            <span className="text-ink-soft">{d.label}</span>
            <span className="num font-medium text-ink">{d.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranked bars — here the ranking IS the question, so bars are right. */
export function RankedBars({
  data,
  suffix,
}: {
  data: { key: string; label: string; count: number }[];
  suffix?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="px-1 pb-3" role="img" aria-label="Ranked bar chart">
      <ResponsiveContainer width="100%" height={Math.max(140, data.length * 38 + 24)}>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...AXIS} />
          <YAxis type="category" dataKey="label" width={116} {...AXIS} />
          <Tooltip content={<Tip suffix={suffix} />} />
          <Bar dataKey="count" fill="var(--danger)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={!reduce}>
            {data.map((d, i) => (
              <Cell key={d.key} fillOpacity={1 - i * 0.12} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
