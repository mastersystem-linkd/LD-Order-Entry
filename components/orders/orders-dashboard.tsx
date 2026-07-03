"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ClipboardListIcon,
  ClockIcon,
  DownloadIcon,
  EyeIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatNumber, type OrderRow, type OrdersList } from "@/lib/orders";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDebouncedValue } from "@/lib/use-debounced-value";
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
  const [selected, setSelected] = React.useState<OrderRow | null>(null);
  const debouncedFilters = useDebouncedValue(filters, 300);

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

  const list = useQuery({
    queryKey: ["orders", { search, page, filters: debouncedFilters }],
    queryFn: () =>
      apiGet<OrdersList>(`/api/orders?${buildParams({ page: String(page) })}`),
    placeholderData: (prev) => prev,
  });

  // Any filter change resets to the first page.
  React.useEffect(() => {
    setPage(1);
  }, [debouncedFilters]);

  const del = useMutation({
    mutationFn: (id: string) => apiSend(`/api/orders/${id}`, "DELETE"),
    onSuccess: () => {
      toast.success(`Order ${toDelete?.order_no} deleted.`);
      setToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setToDelete(null);
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
        "Date",
        "Order no",
        "Party",
        "Haste",
        "Agent",
        "Fabrics",
        "Designs",
        "Qty",
        "Total Amount",
        "Challan",
        "Lot",
        "Status",
      ];
      const body = all.orders.map((o) => [
        o.order_date,
        o.order_no,
        o.party_name,
        o.haste ?? "",
        o.agent ?? "",
        o.fabrics.join(" | "),
        o.line_count,
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
  const rows = data?.orders ?? [];
  const pendingOnPage = rows.filter(
    (r) => r.operations_status === "PENDING",
  ).length;
  const completedOnPage = rows.filter(
    (r) => r.operations_status === "COMPLETED",
  ).length;
  const inProgressOnPage = rows.filter(
    (r) => r.operations_status === "PARTIALLY COMPLETED",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {/* KPIs — 2 per row on mobile, 4 across on desktop */}
      <Reveal index={0}>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <MiniStat
            tone="indigo"
            icon={<ClipboardListIcon />}
            label="Total orders"
            value={data ? formatNumber(data.total).replace(".00", "") : "—"}
            sub="All pages"
          />
          <MiniStat
            tone="green"
            icon={<CheckIcon />}
            label="Completed"
            value={data ? String(completedOnPage) : "—"}
            sub="This page"
          />
          <MiniStat
            tone="amber"
            icon={<ListChecksIcon />}
            label="In progress"
            value={data ? String(inProgressOnPage) : "—"}
            sub="This page"
          />
          <MiniStat
            tone="slate"
            icon={<ClockIcon />}
            label="Pending"
            value={data ? String(pendingOnPage) : "—"}
            sub="This page"
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
      ) : rows.length === 0 ? (
        <Card data-size="sm">
          <CardContent className="py-10 text-center text-sm text-ink-soft">
            No orders found{search ? ` for “${search}”` : ""}.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: one tappable card per order */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            {rows.map((o) => (
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
                    <Th>Date</Th>
                    <Th>Order no</Th>
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
                  {rows.map((o) => (
                    <tr
                      key={o.id}
                      className="border-b border-line transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <Td className="num whitespace-nowrap text-ink">
                        {o.order_date}
                      </Td>
                      <Td className="font-medium">
                        <Link
                          href={`/orders/${o.id}`}
                          className="hover:text-accent hover:underline"
                        >
                          {o.order_no}
                        </Link>
                      </Td>
                      <Td>{o.party_name}</Td>
                      <Td>{o.haste ?? "—"}</Td>
                      <Td>{o.agent ?? "—"}</Td>
                      <Td className="min-w-[160px] whitespace-normal text-ink">
                        {o.fabrics.length ? o.fabrics.join(", ") : "—"}
                      </Td>
                      <Td className="num text-right">{o.line_count}</Td>
                      <Td className="num text-right">
                        {formatNumber(o.qty_total)}
                      </Td>
                      <Td className="num text-right">
                        ₹{formatNumber(o.grand_total)}
                      </Td>
                      <Td>{o.challan_no ?? "—"}</Td>
                      <Td>{o.lot_no ?? "—"}</Td>
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
                  ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </>
      )}

      {/* Pagination */}
      {data && data.total_pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-soft">
            {data.total} order{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || list.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="num">
              {data.page} / {data.total_pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.total_pages || list.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
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
            <DialogTitle>Delete order</DialogTitle>
            <DialogDescription>
              Delete order{" "}
              <span className="font-medium text-ink">
                {toDelete?.order_no}
              </span>{" "}
              and all its line items and stage progress? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={del.isPending}
            >
              Cancel
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
                "Delete"
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
                value={String(selected.line_count)}
                mono
              />
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
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone: "indigo" | "green" | "amber" | "slate";
}) {
  const tile =
    tone === "green"
      ? "bg-success/10 text-success"
      : tone === "amber"
        ? "bg-warning/10 text-warning"
        : tone === "slate"
          ? "bg-inset text-ink-soft"
          : "bg-accent/10 text-accent";
  return (
    <div className="flex items-center gap-2.5 rounded-card border border-line bg-surface p-2.5 shadow-sm">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-[10px] [&_svg]:size-[17px] ${tile}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
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
    </div>
  );
}

function OrderCard({ o, onOpen }: { o: OrderRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-card border border-line bg-surface p-3 text-left shadow-sm transition-colors hover:border-line-strong active:scale-[.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="num font-semibold text-ink">{o.order_no}</div>
          <div className="truncate text-[13px] text-ink-soft">
            {o.party_name}
          </div>
        </div>
        <StatusBadge status={o.operations_status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
        <span className="num">{o.order_date}</span>
        <span className="num">
          {o.line_count} design{o.line_count === 1 ? "" : "s"}
        </span>
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
