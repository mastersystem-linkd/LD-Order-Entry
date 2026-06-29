"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon, RouteIcon, SearchIcon } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { formatNumber, type OrdersList } from "@/lib/orders";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Reveal } from "@/components/ui/reveal";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";

export function TrackingIndex() {
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);

  const list = useQuery({
    queryKey: ["orders", { search, page }],
    queryFn: () =>
      apiGet<OrdersList>(
        `/api/orders?search=${encodeURIComponent(search)}&page=${page}`,
      ),
    placeholderData: (prev) => prev,
  });

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const data = list.data;
  const rows = data?.orders ?? [];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Pick an order to open its 7-stage workflow.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={applySearch} className="flex w-full max-w-md gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order no, party, challan, lot…"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <Button
          variant="outline"
          onClick={() => list.refetch()}
          disabled={list.isFetching}
        >
          {list.isFetching ? <Spinner /> : <RefreshCwIcon />} Refresh
        </Button>
      </div>

      <Reveal index={0}>
      <Card>
        <CardContent className="px-0">
          {list.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Spinner /> Loading orders…
            </div>
          ) : list.isError ? (
            <div className="px-4 py-10 text-sm text-danger">
              {(list.error as Error)?.message ?? "Failed to load orders."}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No orders found{search ? ` for “${search}”` : ""}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Order no</th>
                    <th className="px-3 py-2.5 font-medium">Party</th>
                    <th className="px-3 py-2.5 font-medium">Fabrics</th>
                    <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr
                      key={o.id}
                      className="border-b border-line transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <td className="num px-3 py-2.5 whitespace-nowrap text-ink-soft">
                        {o.order_date}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{o.order_no}</td>
                      <td className="px-3 py-2.5">{o.party_name}</td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-ink-muted">
                        {o.fabrics.length ? o.fabrics.join(", ") : "—"}
                      </td>
                      <td className="num px-3 py-2.5 text-right">
                        {formatNumber(o.qty_total)}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={o.operations_status} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
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
          <span className="tabular-nums">
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
    </div>
  );
}
