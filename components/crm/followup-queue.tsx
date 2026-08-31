"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  PhoneOffIcon,
  PhoneCallIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";

import { apiGet } from "@/lib/api-client";
import {
  PRIORITY_LABEL,
  type FollowupList,
  type FollowupRow,
  type FollowupSort,
  type FollowupStatus,
} from "@/lib/crm";
import { formatDate, formatNumber } from "@/lib/orders";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { HScroll } from "@/components/ui/h-scroll";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Segmented } from "@/components/ui/segmented";
import { Stars } from "@/components/ui/star-rating";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { Pill, PriorityBar, StatusPill } from "@/components/crm/crm-pill";
import { FollowupPanel } from "@/components/crm/followup-panel";

// The follow-up queue (CLAUDE.md §12, OE-P15). Ranked by priority, not date:
// a coordinator clearing 40 calls should reach the ₹18 L late order before the
// ₹40 K clean one.

type Range = "today" | "7" | "30" | "month" | "all";

const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "month", label: "This month" },
  { value: "all", label: "All" },
];

function rangeToDates(r: Range): { from: string; to: string } | null {
  if (r === "all") return null;
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (r === "today") return { from: to, to };
  if (r === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: first.toISOString().slice(0, 10), to };
  }
  const days = r === "7" ? 7 : 30;
  const from = new Date(now.getTime() - days * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to };
}

// The KPI cards double as filters (the Orders/Order-status pattern): clicking
// one narrows the list in place rather than navigating somewhere else.
type KpiKey = "dueToday" | "overdue" | "inProgress" | "completed30d" | "unreachable";


