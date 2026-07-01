"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardListIcon,
  ClockIcon,
  EyeIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatNumber, type OrderRow, type OrdersList } from "@/lib/orders";
import type { Role } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { StatCard } from "@/components/ui/stat-card";
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

export function OrdersDashboard({ role }: { role: Role }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canEdit = role === "ADMIN" || role === "SALES";

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [toDelete, setToDelete] = React.useState<OrderRow | null>(null);

  const list = useQuery({
    queryKey: ["orders", { search, page }],
    queryFn: () =>
      apiGet<OrdersList>(
        `/api/orders?search=${encodeURIComponent(search)}&page=${page}`,
      ),
    placeholderData: (prev) => prev,
  });

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

  const data = list.data;
  const rows = data?.orders ?? [];
  const pendingOnPage = rows.filter(
    (r) => r.operations_status === "PENDING",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Stat cards */}
      <Reveal index={0}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            tone="indigo"
            icon={<ClipboardListIcon />}
            label="Total orders"
            value={data ? formatNumber(data.total).replace(".00", "") : "—"}
            sub="Across all pages"
          />
          <StatCard
            tone="amber"
            icon={<ClockIcon />}
            label="Pending"
            value={data ? String(pendingOnPage) : "—"}
            sub="On this page"
          />
          <StatCard
            tone="slate"
            icon={<LayersIcon />}
            label="Page"
            value={data ? `${data.page} / ${data.total_pages}` : "—"}
            sub={data ? `${data.page_size} per page` : undefined}
          />
        </div>
      </Reveal>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={applySearch} className="flex w-full gap-2 sm:max-w-md">
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            {list.isFetching ? <Spinner /> : <RefreshCwIcon />} Refresh
          </Button>
          {canEdit ? (
            <Button onClick={() => router.push("/orders/new")}>
              <PlusIcon /> New order
            </Button>
          ) : null}
        </div>
      </div>

      {/* Table */}
      <Reveal index={1}>
      <Card data-size="sm">
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    <Th>Date</Th>
                    <Th>Order no</Th>
                    <Th>Party</Th>
                    <Th>Challan</Th>
                    <Th>Lot</Th>
                    <Th>Fabrics</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr
                      key={o.id}
                      className="border-b border-line transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <Td className="num whitespace-nowrap text-ink-soft">
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
                      <Td>{o.challan_no ?? "—"}</Td>
                      <Td>{o.lot_no ?? "—"}</Td>
                      <Td className="max-w-[200px] truncate text-ink-muted">
                        {o.fabrics.length ? o.fabrics.join(", ") : "—"}
                      </Td>
                      <Td className="num text-right">
                        {formatNumber(o.qty_total)}
                      </Td>
                      <Td className="num text-right">
                        ₹{formatNumber(o.grand_total)}
                      </Td>
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
                          {role !== "SALES" ? (
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
          )}
        </CardContent>
      </Card>
      </Reveal>

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
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-4 py-2 font-medium ${className ?? ""}`}>{children}</th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2.5 ${className ?? ""}`}>{children}</td>;
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
