"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/orders";
import { useReducedMotion } from "@/lib/use-reduced-motion";

function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ChartTooltip({
  active,
  payload,
  label,
  prefix,
  labelMap,
}: {
  active?: boolean;
  payload?: { value: number; name?: string }[];
  label?: string;
  prefix?: string;
  labelMap?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label != null ? (
        <div className="mb-0.5 font-medium text-ink">
          {labelMap ? labelMap(label) : label}
        </div>
      ) : null}
      <div className="num text-ink-soft">
        {prefix ?? ""}
        {formatNumber(v)}
      </div>
    </div>
  );
}

// Order / value trend (area).
export function TrendChart({
  data,
  metric,
}: {
  data: { date: string; orders: number; value: number }[];
  metric: "orders" | "value";
}) {
  const reduce = useReducedMotion();
  return (
    <div role="img" aria-label={`Order ${metric} trend over the selected date range`}>
    <ResponsiveContainer width="100%" height={232}>
      <AreaChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
          tickLine={false}
          axisLine={false}
          minTickGap={26}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
          tickLine={false}
          axisLine={false}
          width={46}
          tickFormatter={compact}
          allowDecimals={false}
        />
        <Tooltip
          content={
            <ChartTooltip
              prefix={metric === "value" ? "₹" : ""}
              labelMap={shortDate}
            />
          }
        />
        <Area
          type="monotone"
          dataKey={metric}
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#trendFill)"
          isAnimationActive={!reduce}
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}

// Status split (donut) with a total in the hole. Cancelled orders are shown as
// their own reserved-danger slice so the new cancellation flow is visible.
export function StatusDonut({
  data,
}: {
  data: {
    completed: number;
    partially: number;
    pending: number;
    cancelled: number;
  };
}) {
  const reduce = useReducedMotion();
  const items = [
    { name: "Completed", value: data.completed, color: "var(--success)" },
    { name: "Partially", value: data.partially, color: "var(--warning)" },
    { name: "Pending", value: data.pending, color: "var(--ink-soft)" },
    { name: "Cancelled", value: data.cancelled, color: "var(--danger)" },
  ].filter((i) => i.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) {
    return (
      <div className="grid h-[200px] place-items-center text-sm text-ink-muted">
        No orders in this range.
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="img"
        aria-label={`Order status split — completed ${data.completed}, partially completed ${data.partially}, pending ${data.pending}, cancelled ${data.cancelled}`}
        className="relative w-full"
      >
        <ResponsiveContainer width="100%" height={184}>
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={84}
              paddingAngle={2}
              cornerRadius={4}
              strokeWidth={0}
              isAnimationActive={!reduce}
            >
              {items.map((i) => (
                <Cell key={i.name} fill={i.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Total in the hole */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-display text-2xl font-semibold leading-none text-ink">
            {total}
          </span>
          <span className="mt-0.5 text-[11px] text-ink-muted">orders</span>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs">
        {items.map((i) => (
          <span key={i.name} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: i.color }}
            />
            <span className="text-ink-soft">{i.name}</span>
            <span className="num font-medium text-ink">{i.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// On-time delivery as a semicircular gauge (reserved status colour by band).
export function OnTimeGauge({
  pct,
  onTime,
  late,
}: {
  pct: number;
  onTime: number;
  late: number;
}) {
  const done = onTime + late;
  const R = 70;
  const cx = 90;
  const cy = 96;
  const sw = 16;
  const len = Math.PI * R; // semicircle arc length
  const frac = Math.max(0, Math.min(100, pct)) / 100;
  const color =
    pct >= 90 ? "var(--success)" : pct >= 70 ? "var(--warning)" : "var(--danger)";
  const trackPath = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`;
  return (
    <div className="flex flex-col items-center">
      <div
        role="img"
        aria-label={`On-time delivery ${pct}% — ${onTime} on time, ${late} late`}
        className="relative"
      >
        <svg width="180" height="112" viewBox="0 0 180 112">
          <path
            d={trackPath}
            fill="none"
            stroke="var(--inset)"
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <path
            d={trackPath}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${frac * len} ${len}`}
            style={{ transition: "stroke-dasharray 700ms ease" }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-2 flex flex-col items-center">
          <span className="num font-display text-[28px] font-semibold leading-none text-ink">
            {done === 0 ? "—" : `${pct}%`}
          </span>
          <span className="mt-0.5 text-[11px] text-ink-muted">on time</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-success" />
          <span className="text-ink-soft">On time</span>
          <span className="num font-medium text-ink">{onTime}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-danger" />
          <span className="text-ink-soft">Late</span>
          <span className="num font-medium text-ink">{late}</span>
        </span>
      </div>
    </div>
  );
}

// On-time vs late (bar).
export function DelaysBar({
  onTime,
  late,
}: {
  onTime: number;
  late: number;
}) {
  const reduce = useReducedMotion();
  const data = [
    { name: "On time", value: onTime, color: "var(--success)" },
    { name: "Late", value: late, color: "var(--danger)" },
  ];
  if (onTime + late === 0) {
    return (
      <div className="grid h-[200px] place-items-center text-sm text-ink-muted">
        No completed stages yet.
      </div>
    );
  }
  return (
    <div role="img" aria-label={`On-time ${onTime} vs late ${late} stages`}>
    <ResponsiveContainer width="100%" height={232}>
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: "var(--ink-soft)" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
        />
        <Tooltip cursor={{ fill: "var(--inset)" }} content={<ChartTooltip />} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={!reduce}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
