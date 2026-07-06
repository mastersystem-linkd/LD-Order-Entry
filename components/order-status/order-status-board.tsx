"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
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
import type { Capability } from "@/lib/rbac";
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
  ColumnPicker,
  useColumnPrefs,
  type ColumnOption,
} from "@/components/order-status/column-picker";
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

// The desktop table's toggleable columns. `order` is the identity column and is
// locked on. Ids here are the single source of truth used by both the column
// picker and the header/body `isVisible()` guards, so they can never drift.
const STATUS_COLUMNS: ColumnOption[] = [
  { id: "order", label: "Order no", locked: true },
  { id: "date", label: "Date" },
  { id: "party", label: "Party" },
  { id: "haste", label: "Haste" },
  { id: "fabric", label: "Fabric" },
  { id: "designs", label: "Designs" },
  { id: "qty", label: "Total qty" },
  { id: "total", label: "Total" },
  { id: "challan", label: "Challan" },
  { id: "lot", label: "Lot" },
  { id: "sales", label: "Sales" },
  { id: "stages", label: "Stages (7)" },
  { id: "overall", label: "Overall" },
];

// Short labels for the 7 compact per-stage column headers (the full stage names
// are long; the column header just needs to name the stage).
const STAGE_SHORT: Record<string, string> = {
  order_entry: "Entry",
  stock_checking: "Stock",
  rolling_checking: "Rolling",
  challan: "Challan",
  bill: "Bill",
  dispatch: "Dispatch",
  received_lr: "LR",
};

