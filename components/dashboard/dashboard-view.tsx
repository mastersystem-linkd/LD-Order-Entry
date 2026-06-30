"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  IndianRupeeIcon,
  RefreshCwIcon,
  RulerIcon,
} from "lucide-react";

import { apiGet } from "@/lib/api-client";
import {
  presetRange,
  type DashboardData,
  type DateRangePreset,
  type Department,
} from "@/lib/dashboard";
import { formatDate, formatNumber } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import {
  DelaysBar,
  StatusDonut,
  TrendChart,
} from "@/components/dashboard/dashboard-charts";

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];
function delta(cur: number, prev: number):
  | { dir: "up" | "down"; text: string }
  | undefined {
  if (prev === 0) return cur > 0 ? { dir: "up", text: "new" } : undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { dir: pct >= 0 ? "up" : "down", text: `${pct >= 0 ? "+" : ""}${pct}%` };
}

export function DashboardView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [today] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [metric, setMetric] = React.useState<"orders" | "value">("orders");

  const fallback = presetRange("30d", today);
  const from = sp.get("from") ?? fallback.from;
  const to = sp.get("to") ?? fallback.to;
  const dept = (sp.get("dept") as Department) ?? "ALL";

  const q = useQuery({
    queryKey: ["dashboard", { from, to, dept }],
    queryFn: () =>
      apiGet<DashboardData>(
        `/api/dashboard?from=${from}&to=${to}&department=${dept}`,
      ),
    placeholderData: (p) => p,
    staleTime: 30_000,
  });

  function setParams(next: Partial<{ from: string; to: string; dept: string }>) {
    const params = new URLSearchParams(sp.toString());
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.dept) params.set("dept", next.dept);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const activePreset: DateRangePreset = (() => {
    for (const p of PRESETS) {
      const r = presetRange(p.key, today);
      if (r.from === from && r.to === to) return p.key;
    }
    return "custom";
  })();

  const d = q.data;
  const loading = q.isLoading && !d;

  const pillBase =
    "rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors";
  const pillActive = "bg-accent text-white";
  const pillIdle =
    "border border-line-strong bg-surface-2 text-ink-soft hover:text-ink";

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={activePreset === p.key}
              onClick={() => setParams(presetRange(p.key, today))}
              className={cn(
                pillBase,
                activePreset === p.key ? pillActive : pillIdle,
              )}
            >
              {p.label}
            </button>
          ))}
          <span
            role="status"
            className={cn(
              pillBase,
              "cursor-default",
              activePreset === "custom" ? pillActive : pillIdle,
            )}
          >
            Custom
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setParams({ from: e.target.value })}
            className="num h-9 w-[150px]"
            aria-label="From date"
          />
          <span className="text-ink-muted">–</span>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setParams({ to: e.target.value })}
            className="num h-9 w-[150px]"
            aria-label="To date"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="ml-auto"
        >
          <RefreshCwIcon className={q.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>

      {q.isError && !d ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-danger">
              {(q.error as Error)?.message ?? "Failed to load dashboard."}
            </p>
            <Button variant="outline" onClick={() => q.refetch()}>
              <RefreshCwIcon /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Reveal index={0}>
          <div className="flex flex-col gap-4">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {loading || !d
                ? Array.from({ length: 6 }).map((_, i) => (
                    <Skel key={i} className="h-[88px]" />
                  ))
                : [
                    <Kpi
                      key="o"
                      icon={<ClipboardListIcon />}
                      tone="indigo"
                      label="Total orders"
                      value={d.kpis.orders}
                      trend={delta(d.kpis.orders, d.kpis.prev.orders)}
                    />,
                    <Kpi
                      key="v"
                      icon={<IndianRupeeIcon />}
                      tone="indigo"
                      label="Order value"
                      value={d.kpis.value}
                      prefix="₹"
                      trend={delta(d.kpis.value, d.kpis.prev.value)}
                    />,
                    <Kpi
                      key="m"
                      icon={<RulerIcon />}
                      tone="indigo"
                      label="Meters"
                      value={d.kpis.meters}
                      suffix=" m"
                      trend={delta(d.kpis.meters, d.kpis.prev.meters)}
                    />,
                    <Kpi
                      key="a"
                      icon={<ActivityIcon />}
                      tone="slate"
                      label="Active orders"
                      value={d.kpis.activeOrders}
                    />,
                    <Kpi
                      key="od"
                      icon={<AlertTriangleIcon />}
                      tone="red"
                      label="Overdue stages"
                      value={d.kpis.overdueStages}
                    />,
                    <Kpi
                      key="ot"
                      icon={<CheckCircle2Icon />}
                      tone="green"
                      label="On-time %"
                      value={d.kpis.onTimePct}
                      suffix="%"
                    />,
                  ]}
            </div>

            {/* Operations pipeline */}
            <Section title="Operations pipeline">
              {loading || !d ? (
                <Skel className="h-[88px]" />
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {d.pipeline.map((s) => (
                    <Link
                      key={s.stageKey}
                      href={`/tracking?stage=${s.stageKey}`}
                      className="group rounded-[10px] border border-line bg-surface-2 p-3 transition-colors hover:border-accent hover:bg-accent-soft"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            STAGE_DOT[s.stageKey] ?? "bg-ink-muted",
                          )}
                        />
                        <span className="truncate">{s.label}</span>
                      </div>
                      <div className="num mt-1 text-2xl font-semibold text-ink">
                        {s.count}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            {/* Charts */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Section
                title="Order trend"
                className="md:col-span-2"
                action={
                  <div className="flex gap-1">
                    {(["orders", "value"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={metric === m}
                        onClick={() => setMetric(m)}
                        className={cn(
                          "rounded-pill px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                          metric === m
                            ? "bg-accent text-white"
                            : "border border-line-strong bg-surface-2 text-ink-soft hover:text-ink",
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                }
              >
                {loading || !d ? (
                  <Skel className="h-[232px]" />
                ) : (
                  <TrendChart data={d.trend} metric={metric} />
                )}
              </Section>

              <Section title="Status split">
                {loading || !d ? (
                  <Skel className="h-[232px]" />
                ) : (
                  <StatusDonut data={d.statusBreakdown} />
                )}
              </Section>

              <Section title="Delays">
                {loading || !d ? (
                  <Skel className="h-[232px]" />
                ) : (
                  <DelaysBar onTime={d.delays.onTime} late={d.delays.late} />
                )}
              </Section>
            </div>

            {/* Top lists */}
            <div className="grid gap-3 lg:grid-cols-3">
              <Section title="Top parties">
                {loading || !d ? (
                  <Skel className="h-[180px]" />
                ) : (
                  <TopBars
                    rows={d.topParties.map((p) => ({
                      label: p.party,
                      value: p.value,
                      sub: `${p.orders} order${p.orders === 1 ? "" : "s"}`,
                      display: `₹${formatNumber(p.value)}`,
                    }))}
                    barClass="bg-accent"
                    empty="No orders in this range."
                  />
                )}
              </Section>

              <Section title="Top fabrics">
                {loading || !d ? (
                  <Skel className="h-[180px]" />
                ) : (
                  <TopBars
                    rows={d.topFabrics.map((f) => ({
                      label: f.fabric,
                      value: f.meters,
                      sub: "meters",
                      display: `${formatNumber(f.meters)} m`,
                    }))}
                    barClass="bg-emerald-500"
                    empty="No fabrics in this range."
                  />
                )}
              </Section>

              <Section title="Recent orders">
                {loading || !d ? (
                  <Skel className="h-[180px]" />
                ) : d.recentOrders.length === 0 ? (
                  <Empty text="No orders in this range." />
                ) : (
                  <div className="flex flex-col">
                    {d.recentOrders.map((o) => (
                      <Link
                        key={o.id}
                        href={`/orders/${o.id}`}
                        className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink">
                            {o.orderNo}
                          </div>
                          <div className="truncate text-xs text-ink-muted">
                            {o.party} · {formatDate(o.orderDate)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="num text-sm font-medium text-ink">
                            ₹{formatNumber(o.value)}
                          </span>
                          <StatusBadge status={o.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {/* Attention */}
            <Section title="Needs attention">
              {loading || !d ? (
                <Skel className="h-[120px]" />
              ) : d.attention.length === 0 ? (
                <Empty text="Nothing overdue — you're on track." />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {d.attention.map((a) => (
                    <Link
                      key={a.orderId}
                      href={`/tracking/${a.orderId}`}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:border-danger/40"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">
                          {a.orderNo}
                          <span className="font-normal text-ink-muted">
                            {" "}
                            · {a.party}
                          </span>
                        </div>
                        <div className="text-xs text-ink-soft">
                          Stage: {a.stageLabel}
                        </div>
                      </div>
                      <span className="num shrink-0 rounded-pill bg-danger/10 px-2 py-1 text-xs font-semibold text-danger">
                        {a.daysOverdue}d overdue
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </Reveal>
      )}
    </div>
  );
}

// Per-stage dot colours (matches the tracking board / §9).
const STAGE_DOT: Record<string, string> = {
  order_entry: "bg-indigo-500",
  stock_checking: "bg-blue-500",
  rolling_checking: "bg-amber-500",
  challan: "bg-rose-500",
  bill: "bg-emerald-500",
  dispatch: "bg-violet-500",
  received_lr: "bg-cyan-500",
};

function Kpi({
  icon,
  label,
  value,
  prefix,
  suffix,
  tone,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  tone?: "indigo" | "green" | "amber" | "red" | "slate";
  trend?: { dir: "up" | "down"; text: string };
}) {
  return (
    <StatCard
      icon={icon}
      label={label}
      tone={tone}
      trend={trend}
      value={
        <NumberFlow
          value={value}
          prefix={prefix}
          suffix={suffix}
          format={{ maximumFractionDigits: 0 }}
        />
      }
    />
  );
}

function Section({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-size="sm" className={className}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TopBars({
  rows,
  barClass,
  empty,
}: {
  rows: { label: string; value: number; sub: string; display: string }[];
  barClass: string;
  empty: string;
}) {
  if (rows.length === 0) return <Empty text={empty} />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">
              {r.label}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset">
              <div
                className={cn("h-full rounded-full", barClass)}
                style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }}
              />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-sm font-medium text-ink">{r.display}</div>
            <div className="text-[11px] text-ink-muted">{r.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="grid place-items-center py-8 text-center text-sm text-ink-muted">
      {text}
    </div>
  );
}

function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-card bg-inset", className)} />;
}