export function FollowupQueue({ canEdit }: { canEdit: boolean }) {
  const [range, setRange] = React.useState<Range>("all");
  const [sort, setSort] = React.useState<FollowupSort>("priority");
  const [rawSearch, setRawSearch] = React.useState("");
  const [kpi, setKpi] = React.useState<KpiKey | null>(null);
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Search runs as you type, like the order tracker — a slow round trip must
  // never read as "press Enter".
  const search = useDebouncedValue(rawSearch, 250);

  const dates = rangeToDates(range);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("sort", sort);
  // The card is sent as-is. The server applies the very same predicate it used
  // to compute the card's number, so the count and the rows always agree — and
  // the total, the page count and the pager stay correct.
  if (kpi) params.set("kpi", kpi);
  if (search) params.set("q", search);
  if (dates) {
    params.set("from", dates.from);
    params.set("to", dates.to);
  }
  const qs = params.toString();

  const q = useQuery({
    queryKey: ["crm-followups", qs],
    queryFn: () => apiGet<FollowupList>(`/api/crm/followups?${qs}`),
    placeholderData: (prev) => prev,
  });

  // Reset to page 1 whenever the filters change under our feet.
  React.useEffect(() => {
    setPage(1);
  }, [range, sort, search, kpi]);

  const data = q.data;
  const rows = data?.rows ?? [];
  const k = data?.kpis;
  const selected = rows.find((r) => r.id === openId) ?? null;

  const cards: { key: KpiKey; label: string; value: number; tone: "indigo" | "red" | "amber" | "green" | "slate"; icon: React.ReactNode }[] = [
    { key: "dueToday", label: "Due", value: k?.dueToday ?? 0, tone: "indigo", icon: <ClockIcon /> },
    { key: "overdue", label: "Call overdue", value: k?.overdue ?? 0, tone: "red", icon: <AlertTriangleIcon /> },
    { key: "inProgress", label: "In progress", value: k?.inProgress ?? 0, tone: "amber", icon: <PhoneCallIcon /> },
    { key: "completed30d", label: "Completed (30d)", value: k?.completed30d ?? 0, tone: "green", icon: <CheckCircle2Icon /> },
    { key: "unreachable", label: "Unreachable", value: k?.unreachable ?? 0, tone: "slate", icon: <PhoneOffIcon /> },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-sm">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRange(r.value)}
            className={cn(
              "cursor-pointer rounded-pill px-3.5 py-1.5 text-[12.5px] font-medium transition-colors duration-150",
              range === r.value
                ? "bg-accent text-white"
                : "text-ink-soft hover:bg-inset hover:text-ink",
            )}
          >
            {r.label}
          </button>
        ))}

        <div className="relative order-last ml-0 w-full min-w-0 sm:order-none sm:ml-1 sm:w-auto sm:min-w-[240px] sm:flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search order no or party…"
            className="h-9 pl-8"
          />
        </div>

        <button
          type="button"
          onClick={() => q.refetch()}
          title="Refresh"
          aria-label="Refresh"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-field border border-line bg-surface text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <RefreshCwIcon className={cn("size-4", q.isFetching && "animate-spin")} />
        </button>
      </div>

      {/* KPI row — each card filters the list in place */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1 [&>*]:w-[46vw] [&>*]:shrink-0 [&>*]:snap-start sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 sm:[&>*]:w-auto xl:grid-cols-5">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setKpi(kpi === c.key ? null : c.key)}
            aria-pressed={kpi === c.key}
            title={kpi === c.key ? `Showing only ${c.label.toLowerCase()} — click to clear` : `Show only ${c.label.toLowerCase()}`}
            className="cursor-pointer rounded-card text-left transition-transform focus-visible:outline-none active:scale-[.99]"
          >
            <StatCard
              icon={c.icon}
              label={c.label}
              value={c.value}
              tone={c.tone}
              sub={kpi === c.key ? "Filtering — click to clear" : undefined}
              className={cn(
                "h-full",
                kpi === c.key
                  ? "border-accent ring-2 ring-accent/40"
                  : "hover:border-line-strong",
              )}
            />
          </button>
        ))}
      </div>

      <Card>
        {/* One line. A title over a two-line paragraph above a card holding a
            single row spent a quarter of the screen explaining itself — the
            same fault the issues board and customers roll-up had. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5 sm:px-5">
          <CardTitle className="text-[15px]">Priority queue</CardTitle>
          {data ? (
            <span className="num rounded-pill bg-inset px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft">
              {data.total}
              {data.created > 0 ? ` · ${data.created} new` : ""}
            </span>
          ) : null}
          <span
            className="text-[11.5px] text-ink-soft"
            title="Ranked by order value, our own delay and prior complaints — not by date."
          >
            worst first · click a row to work it
          </span>
          <Segmented
            size="sm"
            className="ml-auto"
            ariaLabel="Sort"
            value={sort}
            onChange={(v) => setSort(v)}
            options={[
              { value: "priority", label: "Priority" },
              { value: "oldest", label: "Oldest" },
              { value: "value", label: "Value" },
            ]}
          />
        </div>

        <CardContent className="px-0">
          <HScroll bodyClassName="overflow-x-auto">
            <Table>
              <THead className="bg-inset">
                <tr>
                  <Th className="w-[14px] px-2" />
                  <Th>Order no</Th>
                  <Th>Party</Th>
                  <Th>Delivered</Th>
                  <Th className="text-right">Waiting</Th>
                  <Th className="text-right">Order value</Th>
                  <Th>Our SLA</Th>
                  <Th className="text-right">Attempts</Th>
                  <Th>Follow-up</Th>
                </tr>
              </THead>
              <tbody>
                {q.isLoading ? (
                  <tr>
                    <Td colSpan={9} className="px-4 py-10 text-center text-ink-soft">
                      Loading…
                    </Td>
                  </tr>
                ) : q.isError ? (
                  // A failed request must never render as "no results" — they
                  // look identical to the operator and one of them is a bug.
                  <tr>
                    <Td colSpan={9} className="px-4 py-10 text-center">
                      <div className="font-semibold text-danger">
                        Could not load the follow-up queue
                      </div>
                      <div className="mx-auto mt-1 max-w-[60ch] text-[12.5px] text-ink-soft">
                        {(q.error as Error)?.message ?? "Unknown error"}
                      </div>
                      <button
                        type="button"
                        onClick={() => q.refetch()}
                        className="mt-3 cursor-pointer rounded-field border border-line-strong px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-inset hover:text-ink"
                      >
                        Try again
                      </button>
                    </Td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <Td colSpan={9} className="px-4 py-10 text-center text-ink-soft">
                      No follow-ups match these filters.
                    </Td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <QueueRow
                      key={r.id}
                      row={r}
                      selected={r.id === openId}
                      onOpen={() => setOpenId(r.id)}
                    />
                  ))
                )}
              </tbody>
            </Table>
          </HScroll>

          {data && data.totalPages > 1 ? (
            <div className="border-t border-line px-4 py-2.5">
              <Pager
                page={data.page}
                totalPages={data.totalPages}
                onPage={setPage}
                busy={q.isFetching}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected ? (
        <FollowupPanel
          followupId={selected.id}
          row={selected}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSaved={() => q.refetch()}
        />
      ) : null}
    </div>
  );
}

function QueueRow({
  row,
  selected,
  onOpen,
}: {
  row: FollowupRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const overdue = row.daysOverdue > 0;
  return (
    <tr
      onClick={onOpen}
      className={cn(
        "cursor-pointer border-b border-line transition-colors",
        selected ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <Td className="px-2">
        <PriorityBar band={row.band} label={PRIORITY_LABEL[row.band]} />
      </Td>
      <Td className="num font-semibold">
        {row.orderNo}
        {row.isEscalated ? (
          <AlertTriangleIcon
            className="ml-1.5 inline size-3.5 text-danger align-[-2px]"
            aria-label="Escalated for review"
          />
        ) : null}
      </Td>
      <Td className="max-w-[260px]">
        <div className="truncate font-semibold text-ink">{row.partyName}</div>
        <div className="truncate text-[12px] text-ink-soft">
          {row.qualities} quality{row.qualities === 1 ? "" : "s"} · {row.designs}{" "}
          design{row.designs === 1 ? "" : "s"}
          {row.transport ? ` · ${row.transport}` : ""}
        </div>
      </Td>
      <Td className="num text-ink-soft">{formatDate(row.deliveredAt)}</Td>
      <Td className="num text-right">{row.daysWaiting} d</Td>
      <Td className="num text-right font-semibold">
        {row.orderValue > 0 ? `₹${formatNumber(row.orderValue)}` : "—"}
      </Td>
      <Td>
        {/* Two separate truths (§12.3). This column is OUR verdict — the
            customer's answer is captured on the call and can disagree. */}
        {row.systemOnTime === null ? (
          <span className="text-ink-soft">—</span>
        ) : row.systemOnTime ? (
          <Pill tone="done">On time</Pill>
        ) : (
          <Pill tone="late">Late</Pill>
        )}
      </Td>
      <Td className="num text-right">{row.attemptCount}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <StatusPill status={row.status as FollowupStatus} overdue={overdue} />
          {row.ratingOverall ? <Stars value={row.ratingOverall} /> : null}
          {row.openIssues > 0 ? (
            <Pill tone="warn" dot={false}>
              {row.openIssues} issue{row.openIssues === 1 ? "" : "s"}
            </Pill>
          ) : null}
        </div>
      </Td>
    </tr>
  );
}