export function OrderStatusBoard({
  caps,
  userKey,
}: {
  caps: Capability[];
  userKey?: string;
}) {
  // Initial filter can be deep-linked from the Dashboard KPI cards, e.g.
  // /order-status?overall=overdue or ?cancelled=1 or ?stage=challan.
  const params = useSearchParams();
  const [searchInput, setSearchInput] = React.useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [party, setParty] = React.useState("");
  const [fabric, setFabric] = React.useState("");
  const [stage, setStage] = React.useState(() => params.get("stage") ?? "");
  const [overall, setOverall] = React.useState<OverallStatus | "">(() => {
    const o = params.get("overall");
    return o === "in_progress" || o === "completed" || o === "overdue" ? o : "";
  });
  // Separate from `overall` because "cancelled" isn't an OverallStatus — a
  // cancelled order's derived overall is a vacuous "completed" (§ aggregate).
  const [cancelledOnly, setCancelledOnly] = React.useState(
    () => params.get("cancelled") === "1",
  );
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

  // Per-user column visibility (persisted in localStorage, keyed by user).
  const { hidden, isVisible, toggle, reset } = useColumnPrefs(
    `oe:order-status:cols:${userKey ?? "anon"}`,
    STATUS_COLUMNS,
  );

  const parties = useLookup("PARTY").data ?? [];
  const fabrics = useLookup("FABRIC").data ?? [];

  // Reset to page 1 whenever a filter changes.
  React.useEffect(() => {
    setPage(1);
  }, [search, party, fabric, stage, overall, cancelledOnly, debouncedFilters]);

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
  // Cancelled orders are counted on their own; the in-progress/completed/overdue
  // tallies are over ACTIVE (non-cancelled) groups so a cancelled order's vacuous
  // "completed" overall doesn't inflate the Completed card.
  const summary = React.useMemo(() => {
    const active = groups.filter((g) => !g.isCancelled);
    return {
      total: groups.length,
      inProgress: active.filter((g) => g.overall === "in_progress").length,
      completed: active.filter((g) => g.overall === "completed").length,
      overdue: active.filter((g) => g.overall === "overdue").length,
      // Count of cancelled DESIGNS (so a partially-cancelled order still shows).
      cancelled: allLines.filter((l) => l.isCancelled).length,
    };
  }, [groups, allLines]);

  const visibleGroups = React.useMemo(() => {
    let gs = groups;
    // Cancelled = any order that has at least one cancelled design (fully- or
    // partially-cancelled); its cancelled rows render struck through.
    if (cancelledOnly) gs = gs.filter((g) => (g.cancelledCount ?? 0) > 0);
    // The overall cards refine over ACTIVE groups (a fully-cancelled order's
    // overall is a vacuous "completed" — it belongs only under the Cancelled card).
    else if (overall)
      gs = gs.filter((g) => !g.isCancelled && g.overall === overall);
    if (stage) gs = gs.filter((g) => g.currentStageKey === stage);
    // Sorted by order date, newest first (with an order-no tie-break).
    return [...gs].sort(
      (a, b) =>
        (a.odDate < b.odDate ? 1 : a.odDate > b.odDate ? -1 : 0) ||
        a.orderNo.localeCompare(b.orderNo),
    );
  }, [groups, overall, cancelledOnly, stage]);

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
    setCancelledOnly(false);
    setFilters(EMPTY_ORDER_FILTERS);
  }
  const hasActiveFilters =
    !!(party || fabric || stage || overall || cancelledOnly) ||
    hasActiveOrderFilters(filters);

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
        "Cancelled",
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
          r.isCancelled
            ? "cancelled"
            : st.stageKey === "stock_checking"
              ? st.state === "done"
                ? "In stock"
                : st.stockStatus === "out_of_stock"
                  ? "Out of stock"
                  : "Pending"
              : st.state === "done"
                ? `Done ${st.date ? formatDate(st.date) : ""}`.trim()
                : st.state,
        ),
        `${r.doneCount}/7`,
        r.isCancelled ? "cancelled" : r.overall,
        r.isCancelled ? "Yes" : "No",
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
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        <SummaryCard
          icon={<ListChecksIcon />}
          tone="slate"
          label="Total orders"
          value={summary.total}
          active={overall === "" && !cancelledOnly}
          onClick={() => {
            setOverall("");
            setCancelledOnly(false);
          }}
        />
        <SummaryCard
          tone="amber"
          label="In progress"
          value={summary.inProgress}
          active={overall === "in_progress" && !cancelledOnly}
          onClick={() => {
            setOverall("in_progress");
            setCancelledOnly(false);
          }}
        />
        <SummaryCard
          tone="green"
          label="Completed"
          value={summary.completed}
          active={overall === "completed" && !cancelledOnly}
          onClick={() => {
            setOverall("completed");
            setCancelledOnly(false);
          }}
        />
        <SummaryCard
          tone="red"
          label="Overdue"
          value={summary.overdue}
          active={overall === "overdue" && !cancelledOnly}
          onClick={() => {
            setOverall("overdue");
            setCancelledOnly(false);
          }}
        />
        <SummaryCard
          icon={<BanIcon />}
          tone="rose"
          label="Cancelled"
          value={summary.cancelled}
          active={cancelledOnly}
          onClick={() => {
            setCancelledOnly(true);
            setOverall("");
          }}
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
          <div className="hidden shrink-0 lg:block">
            <ColumnPicker
              columns={STATUS_COLUMNS}
              hidden={hidden}
              onToggle={toggle}
              onReset={reset}
            />
          </div>
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
                      Order no
                    </Th>
                    {isVisible("date") && <Th>Date</Th>}
                    {isVisible("party") && <Th>Party</Th>}
                    {isVisible("haste") && <Th>Haste</Th>}
                    {isVisible("fabric") && <Th>Fabric</Th>}
                    {isVisible("designs") && (
                      <Th className="text-right">Designs</Th>
                    )}
                    {isVisible("qty") && <Th className="text-right">Total qty</Th>}
                    {isVisible("total") && <Th className="text-right">Total</Th>}
                    {isVisible("challan") && <Th>Challan</Th>}
                    {isVisible("lot") && <Th>Lot</Th>}
                    {isVisible("sales") && <Th>Sales</Th>}
                    {isVisible("stages") &&
                      STAGE_OPTIONS.map((s) => (
                        <Th key={s.key} className="text-center">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                STAGE_DOT[s.key] ?? "bg-ink-muted",
                              )}
                            />
                            {STAGE_SHORT[s.key] ?? s.label}
                          </span>
                        </Th>
                      ))}
                    {isVisible("overall") && <Th>Overall</Th>}
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map((g) => {
                    const isOpen = expanded.has(g.orderId);
                    const struck = g.isCancelled
                      ? "text-ink-muted line-through"
                      : "";
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
                          <Td className="sticky left-0 z-10 bg-surface shadow-[1px_0_0_var(--line)] group-hover:bg-surface-2 group-focus-visible:bg-surface-2">
                            <div className="flex items-center gap-1.5">
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
                              <span
                                className={cn(
                                  "num font-semibold whitespace-nowrap text-ink",
                                  struck,
                                )}
                              >
                                {g.orderNo}
                              </span>
                            </div>
                          </Td>
                          {isVisible("date") && (
                            <Td className="num whitespace-nowrap text-ink-soft">
                              {formatDate(g.odDate)}
                            </Td>
                          )}
                          {isVisible("party") && (
                            <Td
                              className={cn(
                                "max-w-[180px] truncate text-ink",
                                struck,
                              )}
                            >
                              <span title={g.party}>{g.party}</span>
                            </Td>
                          )}
                          {isVisible("haste") && (
                            <Td className="whitespace-nowrap text-ink-soft">
                              {g.haste ?? "—"}
                            </Td>
                          )}
                          {isVisible("fabric") && (
                            <Td
                              className={cn(
                                "max-w-[200px] truncate text-ink",
                                struck,
                              )}
                            >
                              <span title={g.fabrics.join(", ")}>
                                {g.fabrics.length === 1
                                  ? g.fabrics[0]
                                  : `${g.fabrics.length} fabrics`}
                              </span>
                            </Td>
                          )}
                          {isVisible("designs") && (
                            <Td
                              className={cn(
                                "num whitespace-nowrap text-right text-ink",
                                struck,
                              )}
                            >
                              {g.designCount}
                              {!g.isCancelled && g.cancelledCount > 0 ? (
                                <span
                                  className="ml-1 text-[11px] font-medium text-danger"
                                  title={`${g.cancelledCount} cancelled`}
                                >
                                  +{g.cancelledCount}
                                </span>
                              ) : null}
                            </Td>
                          )}
                          {isVisible("qty") && (
                            <Td
                              className={cn(
                                "num whitespace-nowrap text-right text-ink",
                                struck,
                              )}
                            >
                              {formatNumber(g.qtyTotal)}
                            </Td>
                          )}
                          {isVisible("total") && (
                            <Td
                              className={cn(
                                "num whitespace-nowrap text-right text-ink",
                                struck,
                              )}
                            >
                              ₹{formatNumber(g.grandTotal)}
                            </Td>
                          )}
                          {isVisible("challan") && (
                            <Td className="whitespace-nowrap text-ink-soft">
                              {g.challanNo ?? "—"}
                            </Td>
                          )}
                          {isVisible("lot") && (
                            <Td className="whitespace-nowrap text-ink-soft">
                              {g.lotNo ?? "—"}
                            </Td>
                          )}
                          {isVisible("sales") && (
                            <Td className="whitespace-nowrap text-ink-soft">
                              {g.salesPerson ?? "—"}
                            </Td>
                          )}
                          {isVisible("stages") &&
                            g.stages.map((c) => (
                              <Td key={c.stageKey} className="text-center">
                                {g.isCancelled ? (
                                  <span
                                    className="text-ink-muted"
                                    title="Cancelled"
                                  >
                                    –
                                  </span>
                                ) : (
                                  <StageChip cell={c} />
                                )}
                              </Td>
                            ))}
                          {isVisible("overall") && (
                            <Td>
                              {g.isCancelled ? (
                                <CancelledTag />
                              ) : (
                                <OverallBadge overall={g.overall} />
                              )}
                            </Td>
                          )}
                        </tr>

                        {/* Expanded design lines */}
                        {isOpen
                          ? g.lines.map((line) => {
                              const lstruck = line.isCancelled
                                ? "text-ink-muted line-through"
                                : "";
                              return (
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
                                className="group cursor-pointer border-b border-line bg-surface text-[13px] transition-colors outline-none last:border-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
                              >
                                <Td className="sticky left-0 z-10 bg-surface pl-8 shadow-[1px_0_0_var(--line)] group-hover:bg-surface-2 group-focus-visible:bg-surface-2">
                                  <div className="flex items-center gap-1.5">
                                    <ChevronRightIcon className="size-3.5 shrink-0 -rotate-45 text-ink-muted" />
                                    <span
                                      className={cn(
                                        "num font-medium text-ink",
                                        lstruck,
                                      )}
                                    >
                                      {line.design}
                                    </span>
                                  </div>
                                </Td>
                                {isVisible("date") && <Td />}
                                {isVisible("party") && <Td />}
                                {isVisible("haste") && <Td />}
                                {isVisible("fabric") && (
                                  <Td
                                    className={cn(
                                      "max-w-[200px] truncate text-ink",
                                      lstruck,
                                    )}
                                  >
                                    <span title={line.fabric}>{line.fabric}</span>
                                  </Td>
                                )}
                                {isVisible("designs") && <Td />}
                                {isVisible("qty") && (
                                  <Td
                                    className={cn(
                                      "num whitespace-nowrap text-right text-ink",
                                      lstruck,
                                    )}
                                  >
                                    {formatNumber(Number(line.qtyMtr))}
                                  </Td>
                                )}
                                {isVisible("total") && (
                                  <Td
                                    className={cn(
                                      "num whitespace-nowrap text-right text-ink",
                                      lstruck,
                                    )}
                                  >
                                    {line.lineTotal == null
                                      ? "—"
                                      : `₹${formatNumber(Number(line.lineTotal))}`}
                                  </Td>
                                )}
                                {isVisible("challan") && <Td />}
                                {isVisible("lot") && <Td />}
                                {isVisible("sales") && <Td />}
                                {isVisible("stages") &&
                                  line.stages.map((c) => (
                                    <Td key={c.stageKey} className="text-center">
                                      {line.isCancelled ? (
                                        <span
                                          className="text-ink-muted"
                                          title="Cancelled"
                                        >
                                          –
                                        </span>
                                      ) : (
                                        <StageChip cell={c} />
                                      )}
                                    </Td>
                                  ))}
                                {isVisible("overall") && (
                                  <Td>
                                    {line.isCancelled ? (
                                      <CancelledTag />
                                    ) : (
                                      <OverallBadge overall={line.overall} />
                                    )}
                                  </Td>
                                )}
                              </tr>
                              );
                            })
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
          caps={caps}
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
  tone: "slate" | "amber" | "green" | "red" | "rose";
  active: boolean;
  onClick: () => void;
}) {
  const dot =
    tone === "green"
      ? "bg-success"
      : tone === "amber"
        ? "bg-warning"
        : tone === "red" || tone === "rose"
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

// The order's current (bottleneck) stage as a compact badge: a stage-colour dot
// + stage name, tinted by urgency, with a muted sub-label for the detail. The
// stock-checking gate wins over the generic overdue/in-progress branches so it
// always reads "Out of stock" / "Pending", never a date or "In progress".
function CurrentStageBadge({
  stages,
  currentStageKey,
  aggregate,
}: {
  stages: StageCell[];
  currentStageKey: string | null;
  aggregate?: boolean;
}) {
  if (!currentStageKey) {
    return (
      <span className="inline-flex rounded-pill bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
        Completed
      </span>
    );
  }
  const cur = stages.find((s) => s.stageKey === currentStageKey);
  if (!cur) return <span className="text-ink-muted">—</span>;
  const label =
    STAGE_OPTIONS.find((o) => o.key === cur.stageKey)?.label ?? cur.label;

  let tone = "bg-warning/10 text-warning";
  let sub: string | null = null;
  if (cur.stageKey === "stock_checking") {
    // Stock gate wins: never a date / "In progress" (mirrors the drawer + CSV).
    if (cur.stockStatus === "out_of_stock") {
      tone = "bg-danger/10 text-danger";
      sub =
        aggregate && cur.outOf
          ? `${cur.outOf} of ${cur.totalLines} out of stock`
          : "Out of stock";
    } else {
      tone = "bg-inset text-ink-muted";
      sub =
        aggregate && cur.doneOf
          ? `${cur.doneOf} of ${cur.totalLines} in stock`
          : "Pending";
    }
  } else if (cur.state === "overdue") {
    tone = "bg-danger/10 text-danger";
    sub = cur.daysOverdue > 0 ? `${cur.daysOverdue}d late` : "Overdue";
  } else if (
    aggregate &&
    cur.doneOf != null &&
    cur.totalLines &&
    cur.doneOf > 0 &&
    cur.doneOf < cur.totalLines
  ) {
    sub = `${cur.doneOf} of ${cur.totalLines} lines`;
  }

  return (
    <div className="min-w-0">
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium",
          tone,
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            STAGE_DOT[cur.stageKey] ?? "bg-ink-muted",
          )}
        />
        <span className="truncate">{label}</span>
      </span>
      {sub ? (
        <div className="mt-0.5 truncate text-[11px] text-ink-muted">{sub}</div>
      ) : null}
    </div>
  );
}

