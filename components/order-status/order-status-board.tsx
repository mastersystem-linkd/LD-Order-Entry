"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  ListChecksIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/orders";
import {
  aggregateOrderGroups,
  STAGE_DOT,
  STAGE_OPTIONS,
  type OrderStatusGroup,
  type OrderStatusList,
  type OverallStatus,
  type StageCell,
} from "@/lib/order-status";
import type { Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Th } from "@/components/ui/table";
import { useLookup } from "@/components/orders/use-lookups";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { StatusDrawer } from "@/components/order-status/status-drawer";
import {
  appendOrderFilterParams,
  EMPTY_ORDER_FILTERS,
  hasActiveOrderFilters,
  type OrderFilterState,
} from "@/components/orders/order-filters";

const OVERALL: Record<OverallStatus, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "bg-success/10 text-success" },
  in_progress: { label: "In progress", cls: "bg-warning/10 text-warning" },
  overdue: { label: "Overdue", cls: "bg-danger/10 text-danger" },
};

const selectCls =
  "h-9 rounded-field border border-line-strong bg-surface-2 px-2 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

// Orders per page (the board is now grouped by order, not by line).
const ORDERS_PER_PAGE = 20;

export function OrderStatusBoard({ role }: { role: Role }) {
  const [searchInput, setSearchInput] = React.useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [party, setParty] = React.useState("");
  const [fabric, setFabric] = React.useState("");
  const [stage, setStage] = React.useState("");
  const [overall, setOverall] = React.useState<OverallStatus | "">("");
  const [filters, setFilters] =
    React.useState<OrderFilterState>(EMPTY_ORDER_FILTERS);
  const debouncedFilters = useDebouncedValue(filters, 300);
  const [page, setPage] = React.useState(1);
  const [showFilters, setShowFilters] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selectedLineId, setSelectedLineId] = React.useState<string | null>(
    null,
  );
  const [exporting, setExporting] = React.useState(false);

  const parties = useLookup("PARTY").data ?? [];
  const fabrics = useLookup("FABRIC").data ?? [];

  // Reset to page 1 whenever a filter changes.
  React.useEffect(() => {
    setPage(1);
  }, [search, party, fabric, stage, overall, debouncedFilters]);

  // Server filters are line-attribute filters only. The derived bits
  // (overall / stage / pagination) are applied client-side after we roll lines
  // up into order groups, so `all=1` fetches the whole filtered set.
  const tableParams = React.useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (party) p.set("party", party);
    if (fabric) p.set("fabric", fabric);
    appendOrderFilterParams(p, debouncedFilters);
    p.set("all", "1");
    return p.toString();
  }, [search, party, fabric, debouncedFilters]);

  const q = useQuery({
    queryKey: [
      "order-status",
      { search, party, fabric, filters: debouncedFilters },
    ],
    queryFn: () => apiGet<OrderStatusList>(`/api/order-status?${tableParams()}`),
    placeholderData: (prev) => prev,
  });

  const allLines = React.useMemo(() => q.data?.rows ?? [], [q.data]);
  const groups = React.useMemo(
    () => aggregateOrderGroups(allLines),
    [allLines],
  );

  // Order-level summary (over all groups, before overall/stage refinement).
  const summary = React.useMemo(
    () => ({
      total: groups.length,
      inProgress: groups.filter((g) => g.overall === "in_progress").length,
      completed: groups.filter((g) => g.overall === "completed").length,
      overdue: groups.filter((g) => g.overall === "overdue").length,
    }),
    [groups],
  );

  const visibleGroups = React.useMemo(() => {
    let gs = groups;
    if (overall) gs = gs.filter((g) => g.overall === overall);
    if (stage) gs = gs.filter((g) => g.currentStageKey === stage);
    // Sorted by order date, newest first (with an order-no tie-break).
    return [...gs].sort(
      (a, b) =>
        (a.odDate < b.odDate ? 1 : a.odDate > b.odDate ? -1 : 0) ||
        a.orderNo.localeCompare(b.orderNo),
    );
  }, [groups, overall, stage]);

  const total = visibleGroups.length;
  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageGroups = visibleGroups.slice(
    (safePage - 1) * ORDERS_PER_PAGE,
    safePage * ORDERS_PER_PAGE,
  );

  // Flat line list for the drawer's prev/next (across the current page).
  const flatLines = React.useMemo(
    () => pageGroups.flatMap((g) => g.lines),
    [pageGroups],
  );
  const selectedIdx = selectedLineId
    ? flatLines.findIndex((l) => l.lineId === selectedLineId)
    : -1;

  function toggleExpand(orderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function clearFilters() {
    setParty("");
    setFabric("");
    setStage("");
    setOverall("");
    setFilters(EMPTY_ORDER_FILTERS);
  }
  const hasActiveFilters =
    !!(party || fabric || stage || overall) || hasActiveOrderFilters(filters);

  function exportCsv() {
    setExporting(true);
    try {
      // Export the exact rows the board shows across all pages (line-level
      // detail), built from visibleGroups so the "At stage" / "Overall"
      // refinement matches the view — the server applies those two line-level,
      // which would otherwise diverge from the group-level board.
      const lines = visibleGroups.flatMap((g) => g.lines);
      const header = [
        "Order no",
        "Party",
        "Fabric",
        "Design",
        "Mtr",
        "Sales",
        "OD date",
        ...STAGE_OPTIONS.map((s) => s.label),
        "Done",
        "Overall",
      ];
      const body = lines.map((r) => [
        r.orderNo,
        r.party,
        r.fabric,
        r.design,
        r.qtyMtr,
        r.salesPerson ?? "",
        r.odDate,
        ...r.stages.map((st) =>
          st.state === "done"
            ? `Done ${st.date ? formatDate(st.date) : ""}`.trim()
            : st.state,
        ),
        `${r.doneCount}/7`,
        r.overall,
      ]);
      const csv = [header, ...body]
        .map((row) => row.map(csvCell).join(","))
        .join("\n");
      download(csv, `order-status-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${lines.length} lines.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<ListChecksIcon />}
          tone="slate"
          label="Total orders"
          value={summary.total}
          active={overall === ""}
          onClick={() => setOverall("")}
        />
        <SummaryCard
          tone="amber"
          label="In progress"
          value={summary.inProgress}
          active={overall === "in_progress"}
          onClick={() => setOverall("in_progress")}
        />
        <SummaryCard
          tone="green"
          label="Completed"
          value={summary.completed}
          active={overall === "completed"}
          onClick={() => setOverall("completed")}
        />
        <SummaryCard
          tone="red"
          label="Overdue"
          value={summary.overdue}
          active={overall === "overdue"}
          onClick={() => setOverall("overdue")}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order no, party, fabric, design…"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowFilters((s) => !s)}
            aria-pressed={showFilters}
            aria-label="Filters"
            title="Filters"
            className="relative shrink-0"
          >
            <SlidersHorizontalIcon />
            {hasActiveFilters ? (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-surface" />
            ) : null}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            aria-label="Refresh"
            title="Refresh"
            className="shrink-0"
          >
            {q.isFetching ? <Spinner /> : <RefreshCwIcon />}
          </Button>
          <Button
            size="icon"
            onClick={exportCsv}
            disabled={exporting || !visibleGroups.length}
            aria-label="Export CSV"
            title="Export CSV"
            className="shrink-0"
          >
            {exporting ? <Spinner className="text-white" /> : <DownloadIcon />}
          </Button>
        </div>

        {showFilters ? (
          <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 p-2.5">
            <FilterSelect label="Party" value={party} onChange={setParty} options={parties} />
            <FilterSelect label="Fabric" value={fabric} onChange={setFabric} options={fabrics} />
            <select
              className={selectCls}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="At stage"
            >
              <option value="">Any stage</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  At: {s.label}
                </option>
              ))}
            </select>
            <Input
              value={filters.challanNo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, challanNo: e.target.value }))
              }
              placeholder="Challan no"
              aria-label="Challan no"
              className="h-9 w-[130px]"
            />
            <Input
              value={filters.lotNo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, lotNo: e.target.value }))
              }
              placeholder="Lot no"
              aria-label="Lot no"
              className="h-9 w-[110px]"
            />
            <Input
              value={filters.haste}
              onChange={(e) =>
                setFilters((f) => ({ ...f, haste: e.target.value }))
              }
              placeholder="Haste"
              aria-label="Haste"
              className="h-9 w-[110px]"
            />
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, from: e.target.value }))
                }
                aria-label="From date"
                className="num h-9 w-[150px]"
              />
              <span className="text-ink-muted">–</span>
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, to: e.target.value }))
                }
                aria-label="To date"
                className="num h-9 w-[150px]"
              />
            </div>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <XIcon /> Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Status list — cards on mobile, full grouped table on desktop */}
      {q.isLoading && !q.data ? (
        <Card data-size="sm">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-ink-soft">
            <Spinner /> Loading status…
          </CardContent>
        </Card>
      ) : q.isError ? (
        <Card data-size="sm">
          <CardContent className="py-10 text-sm text-danger">
            {(q.error as Error)?.message ?? "Failed to load."}
          </CardContent>
        </Card>
      ) : pageGroups.length === 0 ? (
        <Card data-size="sm">
          <CardContent className="py-12 text-center text-sm text-ink-muted">
            No orders match your filters.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: one tappable card per order → structured detail popup */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            {pageGroups.map((g) => (
              <OrderStatusCard
                key={g.orderId}
                g={g}
                onOpen={() => setSelectedLineId(g.lines[0]?.lineId ?? null)}
              />
            ))}
          </div>

          {/* Desktop: full grouped table */}
          <Card data-size="sm" className="hidden lg:block">
            <CardContent className="px-0">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-20 bg-surface">
                  <tr className="border-b border-line">
                    <Th className="sticky left-0 z-30 bg-surface shadow-[1px_1px_0_var(--line)]">
                      Date
                    </Th>
                    <Th>Order no</Th>
                    <Th>Party</Th>
                    <Th>Haste</Th>
                    <Th>Fabric</Th>
                    <Th className="text-right">Designs</Th>
                    <Th className="text-right">Total Qty</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Challan</Th>
                    <Th>Lot</Th>
                    <Th>Sales</Th>
                    {STAGE_OPTIONS.map((s) => (
                      <Th key={s.key} className="min-w-[104px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              STAGE_DOT[s.key] ?? "bg-ink-muted",
                            )}
                          />
                          {s.label}
                        </span>
                      </Th>
                    ))}
                    <Th className="min-w-[96px]">Progress</Th>
                    <Th>Overall</Th>
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map((g) => {
                    const isOpen = expanded.has(g.orderId);
                    return (
                      <React.Fragment key={g.orderId}>
                        {/* Order summary row */}
                        <tr
                          onClick={() =>
                            setSelectedLineId(g.lines[0]?.lineId ?? null)
                          }
                          tabIndex={0}
                          role="button"
                          aria-label={`Open ${g.orderNo} — ${g.party}, ${g.designCount} designs`}
                          onKeyDown={(e) => {
                            if (
                              (e.key === "Enter" || e.key === " ") &&
                              e.target === e.currentTarget
                            ) {
                              e.preventDefault();
                              setSelectedLineId(g.lines[0]?.lineId ?? null);
                            }
                          }}
                          className="group cursor-pointer border-b border-line transition-colors outline-none last:border-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
                        >
                          <Td className="num sticky left-0 z-10 bg-surface font-medium whitespace-nowrap text-ink shadow-[1px_0_0_var(--line)] group-hover:bg-surface-2 group-focus-visible:bg-surface-2">
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(g.orderId);
                                }}
                                aria-expanded={isOpen}
                                aria-label={
                                  isOpen
                                    ? `Collapse ${g.orderNo}`
                                    : `Expand ${g.orderNo}`
                                }
                                className="-m-1 rounded p-1 text-ink-muted transition-colors hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                              >
                                <ChevronRightIcon
                                  className={cn(
                                    "size-4 shrink-0 transition-transform",
                                    isOpen && "rotate-90",
                                  )}
                                />
                              </button>
                              {g.odDate}
                            </span>
                          </Td>
                          <Td className="num font-semibold whitespace-nowrap text-ink">
                            {g.orderNo}
                          </Td>
                          <Td className="whitespace-nowrap text-ink">{g.party}</Td>
                          <Td className="whitespace-nowrap text-ink">
                            {g.haste ?? "—"}
                          </Td>
                          <Td className="max-w-[220px] truncate text-ink">
                            {g.fabrics.join(", ")}
                          </Td>
                          <Td className="num text-right text-ink">
                            {g.designCount}
                          </Td>
                          <Td className="num whitespace-nowrap text-right text-ink">
                            {formatNumber(g.qtyTotal)}
                          </Td>
                          <Td className="num whitespace-nowrap text-right text-ink">
                            ₹{formatNumber(g.grandTotal)}
                          </Td>
                          <Td className="whitespace-nowrap text-ink">
                            {g.challanNo ?? "—"}
                          </Td>
                          <Td className="whitespace-nowrap text-ink">
                            {g.lotNo ?? "—"}
                          </Td>
                          <Td className="whitespace-nowrap text-ink">
                            {g.salesPerson ?? "—"}
                          </Td>
                          {g.stages.map((c) => (
                            <Td key={c.stageKey}>
                              <StageChip cell={c} />
                            </Td>
                          ))}
                          <Td>
                            <ProgressBar
                              stages={g.stages}
                              currentStageKey={g.currentStageKey}
                            />
                          </Td>
                          <Td>
                            <OverallBadge overall={g.overall} />
                          </Td>
                        </tr>

                        {/* Expanded design lines */}
                        {isOpen
                          ? g.lines.map((line) => (
                              <tr
                                key={line.lineId}
                                onClick={() => setSelectedLineId(line.lineId)}
                                tabIndex={0}
                                role="button"
                                aria-label={`Open ${g.orderNo} — ${line.fabric} ${line.design}`}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedLineId(line.lineId);
                                  }
                                }}
                                className="group cursor-pointer border-b border-line bg-surface-2/40 text-[13px] transition-colors outline-none last:border-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
                              >
                                <Td className="sticky left-0 z-10 bg-surface pl-8 text-ink-muted shadow-[1px_0_0_var(--line)] group-hover:bg-surface-2 group-focus-visible:bg-surface-2">
                                  <ChevronRightIcon className="size-3.5 -rotate-45 text-ink-muted" />
                                </Td>
                                <Td />
                                <Td />
                                <Td />
                                <Td className="whitespace-nowrap text-ink">
                                  {line.fabric}
                                </Td>
                                <Td className="num text-right text-ink">
                                  {line.design}
                                </Td>
                                <Td className="num whitespace-nowrap text-right text-ink">
                                  {formatNumber(Number(line.qtyMtr))}
                                </Td>
                                <Td className="num whitespace-nowrap text-right text-ink">
                                  {line.lineTotal == null
                                    ? "—"
                                    : `₹${formatNumber(Number(line.lineTotal))}`}
                                </Td>
                                <Td />
                                <Td />
                                <Td className="whitespace-nowrap text-ink">
                                  {line.salesPerson ?? "—"}
                                </Td>
                                {line.stages.map((c) => (
                                  <Td key={c.stageKey}>
                                    <StageChip cell={c} />
                                  </Td>
                                ))}
                                <Td>
                                  <ProgressBar
                                    stages={line.stages}
                                    currentStageKey={line.currentStageKey}
                                  />
                                </Td>
                                <Td>
                                  <OverallBadge overall={line.overall} />
                                </Td>
                              </tr>
                            ))
                          : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="num text-ink-soft">
            {total} order{total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1 || q.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="num">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages || q.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {/* Detail drawer (per design line) */}
      {selectedIdx >= 0 && flatLines[selectedIdx] ? (
        <StatusDrawer
          lineId={flatLines[selectedIdx].lineId}
          role={role}
          onClose={() => setSelectedLineId(null)}
          onPrev={() =>
            setSelectedLineId(
              flatLines[Math.max(0, selectedIdx - 1)].lineId,
            )
          }
          onNext={() =>
            setSelectedLineId(
              flatLines[Math.min(flatLines.length - 1, selectedIdx + 1)].lineId,
            )
          }
          hasPrev={selectedIdx > 0}
          hasNext={selectedIdx < flatLines.length - 1}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | undefined;
  tone: "slate" | "amber" | "green" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const dot =
    tone === "green"
      ? "bg-success"
      : tone === "amber"
        ? "bg-warning"
        : tone === "red"
          ? "bg-danger"
          : "bg-ink-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-card border bg-surface p-2.5 text-left shadow-sm transition-colors sm:p-3.5",
        active ? "border-accent ring-2 ring-[var(--accent-ring)]" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
        {icon ? (
          <span className="text-ink-muted [&_svg]:size-3.5">{icon}</span>
        ) : (
          <span className={cn("size-2 rounded-full", dot)} />
        )}
        {label}
      </div>
      <div className="num mt-0.5 text-[20px] font-semibold text-ink sm:mt-1 sm:text-[26px]">
        {value == null ? "—" : value}
      </div>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      className={selectCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      <option value="">{label}: any</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function StageChip({ cell }: { cell: StageCell }) {
  if (cell.state === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-1 text-[11px] font-medium text-success">
        <CheckIcon className="size-3 shrink-0" />
        <span className="num">{cell.date ? formatDate(cell.date) : "done"}</span>
      </span>
    );
  }
  if (cell.state === "in_progress") {
    // Order-level partial: show how many lines finished (e.g. 3/6).
    if (cell.totalLines && cell.doneOf != null && cell.doneOf > 0) {
      return (
        <span className="num inline-flex rounded-md bg-warning/10 px-1.5 py-1 text-[11px] font-medium text-warning">
          {cell.doneOf}/{cell.totalLines}
        </span>
      );
    }
    return (
      <span className="inline-flex rounded-md bg-warning/10 px-1.5 py-1 text-[11px] font-medium text-warning">
        In progress
      </span>
    );
  }
  if (cell.state === "overdue") {
    return (
      <span className="num inline-flex rounded-md bg-danger/10 px-1.5 py-1 text-[11px] font-medium text-danger">
        {cell.daysOverdue}d late
      </span>
    );
  }
  return <span className="text-ink-muted">–</span>;
}

function ProgressBar({
  stages,
  currentStageKey,
}: {
  stages: StageCell[];
  currentStageKey: string | null;
}) {
  const doneCount = stages.filter((s) => s.state === "done").length;
  return (
    <div
      role="img"
      aria-label={`${doneCount} of ${stages.length} stages done`}
      className="flex min-w-[84px] gap-0.5"
    >
      {stages.map((s) => (
        <span
          key={s.stageKey}
          title={s.label}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            s.state === "done"
              ? "bg-success"
              : s.stageKey === currentStageKey
                ? "bg-accent"
                : "bg-inset",
          )}
        />
      ))}
    </div>
  );
}

// Mobile-only summary card for one order group; tapping opens the detail popup.
function OrderStatusCard({
  g,
  onOpen,
}: {
  g: OrderStatusGroup;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-card border border-line bg-surface p-3 text-left shadow-sm transition-colors hover:border-line-strong active:scale-[.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="num font-semibold text-ink">{g.orderNo}</div>
          <div className="truncate text-[13px] text-ink-soft">{g.party}</div>
        </div>
        <OverallBadge overall={g.overall} />
      </div>
      <div className="mt-1.5 truncate text-[12px] text-ink-muted">
        {g.fabrics.join(", ")}
      </div>
      <div className="mt-2 flex items-center gap-x-3 text-[12px] text-ink-muted">
        <span className="num">
          {g.designCount} design{g.designCount === 1 ? "" : "s"}
        </span>
        <span className="num">{formatNumber(g.qtyTotal)} mtr</span>
        <span className="num ml-auto font-medium text-ink-soft">
          {g.doneCount}/7
        </span>
      </div>
      <div className="mt-2.5">
        <ProgressBar stages={g.stages} currentStageKey={g.currentStageKey} />
      </div>
    </button>
  );
}

function OverallBadge({ overall }: { overall: OverallStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-pill px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        OVERALL[overall].cls,
      )}
    >
      {OVERALL[overall].label}
    </span>
  );
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(content: string, filename: string) {
  const blob = new Blob(["﻿" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
