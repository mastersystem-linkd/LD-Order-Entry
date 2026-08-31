"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  ClockIcon,
  PhoneCallIcon,
  StarIcon,
  TriangleAlertIcon,
} from "lucide-react";

import dynamic from "next/dynamic";

import { apiGet } from "@/lib/api-client";
import { categoryLabel, type CrmAnalytics } from "@/lib/crm";
import { formatCount } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import {
  CHART_BODY,
  CHART_COLOURS,
  CountBars,
  CoverageMeter,
  IntentTiles,
  OnTimeQuadrant,
  QueueBar,
} from "@/components/crm/crm-charts-lite";

const chartFallback = <div className="min-h-[188px]" />;
const RatingTrend = dynamic(
  () => import("@/components/crm/crm-charts").then((m) => m.RatingTrend),
  { ssr: false, loading: () => chartFallback },
);

// CRM analytics (CLAUDE.md §12.5.5, OE-P18) — what the follow-up work adds up
// to.
//
// The rule this screen is built on: an unworked queue must LOOK unworked.
// Every panel here would otherwise render a perfectly convincing zero — 0%
// complaints, a flat rating line, an empty Pareto — and a reader would take
// that as "nothing is wrong" when it means "nobody has called anyone". So
// each panel states what it still needs, and the coverage figure sits first
// because it is the number that qualifies every other number on the page.

const DEPT_LABEL: Record<string, string> = {
  OPS: "Operations",
  DISPATCH: "Dispatch",
  DESIGN: "Design",
  ACCOUNTS: "Accounts",
  TRANSPORT: "Transport",
  SALES: "Sales",
};

const inputCls =
  "h-9 rounded-field border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

/** A panel that has nothing to plot yet, and says why rather than drawing zero. */
function Awaiting({ need }: { need: string }) {
  return (
    <div className={cn("flex items-center justify-center px-5 pb-5 text-center", CHART_BODY)}>
      <p className="max-w-[280px] text-[12px] leading-relaxed text-ink-muted">
        {need}
      </p>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex h-full flex-col overflow-hidden p-0", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-2.5 sm:px-5">
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {note ? <span className="text-[11px] text-ink-muted">{note}</span> : null}
      </div>
      <CardContent className="flex-1 px-0 pt-0 pb-0">{children}</CardContent>
    </Card>
  );
}

