"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  DownloadIcon,
  EyeIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RouteIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatNumber, type OrderRow, type OrdersList } from "@/lib/orders";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { hasCap, type Capability } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Th, THead } from "@/components/ui/table";
import {
  appendOrderFilterParams,
  EMPTY_ORDER_FILTERS,
  hasActiveOrderFilters,
  OrderFilters,
  type OrderFilterState,
} from "@/components/orders/order-filters";
import {
  OrderDesignsList,
  OrderDesignsPanel,
} from "@/components/orders/order-designs";

// The KPI cards double as one-click status filters. "" = show all.
type StatusFilter =
  | ""
  | "COMPLETED"
  | "PARTIALLY COMPLETED"
  | "PENDING"
  | "cancelled";

export function OrdersDashboard({ caps }: { caps: Capability[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canEdit = hasCap(caps, "orders.edit");
  const canTrack = hasCap(caps, "operations.view");

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [showFilters, setShowFilters] = React.useState(false);
  const [filters, setFilters] =
    React.useState<OrderFilterState>(EMPTY_ORDER_FILTERS);
  const [exporting, setExporting] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<OrderRow | null>(null);
  const [toCancel, setToCancel] = React.useState<OrderRow | null>(null);
  const [selected, setSelected] = React.useState<OrderRow | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  // KPI-driven status filter (applied client-side over the full fetched set).
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("");
  const debouncedFilters = useDebouncedValue(filters, 300);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const buildParams = React.useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      appendOrderFilterParams(p, debouncedFilters);
      for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
      return p;
    },
    [search, debouncedFilters],
  );

  // Fetch the whole matching set (search + column filters still applied
  // server-side); the KPI status filter + pagination run client-side so the KPI
  // cards can show accurate all-orders counts and act as one-click filters.
  const list = useQuery({
    queryKey: ["orders", { search, filters: debouncedFilters }],
    queryFn: () => apiGet<OrdersList>(`/api/orders?${buildParams({ all: "1" })}`),
    placeholderData: (prev) => prev,
  });

  // Any filter / search / KPI-status change resets to the first page.
  React.useEffect(() => {
    setPage(1);
  }, [debouncedFilters, search, statusFilter]);

  // Whole-order delete is now a SOFT delete (moves every design to Trash,
  // restorable) — not the permanent hard delete. Purge-for-good lives in Trash.
  const del = useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/orders/${id}/delete`, "PATCH", {
        line_id: null,
        deleted: true,
      }),
    onSuccess: () => {
      toast.success(`Order ${toDelete?.order_no} deleted — moved to Trash.`);
      setToDelete(null);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order-status"] });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setToDelete(null);
    },
  });

  // Whole-order cancel/restore (toggles every design line). Restore is immediate;
  // cancel goes through a confirm dialog (setToCancel).
  const cancelOrder = useMutation({
    mutationFn: (vars: { id: string; cancelled: boolean }) =>
      apiSend(`/api/orders/${vars.id}/cancel`, "PATCH", {
        line_id: null,
        cancelled: vars.cancelled,
      }),
    onSuccess: (_res, vars) => {
      toast.success(vars.cancelled ? "Order cancelled." : "Order restored.");
      setToCancel(null);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", vars.id] });
      queryClient.invalidateQueries({ queryKey: ["order-status"] });
      queryClient.invalidateQueries({ queryKey: ["tracking", vars.id] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setToCancel(null);
    },
  });

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await apiGet<OrdersList>(
        `/api/orders?${buildParams({ all: "1" })}`,
      );
      const header = [
        "Order no",
        "Date",
        "Party",
        "Haste",
        "Agent",
        "Fabrics",
        "Designs",
        "Cancelled",
        "Qty",
        "Total Amount",
        "Challan",
        "Lot",
        "Status",
      ];
      const body = all.orders.map((o) => [
        o.order_no,
        o.order_date,
        o.party_name,
        o.haste ?? "",
        o.agent ?? "",
        o.fabrics.join(" | "),
        o.operations_status === "CANCELLED"
          ? o.total_line_count
          : o.line_count,
        o.cancelled_line_count,
        o.qty_total,
        o.grand_total,
        o.challan_no ?? "",
        o.lot_no ?? "",
        o.operations_status,
      ]);
      downloadCsv(
        `orders-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(header, body),
      );
      toast.success(`Exported ${all.orders.length} orders.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const data = list.data;
  const rows = React.useMemo(() => data?.orders ?? [], [data]);

  // Keep the mobile popup's header (a frozen `selected` snapshot) in sync with
  // the live list after an inline per-design cancel/delete; close it if the
  // order has vanished (its last design was deleted → fully-deleted order).
  React.useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.id === selected.id);
    if (fresh) {
      if (fresh !== selected) setSelected(fresh);
    } else if (!list.isFetching) {
      setSelected(null);
    }
  }, [rows, selected, list.isFetching]);

  // All-orders KPI counts (over the full fetched set).
  const kpi = React.useMemo(
    () => ({
      total: rows.length,
      completed: rows.filter((r) => r.operations_status === "COMPLETED").length,
      inProgress: rows.filter(
        (r) => r.operations_status === "PARTIALLY COMPLETED",
      ).length,
      pending: rows.filter((r) => r.operations_status === "PENDING").length,
      cancelledDesigns: rows.reduce((s, r) => s + r.cancelled_line_count, 0),
      ordersWithCancel: rows.filter((r) => r.cancelled_line_count > 0).length,
    }),
    [rows],
  );

  // Apply the active KPI status filter, then paginate client-side.
  const visibleRows = React.useMemo(() => {
    switch (statusFilter) {
      case "":
        return rows;
      case "cancelled":
        return rows.filter((r) => r.cancelled_line_count > 0);
      default:
        return rows.filter((r) => r.operations_status === statusFilter);
    }
  }, [rows, statusFilter]);

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visibleRows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* KPIs — 2 per row on mobile, 5 across on desktop */}
      <Reveal index={0}>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <MiniStat
            tone="indigo"
            icon={<ClipboardListIcon />}
            label="Total orders"
            value={data ? String(kpi.total) : "—"}
            sub="Show all"
            active={statusFilter === ""}
            onClick={() => setStatusFilter("")}
          />
          <MiniStat
            tone="green"
            icon={<CheckIcon />}
            label="Completed"
            value={data ? String(kpi.completed) : "—"}
            sub="Tap to filter"
            active={statusFilter === "COMPLETED"}
            onClick={() => setStatusFilter("COMPLETED")}
          />
          <MiniStat
            tone="amber"
            icon={<ListChecksIcon />}
            label="In progress"
            value={data ? String(kpi.inProgress) : "—"}
            sub="Tap to filter"
            active={statusFilter === "PARTIALLY COMPLETED"}
            onClick={() => setStatusFilter("PARTIALLY COMPLETED")}
          />
          <MiniStat
            tone="slate"
            icon={<ClockIcon />}
            label="Pending"
            value={data ? String(kpi.pending) : "—"}
            sub="Tap to filter"
            active={statusFilter === "PENDING"}
            onClick={() => setStatusFilter("PENDING")}
          />
          <MiniStat
            tone="rose"
            icon={<XCircleIcon />}
            label="Cancelled"
            value={data ? String(kpi.cancelledDesigns) : "—"}
            sub={
              data
                ? `in ${kpi.ordersWithCancel} order${kpi.ordersWithCancel === 1 ? "" : "s"}`
                : undefined
            }
            active={statusFilter === "cancelled"}
            onClick={() => setStatusFilter("cancelled")}
          />
        </div>
      </Reveal>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Search + actions on one line; wraps on mobile (search full width,
            buttons below). */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form onSubmit={applySearch} className="relative w-full sm:flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order no, party, challan, lot…"
              className="pl-8"
            />
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFilters((s) => !s)}
              aria-pressed={showFilters}
            >
              <SlidersHorizontalIcon /> Filters
              {hasActiveOrderFilters(debouncedFilters) ? (
                <span className="ml-1 size-1.5 rounded-full bg-accent" />
              ) : null}
            </Button>
            <Button
              variant="outline"
              onClick={() => list.refetch()}
              disabled={list.isFetching}
            >
              {list.isFetching ? <Spinner /> : <RefreshCwIcon />} Refresh
            </Button>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={exporting || !rows.length}
            >
              {exporting ? <Spinner /> : <DownloadIcon />} Export
            </Button>
            {canEdit ? (
              <Button onClick={() => router.push("/orders/new")}>
                <PlusIcon /> New order
              </Button>
            ) : null}
          </div>
        </div>
        {showFilters ? (
          <OrderFilters
            value={filters}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_ORDER_FILTERS)}
          />
        ) : null}
      </div>

      {/* Orders — cards on mobile, full table on desktop */}
      {list.isLoading ? (
        <Card data-size="sm">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-ink-soft">
            <Spinner /> Loading orders…
          </CardContent>
        </Card>
      ) : list.isError ? (
        <Card data-size="sm">
          <CardContent className="py-10 text-sm text-danger">
            {(list.error as Error)?.message ?? "Failed to load orders."}
          </CardContent>
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card data-size="sm">
          <CardContent className="py-10 text-center text-sm text-ink-soft">
            {statusFilter
              ? "No orders match this filter."
              : `No orders found${search ? ` for “${search}”` : ""}.`}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: one tappable card per order */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            {pageRows.map((o) => (
              <OrderCard key={o.id} o={o} onOpen={() => setSelected(o)} />
            ))}
          </div>

          {/* Desktop: full table */}
          <Reveal index={1}>
            <Card data-size="sm" className="hidden lg:block">
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-ink">
                    <THead>
                  <tr>
                    <Th>Order no</Th>
                    <Th>Date</Th>
                    <Th>Party</Th>
                    <Th>Haste</Th>
                    <Th>Agent</Th>
                    <Th>Fabrics</Th>
                    <Th className="text-right">Designs</Th>
                    <Th className="text-right">Total Qty</Th>
                    <Th className="text-right">Total Amount</Th>
                    <Th>Challan</Th>
                    <Th>Lot</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <tbody>
                  {pageRows.map((o) => {
                    const cancelled = o.operations_status === "CANCELLED";
                    const struck = cancelled
                      ? "text-ink-muted line-through"
                      : "";
                    const isOpen = expanded.has(o.id);
                    return (
                    <React.Fragment key={o.id}>
                    <tr className="border-b border-line transition-colors last:border-0 hover:bg-surface-2">
                      <Td className={cn("font-medium", struck)}>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleExpand(o.id)}
                            aria-expanded={isOpen}
                            aria-label={
                              isOpen
                                ? `Collapse ${o.order_no}`
                                : `Expand ${o.order_no} designs`
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
                          <Link
                            href={`/orders/${o.id}`}
                            className="hover:text-accent hover:underline"
                          >
                            {o.order_no}
                          </Link>
                        </div>
                      </Td>
                      <Td className={cn("num whitespace-nowrap text-ink", struck)}>
                        {o.order_date}
                      </Td>
                      <Td className={struck}>{o.party_name}</Td>
                      <Td className={struck}>{o.haste ?? "—"}</Td>
                      <Td className={struck}>{o.agent ?? "—"}</Td>
                      <Td
                        className={cn(
                          "min-w-[160px] whitespace-normal text-ink",
                          struck,
                        )}
                      >
                        {o.fabrics.length ? o.fabrics.join(", ") : "—"}
                      </Td>
                      <Td className={cn("num text-right", struck)}>
                        {cancelled ? o.total_line_count : o.line_count}
                        {!cancelled && o.cancelled_line_count > 0 ? (
                          <span
                            className="ml-1 text-[11px] font-medium text-danger"
                            title={`${o.cancelled_line_count} cancelled`}
                          >
                            +{o.cancelled_line_count}
                          </span>
                        ) : null}
                      </Td>
                      <Td className={cn("num text-right", struck)}>
                        {formatNumber(o.qty_total)}
                      </Td>
                      <Td className={cn("num text-right", struck)}>
                        ₹{formatNumber(o.grand_total)}
                      </Td>
                      <Td className={struck}>{o.challan_no ?? "—"}</Td>
                      <Td className={struck}>{o.lot_no ?? "—"}</Td>
                      <Td>
                        <StatusBadge status={o.operations_status} />
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <IconLink
                            href={`/orders/${o.id}`}
                            label="View"
                            icon={<EyeIcon />}
                          />
                          {canEdit ? (
                            <IconLink
                              href={`/orders/${o.id}/edit`}
                              label="Edit"
                              icon={<PencilIcon />}
                            />
                          ) : null}
                          {canTrack ? (
                            <IconLink
                              href={`/tracking/${o.id}`}
                              label="Track"
                              icon={<RouteIcon />}
                            />
                          ) : null}
                          {canEdit ? (
                            cancelled ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Restore order"
                                title="Restore order"
                                disabled={cancelOrder.isPending}
                                onClick={() =>
                                  cancelOrder.mutate({
                                    id: o.id,
                                    cancelled: false,
                                  })
                                }
                              >
                                <RotateCcwIcon />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Cancel order"
                                title="Cancel order"
                                className="text-danger hover:bg-danger/10 hover:text-danger"
                                onClick={() => setToCancel(o)}
                              >
                                <BanIcon />
                              </Button>
                            )
                          ) : null}
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Delete"
                              onClick={() => setToDelete(o)}
                              className="text-danger hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2Icon />
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-line bg-inset/40 last:border-0">
                        <td colSpan={13} className="p-0">
                          <OrderDesignsPanel orderId={o.id} caps={caps} />
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                    );
                  })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </>
      )}

      {/* Pagination (client-side over the filtered set) */}
      {visibleRows.length > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-soft">
            {visibleRows.length} order{visibleRows.length === 1 ? "" : "s"}
            {statusFilter ? " (filtered)" : ""}
          </span>
          {totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
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
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Delete confirmation */}
      <Dialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete order?</DialogTitle>
            <DialogDescription>
              Delete order{" "}
              <span className="font-medium text-ink">
                {toDelete?.order_no}
              </span>{" "}
              and all its designs? They move to Trash (hidden from lists and
              operations) and keep their stage progress. You can restore them
              from Trash anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={del.isPending}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() => toDelete && del.mutate(toDelete.id)}
              disabled={del.isPending}
            >
              {del.isPending ? (
                <>
                  <Spinner /> Deleting…
                </>
              ) : (
                <>
                  <Trash2Icon /> Delete order
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel-order confirmation (restore is immediate) */}
      <Dialog
        open={!!toCancel}
        onOpenChange={(open) => {
          if (!open) setToCancel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order?</DialogTitle>
            <DialogDescription>
              Cancel order{" "}
              <span className="font-medium text-ink">
                {toCancel?.order_no}
              </span>{" "}
              and all its designs? They stay on record (struck through) and are
              excluded from totals and operations. You can restore later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setToCancel(null)}
              disabled={cancelOrder.isPending}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                toCancel &&
                cancelOrder.mutate({ id: toCancel.id, cancelled: true })
              }
              disabled={cancelOrder.isPending}
            >
              {cancelOrder.isPending ? (
                <>
                  <Spinner /> Cancelling…
                </>
              ) : (
                <>
                  <BanIcon /> Cancel order
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order detail — mobile quick-view popup */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="num">{selected?.order_no}</span>
              {selected ? (
                <StatusBadge status={selected.operations_status} />
              ) : null}
            </DialogTitle>
            <DialogDescription>{selected?.party_name}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DetailItem term="Date" value={selected.order_date} mono />
              <DetailItem
                term="Department"
                value={selected.department ?? "—"}
              />
              <DetailItem
                term="Sales person"
                value={selected.sales_person ?? "—"}
              />
              <DetailItem term="Agent" value={selected.agent ?? "—"} />
              <DetailItem term="Haste" value={selected.haste ?? "—"} />
              <DetailItem
                term="Challan no"
                value={selected.challan_no ?? "—"}
                mono
              />
              <DetailItem term="Lot no" value={selected.lot_no ?? "—"} mono />
              <DetailItem
                term="Designs"
                value={String(
                  selected.operations_status === "CANCELLED"
                    ? selected.total_line_count
                    : selected.line_count,
                )}
                mono
              />
              {selected.cancelled_line_count > 0 ? (
                <DetailItem
                  term="Cancelled designs"
                  value={String(selected.cancelled_line_count)}
                  mono
                />
              ) : null}
              <DetailItem
                term="Total qty"
                value={`${formatNumber(selected.qty_total)} mtr`}
                mono
              />
              <DetailItem
                term="Grand total"
                value={`₹${formatNumber(selected.grand_total)}`}
                mono
              />
              <DetailItem
                term="Fabrics"
                value={
                  selected.fabrics.length ? selected.fabrics.join(", ") : "—"
                }
                className="col-span-2"
              />
            </dl>
          ) : null}
          {selected && canEdit ? (
            <div className="mt-1">
              <div className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-muted uppercase">
                Manage designs
              </div>
              <div className="max-h-[40vh] overflow-y-auto pr-0.5">
                <OrderDesignsList orderId={selected.id} caps={caps} />
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-row flex-wrap justify-end">
            {selected ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/orders/${selected.id}`} />}
              >
                <EyeIcon /> View
              </Button>
            ) : null}
            {selected && canEdit ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/orders/${selected.id}/edit`} />}
              >
                <PencilIcon /> Edit
              </Button>
            ) : null}
            {selected && canTrack ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/tracking/${selected.id}`} />}
              >
                <RouteIcon /> Track
              </Button>
            ) : null}
            {selected && canEdit ? (
              selected.operations_status === "CANCELLED" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelOrder.isPending}
                  onClick={() =>
                    cancelOrder.mutate({ id: selected.id, cancelled: false })
                  }
                >
                  <RotateCcwIcon /> Restore
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  onClick={() => {
                    const o = selected;
                    setSelected(null);
                    setToCancel(o);
                  }}
                >
                  <BanIcon /> Cancel
                </Button>
              )
            ) : null}
            {selected && canEdit ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  const o = selected;
                  setSelected(null);
                  setToDelete(o);
                }}
              >
                <Trash2Icon /> Delete
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className ?? ""}`}>
      {children}
    </td>
  );
}

function IconLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} render={<Link href={href} />}>
      {icon}
    </Button>
  );
}

function MiniStat({
  icon,
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone: "indigo" | "green" | "amber" | "slate" | "rose";
  active?: boolean;
  onClick?: () => void;
}) {
  const tile =
    tone === "green"
      ? "bg-success/10 text-success"
      : tone === "amber"
        ? "bg-warning/10 text-warning"
        : tone === "rose"
          ? "bg-danger/10 text-danger"
          : tone === "slate"
            ? "bg-inset text-ink-soft"
            : "bg-accent/10 text-accent";
  const inner = (
    <>
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-[10px] [&_svg]:size-[17px] ${tile}`}
      >
        {icon}
      </span>
      <div className="min-w-0 text-left">
        <div className="truncate text-[11px] font-medium text-ink-soft">
          {label}
        </div>
        <div className="num font-display text-[19px] font-semibold leading-tight text-ink">
          {value}
        </div>
        {sub ? (
          <div className="truncate text-[10px] text-ink-muted">{sub}</div>
        ) : null}
      </div>
    </>
  );
  if (!onClick) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border border-line bg-surface p-2.5 shadow-sm">
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2.5 rounded-card border bg-surface p-2.5 text-left shadow-sm transition-colors active:scale-[.99]",
        active
          ? "border-accent ring-2 ring-[var(--accent-ring)]"
          : "border-line hover:border-line-strong",
      )}
    >
      {inner}
    </button>
  );
}