// One stage's status as a compact, colour-coded cell for the 7 per-stage
// columns. The column header names the stage, so the cell carries only the
// status; hover shows the date/detail. On a parent (aggregate) row it folds the
// order's lines (n/m done, or a mixed stock count); on a child row it's that
// one line. Stock checking follows the In / Out / Pending gate.
function StageChip({ cell }: { cell: StageCell }) {
  const tip = cell.date ? ` · ${formatDate(cell.date)}` : "";
  const total = cell.totalLines ?? 0;

  if (cell.stageKey === "stock_checking") {
    if (cell.state === "done")
      return (
        <StageDot tone="success" title={`In stock${tip}`}>
          <CheckIcon className="size-3" />
        </StageDot>
      );
    const outOf = cell.outOf ?? 0;
    const inOf = cell.doneOf ?? 0;
    const pendOf = Math.max(0, total - inOf - outOf);
    // Mixed order: compact colour-coded counts (green in · red out · grey pend).
    if (total > 1 && inOf > 0 && (outOf > 0 || pendOf > 0))
      return (
        <span
          title={`${inOf} in stock · ${outOf} out of stock · ${pendOf} pending`}
          className="num inline-flex items-center gap-1 text-[11px] font-medium"
        >
          {inOf ? <span className="text-success">{inOf}✓</span> : null}
          {outOf ? <span className="text-danger">{outOf}✕</span> : null}
          {pendOf ? <span className="text-ink-muted">{pendOf}·</span> : null}
        </span>
      );
    if (outOf > 0 || cell.stockStatus === "out_of_stock")
      return (
        <StageDot tone="danger" title="Out of stock">
          Out
        </StageDot>
      );
    return (
      <StageDot tone="muted" title="Pending">
        –
      </StageDot>
    );
  }

  if (cell.state === "done")
    return (
      <StageDot tone="success" title={`Done${tip}`}>
        <CheckIcon className="size-3" />
      </StageDot>
    );
  if (cell.state === "overdue")
    return (
      <StageDot tone="danger" title="Overdue">
        {cell.daysOverdue > 0 ? `${cell.daysOverdue}d` : "!"}
      </StageDot>
    );
  if (cell.state === "in_progress") {
    if (total > 1 && cell.doneOf)
      return (
        <StageDot tone="warning" title={`${cell.doneOf} of ${total} done`}>
          {cell.doneOf}/{total}
        </StageDot>
      );
    return (
      <StageDot tone="warning" title="In progress">
        •
      </StageDot>
    );
  }
  return (
    <span className="text-ink-muted" title="Not started">
      –
    </span>
  );
}

