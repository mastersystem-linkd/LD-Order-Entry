"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  DownloadIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api-client";
import { formatNumber, type OrderRow, type OrdersList } from "@/lib/orders";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Reveal } from "@/components/ui/reveal";
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

export function TrackingIndex() {
  const router = useRouter();
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [showFilters, setShowFilters] = React.useState(false);
  const [filters, setFilters] =
    React.useState<OrderFilterState>(EMPTY_ORDER_FILTERS);
  const [exporting, setExporting] = React.useState(false);
  const [detail, setDetail] = React.useState<OrderRow | null>(null);
  const debouncedFilters = useDebouncedValue(filters, 300);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  // Shared /api/orders query string for the operations view. Every order is
  // trackable as soon as it's entered — challan + lot are optional.
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
    queryKey: [
      "orders",
      { search, page, filters: debouncedFilters, scope: "operations" },
    ],
    queryFn: () => apiGet<OrdersList>(`/api/orders?${buildParams({ page: String(page) })}`),
    placeholderData: (prev) => prev,
  });

  // Any filter or search change resets to the first page.
  React.useEffect(() => {
    setPage(1);
  }, [debouncedFilters]);

  React.useEffect(() => {
    setPage(1);
    setSearch(debouncedSearch.trim());
  }, [debouncedSearch]);

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await apiGet<OrdersList>(`/api/orders?${buildParams({ all: "1" })}`);
      const header = [
        "Order no",
        "Date",
        "Party",
        "Haste",
        "Agent",
        "Fabrics",
        "Designs",
        "Total Qty",
        "Total Amount",
        "Challan no",
        "Lot no",
        "Status",
      ];
      const body = all.orders.map((o) => [
        o.order_no,
        o.order_date,
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
        `operations-${new Date().toISOString().slice(0, 10)}.csv`,
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order no, party, challan, lot…"
              className="pl-8"
            />
          </div>
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
            <Button onClick={exportCsv} disabled={exporting || !rows.length}>
              {exporting ? <Spinner className="text-white" /> : <DownloadIcon />}{" "}
              Export
            </Button>
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

      <Reveal index={0}>
        <Card>
          <CardContent className="px-0">
            {list.isLoading ? (
              <div className="flex items-center gap-2 px-4 py-10 text-sm text-ink-soft">
                <Spinner /> Loading orders…
              </div>
            ) : list.isError ? (
              <div className="px-4 py-10 text-sm text-danger">
                {(list.error as Error)?.message ?? "Failed to load orders."}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-soft">
                No orders found{search ? ` for “${search}”` : ""}.
              </div>
            ) : (
              <>
              <div className="hidden overflow-x-auto md:block">
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
                      <Th>Challan no</Th>
                      <Th>Lot no</Th>
                      <Th>Status</Th>
                      <Th className="text-right" />
                    </tr>
                  </THead>
                  <tbody>
                    {rows.map((o) => (
                      <tr
                        key={o.id}
                        onClick={() => router.push(`/tracking/${o.id}`)}
                        className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2"
                      >
                        <td className="px-3 py-2 font-medium whitespace-nowrap">
                          {o.order_no}
                        </td>
                        <td className="num px-3 py-2 whitespace-nowrap">
                          {o.order_date}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.party_name}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.haste || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.agent || "—"}
                        </td>
                        <td className="px-3 py-2 min-w-[160px] whitespace-normal">
                          {o.fabrics.length ? o.fabrics.join(", ") : "—"}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {o.line_count}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {formatNumber(o.qty_total)}
                        </td>
                        <td className="num px-3 py-2 text-right whitespace-nowrap">
                          ₹{formatNumber(o.grand_total)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.challan_no || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.lot_no || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={o.operations_status} />
                        </td>
                        <td
                          className="px-3 py-2 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            render={<Link href={`/tracking/${o.id}`} />}
                          >
                            <RouteIcon /> Track
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: card list — tap a card for the detail popup */}
              <ul className="flex flex-col gap-2.5 p-3 md:hidden">
                {rows.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setDetail(o)}
                      className="flex w-full flex-col gap-2 rounded-field border border-line bg-surface p-3 text-left shadow-sm transition-colors hover:border-line-strong active:bg-surface-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">
                          {o.order_no}
                        </span>
                        <StatusBadge status={o.operations_status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="truncate text-ink-soft">
                          {o.party_name}
                        </span>
                        <span className="num shrink-0 text-ink-muted">
                          {o.order_date}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                        <span className="num">{o.line_count} designs</span>
                        <span className="num">
                          {formatNumber(o.qty_total)} mtr
                        </span>
                        {o.challan_no ? (
                          <span>Challan {o.challan_no}</span>
                        ) : null}
                        {o.haste ? <span>· {o.haste}</span> : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              </>
            )}
          </CardContent>
        </Card>
      </Reveal>

      {data && data.total_pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
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
      ) : null}

      {/* Order detail popup (used by the mobile card list). */}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="num">{detail?.order_no}</span>
              {detail ? (
                <StatusBadge status={detail.operations_status} />
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {detail?.party_name} ·{" "}
              <span className="num">{detail?.order_date}</span>
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Field label="Order no" value={detail?.order_no} mono />
            <Field label="Order date" value={detail?.order_date} mono />
            <Field label="Challan no" value={detail?.challan_no || "—"} />
            <Field label="Lot no" value={detail?.lot_no || "—"} />
            <Field
              label="Designs"
              value={detail ? String(detail.line_count) : ""}
              mono
            />
            <Field
              label="Total qty"
              value={detail ? `${formatNumber(detail.qty_total)} mtr` : ""}
              mono
            />
            <Field label="Haste" value={detail?.haste || "—"} />
            <Field label="Agent" value={detail?.agent || "—"} />
            <Field
              label="Party"
              value={detail?.party_name}
              className="col-span-2"
            />
            <Field
              label="Fabrics"
              value={detail?.fabrics.length ? detail.fabrics.join(", ") : "—"}
              className="col-span-2"
            />
          </dl>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
            <Button
              render={<Link href={detail ? `/tracking/${detail.id}` : "#"} />}
            >
              <RouteIcon /> Track workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-medium text-ink-muted">{label}</dt>
      <dd className={`font-medium break-words text-ink ${mono ? "num" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}
