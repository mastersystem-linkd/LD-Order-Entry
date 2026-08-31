"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useReducedMotion } from "@/lib/use-reduced-motion";

// The ONE chart on CRM analytics that earns a charting library.
//
// A radar of the sub-scores and a Pareto with a cumulative-percentage axis
// both lived here and were both removed: they looked like analysis, but no
// ordinary reader could take a number off either, which is the only thing
// these panels are for. Everything else is a labelled bar in crm-charts-lite.
//
// A rating over time is the exception — a line is how everyone already reads
// "is this getting better or worse", and no bar says it as directly.

function Tip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload?: { n?: number } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const n = payload[0].payload?.n;
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label ? <div className="mb-0.5 font-medium text-ink">{label}</div> : null}
      <div className="num text-ink-soft">
        {payload[0].value.toFixed(1)} out of 5
        {n ? ` · ${n} call${n === 1 ? "" : "s"}` : ""}
      </div>
    </div>
  );
}

export function RatingTrend({
  data,
}: {
  data: { month: string; avg: number; n: number }[];
}) {
  const reduce = useReducedMotion();
  return (
    <div
      className="min-h-[176px] px-1 pb-4"
      role="img"
      aria-label="Average overall rating by month"
    >
      <ResponsiveContainer width="100%" height={176}>
        <AreaChart data={data} margin={{ left: -20, right: 14, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="crmTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="month"
            stroke="var(--line-strong)"
            tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            stroke="var(--line-strong)"
            tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
            tickLine={false}
          />
          <Tooltip content={<Tip />} />
          <Area
            type="monotone"
            dataKey="avg"
            stroke="var(--accent)"
            strokeWidth={2.4}
            fill="url(#crmTrend)"
            dot={{ r: 3.5, fill: "var(--surface)", stroke: "var(--accent)", strokeWidth: 2 }}
            isAnimationActive={!reduce}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