// The little pill used by each per-stage status cell.
function StageDot({
  tone,
  title,
  children,
}: {
  tone: "success" | "danger" | "warning" | "muted";
  title: string;
  children: React.ReactNode;
}) {
  const cls = {
    success: "bg-success/10 text-success",
    danger: "bg-danger/10 text-danger",
    warning: "bg-warning/10 text-warning",
    muted: "bg-inset text-ink-muted",
  }[tone];
  return (
    <span
      title={title}
      className={cn(
        "num inline-flex min-w-[26px] items-center justify-center rounded-md px-1 py-0.5 text-[11px] font-medium whitespace-nowrap",
        cls,
      )}
    >
      {children}
    </span>
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
          <div
            className={cn(
              "num font-semibold text-ink",
              g.isCancelled && "text-ink-muted line-through",
            )}
          >
            {g.orderNo}
          </div>
          <div
            className={cn(
              "truncate text-[13px] text-ink-soft",
              g.isCancelled && "line-through",
            )}
          >
            {g.party}
          </div>
        </div>
        {g.isCancelled ? <CancelledTag /> : <OverallBadge overall={g.overall} />}
      </div>
      <div className="mt-1.5 truncate text-[12px] text-ink-muted">
        {g.fabrics.length} {g.fabrics.length === 1 ? "fabric" : "fabrics"}
      </div>
      <div className="mt-2 flex items-center gap-x-3 text-[12px] text-ink-muted">
        <span className="num">
          {g.designCount} design{g.designCount === 1 ? "" : "s"}
        </span>
        <span className="num">{formatNumber(g.qtyTotal)} mtr</span>
        {g.cancelledCount > 0 ? (
          <span className="num text-danger">{g.cancelledCount} cancelled</span>
        ) : null}
      </div>
      {g.isCancelled ? null : (
        <div className="mt-2.5">
          <CurrentStageBadge
            stages={g.stages}
            currentStageKey={g.currentStageKey}
            aggregate
          />
        </div>
      )}
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

// Shown in place of the overall badge on a cancelled order / design line.
function CancelledTag() {
  return (
    <span className="inline-flex rounded-pill bg-danger/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-danger">
      Cancelled
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