export function CrmAnalyticsView() {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();

  const q = useQuery({
    queryKey: ["crm-analytics", qs],
    queryFn: () => apiGet<CrmAnalytics>(`/api/crm/analytics${qs ? `?${qs}` : ""}`),
    placeholderData: (prev) => prev,
  });

  const d = q.data;
  const worked = (d?.sampleSize ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Coverage first, and coverage loudest. Every other number on this page
          is a statement about the calls that were made; this is the one that
          says how many that was. */}
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<PhoneCallIcon />}
          label="Waiting to be called"
          value={d ? formatCount(d.funnel.due + d.funnel.inProgress) : "—"}
          sub={d ? `${formatCount(d.coverage.followups)} delivered in range` : undefined}
          tone={
            d && d.funnel.due + d.funnel.inProgress > 0 ? "amber" : "slate"
          }
        />
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<StarIcon />}
          label="Average rating"
          value={d?.ratings.avgOverall != null ? d.ratings.avgOverall.toFixed(1) : "—"}
          sub={d ? `${formatCount(d.ratings.rated)} rated` : undefined}
          tone="amber"
        />
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<TriangleAlertIcon />}
          label="Complaint rate"
          value={d?.complaints.ratePer100 != null ? `${d.complaints.ratePer100}` : "—"}
          sub="per 100 delivered orders"
          tone="red"
        />
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<ClockIcon />}
          label="Median resolution"
          value={d?.complaints.medianTatDays != null ? `${d.complaints.medianTatDays} d` : "—"}
          sub={d?.complaints.medianTatDays == null ? "nothing resolved yet" : undefined}
          tone="slate"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5">
        <span className="text-[11.5px] text-ink-soft">Delivered between</span>
        <input
          type="date"
          aria-label="From"
          className={inputCls}
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-[11px] text-ink-muted">to</span>
        <input
          type="date"
          aria-label="To"
          className={inputCls}
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
        />
        {from || to ? (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="cursor-pointer rounded-field px-1.5 py-1 text-[11px] font-medium text-ink-muted hover:bg-inset hover:text-ink"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-ink-muted">
          {d ? `${formatCount(d.coverage.followups)} follow-ups in range` : ""}
        </span>
      </div>

      {/* Said once, plainly, at the top — not repeated in eight empty panels. */}
      {d && !worked ? (
        <div className="rounded-card border-l-[3px] border-l-warning bg-warning/8 px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
          <b className="text-ink">No follow-up has been completed yet.</b> The
          queue holds{" "}
          <span className="num font-semibold">{formatCount(d.coverage.followups)}</span>{" "}
          orders waiting for a call. Until they are worked, every panel below is
          empty because nothing has happened — not because nothing is wrong.
        </div>
      ) : null}

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <Panel title="Coverage" note="the honesty metric — how many were actually called">
          {d && d.coverage.pct !== null ? (
            <CoverageMeter
              pct={d.coverage.pct}
              contacted={d.coverage.contacted}
              followups={d.coverage.followups}
            />
          ) : (
            <Awaiting need="No delivered orders in this range, so there is nothing to have called." />
          )}
        </Panel>

        <Panel title="Where the queue stands" note="every follow-up in range">
          {d && d.coverage.followups > 0 ? (
            <QueueBar
              parts={[
                { key: "due", label: "Waiting", count: d.funnel.due, color: CHART_COLOURS.due },
                { key: "prog", label: "In progress", count: d.funnel.inProgress, color: CHART_COLOURS.progress },
                { key: "done", label: "Completed", count: d.funnel.completed, color: CHART_COLOURS.done },
                { key: "unre", label: "Unreachable", count: d.funnel.unreachable, color: CHART_COLOURS.unreachable },
                { key: "nreq", label: "Not required", count: d.funnel.notRequired, color: CHART_COLOURS.notRequired },
              ]}
            />
          ) : (
            <Awaiting need="No delivered orders in this range, so there is no queue to describe." />
          )}
        </Panel>

        <Panel
          title="Our SLA vs the customer"
          note="where these disagree is the finding"
        >
          {d &&
          d.onTime.bothOnTime +
            d.onTime.bothLate +
            d.onTime.weLateTheyFine +
            d.onTime.weOnTimeTheyNot >
            0 ? (
            <>
              <OnTimeQuadrant data={d.onTime} />
              <p className="px-4 pb-4 text-[11.5px] leading-relaxed text-ink-muted sm:px-5">
                A large “late · they were fine” bar means the deadlines in
                Settings → Time tracking are tighter than the promise you
                actually make. Fix the config before reading anything into the
                on-time figure.
              </p>
            </>
          ) : (
            <Awaiting need="Needs completed calls where the customer answered the on-time question. This is the chart that calibrates the SLA, so it is worth the wait." />
          )}
        </Panel>

        <Panel title="Where the score is lost" note="by criterion, worst first">
          {d && d.ratings.subs.length > 0 ? (
            <CountBars
              tone="warning"
              outOf={5}
              rows={d.ratings.subs.map((x) => ({
                key: x.key,
                label: x.label,
                value: x.avg,
              }))}
            />
          ) : (
            <Awaiting need="Needs rated calls. Criteria are configured in Settings → CRM, so this chart follows whatever you decided to measure." />
          )}
        </Panel>

        <Panel title="Rating trend" note="monthly average of the overall score">
          {d && d.ratings.trend.length > 1 ? (
            <RatingTrend data={d.ratings.trend} />
          ) : (
            <Awaiting
              need={
                d && d.ratings.trend.length === 1
                  ? "One month of ratings so far — a trend needs at least two to compare."
                  : "Needs rated calls across two or more months before a trend means anything."
              }
            />
          )}
        </Panel>

        <Panel title="What keeps happening" note="complaints by category">
          {d && d.complaints.byCategory.length > 0 ? (
            <CountBars
              rows={d.complaints.byCategory.map((c) => ({
                key: c.key,
                label: categoryLabel(c.key),
                value: c.count,
              }))}
            />
          ) : (
            <Awaiting need="No complaints recorded in this range. With coverage still low that means nobody asked, not that nobody complained." />
          )}
        </Panel>

        <Panel title="Who has to act" note="complaints by department">
          {d && d.complaints.byDept.length > 0 ? (
            <CountBars
              rows={d.complaints.byDept.map((c) => ({
                key: c.key,
                label: DEPT_LABEL[c.key] ?? c.key,
                value: c.count,
              }))}
            />
          ) : (
            <Awaiting need="Needs complaints with a department assigned." />
          )}
        </Panel>

        <Panel title="Complaints by transport" note="who is damaging the goods">
          {d && d.complaints.byTransport.length > 0 ? (
            <CountBars
              rows={d.complaints.byTransport.map((c) => ({
                key: c.key,
                label: c.key,
                value: c.count,
              }))}
            />
          ) : (
            <Awaiting need="Needs complaints on orders that name a transport. This chart is only possible because an issue points at a line, not at a text box." />
          )}
        </Panel>

        <Panel title="Reorder signals" note="the commercial case for calling">
          {d && d.reorder.yes + d.reorder.maybe + d.reorder.sample > 0 ? (
            <>
              <IntentTiles
                rows={[
                  { key: "yes", label: "Buying again", value: d.reorder.yes, tone: "text-success" },
                  { key: "maybe", label: "Maybe", value: d.reorder.maybe, tone: "text-warning" },
                  { key: "sample", label: "Asked for a sample", value: d.reorder.sample, tone: "text-accent" },
                ]}
              />
              <p className="flex items-center gap-1.5 px-4 pb-4 text-[11.5px] text-ink-muted sm:px-5">
                <ArrowRightIcon className="size-3.5" />
                A post-delivery call reaches a customer at their warmest all
                quarter.
              </p>
            </>
          ) : (
            <Awaiting need="Needs calls where the coordinator asked what they need next. This is the line that pays for the call." />
          )}
        </Panel>
      </div>
    </div>
  );
}