function OrderCard({ o, onOpen }: { o: OrderRow; onOpen: () => void }) {
  const cancelled = o.operations_status === "CANCELLED";
  const designs = cancelled ? o.total_line_count : o.line_count;
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
              cancelled && "text-ink-muted line-through",
            )}
          >
            {o.order_no}
          </div>
          <div
            className={cn(
              "truncate text-[13px] text-ink-soft",
              cancelled && "line-through",
            )}
          >
            {o.party_name}
          </div>
        </div>
        <StatusBadge status={o.operations_status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
        <span className="num">{o.order_date}</span>
        <span className="num">
          {designs} design{designs === 1 ? "" : "s"}
        </span>
        {!cancelled && o.cancelled_line_count > 0 ? (
          <span className="num text-danger">
            {o.cancelled_line_count} cancelled
          </span>
        ) : null}
        <span className="num">{formatNumber(o.qty_total)} mtr</span>
        <span className="num ml-auto text-[14px] font-semibold text-ink">
          ₹{formatNumber(o.grand_total)}
        </span>
      </div>
    </button>
  );
}

function DetailItem({
  term,
  value,
  mono,
  className,
}: {
  term: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[12px] text-ink-muted">{term}</dt>
      <dd className={`font-medium break-words text-ink ${mono ? "num" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
