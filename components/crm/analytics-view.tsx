"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HourglassIcon,
  LayersIcon,
  PhoneCallIcon,
  ScaleIcon,
  ShoppingBagIcon,
  StarIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
} from "lucide-react";

import dynamic from "next/dynamic";

import { apiGet } from "@/lib/api-client";
import { categoryLabel, type CrmAnalytics } from "@/lib/crm";
import { formatCount } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import {
  CHART_COLOURS,
  CountBars,
  CoverageMeter,
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
    <div className="flex flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
      <span className="grid size-9 place-items-center rounded-full bg-inset text-ink-soft">
        <HourglassIcon className="size-4" />
      </span>
      <p className="max-w-[300px] text-[12.5px] leading-relaxed text-balance text-ink-soft">
        {need}
      </p>
    </div>
  );
}

function Panel({
  title,
  note,
  icon,
  aside,
  children,
  className,
}: {
  title: string;
  note?: string;
  /** Makes a wall of eight cards scannable — you find a panel by its mark. */
  icon?: React.ReactNode;
  /** A control that belongs to this panel, right-aligned in its header. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex h-full flex-col overflow-hidden p-0 transition-shadow duration-200 hover:shadow-md",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line/70 bg-surface-2/40 px-4 py-3 sm:px-5">
        {icon ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent [&_svg]:size-[15px]">
            {icon}
          </span>
        ) : null}
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {note ? <span className="text-[12px] font-medium text-ink-soft">{note}</span> : null}
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      <CardContent className="flex flex-1 flex-col justify-center px-0 pt-0 pb-0">
        {children}
      </CardContent>
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

  // One complaints panel, sliced three ways — the same "who has to act vs what
  // keeps happening" toggle the issues board uses, rather than three panels
  // drawing the same short list.
  const [slice, setSlice] = React.useState<"category" | "dept" | "transport">(
    "category",
  );
  const sliceRows = React.useMemo(() => {
    if (!d) return [];
    const pick =
      slice === "category"
        ? d.complaints.byCategory.map((c) => ({ key: c.key, label: categoryLabel(c.key), value: c.count }))
        : slice === "dept"
          ? d.complaints.byDept.map((c) => ({ key: c.key, label: DEPT_LABEL[c.key] ?? c.key, value: c.count }))
          : d.complaints.byTransport.map((c) => ({ key: c.key, label: c.key, value: c.count }));
    return pick;
  }, [d, slice]);

  const onTimeTotal = d
    ? d.onTime.bothOnTime + d.onTime.bothLate + d.onTime.weLateTheyFine + d.onTime.weOnTimeTheyNot
    : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Coverage first, and coverage loudest. Every other number on this page
          is a statement about the calls that were made; this is the one that
          says how many that was. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
          icon={<ShoppingBagIcon />}
          label="Reorder signals"
          value={d ? formatCount(d.reorder.yes + d.reorder.maybe + d.reorder.sample) : "—"}
          sub={
            d
              ? `${formatCount(d.reorder.yes)} buying again · ${formatCount(d.reorder.sample)} asked for a sample`
              : undefined
          }
          tone="green"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5">
        <span className="text-[12px] text-ink-soft">Delivered between</span>
        <input
          type="date"
          aria-label="From"
          className={inputCls}
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-[12px] text-ink-soft">to</span>
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
            className="cursor-pointer rounded-field px-1.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-inset hover:text-ink"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-[12px] text-ink-soft">
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

      {/* SIX panels, one per question worth asking. There were nine, and three
          of them — complaints by category, by department, by transport — were
          the same list grouped three ways, each drawing a single bar. They are
          one panel with a toggle now, the way the issues board already does
          it. Reorder intent lost its panel too: three numbers are a KPI tile,
          not a chart. */}
      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        {/* 1 — are we even calling anyone? Qualifies every other panel. */}
        <Panel icon={<PhoneCallIcon />}
          title="Coverage" note="the honesty metric">
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

        {/* 2 — where is the work? */}
        <Panel icon={<LayersIcon />}
          title="Where the queue stands" note="every follow-up in range">
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

        {/* 3 — is our deadline honest? The one panel a bar cannot replace. */}
        <Panel icon={<ScaleIcon />}
          title="Our deadline vs the customer" note="the disagreement is the finding">
          {d && onTimeTotal > 0 ? (
            <OnTimeQuadrant data={d.onTime} />
          ) : (
            <Awaiting need="Needs completed calls where the customer answered the on-time question. This is the panel that tells you whether the deadlines in Settings are the promise you actually make." />
          )}
        </Panel>

        {/* 4 — what are we losing marks on? Maps straight to a department. */}
        <Panel icon={<StarIcon />}
          title="Where the score is lost" note="average out of 5, worst first">
          {d && d.ratings.subs.length > 0 ? (
            <CountBars
              tone="warning"
              outOf={5}
              rows={d.ratings.subs.map((x) => ({ key: x.key, label: x.label, value: x.avg }))}
            />
          ) : (
            <Awaiting need="Needs rated calls. The criteria come from Settings → CRM, so this follows whatever you decided to measure." />
          )}
        </Panel>

        {/* 5 — getting better or worse? */}
        <Panel icon={<TrendingUpIcon />}
          title="Rating trend" note="monthly average of the overall score">
          {d && d.ratings.trend.length > 1 ? (
            <RatingTrend data={d.ratings.trend} />
          ) : (
            <Awaiting
              need={
                d && d.ratings.trend.length === 1
                  ? "One month of ratings so far — a trend needs two to compare."
                  : "Needs rated calls across two or more months."
              }
            />
          )}
        </Panel>

        {/* 6 — what is going wrong, sliced three ways in ONE panel. */}
        <Panel
          icon={<TriangleAlertIcon />}
          title="What is going wrong"
          note={
            d && d.complaints.medianTatDays != null
              ? `${d.complaints.total} complaints · median ${d.complaints.medianTatDays}d to close`
              : d
                ? `${d.complaints.total} complaints · none closed yet`
                : undefined
          }
          aside={
            <Segmented
              size="sm"
              ariaLabel="Group complaints by"
              value={slice}
              onChange={setSlice}
              options={[
                { value: "category", label: "What" },
                { value: "dept", label: "Who fixes" },
                { value: "transport", label: "Transport" },
              ]}
            />
          }
        >
          {d && sliceRows.length > 0 ? (
            <CountBars rows={sliceRows} />
          ) : (
            <Awaiting
              need={
                d && d.complaints.total === 0
                  ? "No complaints recorded in this range. With coverage this low that means nobody asked, not that nobody complained."
                  : "No complaint in this range carries that detail."
              }
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
